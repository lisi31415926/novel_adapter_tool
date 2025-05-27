# backend/app/services/background_analysis_service.py
import logging
import json
import asyncio
from typing import Optional, Dict, Any, List, Union, Tuple # Union, Tuple 都是必须的
import re # re 用于 _analyze_single_chunk 中解析JSON

from sqlalchemy.orm import Session, selectinload
# from langchain.text_splitter import RecursiveCharacterTextSplitter # 此文件已包含 _split_text_into_chunks

# 从 app 包导入
from app import crud, schemas, models #
from app.llm_orchestrator import LLMOrchestrator, ContentSafetyException #
from app.database import SessionLocal #
from app.config_service import get_config #
from app.tokenizer_service import estimate_token_count #
# from app.utils import format_prompt_with_curly_braces # 不再需要，改用 PromptEngineeringService
from ..text_processing_utils import generate_unique_id, secure_filename # 新的导入
# 新增：导入 PromptEngineeringService
from app.services.prompt_engineering_service import PromptEngineeringService


logger = logging.getLogger(__name__)

# --- 辅助函数：配置获取 (与您上传的文件一致) ---
def _get_chunk_config_from_settings() -> Dict[str, Any]:
    """获取文本分块的配置参数"""
    app_config = get_config() #
    # 默认值仅作参考，实际应由 app_config.analysis_chunk_settings 提供
    default_chunk_size = 1500 #
    default_chunk_overlap = 150 #
    
    analysis_chunk_settings = app_config.analysis_chunk_settings #
    
    chunk_size = analysis_chunk_settings.chunk_size #
    chunk_overlap = analysis_chunk_settings.chunk_overlap #
    # tokenizer_model 用于 _split_text_into_chunks 中 estimate_token_count 的回退
    tokenizer_model_for_chunking = analysis_chunk_settings.default_tokenizer_model_for_chunking #

    logger.debug(f"分块配置: size={chunk_size}, overlap={chunk_overlap}, tokenizer_model_for_chunking='{tokenizer_model_for_chunking}'")
            
    return {
        "chunk_size": chunk_size, #
        "chunk_overlap": chunk_overlap, #
        "tokenizer_model": tokenizer_model_for_chunking, # 传递给分块函数用
    }

# --- 辅助函数：文本分块 (与您上传的文件一致) ---
def _split_text_into_chunks(
    text: str,
    chunk_config: Dict[str, Any],
    target_model_user_id_for_tokenizer: Optional[str] = None,
) -> List[str]:
    """使用分词器（优先）或字符数估算将文本分割成块。"""
    if not text or not text.strip(): #
        return []

    chunk_size_tokens = chunk_config.get("chunk_size", 1500) #
    chunk_overlap_tokens = chunk_config.get("chunk_overlap", 150) #
    tokenizer_model_user_id_ref = target_model_user_id_for_tokenizer or chunk_config.get("tokenizer_model", "gpt-3.5-turbo") #
    
    # 动态导入 langchain 的分割器以避免在未使用时产生硬依赖
    try:
        from langchain.text_splitter import RecursiveCharacterTextSplitter as LangchainRecursiveSplitter #

        def _token_length_sync(text_to_count: str) -> int:
            # estimate_token_count 是同步函数
            return estimate_token_count(text_to_count, model_user_id=tokenizer_model_user_id_ref) #

        text_splitter = LangchainRecursiveSplitter( #
            chunk_size=chunk_size_tokens, #
            chunk_overlap=chunk_overlap_tokens, #
            length_function=_token_length_sync, #
            separators=["\n\n", "\n", "。", "！", "？", "，", "、", " ", ""], # 保持常用中文分隔符
        )
        split_chunks = text_splitter.split_text(text) #
        logger.debug(f"文本基于Token估算分割为 {len(split_chunks)} 块。") #
        return split_chunks
    except ImportError:
        logger.warning("langchain.text_splitter 未安装。将回退到基于字符的文本分割。建议安装 'pip install langchain-text-splitters' 以获得更精确的基于token的分割。")
    except Exception as e_token_split:
        logger.warning(f"基于Token的文本分割失败 ({e_token_split})。回退到基于字符的分割。") #
    
    # 回退到基于字符的分割 (如果 langchain 不可用或基于token的分割失败)
    try:
        from langchain.text_splitter import RecursiveCharacterTextSplitter as LangchainRecursiveSplitter #
        app_cfg_for_char_factor = get_config() #
        char_factor_cfg = app_cfg_for_char_factor.llm_settings.tokenizer_options.default_chars_per_token_general #
        char_factor = char_factor_cfg if isinstance(char_factor_cfg, (int, float)) and char_factor_cfg > 0 else 2.5
        
        char_splitter = LangchainRecursiveSplitter( #
            chunk_size=int(chunk_size_tokens * char_factor), #
            chunk_overlap=int(chunk_overlap_tokens * char_factor), #
            separators=["\n\n", "\n", "。", "！", "？", "，", "、", " ", ""], #
        )
        split_chunks_char = char_splitter.split_text(text) #
        logger.debug(f"文本基于字符估算分割为 {len(split_chunks_char)} 块。") #
        return split_chunks_char
    except ImportError: # 连 langchain_text_splitters 都没有
        logger.error("RecursiveCharacterTextSplitter 未找到。无法进行文本分块。请安装 'langchain-text-splitters'。")
        return [text] # 最差情况，返回整个文本作为一个块
    except Exception as e_char_split_final:
        logger.error(f"最终尝试基于字符分割时也发生错误: {e_char_split_final}。返回整个文本。")
        return [text]


