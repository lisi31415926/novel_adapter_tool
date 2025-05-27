# backend/app/services/background_analysis_service.py
import logging
import json
import asyncio
from typing import Optional, Dict, Any, List, Union, Tuple, Coroutine

# 新增：导入 nltk
try:
    import nltk
    # 检查punkt分词器是否可用，如果不可用则记录日志提示
    # logger 在模块级别可能尚未初始化，所以这里先用 print，或者将 logger 定义提前
    try:
        nltk.data.find('tokenizers/punkt')
    except nltk.downloader.DownloadError:
        print("NLTK 'punkt' tokenizer not found. Attempting to download...")
        nltk.download('punkt')
        print("'punkt' tokenizer downloaded successfully.")
except ImportError:
    nltk = None
    print("NLTK library not found. 'sentence' splitting strategy will not be available. Please run 'pip install nltk'.")


from sqlalchemy.ext.asyncio import AsyncSession # <- 修正：导入 AsyncSession
from langchain.text_splitter import RecursiveCharacterTextSplitter # 移到函数内部或检查是否真的需要全局
from tenacity import retry, stop_after_attempt, wait_exponential

# 从 app 包导入
from app import crud, schemas, models
from app.llm_orchestrator import LLMOrchestrator
# 从 app.exceptions 导入统一的异常
from app.exceptions import LLMAPIError, LLMAuthenticationError, LLMConnectionError, LLMRateLimitError, ContentSafetyException
from app.database import AsyncSessionLocal # <- 修正：导入 AsyncSessionLocal
from app.config_service import get_config
from app.tokenizer_service import estimate_token_count # <- 修正：改为 estimate_token_count
# from ..text_processing_utils import generate_unique_id, secure_filename # text_processing_utils 在 app/ 目录下
from app.text_processing_utils import generate_unique_id, secure_filename # 使用正确的相对导入
from app.services.prompt_engineering_service import PromptEngineeringService
# from app.services.tokenizer_service import TokenizerService # TokenizerService 已被 estimate_token_count 替代部分功能

logger = logging.getLogger(__name__)

# 全局初始化LLMOrchestrator (保持原样)
llm_orchestrator = LLMOrchestrator()

# --- 静态工具函数 ---
def _get_text_splitter(strategy: str, chunk_size: int, chunk_overlap: int, tokenizer_model_user_id_ref: Optional[str]) -> RecursiveCharacterTextSplitter: # <- 修正：添加 tokenizer_model_user_id_ref
    """根据策略获取文本分割器"""
    if strategy == 'token':
        try:
            # TokenizerService 实例化移除，直接使用 estimate_token_count
            def _token_length_sync(text_to_count: str) -> int:
                return estimate_token_count(text_to_count, model_user_id=tokenizer_model_user_id_ref)

            return RecursiveCharacterTextSplitter(
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                length_function=_token_length_sync,
                separators=["\n\n", "\n", "。", "！", "？", "，", "、", " ", ""],
                is_separator_regex=False,
            )
        except Exception as e:
            logger.warning(f"无法初始化基于Token的分割器，回退到基于字符的分割: {e}")

    # 默认或回退策略：基于字符
    # 字符估算因子应从配置获取
    char_factor = get_config().llm_settings.tokenizer_options.default_chars_per_token_general or 2.5
    return RecursiveCharacterTextSplitter(
        chunk_size=int(chunk_size * char_factor),
        chunk_overlap=int(chunk_overlap * char_factor),
        length_function=len,
        separators=["\n\n", "\n", "。", "！", "？", "，", "、", " ", ""],
        is_separator_regex=False,
    )

