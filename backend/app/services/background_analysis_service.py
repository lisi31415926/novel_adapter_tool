# backend/app/services/background_analysis_service.py
import logging
import json
import asyncio
from typing import Optional, Dict, Any, List, Union, Tuple
import re

# 新增：导入 nltk
try:
    import nltk
    # 检查punkt分词器是否可用，如果不可用则记录日志提示
    try:
        nltk.data.find('tokenizers/punkt')
    except nltk.downloader.DownloadError:
        logger.info("NLTK 'punkt' tokenizer not found. Attempting to download...")
        nltk.download('punkt')
        logger.info("'punkt' tokenizer downloaded successfully.")
except ImportError:
    nltk = None
    logger.warning("NLTK library not found. 'sentence' splitting strategy will not be available. Please run 'pip install nltk'.")


from sqlalchemy.orm import Session
# langchain 的导入保持在函数内部，以实现动态加载

# 从 app 包导入
from app import crud, schemas, models
from app.llm_orchestrator import LLMOrchestrator
# 从 app.exceptions 导入统一的异常
from app.exceptions import LLMAPIError, LLMAuthenticationError, LLMConnectionError, LLMRateLimitError, ContentSafetyException
from app.database import SessionLocal
from app.config_service import get_config
from app.tokenizer_service import estimate_token_count
from ..text_processing_utils import generate_unique_id, secure_filename
from app.services.prompt_engineering_service import PromptEngineeringService


logger = logging.getLogger(__name__)

# --- 辅助函数：配置获取 (无变化) ---
def _get_chunk_config_from_settings() -> Dict[str, Any]:
    """获取文本分块的配置参数"""
    app_config = get_config()
    default_chunk_size = 1500
    default_chunk_overlap = 150
    
    analysis_chunk_settings = app_config.analysis_chunk_settings
    
    chunk_size = analysis_chunk_settings.chunk_size
    chunk_overlap = analysis_chunk_settings.chunk_overlap
    tokenizer_model_for_chunking = analysis_chunk_settings.default_tokenizer_model_for_chunking

    logger.debug(f"分块配置: size={chunk_size}, overlap={chunk_overlap}, tokenizer_model_for_chunking='{tokenizer_model_for_chunking}'")
            
    return {
        "chunk_size": chunk_size,
        "chunk_overlap": chunk_overlap,
        "tokenizer_model": tokenizer_model_for_chunking,
        "strategy": analysis_chunk_settings.strategy or 'recursive', # 新增：从配置读取策略
    }

# --- 辅助函数：文本分块 (已修改) ---
def _split_text_into_chunks(
    text: str,
    chunk_config: Dict[str, Any],
    target_model_user_id_for_tokenizer: Optional[str] = None,
    # 新增 strategy 参数
    strategy: str = 'recursive' 
) -> List[str]:
    """使用不同策略将文本分割成块。"""
    if not text or not text.strip():
        return []
    
    # 优先使用函数调用时传入的 strategy，否则使用 chunk_config 中的
    effective_strategy = strategy or chunk_config.get("strategy", 'recursive')
    log_prefix = "[TextSplitter]"

    # --- 新增：NLTK 句子分割策略 ---
    if effective_strategy == 'sentence':
        if nltk:
            try:
                logger.debug(f"{log_prefix} 使用 'sentence' 策略进行文本分割。")
                return nltk.sent_tokenize(text, language='english') # 对于中文文本，可能需要更专业的句子分割器，但nltk是一个好的开始
            except Exception as e_nltk:
                logger.error(f"{log_prefix} 使用 NLTK sent_tokenize 分割时出错: {e_nltk}。将回退到 'recursive' 策略。")
        else:
            logger.warning(f"{log_prefix} 请求使用 'sentence' 策略，但 NLTK 未安装。将回退到 'recursive' 策略。")
    
    # --- 保留并作为默认/回退的 RecursiveCharacterTextSplitter 策略 ---
    logger.debug(f"{log_prefix} 使用 'recursive' (token-based 或 character-based) 策略进行文本分割。")
    chunk_size_tokens = chunk_config.get("chunk_size", 1500)
    chunk_overlap_tokens = chunk_config.get("chunk_overlap", 150)
    tokenizer_model_user_id_ref = target_model_user_id_for_tokenizer or chunk_config.get("tokenizer_model", "gpt-3.5-turbo")
    
    try:
        from langchain.text_splitter import RecursiveCharacterTextSplitter as LangchainRecursiveSplitter

        def _token_length_sync(text_to_count: str) -> int:
            return estimate_token_count(text_to_count, model_user_id=tokenizer_model_user_id_ref)

        text_splitter = LangchainRecursiveSplitter(
            chunk_size=chunk_size_tokens,
            chunk_overlap=chunk_overlap_tokens,
            length_function=_token_length_sync,
            separators=["\n\n", "\n", "。", "！", "？", "，", "、", " ", ""],
        )
        split_chunks = text_splitter.split_text(text)
        logger.debug(f"{log_prefix} 文本基于Token估算分割为 {len(split_chunks)} 块。")
        return split_chunks
    except ImportError:
        logger.warning(f"{log_prefix} langchain.text_splitter 未安装。将回退到基于字符的文本分割。")
    except Exception as e_token_split:
        logger.warning(f"{log_prefix} 基于Token的文本分割失败 ({e_token_split})。回退到基于字符的分割。")
    
    try:
        from langchain.text_splitter import RecursiveCharacterTextSplitter as LangchainRecursiveSplitter
        app_cfg_for_char_factor = get_config()
        char_factor = app_cfg_for_char_factor.llm_settings.tokenizer_options.default_chars_per_token_general or 2.5
        
        char_splitter = LangchainRecursiveSplitter(
            chunk_size=int(chunk_size_tokens * char_factor),
            chunk_overlap=int(chunk_overlap_tokens * char_factor),
            separators=["\n\n", "\n", "。", "！", "？", "，", "、", " ", ""],
        )
        split_chunks_char = char_splitter.split_text(text)
        logger.debug(f"{log_prefix} 文本基于字符估算分割为 {len(split_chunks_char)} 块。")
        return split_chunks_char
    except ImportError:
        logger.error(f"{log_prefix} RecursiveCharacterTextSplitter 未找到。无法进行文本分块。")
        return [text]
    except Exception as e_char_split_final:
        logger.error(f"{log_prefix} 最终尝试基于字符分割时也发生错误: {e_char_split_final}。返回整个文本。")
        return [text]