# --- 辅助函数：结果合并策略 (与您上传的文件一致) ---
def _merge_sentiment_results(chunk_results: List[Dict[str, Any]], log_prefix: str) -> Optional[Dict[str, Any]]: #
    if not chunk_results: return None #
    valid_scores = [res.get("overall_sentiment_score") for res in chunk_results if isinstance(res.get("overall_sentiment_score"), (int, float))] #
    all_labels = [res.get("overall_sentiment_label") for res in chunk_results if res.get("overall_sentiment_label") and isinstance(res.get("overall_sentiment_label"), str)] #
    if not valid_scores: logger.warning(f"{log_prefix} 合并情感结果时未找到有效 sentiment_score。"); return chunk_results[0] if chunk_results else {"error": "所有块均无有效情感数据"} #
    avg_score = sum(valid_scores) / len(valid_scores) #
    dominant_label = "neutral"; #
    if all_labels: from collections import Counter; label_counts = Counter(all_labels); #
    if all_labels and label_counts: dominant_label = label_counts.most_common(1)[0][0] #
    combined_details_parts = [] #
    for res in chunk_results: #
        if isinstance(res, dict) and res.get("details"): #
            if isinstance(res["details"], list): combined_details_parts.extend(res["details"]) #
            elif isinstance(res["details"], str): combined_details_parts.append(res["details"]) #
    return {"overall_sentiment_label": dominant_label, "overall_sentiment_score": round(avg_score, 4), "num_chunks_analyzed": len(chunk_results), "details": combined_details_parts or None } #

def _merge_list_results(chunk_results: List[Any], log_prefix: str, item_key_for_deduplication: Optional[str] = None) -> List[Any]: #
    merged_list: List[Any] = [] #
    for res_item in chunk_results: #
        if isinstance(res_item, list): merged_list.extend(res_item) #
        elif isinstance(res_item, dict): merged_list.append(res_item) # 假设单个字典也是列表项
    
    if not item_key_for_deduplication or not all(isinstance(item, dict) for item in merged_list): #
        # 如果不进行去重，或列表项不是字典，则尝试用set去重（只对可哈希项有效）
        try: return list(set(merged_list)) if all(isinstance(i, (str, int, float, bool, tuple)) for i in merged_list) else merged_list #
        except TypeError: return merged_list # 如果包含不可哈希类型，则返回原样

    seen_identifiers = set(); unique_items_list = [] #
    for item in merged_list: #
        identifier = item.get(item_key_for_deduplication) #
        if identifier is not None: #
            # 尝试将列表类型的标识符转换为元组以便哈希
            identifier_hashable = tuple(sorted(identifier)) if isinstance(identifier, list) else identifier #
            try: #
                if identifier_hashable not in seen_identifiers: #
                    unique_items_list.append(item); seen_identifiers.add(identifier_hashable) #
            except TypeError: # 如果标识符仍然不可哈希
                logger.warning(f"{log_prefix} 去重时遇到不可哈希标识符 '{identifier_hashable}' (原始类型: {type(identifier)}，键: {item_key_for_deduplication})，此条目直接添加。") #
                unique_items_list.append(item) #
        else: # 没有去重键的条目直接添加
            unique_items_list.append(item) #
    logger.info(f"{log_prefix} 合并了 {len(merged_list)} 项目，去重后 {len(unique_items_list)} (键: {item_key_for_deduplication})。") #
    return unique_items_list #