def _split_text_into_chunks(
    text: str,
    chunk_config: Dict[str, Any], # 包含 strategy, chunk_size, chunk_overlap, tokenizer_model
    target_model_user_id_for_tokenizer: Optional[str] = None
) -> List[str]: # <- 修正：移除了多余的 strategy 参数，它现在从 chunk_config 获取
    """使用不同策略将文本分割成块。"""
    if not text or not text.strip():
        return []
    
    effective_strategy = chunk_config.get("strategy", 'recursive')
    chunk_size_cfg = chunk_config.get("chunk_size", 1500)
    chunk_overlap_cfg = chunk_config.get("chunk_overlap", 150)
    # tokenizer_model_user_id_ref 现在用于 _get_text_splitter
    tokenizer_model_user_id_ref = target_model_user_id_for_tokenizer or chunk_config.get("tokenizer_model")

    log_prefix = "[TextSplitter]"

    if effective_strategy == 'sentence':
        if nltk:
            try:
                logger.debug(f"{log_prefix} 使用 'sentence' 策略进行文本分割。")
                return nltk.sent_tokenize(text) # language='english' 可能不适合中文
            except Exception as e_nltk:
                logger.error(f"{log_prefix} 使用 NLTK sent_tokenize 分割时出错: {e_nltk}。将回退到 'recursive' 策略。")
                effective_strategy = 'recursive' # 明确回退
        else:
            logger.warning(f"{log_prefix} 请求使用 'sentence' 策略，但 NLTK 未安装。将回退到 'recursive' 策略。")
            effective_strategy = 'recursive' # 明确回退
    
    if effective_strategy == 'recursive': # 确保在回退后执行此逻辑
        logger.debug(f"{log_prefix} 使用 'recursive' (token-based 或 character-based) 策略进行文本分割。")
        try:
            # from langchain.text_splitter import RecursiveCharacterTextSplitter # 移到全局或_get_text_splitter
            text_splitter = _get_text_splitter(
                'token', # 总是先尝试token 기반
                chunk_size_cfg,
                chunk_overlap_cfg,
                tokenizer_model_user_id_ref
            )
            split_chunks = text_splitter.split_text(text)
            logger.debug(f"{log_prefix} 文本基于Token估算分割为 {len(split_chunks)} 块。")
            return split_chunks
        except ImportError: # langchain 可能未安装
            logger.warning(f"{log_prefix} langchain.text_splitter 未安装或初始化失败。无法进行基于Token的分割。")
        except Exception as e_token_split:
            logger.warning(f"{log_prefix} 基于Token的文本分割失败 ({e_token_split})。")
        
        # 如果基于Token的分割失败或Langchain不可用，则回退到基于字符的分割
        logger.warning(f"{log_prefix} 回退到基于字符的文本分割。")
        try:
            text_splitter_char = _get_text_splitter(
                'character', # 明确指定字符策略
                chunk_size_cfg,
                chunk_overlap_cfg,
                None # 字符分割不需要tokenizer模型参考
            )
            split_chunks_char = text_splitter_char.split_text(text)
            logger.debug(f"{log_prefix} 文本基于字符估算分割为 {len(split_chunks_char)} 块。")
            return split_chunks_char
        except Exception as e_char_split_final:
            logger.error(f"{log_prefix} 最终尝试基于字符分割时也发生错误: {e_char_split_final}。返回整个文本。")
            return [text] # 作为最差情况返回
    
    logger.error(f"{log_prefix} 未能确定有效的分割策略。返回整个文本。")
    return [text] # 最后的保障

# --- 结果合并策略 (保持原样，但确保日志和调用正确) ---
def _merge_sentiment_results(chunk_results: List[Dict[str, Any]], log_prefix: str) -> Optional[Dict[str, Any]]:
    if not chunk_results: return None
    valid_scores = [res.get("overall_sentiment_score") for res in chunk_results if isinstance(res.get("overall_sentiment_score"), (int, float))]
    all_labels = [res.get("overall_sentiment_label") for res in chunk_results if res.get("overall_sentiment_label") and isinstance(res.get("overall_sentiment_label"), str)]
    if not valid_scores:
        logger.warning(f"{log_prefix} 合并情感结果时未找到有效 sentiment_score。")
        return chunk_results[0] if chunk_results else {"error": "所有块均无有效情感数据"}
    avg_score = sum(valid_scores) / len(valid_scores)
    dominant_label = "neutral"
    if all_labels:
        from collections import Counter
        label_counts = Counter(all_labels)
        if label_counts:
            dominant_label = label_counts.most_common(1)[0][0]
    combined_details_parts = []
    for res in chunk_results:
        if isinstance(res, dict) and res.get("details"):
            if isinstance(res["details"], list): combined_details_parts.extend(res["details"])
            elif isinstance(res["details"], str): combined_details_parts.append(res["details"])
    return {"overall_sentiment_label": dominant_label, "overall_sentiment_score": round(avg_score, 4), "num_chunks_analyzed": len(chunk_results), "details": combined_details_parts or None }