# --- 辅助函数：结果合并策略 (无变化) ---
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
            return merged_list

    seen_identifiers = set()
    unique_items_list = []
    for item in merged_list:
        identifier = item.get(item_key_for_deduplication)
        if identifier is not None:
            identifier_hashable = tuple(sorted(identifier)) if isinstance(identifier, list) else identifier
            try:
                if identifier_hashable not in seen_identifiers:
                    unique_items_list.append(item)
                    seen_identifiers.add(identifier_hashable)
            except TypeError:
                logger.warning(f"{log_prefix} 去重时遇到不可哈希标识符 '{identifier_hashable}' (类型: {type(identifier)})，此条目直接添加。")
                unique_items_list.append(item)
        else:
            unique_items_list.append(item)
    logger.info(f"{log_prefix} 合并了 {len(merged_list)} 项目，去重后 {len(unique_items_list)} (键: {item_key_for_deduplication})。")
    return unique_items_list

def _merge_summary_results(chunk_summaries: List[str], log_prefix: str) -> str:
    if not chunk_summaries: return ""
    return "\n\n".join(s.strip() for s in chunk_summaries if s and s.strip())


class BackgroundAnalysisService:
    @staticmethod
    async def _analyze_single_chunk(
        db: Session, 
        llm_orchestrator: LLMOrchestrator, 
        prompt_engineer: PromptEngineeringService, 
        task: schemas.PredefinedTaskEnum,
        chunk_text: str,
        model_id: Optional[str], 
        novel_id_for_context: Optional[int], 
        log_prefix: str,
        task_name_for_log: str
    ) -> Tuple[Optional[Any], Optional[Dict[str, str]]]:
        """核心块分析逻辑，使用 PromptEngineeringService 和 LLMOrchestrator。"""
        analysis_result_chunk = None
        error_info_chunk = None
        
        try:
            mock_step_for_prompt = schemas.RuleStepPublic( 
                task_type=task.value, id=0, chain_id=0, step_order=0, is_enabled=True,
                input_source=schemas.StepInputSourceEnum.PREVIOUS_STEP, parameters={}, post_processing_rules=[],
            )
            
            novel_model_obj_for_prompt = None
            if novel_id_for_context:
                 novel_model_obj_for_prompt = await asyncio.to_thread(db.get, models.Novel, novel_id_for_context)

            prompt_data = await prompt_engineer.build_prompt_for_step(
                rule_step_schema=mock_step_for_prompt,
                novel_id=novel_id_for_context or 0,
                novel_obj=novel_model_obj_for_prompt,
                dynamic_params={},
                main_input_text=chunk_text
            )
            
            response = await llm_orchestrator.generate(
                model_id=model_id,
                prompt=prompt_data.user_prompt,
                system_prompt=prompt_data.system_prompt,
                is_json_output=prompt_data.is_json_output_hint,
                temperature=0.1 
            )
            
            llm_output = response.text

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

        # 适配新的统一异常
        except ContentSafetyException as e_safety:
            logger.error(f"{log_prefix} 任务 '{task_name_for_log}' 的块因内容安全问题失败: {e_safety.message}")
            error_info_chunk = {"task": task_name_for_log, "error": "内容安全异常", "details": e_safety.message[:200]}
        except (LLMAPIError, LLMConnectionError, LLMAuthenticationError, LLMRateLimitError) as e_llm:
             error_msg_llm = f"任务 '{task_name_for_log}' 的块LLM调用失败: {e_llm}"
             logger.error(f"{log_prefix} {error_msg_llm}", exc_info=False) # 对于已知LLM错误，不打印完整堆栈
             error_info_chunk = {"task": task_name_for_log, "error": type(e_llm).__name__, "details": str(e_llm)[:200]}
        except Exception as e_unknown:
            error_msg_unknown = f"任务 '{task_name_for_log}' 的块分析时发生未知错误: {e_unknown}"
            logger.error(f"{log_prefix} {error_msg_unknown}", exc_info=True)
            error_info_chunk = {"task": task_name_for_log, "error": "未知处理错误", "details": str(e_unknown)[:200]}
            
        return analysis_result_chunk, error_info_chunk

    # _execute_analysis_task_on_chunks, _analyze_chapter_content, start_full_analysis 等其他方法保持不变...
    # 为保持简洁，此处省略未变化的代码。实际使用时请保留这些方法的原样。
    # ... (此处应包含文件中所有其他未修改的方法)

    @staticmethod
    async def _execute_analysis_task_on_chunks(
        db: Session, 
        llm_orchestrator: LLMOrchestrator, 
        prompt_engineer: PromptEngineeringService, 
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
        
        tasks_for_gather = [
            BackgroundAnalysisService._analyze_single_chunk( 
                db, llm_orchestrator, prompt_engineer, task_enum, chunk, model_id_for_task, 
                novel_id_for_context, 
                f"{log_prefix} [块 {i+1}/{len(text_chunks)}]", task_name_log
            ) for i, chunk in enumerate(text_chunks)
        ]
        
        gathered_results = await asyncio.gather(*tasks_for_gather, return_exceptions=True)

        for result_item in gathered_results:
            if isinstance(result_item, Exception):
                logger.error(f"{log_prefix} 任务 '{task_name_log}' 的一个块分析时发生gather异常: {result_item}")
                chunk_errors_for_task.append({"task": task_name_log, "error": "块分析时发生gather异常", "details": str(result_item)[:150]})
            else:
                res, err = result_item
                if res is not None: chunk_results_for_task.append(res)
                if err: chunk_errors_for_task.append(err)
        
        if not chunk_results_for_task:
            logger.warning(f"{log_prefix} 任务 '{task_name_log}' 所有块均无有效结果。")
            return None, chunk_errors_for_task
        
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
            if not merged_result and chunk_results_for_task:
                merged_result = chunk_results_for_task[0] if len(chunk_results_for_task) == 1 else chunk_results_for_task
        
        if merged_result is not None:
            logger.info(f"{log_prefix} 任务 '{task_name_log}' 完成，生成合并结果。错误数: {len(chunk_errors_for_task)}。")
        else:
            logger.warning(f"{log_prefix} 任务 '{task_name_log}' 完成，但未生成合并结果。错误数: {len(chunk_errors_for_task)}。")
        return merged_result, chunk_errors_for_task

    @staticmethod
    async def _analyze_chapter_content(
        db: Session,
        chapter: models.Chapter,
        llm_orchestrator: LLMOrchestrator, 
        prompt_engineer: PromptEngineeringService, 
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
        tokenizer_model_id_for_splitting = global_default_model_id_from_config or current_chunk_config_to_use.get("tokenizer_model")
        
        text_chunks_list = _split_text_into_chunks(
            chapter_content,
            current_chunk_config_to_use,
            tokenizer_model_id_for_splitting,
            strategy=current_chunk_config_to_use.get('strategy', 'recursive') # 传递策略
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
        effective_analysis_config = analysis_config or app_cfg.background_analysis_settings.model_dump()

        for crud_field_name, task_enum_to_run, task_name_for_logging, default_enabled_status in tasks_to_run_config_list:
            task_category_name = crud_field_name.split('_')[0]
            task_specific_settings = effective_analysis_config.get(task_category_name, {})
            if isinstance(task_specific_settings, dict) and task_specific_settings.get("enabled", default_enabled_status):
                model_id_for_this_task_run = task_model_preferences_map.get(task_enum_to_run.value, global_default_model_id_from_config)
                
                merged_res_from_chunks, errors_from_chunks = await BackgroundAnalysisService._execute_analysis_task_on_chunks(
                    db, llm_orchestrator, prompt_engineer, task_enum_to_run, task_name_for_logging, 
                    text_chunks_list, model_id_for_this_task_run, chapter.novel_id, log_prefix
                )
                if merged_res_from_chunks is not None:
                    analysis_data_for_crud_update[crud_field_name] = merged_res_from_chunks
                    any_task_produced_actual_results = True
                if errors_from_chunks:
                    accumulated_errors.extend(errors_from_chunks)
            else:
                 logger.info(f"{log_prefix} 任务 '{task_name_for_logging}' 在配置中被禁用，跳过。")

        if any_task_produced_actual_results or accumulated_errors:
            chapter_to_update_orm = await asyncio.to_thread(db.get, models.Chapter, chapter.id)
            if not chapter_to_update_orm:
                logger.error(f"{log_prefix} 尝试更新章节分析数据时，未能在数据库中找到章节ID {chapter.id}。")
                return False

            try:
                logger.info(f"{log_prefix} 准备更新数据库。分析字段: {list(analysis_data_for_crud_update.keys())}。错误数: {len(accumulated_errors)}。")
                
                # 使用 to_thread 调用同步的 crud.update_chapter
                await asyncio.to_thread(
                    crud.update_chapter,
                    db=db,
                    chapter_obj=chapter_to_update_orm,
                    chapter_in=analysis_data_for_crud_update
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
            elif accumulated_errors:
                logger.info(f"{log_prefix} 分析完成，部分任务因模型未配置跳过。")
                return True
        
        logger.info(f"{log_prefix} 章节分析成功完成。")
        return True

    @staticmethod
    def start_full_analysis( 
        db: Session, 
        novel_id: int,
        llm_orchestrator: LLMOrchestrator, 
        analysis_config_from_global: Optional[Dict[str, Any]] = None 
    ):
        log_prefix_novel_analysis = f"[小说分析服务 ID:{novel_id}]"
        logger.info(f"{log_prefix_novel_analysis} (后台任务) 开始对所有章节进行分析。")

        novel_orm_instance: Optional[models.Novel] = None
        prompt_engineer_instance = PromptEngineeringService(db_session=db, llm_orchestrator=llm_orchestrator)

        try:
            novel_orm_instance = crud.get_novel(db, novel_id=novel_id, with_details=True)
            if not novel_orm_instance:
                logger.error(f"{log_prefix_novel_analysis} 未找到小说ID {novel_id}。中止。")
                return

            crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_in={"analysis_status": schemas.NovelAnalysisStatusEnum.IN_PROGRESS.value, "analysis_errors": []})
            logger.info(f"{log_prefix_novel_analysis} 小说《{novel_orm_instance.title}》状态更新为“进行中”。")
            
            if not novel_orm_instance.chapters:
                logger.info(f"{log_prefix_novel_analysis} 小说《{novel_orm_instance.title}》无章节，分析标记为完成（无内容）。")
                crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_in={"analysis_status": schemas.NovelAnalysisStatusEnum.COMPLETED_NO_CONTENT.value, "analysis_errors": ["小说无章节内容可供分析"]})
                return

            sorted_chapters_list = sorted(list(novel_orm_instance.chapters), key=lambda c: (c.plot_version_id is not None, c.plot_version_id or -1, c.chapter_index if c.plot_version_id is None else (c.version_order or float('inf'))))
            total_chapters_to_analyze = len(sorted_chapters_list)
            successful_chapters_count, chapters_with_issues_count = 0, 0
            accumulated_novel_errors: List[str] = []
            
            async def run_chapter_analyses():
                nonlocal successful_chapters_count, chapters_with_issues_count, accumulated_novel_errors 
                tasks = [BackgroundAnalysisService._analyze_chapter_content(db, chapter, llm_orchestrator, prompt_engineer_instance, analysis_config_from_global) for chapter in sorted_chapters_list]
                results = await asyncio.gather(*tasks, return_exceptions=True)

                for i, res in enumerate(results):
                    chap_log_prefix = f"{log_prefix_novel_analysis} [章节 {i+1}/{total_chapters_to_analyze} ID:{sorted_chapters_list[i].id}]"
                    if isinstance(res, Exception):
                        logger.error(f"{chap_log_prefix} 严重错误: {res}", exc_info=True)
                        chapters_with_issues_count += 1
                        accumulated_novel_errors.append(f"章节 {sorted_chapters_list[i].id} 严重错误: {str(res)[:150]}")
                    elif res:
                        successful_chapters_count += 1
                    else:
                        chapters_with_issues_count += 1
                        logger.warning(f"{chap_log_prefix} 处理完成但有警告。")
            
            asyncio.run(run_chapter_analyses()) 

            final_status = schemas.NovelAnalysisStatusEnum.FAILED
            if chapters_with_issues_count == 0 and successful_chapters_count == total_chapters_to_analyze:
                final_status = schemas.NovelAnalysisStatusEnum.COMPLETED
            elif successful_chapters_count > 0:
                final_status = schemas.NovelAnalysisStatusEnum.COMPLETED_WITH_ERRORS
            
            crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_in={"analysis_status": final_status.value, "analysis_errors": accumulated_novel_errors})
            logger.info(f"{log_prefix_novel_analysis} 小说《{novel_orm_instance.title}》分析结束，状态: {final_status.value}。")

        except Exception as e:
            logger.critical(f"{log_prefix_novel_analysis} 主分析流程发生严重错误: {e}", exc_info=True)
            if novel_id and novel_orm_instance:
                try:
                    fail_msg = f"主流程严重错误: {str(e)[:200]}"
                    current_errors = novel_orm_instance.analysis_errors or []
                    if fail_msg not in current_errors: current_errors.append(fail_msg)
                    crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_in={"analysis_status": schemas.NovelAnalysisStatusEnum.FAILED.value, "analysis_errors": current_errors})
                except Exception as e_commit_fail:
                    logger.error(f"{log_prefix_novel_analysis} 提交“失败”状态时再失败: {e_commit_fail}", exc_info=True)