def _merge_summary_results(chunk_summaries: List[str], log_prefix: str) -> str: #
    if not chunk_summaries: return "" #
    return "\n\n".join(s.strip() for s in chunk_summaries if s and s.strip()) #


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
        llm_output_for_debug: str = "N/A"

        try:
            # 1. 使用 PromptEngineeringService 构建 Prompt
            mock_step_for_prompt = schemas.RuleStepPublic( 
                task_type=task.value,
                id=0, 
                chain_id=0, 
                step_order=0,
                is_enabled=True,
                input_source=schemas.StepInputSourceEnum.PREVIOUS_STEP, 
                parameters={}, 
                post_processing_rules=[],
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
            
            # 2. 调用 LLMOrchestrator 实例的 generate 方法
            response = await llm_orchestrator.generate( #
                model_id=model_id, #
                prompt=prompt_data.user_prompt, # 修改：使用构建好的prompt
                system_prompt=prompt_data.system_prompt, # 修改：使用构建好的system_prompt
                is_json_output=prompt_data.is_json_output_hint, # 修改：使用来自prompt_data的提示
                temperature=0.1 
            )
            if response.error: #
                raise RuntimeError(f"LLM调用错误: {response.error}") #
            
            llm_output_for_debug = response.text #

            if prompt_data.is_json_output_hint: # 修改：使用来自prompt_data的提示
                try:
                    json_str_parsed = llm_output_for_debug #
                    match_json_md = re.search(r"```json\s*([\s\S]+?)\s*```", llm_output_for_debug, re.DOTALL | re.IGNORECASE)
                    if match_json_md:
                        json_str_parsed = match_json_md.group(1).strip()
                    
                    analysis_result_chunk = json.loads(json_str_parsed) #
                except json.JSONDecodeError as e_json_parse_single: #
                    logger.error(f"{log_prefix} 任务 '{task_name_for_log}' 的块LLM输出 (模型: {response.model_id_used}) 不是有效JSON: {e_json_parse_single}. 输出预览: {llm_output_for_debug[:200]}") #
                    error_info_chunk = {"task": task_name_for_log, "error": "JSON解析失败", "details": str(e_json_parse_single), "raw_output_preview": llm_output_for_debug[:150]} #
            else:
                analysis_result_chunk = llm_output_for_debug.strip() #

        except ContentSafetyException as e_safety: #
            logger.error(f"{log_prefix} 任务 '{task_name_for_log}' 的块因内容安全问题失败: {e_safety.original_message}") #
            error_info_chunk = {"task": task_name_for_log, "error": "内容安全异常", "details": e_safety.original_message[:200]} #
        except Exception as e_llm: #
            error_msg_llm = f"任务 '{task_name_for_log}' 的块LLM调用失败: {e_llm}" #
            logger.error(f"{log_prefix} {error_msg_llm}", exc_info=True) #
            error_info_chunk = {"task": task_name_for_log, "error": "LLM调用或Prompt构建失败", "details": str(e_llm)[:200]} #
        return analysis_result_chunk, error_info_chunk #

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
        chunk_results_for_task: List[Any] = [] #
        chunk_errors_for_task: List[Dict[str, str]] = [] #

        if not model_id_for_task: #
            logger.warning(f"{log_prefix} 任务 '{task_name_log}' 未配置模型ID，将跳过。") #
            chunk_errors_for_task.append({"task": task_name_log, "error": "模型未配置", "details": "任务已跳过。"}) #
            return None, chunk_errors_for_task #

        logger.info(f"{log_prefix} 开始执行 '{task_name_log}' ({len(text_chunks)} 块, 模型ID: '{model_id_for_task}')。") #
        
        tasks_for_gather = [ #
            BackgroundAnalysisService._analyze_single_chunk( 
                db, llm_orchestrator, prompt_engineer, task_enum, chunk, model_id_for_task, 
                novel_id_for_context, 
                f"{log_prefix} [块 {i+1}/{len(text_chunks)}]", task_name_log
            ) for i, chunk in enumerate(text_chunks) #
        ]
        
        gathered_results = await asyncio.gather(*tasks_for_gather, return_exceptions=True) #

        for result_item in gathered_results: #
            if isinstance(result_item, Exception): #
                logger.error(f"{log_prefix} 任务 '{task_name_log}' 的一个块分析时发生gather异常: {result_item}") #
                chunk_errors_for_task.append({"task": task_name_log, "error": "块分析时发生gather异常", "details": str(result_item)[:150]}) #
            else: #
                res, err = result_item #
                if res is not None: chunk_results_for_task.append(res) #
                if err: chunk_errors_for_task.append(err) #
        
        if not chunk_results_for_task: logger.warning(f"{log_prefix} 任务 '{task_name_log}' 所有块均无有效结果。"); return None, chunk_errors_for_task #
        
        merged_result: Optional[Any] = None #
        try: #
            if task_enum == schemas.PredefinedTaskEnum.SENTIMENT_ANALYSIS_CHAPTER: merged_result = _merge_sentiment_results(chunk_results_for_task, log_prefix) #
            elif task_enum == schemas.PredefinedTaskEnum.EXTRACT_MAIN_EVENT: merged_result = _merge_list_results(chunk_results_for_task, log_prefix, "event_summary") #
            elif task_enum == schemas.PredefinedTaskEnum.EXTRACT_ROLES: merged_result = _merge_list_results(chunk_results_for_task, log_prefix, "character_name") #
            elif task_enum == schemas.PredefinedTaskEnum.ANALYZE_CHAPTER_THEME: merged_result = _merge_list_results(chunk_results_for_task, log_prefix, "theme") #
            elif task_enum == schemas.PredefinedTaskEnum.SUMMARIZE_CHAPTER: #
                summaries_list = [] #
                for res_item in chunk_results_for_task: #
                    if isinstance(res_item, dict) and "summary" in res_item and isinstance(res_item["summary"], str): #
                        summaries_list.append(res_item["summary"]) #
                    elif isinstance(res_item, str): #
                        summaries_list.append(res_item) #
                merged_result = _merge_summary_results(summaries_list, log_prefix) #
            else: logger.warning(f"{log_prefix} 任务 '{task_enum.value}' 无特定合并策略。"); merged_result = chunk_results_for_task[0] if len(chunk_results_for_task) == 1 else chunk_results_for_task #
        except Exception as e_merge: #
            logger.error(f"{log_prefix} 合并任务 '{task_name_log}' 结果时出错: {e_merge}", exc_info=True); chunk_errors_for_task.append({"task": f"合并 {task_name_log}", "error": "结果合并失败", "details": str(e_merge)}) #
            if not merged_result and chunk_results_for_task: merged_result = chunk_results_for_task[0] if len(chunk_results_for_task) == 1 else chunk_results_for_task #
        
        if merged_result is not None: logger.info(f"{log_prefix} 任务 '{task_name_log}' 完成，生成合并结果。错误数: {len(chunk_errors_for_task)}。") #
        else: logger.warning(f"{log_prefix} 任务 '{task_name_log}' 完成，但未生成合并结果。错误数: {len(chunk_errors_for_task)}。") #
        return merged_result, chunk_errors_for_task #

    @staticmethod
    async def _analyze_chapter_content(
        db: Session,
        chapter: models.Chapter,
        llm_orchestrator: LLMOrchestrator, 
        prompt_engineer: PromptEngineeringService, 
        analysis_config: Optional[Dict[str, Any]] = None, 
        chunk_config_override: Optional[Dict[str, Any]] = None
    ) -> bool: 
        log_prefix = f"[章节分析 CH_ID:{chapter.id} NV_ID:{chapter.novel_id}]" #
        logger.info(f"{log_prefix} 开始分析章节 '{chapter.title}'。") #
        analysis_data_for_crud_update: Dict[str, Any] = {} #
        accumulated_errors: List[Dict[str, str]] = [] #
        chapter_content = chapter.content or "" #
        if not chapter_content.strip(): logger.info(f"{log_prefix} 章节内容为空，跳过。"); return True #

        app_cfg = get_config() #
        llm_settings_cfg = app_cfg.llm_settings #
        task_model_preferences_map = llm_settings_cfg.task_model_preference #
        global_default_model_id_from_config = llm_settings_cfg.default_model_id #
        
        current_chunk_config_to_use = chunk_config_override or _get_chunk_config_from_settings() #
        tokenizer_model_id_for_splitting = global_default_model_id_from_config or current_chunk_config_to_use.get("tokenizer_model") #
        
        text_chunks_list = _split_text_into_chunks(chapter_content, current_chunk_config_to_use, tokenizer_model_id_for_splitting) #
        if not text_chunks_list: logger.warning(f"{log_prefix} 分块后无内容，跳过。"); return True #
        logger.info(f"{log_prefix} 内容分割为 {len(text_chunks_list)} 块。") #

        tasks_to_run_config_list: List[Tuple[str, schemas.PredefinedTaskEnum, str, bool]] = [ #
            ("sentiment_analysis", schemas.PredefinedTaskEnum.SENTIMENT_ANALYSIS_CHAPTER, "章节情感分析", True), #
            ("event_extraction", schemas.PredefinedTaskEnum.EXTRACT_MAIN_EVENT, "主要事件提取", True), #
            ("character_analysis", schemas.PredefinedTaskEnum.EXTRACT_ROLES, "主要角色提及分析", True), #
            ("theme_analysis", schemas.PredefinedTaskEnum.ANALYZE_CHAPTER_THEME, "章节主题分析", True), #
            ("summary", schemas.PredefinedTaskEnum.SUMMARIZE_CHAPTER, "章节摘要生成", True), #
        ]
        any_task_produced_actual_results = False #
        effective_analysis_config = analysis_config or app_cfg.background_analysis_settings.model_dump() #

        for crud_field_name, task_enum_to_run, task_name_for_logging, default_enabled_status in tasks_to_run_config_list: #
            task_category_name = crud_field_name.split('_')[0] #
            task_specific_settings = effective_analysis_config.get(task_category_name, {}) #
            if isinstance(task_specific_settings, dict) and task_specific_settings.get("enabled", default_enabled_status): #
                model_id_for_this_task_run = task_model_preferences_map.get(task_enum_to_run.value, global_default_model_id_from_config) #
                
                merged_res_from_chunks, errors_from_chunks = await BackgroundAnalysisService._execute_analysis_task_on_chunks( #
                    db, llm_orchestrator, prompt_engineer, task_enum_to_run, task_name_for_logging, 
                    text_chunks_list, model_id_for_this_task_run, chapter.novel_id, log_prefix
                )
                if merged_res_from_chunks is not None:  #
                    analysis_data_for_crud_update[crud_field_name] = merged_res_from_chunks; any_task_produced_actual_results = True #
                if errors_from_chunks: accumulated_errors.extend(errors_from_chunks) #
            else:
                 logger.info(f"{log_prefix} 任务 '{task_name_for_logging}' 在配置中被禁用，跳过。") #

        if any_task_produced_actual_results or accumulated_errors: #
            chapter_to_update_orm = await asyncio.to_thread(db.get, models.Chapter, chapter.id) #
            if not chapter_to_update_orm:
                logger.error(f"{log_prefix} 尝试更新章节分析数据时，未能在数据库中找到章节ID {chapter.id}。")
                return False 

            try: #
                logger.info(f"{log_prefix} 准备更新数据库。分析字段: {list(analysis_data_for_crud_update.keys())}。错误数: {len(accumulated_errors)}。") #
                update_payload_for_chapter = { #
                    "sentiment_analysis": analysis_data_for_crud_update.get("sentiment_analysis"), 
                    "event_extraction": analysis_data_for_crud_update.get("event_extraction"),
                    "character_analysis": analysis_data_for_crud_update.get("character_analysis"),
                    "theme_analysis": analysis_data_for_crud_update.get("theme_analysis"),
                    "summary": analysis_data_for_crud_update.get("summary") 
                }
                filtered_payload_for_chapter = {k: v for k, v in update_payload_for_chapter.items() if v is not None}

                if filtered_payload_for_chapter: 
                    await asyncio.to_thread(crud.update_chapter, db=db, chapter_obj=chapter_to_update_orm, chapter_in=filtered_payload_for_chapter) # 修改：调用新的crud.update_chapter
                    logger.info(f"{log_prefix} 章节分析数据已更新到数据库。") #
                else:
                    logger.info(f"{log_prefix} 没有新的分析数据需要更新到数据库。")

            except Exception as e_db_upd_chapter: logger.error(f"{log_prefix} 更新章节分析数据到DB失败: {e_db_upd_chapter}", exc_info=True); return False #
        
        if accumulated_errors: #
            non_model_cfg_errors = [err for err in accumulated_errors if err.get("error") != "模型未配置"] #
            if non_model_cfg_errors:  #
                logger.warning(f"{log_prefix} 分析完成，但有 {len(non_model_cfg_errors)} 个非配置类错误。"); return False #
            elif accumulated_errors: logger.info(f"{log_prefix} 分析完成，部分任务因模型未配置跳过。"); return True #
        
        logger.info(f"{log_prefix} 章节分析成功完成。"); return True #

    @staticmethod
    def start_full_analysis( 
        db: Session, 
        novel_id: int,
        llm_orchestrator: LLMOrchestrator, 
        analysis_config_from_global: Optional[Dict[str, Any]] = None 
    ):
        log_prefix_novel_analysis = f"[小说分析服务 ID:{novel_id}]" #
        logger.info(f"{log_prefix_novel_analysis} (后台任务) 开始对所有章节进行分析。") #

        novel_orm_instance: Optional[models.Novel] = None #
        prompt_engineer_instance = PromptEngineeringService(db_session=db, llm_orchestrator=llm_orchestrator)

        try:
            # crud.get_novel(with_details=True) 会预加载章节
            novel_orm_instance = crud.get_novel(db, novel_id=novel_id, with_details=True) #
            if not novel_orm_instance:  #
                logger.error(f"{log_prefix_novel_analysis} 未找到小说ID {novel_id}。中止。"); return #

            update_data_in_progress = {"analysis_status": schemas.NovelAnalysisStatusEnum.IN_PROGRESS.value, "analysis_errors": []} #
            crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_in=update_data_in_progress) # 修改：使用新的crud.update_novel
            logger.info(f"{log_prefix_novel_analysis} 小说《{novel_orm_instance.title}》状态更新为“进行中”。") #
            
            if not novel_orm_instance.chapters: #
                logger.info(f"{log_prefix_novel_analysis} 小说《{novel_orm_instance.title}》无章节，分析标记为完成（无内容）。") #
                update_data_no_content = {"analysis_status": schemas.NovelAnalysisStatusEnum.COMPLETED_NO_CONTENT.value, "analysis_errors": ["小说无章节内容可供分析"]} #
                crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_in=update_data_no_content) # 修改：使用新的crud.update_novel
                return #

            sorted_chapters_list = sorted( #
                list(novel_orm_instance.chapters),  #
                key=lambda c: (c.plot_version_id is not None, c.plot_version_id or -1,  #
                               c.chapter_index if c.plot_version_id is None else (c.version_order or float('inf'))) #
            )
            total_chapters_to_analyze = len(sorted_chapters_list) #
            successful_chapters_count = 0; chapters_with_issues_count = 0 #
            
            async def run_chapter_analyses(): #
                nonlocal successful_chapters_count, chapters_with_issues_count, accumulated_novel_errors 
                tasks_for_chapters = [ #
                    BackgroundAnalysisService._analyze_chapter_content( #
                        db, chapter_item, llm_orchestrator, prompt_engineer_instance, 
                        analysis_config_from_global 
                    ) for chapter_item in sorted_chapters_list #
                ]
                results_from_chapter_analysis = await asyncio.gather(*tasks_for_chapters, return_exceptions=True) #

                for i_res, result_or_exc_item in enumerate(results_from_chapter_analysis): #
                    chapter_being_analyzed = sorted_chapters_list[i_res] #
                    chap_log_prefix_item_loop = f"{log_prefix_novel_analysis} [章节 {i_res+1}/{total_chapters_to_analyze} ID:{chapter_being_analyzed.id}]" #
                    if isinstance(result_or_exc_item, Exception): #
                        logger.error(f"{chap_log_prefix_item_loop} 处理章节时发生未捕获的严重错误: {result_or_exc_item}", exc_info=True) #
                        chapters_with_issues_count += 1 #
                        error_msg_for_loop = f"章节 {chapter_being_analyzed.id} 严重处理错误: {str(result_or_exc_item)[:150]}" #
                        if error_msg_for_loop not in accumulated_novel_errors: accumulated_novel_errors.append(error_msg_for_loop) #
                    elif result_or_exc_item: # True 表示成功 #
                        successful_chapters_count +=1 #
                    else: # False 表示有内部问题 #
                        chapters_with_issues_count += 1 #
                        logger.warning(f"{chap_log_prefix_item_loop} 章节处理完成，但存在问题或警告。") #
                    if (i_res + 1) % 10 == 0: logger.info(f"{log_prefix_novel_analysis} 已处理 {i_res+1} 个章节的分析。") #
            
            accumulated_novel_errors: List[str] = [] 
            asyncio.run(run_chapter_analyses()) 

            final_status_to_set: schemas.NovelAnalysisStatusEnum #
            if chapters_with_issues_count == 0 and successful_chapters_count == total_chapters_to_analyze:  #
                final_status_to_set = schemas.NovelAnalysisStatusEnum.COMPLETED; logger.info(f"{log_prefix_novel_analysis} 所有 {total_chapters_to_analyze} 章均成功处理。") #
            elif successful_chapters_count > 0 or chapters_with_issues_count > 0 :  #
                final_status_to_set = schemas.NovelAnalysisStatusEnum.COMPLETED_WITH_ERRORS; summary_msg_for_final = f"分析完成。成功章节: {successful_chapters_count}/{total_chapters_to_analyze}。问题章节: {chapters_with_issues_count}/{total_chapters_to_analyze}。"; accumulated_novel_errors.append(summary_msg_for_final); logger.warning(f"{log_prefix_novel_analysis} {summary_msg_for_final}") #
            else:  #
                final_status_to_set = schemas.NovelAnalysisStatusEnum.FAILED; summary_msg_for_all_fail = f"所有 {total_chapters_to_analyze} 章均处理失败或未执行任务。"; accumulated_novel_errors.append(summary_msg_for_all_fail); logger.error(f"{log_prefix_novel_analysis} {summary_msg_for_all_fail}") #
            
            final_novel_update_data = {"analysis_status": final_status_to_set.value, "analysis_errors": accumulated_novel_errors} #
            crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_in=final_novel_update_data) # 修改：使用新的crud.update_novel
            logger.info(f"{log_prefix_novel_analysis} 小说《{novel_orm_instance.title}》分析流程结束。最终状态: {final_status_to_set.value}。") #

        except Exception as e_main_orchestrator_bg_task: #
            logger.critical(f"{log_prefix_novel_analysis} (后台任务) 主分析流程发生严重错误: {e_main_orchestrator_bg_task}", exc_info=True) #
            if novel_id and novel_orm_instance: #
                try: #
                    fail_error_msg_outer_task = f"主分析流程严重错误: {str(e_main_orchestrator_bg_task)[:200]}" #
                    current_errors_on_fail_task = novel_orm_instance.analysis_errors or [] #
                    if fail_error_msg_outer_task not in current_errors_on_fail_task: current_errors_on_fail_task.append(fail_error_msg_outer_task) #
                    
                    novel_fail_update_payload_dict = {"analysis_status": schemas.NovelAnalysisStatusEnum.FAILED.value, "analysis_errors": current_errors_on_fail_task } #
                    crud.update_novel(db=db, novel_obj=novel_orm_instance, novel_in=novel_fail_update_payload_dict) # 修改：使用新的crud.update_novel
                except Exception as e_commit_fail_status_bg_task: #
                    logger.error(f"{log_prefix_novel_analysis} (后台任务) 尝试提交“失败”状态时再次失败: {e_commit_fail_status_bg_task}", exc_info=True) #