def _merge_list_results(chunk_results: List[Any], log_prefix: str, item_key_for_deduplication: Optional[str] = None) -> List[Any]:
    merged_list: List[Any] = []
    for res_item in chunk_results:
        if isinstance(res_item, list): merged_list.extend(res_item)
        elif isinstance(res_item, dict): merged_list.append(res_item)
    
    if not item_key_for_deduplication or not all(isinstance(item, dict) for item in merged_list):
        try:
            return list(set(merged_list)) if all(isinstance(i, (str, int, float, bool, tuple)) for i in merged_list) else merged_list
        except TypeError:
            return merged_list # 如果包含不可哈希类型，无法去重，直接返回

    seen_identifiers = set()
    unique_items_list = []
    for item_dict in merged_list: # 此时 merged_list 包含字典
        identifier = item_dict.get(item_key_for_deduplication)
        if identifier is not None:
            identifier_hashable = tuple(sorted(identifier)) if isinstance(identifier, list) else identifier # 尝试哈希列表
            try:
                if identifier_hashable not in seen_identifiers:
                    unique_items_list.append(item_dict)
                    seen_identifiers.add(identifier_hashable)
            except TypeError: # 捕获列表或字典等不可哈希类型的错误
                logger.warning(f"{log_prefix} 去重时遇到不可哈希标识符 '{identifier_hashable}' (类型: {type(identifier)})，此条目直接添加。")
                unique_items_list.append(item_dict) # 直接添加不可哈希的项
        else:
            unique_items_list.append(item_dict) # 没有去重键的也直接添加
    logger.info(f"{log_prefix} 合并了 {len(merged_list)} 项目，去重后 {len(unique_items_list)} (键: {item_key_for_deduplication})。")
    return unique_items_list

def _merge_summary_results(chunk_summaries: List[str], log_prefix: str) -> str:
    if not chunk_summaries: return ""
    return "\n\n".join(s.strip() for s in chunk_summaries if s and s.strip())