# --- 单个章节分析的后台任务触发器 (无重大变化) ---
def trigger_chapter_analysis_task(
    background_tasks: Optional[Any], 
    chapter_id: int,
    novel_id: int, 
    analysis_config_override: Optional[Dict[str, Any]] = None,
    llm_orchestrator_override: Optional[LLMOrchestrator] = None
):
    # 此函数逻辑基本不变，仅确保其能与修改后的部分协同工作
    log_prefix = f"[ChapterAnalysisTrigger CH_ID:{chapter_id} NV_ID:{novel_id}]"
    logger.info(f"{log_prefix} 收到触发单个章节分析的请求。")

    def run_single_chapter_analysis_in_background(
        chap_id: int, nov_id: int, config_override: Optional[Dict[str, Any]], llm_orch: LLMOrchestrator 
    ):
        log_prefix_bg = f"{log_prefix} (后台任务)"
        logger.info(f"{log_prefix_bg} 开始。")
        db = SessionLocal()
        try:
            chapter = db.get(models.Chapter, chap_id)
            if not chapter or chapter.novel_id != nov_id:
                logger.error(f"{log_prefix_bg} 未找到章节或章节不匹配。")
                return
            
            prompt_engineer = PromptEngineeringService(db_session=db, llm_orchestrator=llm_orch)
            
            async def do_analysis():
                return await BackgroundAnalysisService._analyze_chapter_content(
                    db, chapter, llm_orch, prompt_engineer, analysis_config=config_override
                )
            
            success = asyncio.run(do_analysis())
            
            if success: logger.info(f"{log_prefix_bg} 成功完成。")
            else: logger.warning(f"{log_prefix_bg} 完成但有警告。")

        except Exception as e:
            logger.error(f"{log_prefix_bg} 发生错误: {e}", exc_info=True)
        finally:
            db.close()
            logger.info(f"{log_prefix_bg} 数据库会话关闭。")

    llm_orch_to_use = llm_orchestrator_override or LLMOrchestrator()

    if background_tasks:
        background_tasks.add_task(
            run_single_chapter_analysis_in_background,
            chapter_id, novel_id, analysis_config_override, llm_orch_to_use
        )
        logger.info(f"{log_prefix} 任务已添加至后台。")
    else: 
        logger.warning(f"{log_prefix} 未提供BackgroundTasks，同步执行。")
        run_single_chapter_analysis_in_background(
            chapter_id, novel_id, analysis_config_override, llm_orch_to_use
        )