# --- 单个章节分析的后台任务触发器 (与您上传的文件一致，仅做微小调整以确保兼容性) ---
def trigger_chapter_analysis_task(
    background_tasks: Optional[Any], 
    chapter_id: int,
    novel_id: int, 
    analysis_config_override: Optional[Dict[str, Any]] = None,
    llm_orchestrator_override: Optional[LLMOrchestrator] = None
):
    log_prefix_trigger_chap = f"[ChapterAnalysisTrigger CH_ID:{chapter_id} NV_ID:{novel_id}]" #
    logger.info(f"{log_prefix_trigger_chap} 收到触发单个章节分析的请求。") #

    def run_single_chapter_analysis_in_background(
        chap_id_bg: int, 
        nov_id_bg: int, 
        config_override_bg: Optional[Dict[str, Any]],
        llm_orch_instance_bg: LLMOrchestrator 
    ):
        log_prefix_bg_run = f"{log_prefix_trigger_chap} (后台任务)" #
        logger.info(f"{log_prefix_bg_run} 开始分析章节。") #
        db_session_bg = SessionLocal() #
        try:
            chapter_to_analyze_bg = db_session_bg.get(models.Chapter, chap_id_bg) #
            if not chapter_to_analyze_bg or chapter_to_analyze_bg.novel_id != nov_id_bg: #
                logger.error(f"{log_prefix_bg_run} 未找到章节ID {chap_id_bg} 或其不属于小说 {nov_id_bg}。") #
                return #

            prompt_engineer_bg_instance = PromptEngineeringService(db_session=db_session_bg, llm_orchestrator=llm_orch_instance_bg)
            
            async def do_analysis_bg(): #
                return await BackgroundAnalysisService._analyze_chapter_content( #
                    db=db_session_bg, #
                    chapter=chapter_to_analyze_bg, #
                    llm_orchestrator=llm_orch_instance_bg, #
                    prompt_engineer=prompt_engineer_bg_instance, 
                    analysis_config=config_override_bg #
                )
            
            success = asyncio.run(do_analysis_bg()) #
            
            if success: logger.info(f"{log_prefix_bg_run} 章节分析成功完成。") #
            else: logger.warning(f"{log_prefix_bg_run} 章节分析完成，但存在问题或警告。") #

        except Exception as e_single_chap_bg: #
            logger.error(f"{log_prefix_bg_run} 分析单个章节时发生错误: {e_single_chap_bg}", exc_info=True) #
        finally:
            db_session_bg.close() #
            logger.info(f"{log_prefix_bg_run} 单章节分析的数据库会话已关闭。") #

    llm_orch_to_use_for_bg = llm_orchestrator_override or LLMOrchestrator() #

    if background_tasks: #
        background_tasks.add_task( #
            run_single_chapter_analysis_in_background,
            chapter_id, novel_id, analysis_config_override, llm_orch_to_use_for_bg
        )
        logger.info(f"{log_prefix_trigger_chap} 已将单个章节分析任务添加到后台队列。") #
    else: 
        logger.warning(f"{log_prefix_trigger_chap} 未提供 BackgroundTasks 对象，将尝试同步执行（不推荐）。") #
        db_sync_exec = SessionLocal() #
        try: #
            run_single_chapter_analysis_in_background( #
                db_sync_exec, chapter_id, novel_id, analysis_config_override, llm_orch_to_use_for_bg
            )
        finally: #
            db_sync_exec.close() #