class BackgroundAnalysisService:
    """
    一个完全异步的服务类，用于处理后台分析任务。
    """

    @staticmethod
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    async def _analyze_single_chunk(
        db: AsyncSession, # <- 修正：使用 AsyncSession
        task_schema_for_prompt: schemas.RuleStepPublic, # 使用一个固定的schema结构来构建prompt
        chunk_text: str,
        model_id_for_llm: Optional[str], 
        novel_id_for_context: Optional[int], 
        log_prefix: str,
        task_name_for_log: str # 用于日志的清晰任务名
    ) -> Tuple[Optional[Any], Optional[Dict[str, str]]]: # -> 修正：返回 Tuple[Optional[Any], Optional[Dict[str, str]]]
        """
        [异步重构] 核心块分析逻辑，使用 PromptEngineeringService 和 LLMOrchestrator。
        """
        analysis_result_chunk = None
        error_info_chunk = None
        
        # PromptEngineeringService 需要 db 和 orchestrator，而 orchestrator 在此类外部实例化
        prompt_engineer = PromptEngineeringService(db_session=db, llm_orchestrator=llm_orchestrator)
        
        try:
            novel_model_obj_for_prompt = None
            if novel_id_for_context:
                 novel_model_obj_for_prompt = await db.get(models.Novel, novel_id_for_context) # <- 修正：使用 await

            prompt_data = await prompt_engineer.build_prompt_for_step(
                rule_step_schema=task_schema_for_prompt, # 使用传入的schema
                novel_id=novel_id_for_context or 0, # 确保novel_id有效
                novel_obj=novel_model_obj_for_prompt,
                dynamic_params={}, # 对于纯文本分析任务，通常没有复杂的动态参数
                main_input_text=chunk_text
            )
            
            response = await llm_orchestrator.generate(
                model_id=model_id_for_llm,
                prompt=prompt_data.user_prompt,
                system_prompt=prompt_data.system_prompt,
                is_json_output=prompt_data.is_json_output_hint,
                temperature=0.1 # 可以考虑从task_schema_for_prompt或配置中获取
            )
            
            llm_output = response.text # response.text 而不是 response.content

            if prompt_data.is_json_output_hint:
                try:
                    json_str_parsed = llm_output
                    match_json_md = re.search(r"```json\s*([\s\S]+?)\s*```", llm_output, re.DOTALL | re.IGNORECASE)
                    if match_json_md:
                        json_str_parsed = match_json_md.group(1).strip()
                    analysis_result_chunk = json.loads(json_str_parsed)
                except json.JSONDecodeError as e_json:
                    logger.error(f"{log_prefix} 任务 '{task_name_for_log}' 的块LLM输出不是有效JSON: {e_json}. 输出预览: {llm_output[:200]}")
                    error_info_chunk = {"task": task_name_for_log, "error": "JSON解析失败", "details": str(e_json), "raw_output_preview": llm_output[:150]}
            else:
                analysis_result_chunk = llm_output.strip()

        except ContentSafetyException as e_safety:
            logger.error(f"{log_prefix} 任务 '{task_name_for_log}' 的块因内容安全问题失败: {e_safety.message}")
            error_info_chunk = {"task": task_name_for_log, "error": "内容安全异常", "details": e_safety.message[:200]}
        except (LLMAPIError, LLMConnectionError, LLMAuthenticationError, LLMRateLimitError) as e_llm:
             error_msg_llm = f"任务 '{task_name_for_log}' 的块LLM调用失败: {e_llm}"
             logger.error(f"{log_prefix} {error_msg_llm}", exc_info=False)
             error_info_chunk = {"task": task_name_for_log, "error": type(e_llm).__name__, "details": str(e_llm)[:200]}
        except Exception as e_unknown:
            error_msg_unknown = f"任务 '{task_name_for_log}' 的块分析时发生未知错误: {e_unknown}"
            logger.error(f"{log_prefix} {error_msg_unknown}", exc_info=True)
            error_info_chunk = {"task": task_name_for_log, "error": "未知处理错误", "details": str(e_unknown)[:200]}
            
        return analysis_result_chunk, error_info_chunk

    @staticmethod
    async def _execute_analysis_task_on_chunks(
        db: AsyncSession, # <- 修正：使用 AsyncSession
        task_enum: schemas.PredefinedTaskEnum,
        task_name_log: str,
        text_chunks: List[str],
        model_id_for_task: Optional[str], 
        novel_id_for_context: Optional[int], 
        log_prefix: str
    ) -> Tuple[Optional[Any], List[Dict[str, str]]]: 
        chunk_results_for_task: List[Any] = []
        chunk_errors_for_task: List[Dict[str, str]] = []

        if not model_id_for_task:
            logger.warning(f"{log_prefix} 任务 '{task_name_log}' 未配置模型ID，将跳过。")
            chunk_errors_for_task.append({"task": task_name_log, "error": "模型未配置", "details": "任务已跳过。"})
            return None, chunk_errors_for_task

        logger.info(f"{log_prefix} 开始执行 '{task_name_log}' ({len(text_chunks)} 块, 模型ID: '{model_id_for_task}')。")
        
        # 为所有块的分析创建一个模拟的 RuleStepPublic schema，用于 PromptEngineeringService
        mock_step_schema_for_task = schemas.RuleStepPublic(
            task_type=task_enum.value, id=0, # 这些id和order不重要，因为只是用于构建prompt
            chain_id=0, step_order=0, is_enabled=True,
            input_source=schemas.StepInputSourceEnum.PREVIOUS_STEP, # 假设块内容是上一步的输出
            parameters={}, post_processing_rules=[], 
            model_id=model_id_for_task # 确保传递了模型ID，即使_analyze_single_chunk也接收了
        )

        tasks_for_gather = [
            BackgroundAnalysisService._analyze_single_chunk( 
                db, mock_step_schema_for_task, chunk, model_id_for_task, 
                novel_id_for_context, 
                f"{log_prefix} [块 {i+1}/{len(text_chunks)}]", task_name_log
            ) for i, chunk in enumerate(text_chunks)
        ]
        
        gathered_results = await asyncio.gather(*tasks_for_gather, return_exceptions=True)

        for result_item in gathered_results:
            if isinstance(result_item, Exception):
                logger.error(f"{log_prefix} 任务 '{task_name_log}' 的一个块分析时发生gather异常: {result_item}")
                chunk_errors_for_task.append({"task": task_name_log, "error": "块分析时发生gather异常", "details": str(result_item)[:150]})
            elif result_item is not None: # 确保 result_item 不是 None
                res, err = result_item # result_item 应该是一个元组
                if res is not None: chunk_results_for_task.append(res)
                if err: chunk_errors_for_task.append(err)
        
        if not chunk_results_for_task:
            logger.warning(f"{log_prefix} 任务 '{task_name_log}' 所有块均无有效结果。")
            return None, chunk_errors_for_task
        
        # 结果合并逻辑 (保持原样)
        merged_result: Optional[Any] = None
        try:
            if task_enum == schemas.PredefinedTaskEnum.SENTIMENT_ANALYSIS_CHAPTER: merged_result = _merge_sentiment_results(chunk_results_for_task, log_prefix)
            elif task_enum == schemas.PredefinedTaskEnum.EXTRACT_MAIN_EVENT: merged_result = _merge_list_results(chunk_results_for_task, log_prefix, "event_summary")
            elif task_enum == schemas.PredefinedTaskEnum.EXTRACT_ROLES: merged_result = _merge_list_results(chunk_results_for_task, log_prefix, "character_name")
            elif task_enum == schemas.PredefinedTaskEnum.ANALYZE_CHAPTER_THEME: merged_result = _merge_list_results(chunk_results_for_task, log_prefix, "theme")
            elif task_enum == schemas.PredefinedTaskEnum.SUMMARIZE_CHAPTER:
                summaries_list = [res.get("summary") if isinstance(res, dict) else str(res) for res in chunk_results_for_task]
                merged_result = _merge_summary_results([s for s in summaries_list if s], log_prefix)
            else:
                logger.warning(f"{log_prefix} 任务 '{task_enum.value}' 无特定合并策略。")
                merged_result = chunk_results_for_task[0] if len(chunk_results_for_task) == 1 else chunk_results_for_task
        except Exception as e_merge:
            logger.error(f"{log_prefix} 合并任务 '{task_name_log}' 结果时出错: {e_merge}", exc_info=True)
            chunk_errors_for_task.append({"task": f"合并 {task_name_log}", "error": "结果合并失败", "details": str(e_merge)})
            if not merged_result and chunk_results_for_task: # 如果合并失败但有原始块结果，尝试返回第一个
                merged_result = chunk_results_for_task[0] if len(chunk_results_for_task) == 1 else chunk_results_for_task
        
        if merged_result is not None:
            logger.info(f"{log_prefix} 任务 '{task_name_log}' 完成，生成合并结果。错误数: {len(chunk_errors_for_task)}。")
        else:
            logger.warning(f"{log_prefix} 任务 '{task_name_log}' 完成，但未生成合并结果。错误数: {len(chunk_errors_for_task)}。")
        return merged_result, chunk_errors_for_task

    @staticmethod
    async def _analyze_chapter_content(
        db: AsyncSession, # <- 修正：使用 AsyncSession
        chapter: models.Chapter,
        # llm_orchestrator 和 prompt_engineer 参数已移除，因为 _execute_analysis_task_on_chunks 会自行处理
        analysis_config: Optional[Dict[str, Any]] = None, 
        chunk_config_override: Optional[Dict[str, Any]] = None
    ) -> bool: 
        log_prefix = f"[章节分析 CH_ID:{chapter.id} NV_ID:{chapter.novel_id}]"
        logger.info(f"{log_prefix} 开始分析章节 '{chapter.title}'。")
        analysis_data_for_crud_update: Dict[str, Any] = {}
        accumulated_errors: List[Dict[str, str]] = []
        chapter_content = chapter.content or ""
        if not chapter_content.strip():
            logger.info(f"{log_prefix} 章节内容为空，跳过。")
            return True

        app_cfg = get_config()
        llm_settings_cfg = app_cfg.llm_settings
        task_model_preferences_map = llm_settings_cfg.task_model_preference
        global_default_model_id_from_config = llm_settings_cfg.default_model_id
        
        current_chunk_config_to_use = chunk_config_override or _get_chunk_config_from_settings()
        # tokenizer_model_id_for_splitting 现在从 chunk_config 中获取，或使用全局默认
        tokenizer_model_id_for_splitting = current_chunk_config_to_use.get("tokenizer_model") or global_default_model_id_from_config
        
        text_chunks_list = _split_text_into_chunks(
            chapter_content,
            current_chunk_config_to_use,
            tokenizer_model_id_for_splitting,
            # strategy 参数已在 current_chunk_config_to_use 中
        )
        if not text_chunks_list:
            logger.warning(f"{log_prefix} 分块后无内容，跳过。")
            return True
        logger.info(f"{log_prefix} 内容分割为 {len(text_chunks_list)} 块。")

        tasks_to_run_config_list = [
            ("sentiment_analysis", schemas.PredefinedTaskEnum.SENTIMENT_ANALYSIS_CHAPTER, "章节情感分析", True),
            ("event_extraction", schemas.PredefinedTaskEnum.EXTRACT_MAIN_EVENT, "主要事件提取", True),
            ("character_analysis", schemas.PredefinedTaskEnum.EXTRACT_ROLES, "主要角色提及分析", True),
            ("theme_analysis", schemas.PredefinedTaskEnum.ANALYZE_CHAPTER_THEME, "章节主题分析", True),
            ("summary", schemas.PredefinedTaskEnum.SUMMARIZE_CHAPTER, "章节摘要生成", True),
        ]
        any_task_produced_actual_results = False
        # background_analysis_settings 可能不存在于 app_cfg，需要安全获取
        effective_analysis_config = analysis_config or app_cfg.model_dump().get("background_analysis_settings", {})


        for crud_field_name, task_enum_to_run, task_name_for_logging, default_enabled_status in tasks_to_run_config_list:
            task_category_name = crud_field_name.split('_')[0] # e.g., 'sentiment' from 'sentiment_analysis'
            # 确保 task_specific_settings 是字典
            task_specific_settings = effective_analysis_config.get(task_category_name) if isinstance(effective_analysis_config, dict) else {}
            if isinstance(task_specific_settings, dict) and task_specific_settings.get("enabled", default_enabled_status):
                model_id_for_this_task_run = task_model_preferences_map.get(task_enum_to_run.value, global_default_model_id_from_config)
                
                merged_res_from_chunks, errors_from_chunks = await BackgroundAnalysisService._execute_analysis_task_on_chunks(
                    db, task_enum_to_run, task_name_for_logging, # llm_orchestrator 和 prompt_engineer 由 _execute_analysis_task_on_chunks 内部处理
                    text_chunks_list, model_id_for_this_task_run, chapter.novel_id, log_prefix
                )
                if merged_res_from_chunks is not None:
                    analysis_data_for_crud_update[crud_field_name] = merged_res_from_chunks
                    any_task_produced_actual_results = True
                if errors_from_chunks:
                    accumulated_errors.extend(errors_from_chunks)
            else:
                 logger.info(f"{log_prefix} 任务 '{task_name_for_logging}' 在配置中被禁用或配置错误，跳过。")

        if any_task_produced_actual_results or accumulated_errors:
            # chapter_to_update_orm = await asyncio.to_thread(db.get, models.Chapter, chapter.id)
            chapter_to_update_orm = await db.get(models.Chapter, chapter.id) # <- 修正：直接 await
            if not chapter_to_update_orm:
                logger.error(f"{log_prefix} 尝试更新章节分析数据时，未能在数据库中找到章节ID {chapter.id}。")
                return False

            try:
                logger.info(f"{log_prefix} 准备更新数据库。分析字段: {list(analysis_data_for_crud_update.keys())}。错误数: {len(accumulated_errors)}。")
                
                await crud.update_chapter( # <- 修正：直接 await
                    db=db,
                    chapter_obj=chapter_to_update_orm, # crud.update_chapter 接收 chapter_obj 和 chapter_in
                    chapter_in=schemas.ChapterUpdate(**analysis_data_for_crud_update) # 将字典转换为 Pydantic 模型
                )
                logger.info(f"{log_prefix} 章节分析数据已更新到数据库。")
            except Exception as e_db_upd_chapter:
                logger.error(f"{log_prefix} 更新章节分析数据到DB失败: {e_db_upd_chapter}", exc_info=True)
                return False
        
        if accumulated_errors:
            non_model_cfg_errors = [err for err in accumulated_errors if err.get("error") != "模型未配置"]
            if non_model_cfg_errors:
                logger.warning(f"{log_prefix} 分析完成，但有 {len(non_model_cfg_errors)} 个非配置类错误。")
                return False
            elif accumulated_errors: # 只有模型未配置的错误
                logger.info(f"{log_prefix} 分析完成，部分任务因模型未配置跳过。")
                return True # 视为部分成功
        
        logger.info(f"{log_prefix} 章节分析成功完成。")
        return True

    @staticmethod
    async def run_full_analysis_in_background(novel_id: int): # <- 修正：改为 async def
        """
        [异步重构] 后台任务入口点，对整本小说进行分析。
        此方法由外部的 BackgroundTasks 调用，它应该获得一个异步DB会话。
        """
        log_prefix_novel_analysis = f"[小说分析服务 ID:{novel_id}]"
        logger.info(f"{log_prefix_novel_analysis} (后台任务) 开始对所有章节进行分析。")

        async with AsyncSessionLocal() as db: # <- 修正：使用异步会话上下文管理器
            try:
                novel_orm_instance = await crud.get_novel(db, novel_id=novel_id, with_details=True) # <- 修正：使用 await
                if not novel_orm_instance:
                    logger.error(f"{log_prefix_novel_analysis} 未找到小说ID {novel_id}。中止。")
                    return

                await crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_update=schemas.NovelUpdate(analysis_status=schemas.NovelAnalysisStatusEnum.IN_PROGRESS, analysis_errors=[])) # <- 修正
                logger.info(f"{log_prefix_novel_analysis} 小说《{novel_orm_instance.title}》状态更新为“进行中”。")
                
                if not novel_orm_instance.chapters:
                    logger.info(f"{log_prefix_novel_analysis} 小说《{novel_orm_instance.title}》无章节，分析标记为完成（无内容）。")
                    await crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_update=schemas.NovelUpdate(analysis_status=schemas.NovelAnalysisStatusEnum.COMPLETED_NO_CONTENT, analysis_errors=["小说无章节内容可供分析"])) # <- 修正
                    return

                sorted_chapters_list = sorted(list(novel_orm_instance.chapters), key=lambda c: (c.plot_version_id is not None, c.plot_version_id or -1, c.chapter_index if c.plot_version_id is None else (c.version_order or float('inf'))))
                total_chapters_to_analyze = len(sorted_chapters_list)
                successful_chapters_count, chapters_with_issues_count = 0, 0
                accumulated_novel_errors: List[str] = []
                
                # analysis_config_from_global 现在应从配置中获取
                app_config_instance = get_config()
                analysis_config_from_global = app_config_instance.model_dump().get("background_analysis_settings", {})

                # 此处不需要额外的 asyncio.run，因为 run_full_analysis_in_background 已经是异步的
                all_chapter_analysis_coroutines: List[Coroutine] = []
                for chapter in sorted_chapters_list:
                     # _analyze_chapter_content 现在是异步的
                    all_chapter_analysis_coroutines.append(
                        BackgroundAnalysisService._analyze_chapter_content(
                            db, chapter, 
                            analysis_config=analysis_config_from_global
                        )
                    )
                
                results_from_chapters = await asyncio.gather(*all_chapter_analysis_coroutines, return_exceptions=True)

                for i, res_chap in enumerate(results_from_chapters):
                    chap_log_prefix = f"{log_prefix_novel_analysis} [章节 {i+1}/{total_chapters_to_analyze} ID:{sorted_chapters_list[i].id}]"
                    if isinstance(res_chap, Exception):
                        logger.error(f"{chap_log_prefix} 严重错误: {res_chap}", exc_info=True)
                        chapters_with_issues_count += 1
                        accumulated_novel_errors.append(f"章节 {sorted_chapters_list[i].id} 严重错误: {str(res_chap)[:150]}")
                    elif res_chap: # res_chap 是 _analyze_chapter_content 的返回值 (bool)
                        successful_chapters_count += 1
                    else: # res_chap is False
                        chapters_with_issues_count += 1
                        logger.warning(f"{chap_log_prefix} 处理完成但有警告。")
                
                final_status = schemas.NovelAnalysisStatusEnum.FAILED
                if chapters_with_issues_count == 0 and successful_chapters_count == total_chapters_to_analyze:
                    final_status = schemas.NovelAnalysisStatusEnum.COMPLETED
                elif successful_chapters_count > 0:
                    final_status = schemas.NovelAnalysisStatusEnum.COMPLETED_WITH_ERRORS
                
                await crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_update=schemas.NovelUpdate(analysis_status=final_status, analysis_errors=accumulated_novel_errors)) # <- 修正
                logger.info(f"{log_prefix_novel_analysis} 小说《{novel_orm_instance.title}》分析结束，状态: {final_status.value}。")

            except Exception as e_main_process: # 更名为 e_main_process
                logger.critical(f"{log_prefix_novel_analysis} 主分析流程发生严重错误: {e_main_process}", exc_info=True)
                if novel_id and novel_orm_instance: # 确保 novel_orm_instance 已定义
                    try:
                        fail_msg = f"主流程严重错误: {str(e_main_process)[:200]}"
                        current_errors = novel_orm_instance.analysis_errors or []
                        if fail_msg not in current_errors: current_errors.append(fail_msg)
                        # 更新 NovelUpdate schema 以匹配字段
                        await crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_update=schemas.NovelUpdate(analysis_status=schemas.NovelAnalysisStatusEnum.FAILED, analysis_errors=current_errors)) # <- 修正
                    except Exception as e_commit_fail_status: # 更名
                        logger.error(f"{log_prefix_novel_analysis} 提交“失败”状态时再失败: {e_commit_fail_status}", exc_info=True)

def trigger_chapter_analysis_task(
    background_tasks: Optional[Any], # FastAPI BackgroundTasks
    chapter_id: int,
    novel_id: int, 
    analysis_config_override: Optional[Dict[str, Any]] = None,
    # llm_orchestrator_override 已移除，使用全局单例
):
    log_prefix = f"[ChapterAnalysisTrigger CH_ID:{chapter_id} NV_ID:{novel_id}]"
    logger.info(f"{log_prefix} 收到触发单个章节分析的请求。")

    async def run_single_chapter_analysis_in_background_async( # <- 修正：改为 async def
        chap_id: int, nov_id: int, config_override: Optional[Dict[str, Any]]
    ):
        log_prefix_bg = f"{log_prefix} (后台任务)"
        logger.info(f"{log_prefix_bg} 开始。")
        async with AsyncSessionLocal() as db: # <- 修正：使用异步会话
            try:
                chapter = await db.get(models.Chapter, chap_id) # <- 修正：使用 await
                if not chapter or chapter.novel_id != nov_id:
                    logger.error(f"{log_prefix_bg} 未找到章节或章节不匹配。")
                    return
                
                # _analyze_chapter_content 现在是异步的，并且不直接接收 orchestrator 和 prompt_engineer
                success = await BackgroundAnalysisService._analyze_chapter_content(
                    db, chapter, analysis_config=config_override
                )
                
                if success: logger.info(f"{log_prefix_bg} 成功完成。")
                else: logger.warning(f"{log_prefix_bg} 完成但有警告或错误。")

            except Exception as e_bg_single_chap: # 更名
                logger.error(f"{log_prefix_bg} 发生错误: {e_bg_single_chap}", exc_info=True)
            finally:
                # AsyncSessionLocal 的上下文管理器会自动处理关闭
                logger.info(f"{log_prefix_bg} 异步数据库会话自动关闭。")

    if background_tasks:
        background_tasks.add_task(
            run_single_chapter_analysis_in_background_async, # <- 修正：调用异步版本
            chapter_id, novel_id, analysis_config_override
        )
        logger.info(f"{log_prefix} 任务已添加至后台。")
    else: 
        logger.warning(f"{log_prefix} 未提供BackgroundTasks，将尝试直接异步运行（可能阻塞当前上下文，不推荐）。")
        # 直接异步运行（如果上下文允许）
        asyncio.create_task(run_single_chapter_analysis_in_background_async(chapter_id, novel_id, analysis_config_override))