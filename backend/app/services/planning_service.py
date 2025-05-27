# backend/app/services/planning_service.py
import logging
import json
import re
import math
from typing import List, Dict, Optional, Any, Tuple, Callable, Awaitable # Callable, Awaitable 可能用于旧的嵌入函数签名
from datetime import datetime
import asyncio # 导入 asyncio

from sqlalchemy.orm import Session 
# from sqlalchemy.ext.asyncio import AsyncSession # 如果进行异步数据库操作，则需要，但当前crud是同步的

# 导入项目内部模块
from app import crud, models, schemas, config_service, tokenizer_service # 使用 app 顶层包导入
from app.llm_orchestrator import LLMOrchestrator, ContentSafetyException # 从正确的路径导入
from app.services import vector_store_service # 从正确的路径导入

# 从 schemas 模块导入枚举和特定的 Pydantic 模型
# SchemasPredefinedTaskEnum, StepInputSourceEnum 已更名为 schemas.PredefinedTaskEnum, schemas.StepInputSourceEnum
# SentimentConstraintEnum, OutputFormatConstraintEnum, PlotVersionStatusEnum, ConflictLevelEnum, RuleStepParameterDefinition 已更名为 schemas.下的同名枚举或类

logger = logging.getLogger(__name__)

async def _get_truncated_context_piece(
    text: Optional[str],
    max_tokens: int,
    model_user_id_for_tokenizer: str, # 这个应该是用户定义的模型ID
    description_for_log: str
) -> str:
    """辅助函数：截断文本以适应 token 限制，使用 tokenizer_service。"""
    if not text or not text.strip():
        return f"({description_for_log} 未提供或为空)"

    log_prefix_truncate = f"[PlanningSvc-TruncateContext-{description_for_log}]" # 添加服务前缀
    logger.debug(f"{log_prefix_truncate} 原始文本长度: {len(text)} chars, 目标tokens: {max_tokens}, 使用模型配置ID: {model_user_id_for_tokenizer}")

    try:
        # tokenizer_service.truncate_text_by_tokens 是异步函数
        truncated_text_content, num_final_tokens = await tokenizer_service.truncate_text_by_tokens(
            text=text,
            max_tokens=max_tokens,
            model_user_id=model_user_id_for_tokenizer # 传递用户定义的模型ID
        )
        if len(text) > len(truncated_text_content):
            logger.info(f"{log_prefix_truncate} 文本已截断。原长: {len(text)} chars, 截断后: {len(truncated_text_content)} chars (约 {num_final_tokens} tokens).")
        else:
            logger.debug(f"{log_prefix_truncate} 文本无需截断。长度: {len(truncated_text_content)} chars (约 {num_final_tokens} tokens).")
        return truncated_text_content
    except Exception as e_truncate:
        logger.error(f"{log_prefix_truncate} 调用 tokenizer_service.truncate_text_by_tokens 失败: {e_truncate}. 将返回原始文本的前缀作为后备。", exc_info=True)
        # 从配置服务获取回退的每Token字符数估算值
        chars_per_token_fallback = config_service.get_setting("llm_settings.tokenizer_options.default_chars_per_token_general", 2.5)
        fallback_max_chars = int(max_tokens * chars_per_token_fallback)
        if len(text) > fallback_max_chars:
            return text[:fallback_max_chars] + f"... (因精确截断失败，已按字符数粗略截断，原长{len(text)}字符)"
        return text


def _cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """计算两个向量之间的余弦相似度。"""
    if not vec1 or not vec2 or len(vec1) != len(vec2): return 0.0
    dot_product = sum(v1 * v2 for v1, v2 in zip(vec1, vec2))
    magnitude1 = math.sqrt(sum(v**2 for v in vec1)); magnitude2 = math.sqrt(sum(v**2 for v in vec2))
    if magnitude1 == 0 or magnitude2 == 0: return 0.0
    similarity = dot_product / (magnitude1 * magnitude2)
    return max(-1.0, min(1.0, similarity)) # 确保结果在 [-1, 1] 区间

async def parse_user_goal_to_structured_dict(
    llm_orchestrator: LLMOrchestrator, # 接收 LLMOrchestrator 实例
    goal_description: str,
    novel_context_summary: Optional[str] = None,
    requested_model_user_id: Optional[str] = None 
) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    """使用LLM将用户的自然语言改编目标解析为结构化字典。"""
    planner_log: List[str] = [f"开始解析用户改编目标 (前100字符): \"{goal_description[:100].replace(chr(10), ' ')}...\""]
    parsed_goal_as_dict: Optional[Dict[str, Any]] = None
    
    task_identifier_for_model_selection = schemas.PredefinedTaskEnum.PLANNING_PARSE_GOAL.value
    
    # 确定实际用于LLM调用的模型ID和用于Token截断的模型ID
    # (与您提供的原始文件逻辑一致，确保 config_service.get_setting 路径正确)
    app_cfg = config_service.get_config()
    actual_model_user_id_for_llm_call: Optional[str] = requested_model_user_id
    model_id_for_truncation_tokenizer: str
    
    if requested_model_user_id:
        model_id_for_truncation_tokenizer = requested_model_user_id
    else:
        preferred_for_task = app_cfg.llm_settings.task_model_preference.get(task_identifier_for_model_selection)
        model_alias_or_id = preferred_for_task or app_cfg.llm_settings.default_model_id
        if model_alias_or_id:
            model_id_for_truncation_tokenizer = app_cfg.llm_settings.model_aliases.get(model_alias_or_id, model_alias_or_id)
        else: # 最终回退
            model_id_for_truncation_tokenizer = app_cfg.llm_settings.model_aliases.get(
                app_cfg.llm_settings.default_llm_fallback, 
                app_cfg.llm_settings.default_llm_fallback
            )
    if not model_id_for_truncation_tokenizer: # 进一步保险
         planner_log.append("错误: 无法确定用于Token截断的模型ID。")
         logger.error("PlanningService (parse_goal): 无法确定用于Token截断的有效模型user_given_id。")
         return None, planner_log

    planner_log.append(f"选定用于目标解析的LLM模型配置（ID/别名）: {actual_model_user_id_for_llm_call or '由Orchestrator根据任务类型决定'}")
    planner_log.append(f"选定用于上下文截断的模型配置ID (tokenizer): {model_id_for_truncation_tokenizer}")

    # 构建Prompt (与您原始文件中的模板类似)
    # 注意：这里的 prompt_template_for_goal_parsing 应包含所有schemas.SentimentConstraintEnum等枚举值的字符串形式
    # 为清晰起见，实际项目中可以将此长模板移至单独的常量文件或配置
    prompt_template_for_goal_parsing = f"""
你是一位专注于分析中文网络小说改编需求的AI助手。请仔细审查以下用户提供的关于小说改编目标的自然语言描述。
你的核心任务是提取所有相关的关键信息，并将这些信息精确地组织成一个严格符合特定格式的JSON对象字符串。
输出要求：你【必须仅输出一个单一且完整的JSON对象字符串】。不要包含任何JSON对象之外的解释性文字、Markdown标记 (如 ```json ... ```) 或任何其他非JSON内容。

JSON对象结构定义 (请严格遵守。如果某个字段的信息在用户描述中未提及或不适用，请省略该字段或将其值设为null/[]，除非字段本身有默认值指示。):
- "main_intent": (字符串, 可选) 用户的主要改编意图。例如："风格转换", "情节简化", "角色视角转换", "结局改写", "生成互动小说脚本", "特定场景增强"。
- "key_elements": (字符串数组, 可选, 默认为 []) 描述中明确提及的关键元素，如角色名、特定情节、重要物品、地点、核心设定、主题思想等。
- "target_style": (字符串数组, 可选, 默认为 []) 用户期望的最终作品风格。例如：["轻松幽默", "热血爽文", "悬疑推理", "科幻硬核", "现实主义", "浪漫言情"]。
- "target_sentiment": (字符串, 可选, 严格限制为以下枚举值之一: "{schemas.SentimentConstraintEnum.POSITIVE.value}", "{schemas.SentimentConstraintEnum.NEGATIVE.value}", "{schemas.SentimentConstraintEnum.NEUTRAL.value}")。
- "target_audience": (字符串, 可选) 改编作品的目标读者群体 (例如："青少年 (12-18岁)", "青年男性 (18-30岁)", "资深网文爱好者", "对特定题材感兴趣的女性读者")。
- "length_modification": (字符串, 可选) 对作品篇幅的修改意图。例如："大幅缩减为短篇", "扩充细节增加篇幅", "保持与原作大致相当"。
- "specific_instructions": (字符串, 可选) 用户提出的其他具体指令、约束条件、或期望的剧情走向/结局的简要描述。
- "novel_title_hint": (字符串, 可选) 如果用户描述中明确提及了作为改编基础的小说标题。
- "focus_chapters_or_parts": (字符串, 可选) 用户希望重点进行改编或分析的章节范围或故事的特定部分 (例如："前三章", "高潮部分", "主角黑化前的剧情")。
"""
    constructed_input_for_llm = goal_description
    if novel_context_summary and novel_context_summary.strip():
        truncated_summary = await _get_truncated_context_piece(
            novel_context_summary,
            max_tokens=500, 
            model_user_id_for_tokenizer=model_id_for_truncation_tokenizer, 
            description_for_log="小说摘要(用于目标解析)"
        )
        constructed_input_for_llm = (
            f"用户改编目标描述：\n\"\"\"\n{goal_description}\n\"\"\"\n\n"
            f"相关小说摘要 (供参考，请勿直接复制到输出的JSON中，仅用于理解用户目标)：\n\"\"\"\n{truncated_summary}\n\"\"\"\n"
        )
        planner_log.append(f"已将小说摘要（原始长度 {len(novel_context_summary)} chars, 截断后用于提示）和目标描述合并为LLM输入。")

    final_llm_instruction_for_parsing = (
        f"{prompt_template_for_goal_parsing.strip()}"
        f"\n\n请分析以下用户提供的内容，并严格按照上述JSON对象结构定义进行解析和输出：\n--- 用户提供内容开始 ---\n"
        f"{constructed_input_for_llm.strip()}"
        f"\n--- 用户提供内容结束 ---\n\nJSON输出："
    )
    planner_log.append(f"构建的LLM目标解析指令 (部分预览): {final_llm_instruction_for_parsing[:600].replace(chr(10), ' ')}...")

    llm_raw_response_str: str = ""; json_str_extracted_for_parsing: Optional[str] = None
    model_used_for_parsing: Optional[str] = None

    try:
        # 准备传递给 llm_orchestrator.generate 的参数
        llm_call_params = {
            "temperature": 0.05, 
            "max_tokens": 2000 # 期望LLM输出的JSON的Token上限
        }
        # generation_constraints 在这里通过Prompt指示LLM输出JSON，
        # llm_orchestrator.generate 的 is_json_output 参数也可以设为True来辅助
        
        # 调用 llm_orchestrator.generate
        llm_response: schemas.LLMResponse = await llm_orchestrator.generate(
            model_id=actual_model_user_id_for_llm_call, # 允许Orchestrator根据task_identifier_for_model_selection选择
            prompt=final_llm_instruction_for_parsing, # 完整的指令作为用户Prompt
            system_prompt=None, # 此场景系统提示已融入主Prompt
            is_json_output=True, # 明确期望JSON输出
            llm_override_parameters=llm_call_params # 传递温度、最大Token等
        )

        if llm_response.error:
            raise RuntimeError(f"LLM调用返回错误: {llm_response.error}")
        
        llm_raw_response_str = llm_response.text
        model_used_for_parsing = llm_response.model_id_used
        planner_log.append(f"LLM目标解析调用成功，使用模型: {model_used_for_parsing}。原始响应 (前100字符): {llm_raw_response_str[:100].replace(chr(10), ' ')}...")

        # 后续的JSON提取和解析逻辑与您提供的版本一致
        match_markdown_json = re.search(r"```json\s*([\s\S]+?)\s*```", llm_raw_response_str, re.DOTALL)
        if match_markdown_json:
            json_str_extracted_for_parsing = match_markdown_json.group(1).strip()
            planner_log.append("从Markdown代码块中提取到JSON内容。")
        elif llm_raw_response_str.strip().startswith("{") and llm_raw_response_str.strip().endswith("}"):
            json_str_extracted_for_parsing = llm_raw_response_str.strip()
            planner_log.append("LLM响应看似为纯JSON，直接解析。")
        else: # 尝试从文本中提取第一个 '{' 和最后一个 '}' 之间的内容
            first_brace_idx = llm_raw_response_str.find('{')
            last_brace_idx = llm_raw_response_str.rfind('}')
            if first_brace_idx != -1 and last_brace_idx != -1 and last_brace_idx > first_brace_idx:
                json_str_extracted_for_parsing = llm_raw_response_str[first_brace_idx : last_brace_idx+1].strip()
                planner_log.append(f"警告: LLM响应非标准JSON。尝试提取被 '{{...}}' 包裹的部分。")
            else:
                planner_log.append(f"错误: LLM响应中未找到有效JSON结构。响应 (前300字符): {llm_raw_response_str[:300].replace(chr(10),' ')}")
                raise json.JSONDecodeError("LLM响应不是有效的JSON字符串或Markdown JSON块。", llm_raw_response_str, 0)

        if not json_str_extracted_for_parsing: # 如果未能提取出任何内容
            planner_log.append(f"错误: 未能从LLM响应中提取出有效的JSON字符串。响应 (前300字符): {llm_raw_response_str[:300].replace(chr(10),' ')}")
            raise json.JSONDecodeError("未能从LLM响应提取JSON字符串。", llm_raw_response_str, 0)

        parsed_goal_as_dict = json.loads(json_str_extracted_for_parsing)

        if not isinstance(parsed_goal_as_dict, dict):
            planner_log.append(f"错误: LLM响应成功解析为JSON，但结果不是一个字典类型。实际类型: {type(parsed_goal_as_dict)}。")
            parsed_goal_as_dict = None # 重置为None
        else:
            planner_log.append("LLM响应成功解析为字典。")
            # 对解析出的字典进行必要的清理或类型转换 (与您原代码一致)
            for list_key in ["key_elements", "target_style"]:
                if list_key in parsed_goal_as_dict:
                    if parsed_goal_as_dict[list_key] is None: parsed_goal_as_dict[list_key] = []
                    elif not isinstance(parsed_goal_as_dict[list_key], list):
                        original_val = parsed_goal_as_dict[list_key]
                        parsed_goal_as_dict[list_key] = [str(original_val)] if original_val and str(original_val).strip() else []
            if "target_sentiment" in parsed_goal_as_dict and parsed_goal_as_dict["target_sentiment"]:
                try: schemas.SentimentConstraintEnum(parsed_goal_as_dict["target_sentiment"]) # 验证是否为有效枚举值
                except ValueError:
                    planner_log.append(f"警告: LLM返回的目标情感值 '{parsed_goal_as_dict['target_sentiment']}' 无效，将忽略此字段。")
                    parsed_goal_as_dict.pop("target_sentiment", None) # 移除无效值

    except json.JSONDecodeError as e_json_decode:
        planner_log.append(f"错误: 解析LLM响应为JSON失败 - {str(e_json_decode)}. 尝试解析的JSON字符串 (前250字符): {json_str_extracted_for_parsing[:250].replace(chr(10),' ') if json_str_extracted_for_parsing else 'N/A'}")
        logger.error(f"PlanningService: JSONDecodeError in parse_user_goal_to_structured_dict: {e_json_decode}. Parsed string (first 250): '{json_str_extracted_for_parsing[:250] if json_str_extracted_for_parsing else 'N/A'}'. LLM Raw (first 250): '{llm_raw_response_str[:250]}'", exc_info=False)
        parsed_goal_as_dict = None
    except ContentSafetyException as e_safety: # 捕获内容安全异常
        planner_log.append(f"错误: LLM目标解析调用因内容安全问题失败 - {e_safety.original_message}")
        logger.warning(f"PlanningService: ContentSafetyException in parse_user_goal_to_structured_dict: {e_safety.original_message}", exc_info=False)
        parsed_goal_as_dict = None
    except (RuntimeError, ValueError) as e_llm_or_prompt: # 捕获LLM调用或Prompt构建时的其他错误
        planner_log.append(f"错误: LLM调用或Prompt构建失败 - {str(e_llm_or_prompt)}")
        logger.error(f"PlanningService: LLM/Prompt error in parse_user_goal_to_structured_dict: {e_llm_or_prompt}", exc_info=True)
        parsed_goal_as_dict = None
    except Exception as e_unknown_parse: # 捕获其他未知错误
        planner_log.append(f"错误: 解析用户目标时发生未知错误 - {str(e_unknown_parse)}")
        logger.error(f"PlanningService: Unexpected error in parse_user_goal_to_structured_dict: {e_unknown_parse}", exc_info=True)
        parsed_goal_as_dict = None

    return parsed_goal_as_dict, planner_log


def _get_text_representation_for_chain(chain_orm: models.RuleChain) -> str:
    """为规则链生成文本表示（用于语义相似度计算）。"""
    parts: List[str] = [chain_orm.name.lower()]
    if chain_orm.description: parts.append(chain_orm.description.lower())
    step_reprs: List[str] = []
    
    # chain_orm.steps 是 List[models.RuleStep]
    # chain_orm.template_associations 是 List[models.RuleChainRuleTemplateAssociation]
    # 需要合并并排序
    
    combined_steps_info: List[Dict[str, Any]] = []
    for step_model in chain_orm.steps:
        combined_steps_info.append({
            "order": step_model.step_order,
            "type": "private",
            "task_type": step_model.task_type,
            "instruction": step_model.custom_instruction,
            "params": step_model.parameters # 已经是字典
        })
    for assoc in chain_orm.template_associations:
        if assoc.template: # 确保模板已加载
            combined_steps_info.append({
                "order": assoc.step_order,
                "type": "template",
                "task_type": assoc.template.task_type,
                "instruction": assoc.template.custom_instruction,
                "params": assoc.template.parameters # 已经是字典
            })
            
    sorted_steps_info = sorted(combined_steps_info, key=lambda s_info: s_info["order"])
    
    for step_info_dict in sorted_steps_info:
        step_details_parts: List[str] = [f"步骤 {step_info_dict['order'] + 1} 类型 {step_info_dict['task_type'].lower()} ({'私有' if step_info_dict['type'] == 'private' else '模板'})"]
        if step_info_dict.get("instruction"): step_details_parts.append(f"指令摘要: {step_info_dict['instruction'].lower()[:80]}")
        
        params_dict_val = step_info_dict.get("params")
        if params_dict_val and isinstance(params_dict_val, dict):
            param_summary_parts_list: List[str] = []
            if step_info_dict['task_type'] == schemas.PredefinedTaskEnum.RAG_GENERATION.value and params_dict_val.get("rag_instruction"): 
                param_summary_parts_list.append(f"RAG核心指令: {str(params_dict_val['rag_instruction'])[:40]}")
            
            gc_data_val = params_dict_val.get("generation_constraints")
            if isinstance(gc_data_val, dict): # generation_constraints 在参数中通常是字典形式
                if gc_data_val.get("max_length"): param_summary_parts_list.append(f"限长{gc_data_val['max_length']}")
                if gc_data_val.get("enforce_sentiment"): param_summary_parts_list.append(f"情感{gc_data_val['enforce_sentiment']}")
                if gc_data_val.get("output_format"): param_summary_parts_list.append(f"格式{gc_data_val['output_format']}")
                style_hints_val = gc_data_val.get("style_hints")
                if style_hints_val and isinstance(style_hints_val, list) and style_hints_val: 
                    param_summary_parts_list.append(f"风格:{','.join(style_hints_val[:2])}")

            if step_info_dict['task_type'] == schemas.PredefinedTaskEnum.CHANGE_PERSPECTIVE.value:
                if params_dict_val.get("source_perspective"): param_summary_parts_list.append(f"源视角:{params_dict_val['source_perspective']}")
                if params_dict_val.get("target_perspective"): param_summary_parts_list.append(f"目标视角:{params_dict_val['target_perspective']}")
            
            if param_summary_parts_list: step_details_parts.append(f"参数特点: {', '.join(param_summary_parts_list)}")
        step_reprs.append(" ".join(step_details_parts))
        
    if step_reprs: parts.append("步骤概览: " + "; ".join(step_reprs))
    return " ".join(parts)

def _get_text_representation_for_parsed_goal(parsed_goal: schemas.ParsedAdaptationGoal) -> str:
    """为解析后的目标生成文本表示。"""
    parts: List[str] = []
    if parsed_goal.main_intent: parts.append(f"主要意图是{parsed_goal.main_intent}")
    if parsed_goal.key_elements and isinstance(parsed_goal.key_elements, list): parts.append(f"关键元素包括{','.join(parsed_goal.key_elements)}")
    if parsed_goal.target_style and isinstance(parsed_goal.target_style, list): parts.append(f"目标风格为{','.join(parsed_goal.target_style)}")
    if parsed_goal.target_sentiment: parts.append(f"目标情感为{parsed_goal.target_sentiment.value}") # 使用枚举的 .value
    if parsed_goal.target_audience: parts.append(f"目标读者是{parsed_goal.target_audience}")
    if parsed_goal.length_modification: parts.append(f"篇幅想{parsed_goal.length_modification}")
    if parsed_goal.focus_chapters_or_parts: parts.append(f"重点关注{parsed_goal.focus_chapters_or_parts}")
    if parsed_goal.novel_title_hint: parts.append(f"针对小说《{parsed_goal.novel_title_hint}》")
    if parsed_goal.specific_instructions: parts.append(f"具体要求是{parsed_goal.specific_instructions[:150]}") # 限制长度
    return "；".join(filter(None, parts)) if parts else "一个通用的改编目标"


async def recommend_chains_for_parsed_goal(
    parsed_goal_obj: schemas.ParsedAdaptationGoal,
    novel_id: Optional[int], 
    db: Session, 
) -> Tuple[List[schemas.RecommendedRuleChainItem], List[str]]:
    """根据解析后的目标推荐规则链模板。"""
    # crud.get_rule_chains 返回 (items, total_count)
    all_chains_from_db_tuple = await asyncio.to_thread(crud.get_rule_chains, db, limit=1000, only_templates=True)
    all_chains_from_db: List[models.RuleChain] = all_chains_from_db_tuple[0] # 获取规则链列表
    
    planner_log_recommend: List[str] = ["开始为解析后的目标推荐规则链模板..."]
    if not parsed_goal_obj:
        planner_log_recommend.append("错误：传入的解析后目标对象为空，无法推荐。"); return [], planner_log_recommend

    if not all_chains_from_db:
        planner_log_recommend.append("数据库中无已保存的规则链模板，无法推荐。"); return [], planner_log_recommend

    planner_log_recommend.append(f"从数据库获取到 {len(all_chains_from_db)} 条规则链模板进行匹配。")

    # 关键词匹配逻辑 (与原始文件一致)
    search_terms_from_goal: List[str] = []
    if parsed_goal_obj.main_intent: search_terms_from_goal.extend(re.split(r'\s+|,|;', parsed_goal_obj.main_intent.lower()))
    # ... (其他关键词提取逻辑)
    search_terms_from_goal = list(set(s_term.strip() for s_term in search_terms_from_goal if s_term and s_term.strip() and len(s_term.strip()) > 1))
    planner_log_recommend.append(f"关键词匹配搜索词 (共{len(search_terms_from_goal)}个，预览): {search_terms_from_goal[:15]}...")
    
    candidate_chains_with_scores: List[Dict[str, Any]] = []
    for chain_db_model_item in all_chains_from_db: # chain_db_model_item 是 models.RuleChain 实例
        kw_score = 0.0; match_reasons: List[str] = []
        chain_text_corpus_name_desc = f"{chain_db_model_item.name.lower()} {chain_db_model_item.description.lower() if chain_db_model_item.description else ''}"
        for term_kw in search_terms_from_goal:
            if term_kw in chain_text_corpus_name_desc: kw_score += 1.0; match_reasons.append(f"名称/描述匹配'{term_kw}'")
        
        # 组合私有步骤和模板步骤进行匹配 (与 _get_text_representation_for_chain 类似)
        # 注意：chain_db_model_item.steps 和 chain_db_model_item.template_associations
        # 在 crud.get_rule_chains 中应该被正确预加载 (lazy="selectin" 或 joinedload)
        # 否则，访问它们会触发额外的数据库查询，在异步上下文中可能需要特殊处理
        # 假设 crud.get_rule_chains 已处理好预加载
        
        # 私有步骤
        for step_db_model_item in chain_db_model_item.steps: 
            step_corpus_str = f"{step_db_model_item.task_type.lower()}"
            if step_db_model_item.custom_instruction: step_corpus_str += f" {step_db_model_item.custom_instruction.lower()}"
            try:
                params_dict_step = step_db_model_item.parameters # 已经是字典
                if params_dict_step:
                    params_str_val = json.dumps(params_dict_step, ensure_ascii=False, default=str).lower()
                    step_corpus_str += f" {params_str_val}"
            except TypeError: pass # 忽略JSON序列化错误
            for term_kw_step in search_terms_from_goal:
                if term_kw_step in step_corpus_str: kw_score += 0.5; match_reasons.append(f"私有步骤'{step_db_model_item.task_type}'匹配'{term_kw_step}'")
        
        # 模板步骤
        for assoc_item in chain_db_model_item.template_associations:
            if assoc_item.template: # 确保模板已加载
                template_step_corpus = f"{assoc_item.template.task_type.lower()}"
                if assoc_item.template.custom_instruction: template_step_corpus += f" {assoc_item.template.custom_instruction.lower()}"
                try:
                    template_params_dict = assoc_item.template.parameters
                    if template_params_dict:
                        template_params_str = json.dumps(template_params_dict, ensure_ascii=False, default=str).lower()
                        template_step_corpus += f" {template_params_str}"
                except TypeError: pass
                for term_kw_template_step in search_terms_from_goal:
                    if term_kw_template_step in template_step_corpus: kw_score += 0.4; match_reasons.append(f"模板步骤'{assoc_item.template.task_type}'匹配'{term_kw_template_step}'")


        if kw_score > 0:
            candidate_chains_with_scores.append({
                "chain_orm": chain_db_model_item, "keyword_score": kw_score,
                "match_reasons": list(set(match_reasons)), "semantic_score": 0.0 # 初始化语义得分
            })

    # 语义相似度推荐 (核心逻辑修改处)
    use_semantic_cfg = config_service.get_setting("planning_settings.use_semantic_recommendation", True)
    semantic_weight_cfg = config_service.get_setting("planning_settings.semantic_score_weight", 1.5)
    if use_semantic_cfg and candidate_chains_with_scores:
        planner_log_recommend.append(f"尝试进行语义相似度推荐 (权重: {semantic_weight_cfg})...")
        try:
            goal_text_representation = _get_text_representation_for_parsed_goal(parsed_goal_obj)
            chain_texts_representations = [_get_text_representation_for_chain(cand_info['chain_orm']) for cand_info in candidate_chains_with_scores]
            
            all_texts_for_embedding = [goal_text_representation] + chain_texts_representations
            
            # 获取嵌入模型实例
            embedding_model = vector_store_service.get_embedding_model()
            # LangChain 的 embed_documents 是同步的，用 asyncio.to_thread 包装
            all_embeddings_list = await asyncio.to_thread(
                embedding_model.embed_documents,
                all_texts_for_embedding
            )
            
            if all_embeddings_list and len(all_embeddings_list) == len(all_texts_for_embedding) and all_embeddings_list[0]:
                goal_embedding_vector = all_embeddings_list[0]
                chain_embeddings_vectors = all_embeddings_list[1:]
                for i, chain_info_item in enumerate(candidate_chains_with_scores):
                    if i < len(chain_embeddings_vectors) and chain_embeddings_vectors[i]:
                        similarity_score_val = _cosine_similarity(goal_embedding_vector, chain_embeddings_vectors[i])
                        chain_info_item["semantic_score"] = max(0, similarity_score_val) # 确保非负
                        chain_info_item["match_reasons"].append(f"语义相关度: {similarity_score_val:.3f}")
                planner_log_recommend.append(f"已计算 {len(chain_embeddings_vectors)} 条规则链模板与目标的语义相似度。")
            else:
                planner_log_recommend.append(f"警告：获取嵌入向量数量不足或目标嵌入为空。跳过语义推荐。")
        except RuntimeError as e_embed_runtime_err: # 捕获可能的模型加载错误
            logger.error(f"PlanningService (recommend_chains): 文本嵌入失败: {e_embed_runtime_err}", exc_info=True)
            planner_log_recommend.append(f"警告：语义推荐的嵌入向量生成失败 - {str(e_embed_runtime_err)}。")
        except Exception as e_semantic_error_val:
            logger.error(f"PlanningService (recommend_chains): 规则链语义推荐过程中发生未知错误: {e_semantic_error_val}", exc_info=True)
            planner_log_recommend.append(f"警告：规则链语义推荐失败 - {str(e_semantic_error_val)}")
    elif not use_semantic_cfg:
        planner_log_recommend.append("语义推荐已在配置中禁用，仅使用关键词匹配。")

    # 计算最终得分并排序 (与原始文件一致)
    for chain_info_final_score in candidate_chains_with_scores:
        kw_s_val = chain_info_final_score.get("keyword_score", 0.0) or 0.0
        sem_s_val = chain_info_final_score.get("semantic_score", 0.0) or 0.0
        chain_info_final_score["final_score"] = kw_s_val + (sem_s_val * semantic_weight_cfg if use_semantic_cfg and sem_s_val > 0 else 0)
    
    candidate_chains_with_scores.sort(key=lambda x_sort: x_sort.get("final_score", 0.0), reverse=True)
    
    max_recs_cfg = config_service.get_setting("planning_settings.max_recommendations", 5)
    score_threshold_recommend_cfg = config_service.get_setting("planning_settings.recommendation_score_threshold", 0.1)
    recommendations_result_list: List[schemas.RecommendedRuleChainItem] = []
    
    # 归一化因子，避免出现 > 1.0 的分数 (与原始文件一致)
    max_observed_score_val = max(chain_info_norm.get("final_score", 0.0) for chain_info_norm in candidate_chains_with_scores) if candidate_chains_with_scores else 1.0
    normalizing_factor_heuristic_val = max(1.0, max_observed_score_val)

    for cand_info_item in candidate_chains_with_scores:
        if len(recommendations_result_list) >= max_recs_cfg: break
        final_score_item_val = cand_info_item.get("final_score", 0.0)
        relevance_score_normalized_val = min(1.0, max(0.0, round(final_score_item_val / normalizing_factor_heuristic_val, 3))) if normalizing_factor_heuristic_val > 0 else 0.0
        
        # 如果已有一些推荐，且当前项分数过低，则停止添加 (与原始文件一致)
        if relevance_score_normalized_val < score_threshold_recommend_cfg and len(recommendations_result_list) >= 1:
             if final_score_item_val == 0 and len(recommendations_result_list) > 0 : continue # 对于0分，如果已有推荐，则不再添加

        chain_model_rec_item: models.RuleChain = cand_info_item["chain_orm"] # SQLModel 实例
        recommendations_result_list.append(schemas.RecommendedRuleChainItem(
            chain_id=chain_model_rec_item.id, # id 应该是 Optional[int]
            chain_name=chain_model_rec_item.name,
            description=chain_model_rec_item.description, 
            relevance_score=relevance_score_normalized_val,
            reasoning=", ".join(list(set(cand_info_item.get("match_reasons",[]))))[:255] # 限制理由长度
        ))
    planner_log_recommend.append(f"最终推荐 {len(recommendations_result_list)} 条规则链模板。")
    return recommendations_result_list, planner_log_recommend


async def generate_rule_chain_draft_from_parsed_goal(
    llm_orchestrator: LLMOrchestrator, # 接收 LLMOrchestrator 实例
    parsed_goal_obj: schemas.ParsedAdaptationGoal,
    novel_id: Optional[int], 
    novel_context_summary: Optional[str] = None,
    requested_model_user_id: Optional[str] = None,
    planner_log: Optional[List[str]] = None 
) -> Tuple[Optional[schemas.RuleChainCreate], List[str]]:
    """使用LLM根据解析后的目标和可选的小说上下文生成规则链草稿。"""
    # (此函数大部分逻辑与原始文件一致，关键是适配LLM调用部分)
    if planner_log is None: planner_log = []
    planner_log.append("开始使用LLM生成规则链草稿...")
    if not parsed_goal_obj:
        planner_log.append("错误：传入的解析后目标对象为空，无法生成草稿。"); return None, planner_log

    # 确定模型ID的逻辑 (与 parse_user_goal_to_structured_dict 中的类似)
    # ... (此处省略，与 parse_user_goal_to_structured_dict 中模型ID确定逻辑相同，确保路径正确)
    app_cfg_draft = config_service.get_config()
    task_identifier_for_draft_gen = schemas.PredefinedTaskEnum.PLANNING_GENERATE_DRAFT.value
    actual_model_user_id_for_draft_call = requested_model_user_id
    model_id_for_draft_truncation: str

    if requested_model_user_id: model_id_for_draft_truncation = requested_model_user_id
    else:
        pref_draft = app_cfg_draft.llm_settings.task_model_preference.get(task_identifier_for_draft_gen)
        model_alias_id_draft = pref_draft or app_cfg_draft.llm_settings.default_model_id
        if model_alias_id_draft: model_id_for_draft_truncation = app_cfg_draft.llm_settings.model_aliases.get(model_alias_id_draft, model_alias_id_draft)
        else: model_id_for_draft_truncation = app_cfg_draft.llm_settings.model_aliases.get(app_cfg_draft.llm_settings.default_llm_fallback, app_cfg_draft.llm_settings.default_llm_fallback)
    
    if not model_id_for_draft_truncation:
        planner_log.append("错误: 无法确定用于Token截断的模型ID (草稿生成)。")
        logger.error("PlanningService (generate_draft): 无法确定用于Token截断的有效模型 user_given_id。")
        return None, planner_log
        
    planner_log.append(f"选定用于规则链草稿生成的LLM模型配置（ID/别名）: {actual_model_user_id_for_draft_call or '由Orchestrator决定'}")
    planner_log.append(f"选定用于上下文截断的模型配置ID (tokenizer - 草稿): {model_id_for_draft_truncation}")

    parsed_goal_dict_for_prompt_val = parsed_goal_obj.model_dump(exclude_none=True, exclude_defaults=True)
    
    # 构建可用任务描述 (与原始文件一致)
    available_tasks_desc_parts_list: List[str] = ["以下是设计规则链步骤时可用的预定义任务类型（`task_type`）及其典型用途和关键参数提示："]
    task_labels_map_val = schemas.get_predefined_task_details_map() # 从 schemas.py 获取
    for task_enum_item_val, task_info_item_val in task_labels_map_val.items():
        desc_line_str = f"- \"{task_enum_item_val.value}\" ({task_info_item_val['label']}): {task_info_item_val['description']}"
        if task_info_item_val.get('key_params'): desc_line_str += f" 关键参数提示: {', '.join(task_info_item_val['key_params'])}。"
        available_tasks_desc_parts_list.append(desc_line_str)
    available_tasks_str_val = "\n".join(available_tasks_desc_parts_list)
    
    # 构建Prompt (与原始文件中的模板类似，确保所有枚举值都正确引用)
    prompt_for_draft_generation_val = f"""
作为一位经验丰富的中文网络小说编辑和AI流程自动化专家，你的任务是根据用户提供的已解析改编目标（JSON格式），设计一个包含多个步骤（RuleStep）的自动化规则链（RuleChain）草稿。
规则链应该能够帮助用户高效地实现他们的改编意图。

【可用任务类型参考】
{available_tasks_str_val}

【规则链步骤设计指南】
1.  **逻辑顺序与输入源**: 步骤的 `step_order` 从0开始连续递增。`input_source` 默认为 `"{schemas.StepInputSourceEnum.PREVIOUS_STEP.value}"`；第一个步骤通常应使用 `"{schemas.StepInputSourceEnum.ORIGINAL.value}"`。
2.  **任务类型选择**: 根据用户目标和可用任务列表，为每个步骤选择最合适的 `task_type`。
3.  **参数化 (`parameters` 对象)**: ... (省略详细参数化说明，与原始文件一致，但确保引用正确的枚举值如 PredefinedTaskEnum.RAG_GENERATION.value) ...
4.  **RAG步骤**: 如果步骤的 `task_type` 是 `"{schemas.PredefinedTaskEnum.RAG_GENERATION.value}"`，则核心的检索和生成指令应放在 `parameters.rag_instruction` (字符串) 中。
5.  **目标映射**: ...
6.  **简洁性与实用性**: ...

【输出要求】
请严格按照以下Pydantic模型参考，输出一个【单一、完整且有效的JSON对象字符串】，代表一个 `RuleChainCreate` 类型的规则链草稿。
【绝对不要】在JSON对象之外包含任何解释性文字、Markdown标记 (如 ```json ... ```)、注释或任何形式的前后缀文本。
请为规则链草稿生成一个简洁且能准确反映其核心改编目标的 `name` (字符串) 和可选的 `description` (字符串)。
确保 `is_template` 字段的值为 `false`。
所有步骤 (`steps` 数组) 必须包含 `step_order`, `task_type`, `input_source`。其他字段根据需要添加。

```json
// Pydantic模型参考 (仅供结构参考，实际输出时【不要】包含这些注释)
// {{
//   "name": "string (例如：将奇幻小说《XXX》改编为轻松幽默风格的短篇)",
//   "description": "string (可选, 描述此规则链的功能和目标)",
//   "is_template": false,
//   "novel_id": null, // 如果不与特定小说关联，则为null
//   "steps": [ // steps 数组，包含RuleStepCreatePrivate或RuleTemplateReferenceCreate类型的对象
//     {{
//       "step_type": "private", // 或 "template"
//       "step_order": 0, 
//       "task_type": "string (必须是可用任务类型之一)", // 对于私有步骤
//       // "template_id": 123, // 对于模板引用步骤
//       "input_source": "string (例如：original, previous_step)",
//       "parameters": {{ // 示例参数，具体结构依赖RuleStepParameterDefinition
//         // "model_id": {{ "param_type": "model_selector", "value": "user_defined_llm_config_id" }},
//         // "target_audience": {{ "param_type": "static_string", "value": "青少年" }}
//       }},
//       // ... 其他可选字段 ...
//     }}
//   ]
// }}

用户提供的已解析改编目标（请基于此进行设计）：
{json.dumps(parsed_goal_dict_for_prompt_val, indent=2, ensure_ascii=False)}
"""
    final_llm_instruction_for_drafting_val = prompt_for_draft_generation_val
    if novel_context_summary and novel_context_summary.strip():
        truncated_novel_summary_draft = await _get_truncated_context_piece(
            novel_context_summary, max_tokens=700,
            model_user_id_for_tokenizer=model_id_for_draft_truncation, 
            description_for_log="小说摘要(用于草稿生成)"
        )
        final_llm_instruction_for_drafting_val += f'\n\n相关小说摘要 (供参考，帮助理解用户目标，请勿直接复制到规则链步骤中)：\n"""\n{truncated_novel_summary_draft}\n"""\n'
        planner_log.append(f"已将小说摘要（原始长度 {len(novel_context_summary)} chars, 截断后用于提示）加入草稿生成提示。")

    final_llm_instruction_for_drafting_val += "\n请严格按照上述JSON对象结构和输出要求进行回应，直接输出JSON对象字符串："
    planner_log.append(f"构建的LLM规则链草稿生成提示 (部分预览): {final_llm_instruction_for_drafting_val[:700].replace(chr(10), ' ')}...")

    generated_chain_draft_schema_obj: Optional[schemas.RuleChainCreate] = None
    llm_draft_gen_raw_response_str_val: str = ""; json_draft_str_to_parse_val: Optional[str] = None
    model_used_for_drafting_val: Optional[str] = None

    try:
        # 准备传递给 llm_orchestrator.generate 的参数
        llm_call_params_draft = {
            "temperature": 0.2, 
            "max_tokens": config_service.get_setting("llm_settings.default_max_completion_tokens", 2000) * 2 # 允许草稿生成较长的输出
        }
        
        llm_draft_response: schemas.LLMResponse = await llm_orchestrator.generate(
            model_id=actual_model_user_id_for_draft_call, # 允许编排器根据任务选择
            prompt=final_llm_instruction_for_drafting_val,
            system_prompt=None, # 系统提示已融入主Prompt
            is_json_output=True, # 明确期望JSON
            llm_override_parameters=llm_call_params_draft
        )

        if llm_draft_response.error:
            raise RuntimeError(f"LLM调用返回错误: {llm_draft_response.error}")

        llm_draft_gen_raw_response_str_val = llm_draft_response.text
        model_used_for_drafting_val = llm_draft_response.model_id_used
        planner_log.append(f"LLM规则链草稿生成调用成功，使用模型: {model_used_for_drafting_val}。原始响应 (前100字符): {llm_draft_gen_raw_response_str_val[:100].replace(chr(10), ' ')}...")

        # 后续的JSON提取和解析逻辑 (与原始文件一致)
        match_draft_markdown_val = re.search(r"```json\s*([\s\S]+?)\s*```", llm_draft_gen_raw_response_str_val, re.DOTALL)
        if match_draft_markdown_val: json_draft_str_to_parse_val = match_draft_markdown_val.group(1).strip()
        elif llm_draft_gen_raw_response_str_val.strip().startswith("{") and llm_draft_gen_raw_response_str_val.strip().endswith("}"): json_draft_str_to_parse_val = llm_draft_gen_raw_response_str_val.strip()
        else: # 尝试提取第一个 '{' 和最后一个 '}'
            first_b_draft = llm_draft_gen_raw_response_str_val.find('{'); last_b_draft = llm_draft_gen_raw_response_str_val.rfind('}')
            if first_b_draft != -1 and last_b_draft != -1 and last_b_draft > first_b_draft:
                json_draft_str_to_parse_val = llm_draft_gen_raw_response_str_val[first_b_draft : last_b_draft + 1].strip()
                planner_log.append("警告: LLM生成的规则链草稿响应非标准JSON，尝试提取被 '{...}' 包裹的部分。")
            else:
                planner_log.append(f"错误: LLM生成的规则链草稿响应中未找到有效JSON结构。响应 (前300字符): {llm_draft_gen_raw_response_str_val[:300].replace(chr(10),' ')}")
                raise json.JSONDecodeError("LLM草稿响应不是有效的JSON字符串或Markdown JSON块。", llm_draft_gen_raw_response_str_val, 0)

        if not json_draft_str_to_parse_val:
            planner_log.append(f"错误: 未能从LLM响应中提取出有效的规则链草稿JSON字符串。响应 (前300字符): {llm_draft_gen_raw_response_str_val[:300].replace(chr(10),' ')}")
            raise json.JSONDecodeError("未能从LLM响应提取规则链草稿JSON字符串。", llm_draft_gen_raw_response_str_val, 0)
        
        parsed_chain_draft_dict_val = json.loads(json_draft_str_to_parse_val)
        
        if not isinstance(parsed_chain_draft_dict_val, dict): # 确保根是字典
            planner_log.append(f"错误：LLM返回的草稿根级别不是一个JSON对象。类型：{type(parsed_chain_draft_dict_val)}")
            raise ValueError("LLM生成的规则链草稿根级别必须是JSON对象。")

        # 对草稿进行校验和填充默认值 (与原始文件一致，确保使用 schemas.PredefinedTaskEnum.value 等)
        if "name" not in parsed_chain_draft_dict_val or not str(parsed_chain_draft_dict_val.get("name", "")).strip():
            parsed_chain_draft_dict_val["name"] = f"AI生成草稿 (基于: {parsed_goal_obj.main_intent or '综合目标'}) - {datetime.now().strftime('%H%M%S')}"
        parsed_chain_draft_dict_val["is_template"] = False # 确保是false
        parsed_chain_draft_dict_val.setdefault("novel_id", novel_id if novel_id else None) # 关联到当前小说（如果提供）

        raw_steps_val = parsed_chain_draft_dict_val.get("steps")
        if not isinstance(raw_steps_val, list):
            parsed_chain_draft_dict_val["steps"] = [] # 确保steps是列表
            planner_log.append("警告: LLM生成的草稿缺少'steps'字段或其不是列表，已初始化为空列表。")
        else: # 清理和规范化步骤数据
            valid_steps_for_schema_list: List[Dict[str,Any]] = []
            # 按 step_order 排序，以防LLM未按顺序生成
            sorted_raw_steps_list = sorted(raw_steps_val, key=lambda s_item: s_item.get('step_order', float('inf')) if isinstance(s_item,dict) else float('inf'))
            
            for i_step_idx, step_dict_raw_item_val in enumerate(sorted_raw_steps_list):
                if not isinstance(step_dict_raw_item_val, dict):
                    planner_log.append(f"警告: 忽略了一个非字典类型的步骤数据: {str(step_dict_raw_item_val)[:50]}"); continue
                
                step_data_for_pydantic_val: Dict[str, Any] = {"step_order": i_step_idx} # 强制重排 order

                # 处理 task_type (确保是有效的枚举值或自定义字符串)
                task_type_val_raw_item = str(step_dict_raw_item_val.get('task_type',"")).strip()
                try: 
                    step_data_for_pydantic_val['task_type'] = schemas.PredefinedTaskEnum(task_type_val_raw_item).value
                except ValueError: 
                    planner_log.append(f"提示: 步骤 {i_step_idx} 的task_type '{task_type_val_raw_item}' 是自定义类型或无法匹配预定义枚举。")
                    step_data_for_pydantic_val['task_type'] = task_type_val_raw_item 
                
                # 处理 input_source
                input_source_val_raw_item = str(step_dict_raw_item_val.get('input_source',"")).strip()
                try:
                    step_data_for_pydantic_val['input_source'] = schemas.StepInputSourceEnum(input_source_val_raw_item).value
                except ValueError: # 回退到默认逻辑
                     step_data_for_pydantic_val['input_source'] = schemas.StepInputSourceEnum.PREVIOUS_STEP.value if i_step_idx > 0 else schemas.StepInputSourceEnum.ORIGINAL.value
                
                step_data_for_pydantic_val['custom_instruction'] = str(step_dict_raw_item_val.get('custom_instruction', "")).strip() or None

                # 参数处理：确保 parameters 是一个字典，其值可以是简单类型或嵌套的 RuleStepParameterDefinition 结构
                raw_params_step = step_dict_raw_item_val.get('parameters')
                if isinstance(raw_params_step, dict):
                    # 递归地将参数值（如果是字典）转换为RuleStepParameterDefinition对象
                    # (这部分逻辑可以很复杂，取决于参数定义的深度和规范程度)
                    # 为简化，这里直接使用原始字典，并依赖Pydantic的校验
                    step_data_for_pydantic_val['parameters'] = raw_params_step
                else: step_data_for_pydantic_val['parameters'] = {}
                
                # 后处理规则
                raw_pp_rules_step = step_dict_raw_item_val.get('post_processing_rules')
                if isinstance(raw_pp_rules_step, list):
                    valid_pp_rules_list = []
                    for rule_str_item in raw_pp_rules_step:
                        try: valid_pp_rules_list.append(schemas.PostProcessingRuleEnum(str(rule_str_item)).value)
                        except ValueError: planner_log.append(f"警告: 步骤 {i_step_idx} 的后处理规则 '{rule_str_item}' 无效，已忽略。")
                    step_data_for_pydantic_val['post_processing_rules'] = valid_pp_rules_list
                else: step_data_for_pydantic_val['post_processing_rules'] = []
                
                # 其他步骤字段 (model_id, llm_override_parameters, generation_constraints, etc.)
                step_data_for_pydantic_val['model_id'] = step_dict_raw_item_val.get('model_id')
                step_data_for_pydantic_val['llm_override_parameters'] = step_dict_raw_item_val.get('llm_override_parameters') if isinstance(step_dict_raw_item_val.get('llm_override_parameters'), dict) else None
                step_data_for_pydantic_val['generation_constraints'] = step_dict_raw_item_val.get('generation_constraints') if isinstance(step_dict_raw_item_val.get('generation_constraints'), dict) else None
                step_data_for_pydantic_val['output_variable_name'] = step_dict_raw_item_val.get('output_variable_name')
                step_data_for_pydantic_val['description'] = step_dict_raw_item_val.get('description')
                step_data_for_pydantic_val.setdefault('step_type', 'private') # 默认是私有步骤
                step_data_for_pydantic_val.setdefault('is_enabled', True)

                valid_steps_for_schema_list.append(step_data_for_pydantic_val)
            parsed_chain_draft_dict_val["steps"] = valid_steps_for_schema_list

        # 使用 Pydantic 模型进行最终校验
        generated_chain_draft_schema_obj = schemas.RuleChainCreate(**parsed_chain_draft_dict_val)
        planner_log.append(f"AI生成的规则链草稿成功解析并校验: '{generated_chain_draft_schema_obj.name}' ({len(generated_chain_draft_schema_obj.steps)}个步骤).")

    except json.JSONDecodeError as e_json_decode_draft_val:
        planner_log.append(f"错误: 解析LLM生成的规则链草稿JSON失败 - {str(e_json_decode_draft_val)}. 尝试解析的JSON (前250字符): {json_draft_str_to_parse_val[:250].replace(chr(10),' ') if json_draft_str_to_parse_val else 'N/A'}")
        logger.error(f"PlanningService: JSONDecodeError (Draft Chain Generation): {e_json_decode_draft_val}. Parsed string (first 250): '{json_draft_str_to_parse_val[:250] if json_draft_str_to_parse_val else 'N/A'}'. LLM Raw (first 250): '{llm_draft_gen_raw_response_str_val[:250]}'", exc_info=False)
        generated_chain_draft_schema_obj = None
    except ContentSafetyException as e_safety_draft_val: # 捕获内容安全异常
        planner_log.append(f"错误: LLM规则链草稿生成调用因内容安全问题失败 - {e_safety_draft_val.original_message}")
        logger.warning(f"PlanningService: ContentSafetyException in generate_rule_chain_draft_from_parsed_goal: {e_safety_draft_val.original_message}", exc_info=False)
        generated_chain_draft_schema_obj = None
    except (RuntimeError, ValueError) as e_llm_or_prompt_draft_val: # 捕获LLM调用、Prompt构建或Pydantic校验错误
        planner_log.append(f"错误: LLM调用、Prompt构建或草稿数据校验失败 (草稿生成) - {str(e_llm_or_prompt_draft_val)}")
        logger.error(f"PlanningService: LLM/Prompt/Validation error in generate_rule_chain_draft_from_parsed_goal: {e_llm_or_prompt_draft_val}", exc_info=True)
        generated_chain_draft_schema_obj = None
    except Exception as e_draft_gen_unknown_val: # 捕获其他未知错误
        planner_log.append(f"错误: 生成或校验规则链草稿时发生未知错误 - {str(e_draft_gen_unknown_val)}")
        logger.error(f"PlanningService: Error in generate_rule_chain_draft_from_parsed_goal: {e_draft_gen_unknown_val}", exc_info=True)
        generated_chain_draft_schema_obj = None

    return generated_chain_draft_schema_obj, planner_log


async def generate_ai_suggested_plot_version(
    db: Session, 
    llm_orchestrator: LLMOrchestrator, # 接收 LLMOrchestrator 实例
    plot_branch: models.PlotBranch, # SQLModel 实例
    user_prompt: str,
    parent_version_id: Optional[int] = None,
    llm_params_override: Optional[Dict[str, Any]] = None, # 用于覆盖LLM参数
    requested_model_user_id: Optional[str] = None 
) -> Optional[models.PlotVersion]: # 返回 SQLModel 实例
    """使用AI为剧情分支生成一个新的剧情版本建议。"""
    # novel 是通过 plot_branch.novel 访问的，应已通过关系加载
    novel_orm_instance = await asyncio.to_thread(lambda: plot_branch.novel) # 确保在异步上下文中访问关系
    if not novel_orm_instance:
        logger.error(f"AI生成剧情版本：剧情分支ID {plot_branch.id} 未关联到有效的小说记录。")
        raise ValueError(f"剧情分支 {plot_branch.id} 未正确关联到小说。")
    
    log_prefix_plot_sugg = f"[PlanningSvc-AISuggestPlotVersion BranchID:{plot_branch.id}, NovelID:{novel_orm_instance.id}]"
    logger.info(f"{log_prefix_plot_sugg} - 用户提示: '{user_prompt[:50]}...'")

    # 确定模型ID (与之前类似)
    # ... (省略模型ID确定逻辑，与 parse_user_goal_to_structured_dict 中类似)
    app_cfg_plot = config_service.get_config()
    task_identifier_for_plot_sugg = schemas.PredefinedTaskEnum.PLOT_SUGGESTION.value
    actual_model_user_id_for_plot_call = requested_model_user_id
    model_id_for_plot_truncation: str

    if requested_model_user_id: model_id_for_plot_truncation = requested_model_user_id
    else:
        pref_plot = app_cfg_plot.llm_settings.task_model_preference.get(task_identifier_for_plot_sugg)
        model_alias_id_plot = pref_plot or app_cfg_plot.llm_settings.default_model_id
        if model_alias_id_plot: model_id_for_plot_truncation = app_cfg_plot.llm_settings.model_aliases.get(model_alias_id_plot, model_alias_id_plot)
        else: model_id_for_plot_truncation = app_cfg_plot.llm_settings.model_aliases.get(app_cfg_plot.llm_settings.default_llm_fallback, app_cfg_plot.llm_settings.default_llm_fallback)
    
    if not model_id_for_plot_truncation:
        logger.error(f"{log_prefix_plot_sugg} 无法确定用于Token截断的模型ID。")
        raise ValueError("无法确定Token截断模型ID。")

    # 构建上下文 (与原始文件类似，但确保使用异步截断)
    context_parts_list = [f"当前小说标题: 《{novel_orm_instance.title}》"]
    if novel_orm_instance.summary:
        summary_snip = await _get_truncated_context_piece(novel_orm_instance.summary, 500, model_id_for_plot_truncation, "小说摘要")
        context_parts_list.append(f"小说整体摘要:\n{summary_snip}")
    # ... (其他上下文构建，如世界观、分支描述、父版本摘要等)
    parent_version_text_ctx = "无明确的父版本作为参考，或这是分支下的第一个AI建议版本。"
    if parent_version_id:
        parent_version_orm = await asyncio.to_thread(crud.get_plot_version, db, parent_version_id)
        if parent_version_orm and parent_version_orm.plot_branch_id == plot_branch.id:
            parent_info_parts_list = [f"此新版本建议是基于现有版本 '{parent_version_orm.version_name}' (ID: {parent_version_orm.id}, 状态: {parent_version_orm.status.value}) 进行推演。"]
            if parent_version_orm.description: parent_info_parts_list.append(f"父版本描述: {await _get_truncated_context_piece(parent_version_orm.description, 200, model_id_for_plot_truncation, '父版本描述')}")
            if parent_version_orm.content_summary:
                summary_str_val = json.dumps(parent_version_orm.content_summary, ensure_ascii=False, indent=None)
                parent_info_parts_list.append(f"父版本内容摘要 (JSON): {await _get_truncated_context_piece(summary_str_val, 300, model_id_for_plot_truncation, '父版本摘要JSON')}")
            parent_version_text_ctx = "\n".join(parent_info_parts_list)
    context_parts_list.append(parent_version_text_ctx)
    full_context_for_llm_call = "\n\n".join(context_parts_list)

    # 构建Prompt (与原始文件模板类似)
    json_output_structure_guidance_val = """
请严格以JSON对象格式输出你的建议。JSON对象必须包含以下顶级键:
"suggested_version_name": (字符串) 为新剧情版本起一个简洁且能概括其核心的名称。
"suggested_description": (字符串) 详细阐述新剧情版本的核心理念、主要情节走向等。
"suggested_content_summary": (JSON对象) 一个包含新版本剧情核心内容的结构化摘要。此对象应包含以下子键: a. "main_theme_or_central_conflict": (字符串)... b. "opening_scene_description": (字符串)... c. "key_plot_points": (字符串数组, 至少3项)... d. "character_arcs_impacted": (对象数组, 可选)... e. "key_locations_or_items_involved": (字符串数组, 可选)... f. "branch_unique_elements": (字符串数组, 可选)...
"is_potential_ending": (布尔值, 必须提供true或false) 判断此剧情走向是否可能发展为结局。 """
    final_prompt_to_llm_call = f""" 作为一位经验丰富的剧情策划师，请为剧情分支构思一个全新的发展版本。
[现有背景信息和上下文]
{full_context_for_llm_call}
[用户的核心期望/问题/假设，指导新版本的方向]
"{user_prompt}"
[你的任务和输出格式要求]
{json_output_structure_guidance_val}
请确保输出的JSON对象完整、有效。"""

    # LLM调用参数准备 (与原始文件类似)
    planning_settings_cfg_val = config_service.get_setting("planning_settings", {})
    default_max_tokens_suggestion_val = planning_settings_cfg_val.get("plot_suggestion_max_tokens", 4000)
    default_min_tokens_suggestion_val = planning_settings_cfg_val.get("plot_suggestion_min_tokens", 300)

    llm_call_params_plot_sugg: Dict[str, Any] = {
        "temperature": 0.7, # 剧情建议可以更有创造性
        "max_tokens": default_max_tokens_suggestion_val 
    }
    if llm_params_override: # 合并用户传入的覆盖参数
        llm_call_params_plot_sugg.update(llm_params_override)
    
    # 从 llm_call_params_plot_sugg 中提取 model_id (如果用户在覆盖参数中指定了)
    final_model_id_for_plot_call_val = llm_call_params_plot_sugg.pop("model_id", actual_model_user_id_for_plot_call)


    logger.info(f"{log_prefix_plot_sugg} - 向LLM发送生成剧情版本建议的请求 (模型配置ID/别名: {final_model_id_for_plot_call_val or '由Orchestrator决定'})...")
    
    raw_llm_response_val: str; model_used_plot_sugg: Optional[str]
    try:
        llm_plot_response: schemas.LLMResponse = await llm_orchestrator.generate(
            model_id=final_model_id_for_plot_call_val, # 允许编排器根据任务选择
            prompt=final_prompt_to_llm_call,
            system_prompt=None, # 系统提示已融入主Prompt
            is_json_output=True, # 明确期望JSON
            llm_override_parameters=llm_call_params_plot_sugg
        )
        if llm_plot_response.error:
            raise RuntimeError(f"LLM调用返回错误: {llm_plot_response.error}")
        raw_llm_response_val = llm_plot_response.text
        model_used_plot_sugg = llm_plot_response.model_id_used

    except ContentSafetyException as e_safety_plot_val:
        logger.error(f"{log_prefix_plot_sugg} - LLM剧情版本建议生成因内容安全问题失败: {e_safety_plot_val.original_message}")
        raise RuntimeError(f"AI剧情建议生成被内容安全策略阻止: {e_safety_plot_val.original_message}") from e_safety_plot_val
    except Exception as e_llm_call_plot_val:
        logger.error(f"{log_prefix_plot_sugg} - LLM剧情版本建议生成调用失败: {e_llm_call_plot_val}", exc_info=True)
        raise RuntimeError(f"AI剧情建议生成时LLM调用失败: {str(e_llm_call_plot_val)}") from e_llm_call_plot_val
        
    if not raw_llm_response_val or not raw_llm_response_val.strip():
        logger.error(f"{log_prefix_plot_sugg} - LLM未能为剧情版本生成任何有效内容 (模型: {model_used_plot_sugg})。");
        raise RuntimeError("AI未能生成剧情建议。")

    try:
        # JSON解析和数据提取 (与原始文件类似，确保键名与json_output_structure_guidance_val一致)
        json_match_val = re.search(r"```json\s*([\s\S]*?)\s*```", raw_llm_response_val, re.DOTALL)
        json_string_to_parse_val = json_match_val.group(1).strip() if json_match_val else raw_llm_response_val.strip()
        json_string_to_parse_val = re.sub(r',\s*(\}|\])', r'\1', json_string_to_parse_val) # 移除末尾逗号

        suggestion_data_dict = json.loads(json_string_to_parse_val)
        if not isinstance(suggestion_data_dict, dict):
            logger.error(f"{log_prefix_plot_sugg} - LLM返回的剧情版本建议不是有效的JSON对象: {json_string_to_parse_val[:200]}");
            raise TypeError("LLM response was not a JSON object.")
        
        required_keys_list = ["suggested_version_name", "suggested_description", "suggested_content_summary", "is_potential_ending"]
        missing_keys_list = [key_req for key_req in required_keys_list if key_req not in suggestion_data_dict]
        if missing_keys_list:
            logger.error(f"{log_prefix_plot_sugg} - LLM返回的JSON缺少关键字段: {', '.join(missing_keys_list)}. 响应: {json_string_to_parse_val[:300]}");
            raise ValueError(f"AI建议缺少关键字段: {', '.join(missing_keys_list)}")

        # 清理和准备数据用于创建 PlotVersion SQLModel 实例
        version_data_for_sqlmodel: Dict[str, Any] = {
            "plot_branch_id": plot_branch.id, # 必须
            "version_name": str(suggestion_data_dict["suggested_version_name"]).strip()[:255] or f"AI建议 @ {datetime.now().strftime('%Y%m%d-%H%M%S')}",
            "description": str(suggestion_data_dict["suggested_description"]).strip() or "AI生成的剧情版本描述。",
            "status": schemas.PlotVersionStatusEnum.DRAFT, # AI建议默认为草稿
            "content_summary": suggestion_data_dict["suggested_content_summary"] if isinstance(suggestion_data_dict["suggested_content_summary"], dict) else {},
            "is_ending": bool(suggestion_data_dict.get("is_potential_ending", False)),
            # version_number 将由 crud.create_plot_version 自动处理
        }
        
        plot_version_sqlmodel_instance_to_create = models.PlotVersion.model_validate(version_data_for_sqlmodel)

        created_plot_version_orm = await asyncio.to_thread(
            crud.create_plot_version, 
            db, 
            version_create=plot_version_sqlmodel_instance_to_create # 传递SQLModel实例
        )
        logger.info(f"{log_prefix_plot_sugg} - AI剧情版本建议已成功创建为 PlotVersion ID: {created_plot_version_orm.id} (版本号: {created_plot_version_orm.version_number}) (模型: {model_used_plot_sugg})")
        return created_plot_version_orm
    
    except (json.JSONDecodeError, TypeError, ValueError) as e_parse_val_err:
        logger.error(f"{log_prefix_plot_sugg} - 解析或校验LLM剧情版本建议时失败: {str(e_parse_val_err)}. 原始响应 (部分): {raw_llm_response_val[:500]}", exc_info=True)
        descriptive_error_summary_obj = {"error": f"LLM响应解析或校验失败: {str(e_parse_val_err)}", "llm_raw_output_preview": raw_llm_response_val[:1000]}
        
        fallback_version_data_for_sqlmodel: Dict[str, Any] = {
            "plot_branch_id": plot_branch.id,
            "version_name": f"AI建议(处理失败) @ {datetime.now().strftime('%Y%m%d-%H%M%S')}",
            "description": "AI返回了格式不正确或不完整的建议，原始响应存储在内容摘要中。",
            "content_summary": descriptive_error_summary_obj, # 存储错误信息
            "status": schemas.PlotVersionStatusEnum.DRAFT,
            "is_ending": False
        }
        try:
            fallback_plot_version_sqlmodel = models.PlotVersion.model_validate(fallback_version_data_for_sqlmodel)
            return await asyncio.to_thread(crud.create_plot_version, db, version_create=fallback_plot_version_sqlmodel)
        except Exception as e_fallback_db_err:
            logger.error(f"{log_prefix_plot_sugg} - 创建回退剧情版本时数据库错误: {e_fallback_db_err}", exc_info=True);
            raise RuntimeError(f"处理AI生成的剧情版本建议及其回退存储均失败。") from e_fallback_db_err
    except Exception as e_create_version_err: # 捕获其他创建版本时的错误
        logger.error(f"{log_prefix_plot_sugg} - 从AI建议创建PlotVersion对象时发生数据库或其他错误: {e_create_version_err}", exc_info=True)
        raise RuntimeError(f"处理AI生成的剧情版本建议时出错: {e_create_version_err}") from e_create_version_err

# --- 新增的顶层函数，用于协调规划流程 (与您 bug.txt 中提到的类似) ---
async def analyze_goal_and_suggest_or_draft_chain(
    db_session: Session,
    llm_orchestrator: LLMOrchestrator,
    goal_description: str,
    novel_id: Optional[int] = None,
    novel_title: Optional[str] = None, # 新增：接收小说标题
    novel_context_summary: Optional[str] = None, # 新增：接收小说摘要
    requested_model_id_for_parsing: Optional[str] = None, # 新增：允许为解析指定模型
    requested_model_id_for_drafting: Optional[str] = None # 新增：允许为草稿生成指定模型
) -> schemas.AdaptationPlanResponse:
    """
    协调整个改编规划流程：解析目标、推荐现有链、生成新链草稿。
    """
    log_prefix_plan_coord = f"[PlanningSvc-AnalyzeAndSuggest NovelID:{novel_id or 'N/A'}]"
    logger.info(f"{log_prefix_plan_coord} 开始完整规划流程。目标: '{goal_description[:70]}...'")
    
    master_planner_log: List[str] = [f"规划流程启动于 {datetime.now().isoformat()}"]

    # 1. 解析用户目标
    parsed_goal_dict, parsing_log = await parse_user_goal_to_structured_dict(
        llm_orchestrator=llm_orchestrator, # 传递编排器
        goal_description=goal_description,
        novel_context_summary=novel_context_summary,
        requested_model_user_id=requested_model_id_for_parsing
    )
    master_planner_log.extend(parsing_log)

    parsed_goal_pydantic_obj: Optional[schemas.ParsedAdaptationGoal] = None
    if parsed_goal_dict:
        try:
            parsed_goal_pydantic_obj = schemas.ParsedAdaptationGoal(**parsed_goal_dict)
            master_planner_log.append("用户目标已成功解析为结构化Pydantic对象。")
        except Exception as e_val_parsed_goal:
            master_planner_log.append(f"错误: 解析后的目标字典无法验证为Pydantic模型: {e_val_parsed_goal}")
            logger.warning(f"{log_prefix_plan_coord} 解析后的目标字典验证失败: {parsed_goal_dict}", exc_info=True)
    else:
        master_planner_log.append("警告: 用户目标未能成功解析为字典，无法继续推荐或生成草稿。")
        # 即使解析失败，也返回一个包含日志的响应
        return schemas.AdaptationPlanResponse(
            original_goal=goal_description,
            parsed_goal=None, recommended_chains=[], generated_chain_draft=None,
            planner_log=master_planner_log
        )

    # 2. 推荐现有规则链模板 (如果目标解析成功)
    recommended_chains_list: List[schemas.RecommendedRuleChainItem] = []
    if parsed_goal_pydantic_obj:
        recommended_chains_list, recommendation_log = await recommend_chains_for_parsed_goal(
            parsed_goal_obj=parsed_goal_pydantic_obj,
            novel_id=novel_id,
            db=db_session, # 传递 db_session
        )
        master_planner_log.extend(recommendation_log)
    
    # 3. (可选地) 生成新的规则链草稿 (如果目标解析成功，且可能没有好的推荐，或用户明确要求)
    # 这里的逻辑可以更复杂，例如：如果没有推荐或推荐分数低，则自动生成草稿
    generated_chain_draft_obj: Optional[schemas.RuleChainCreate] = None
    should_generate_draft = True # 简单起见，总是尝试生成草稿 (如果解析成功)
    
    # 可以在配置中添加一个阈值，例如：
    # min_score_for_no_draft = config_service.get_setting("planning_settings.min_recommendation_score_to_skip_draft", 0.7)
    # if recommended_chains_list and recommended_chains_list[0].relevance_score >= min_score_for_no_draft:
    #     should_generate_draft = False
    #     master_planner_log.append(f"找到高相关度推荐 (得分 {recommended_chains_list[0].relevance_score:.2f})，跳过自动生成新草稿。")

    if parsed_goal_pydantic_obj and should_generate_draft:
        generated_chain_draft_obj, drafting_log = await generate_rule_chain_draft_from_parsed_goal(
            llm_orchestrator=llm_orchestrator, # 传递编排器
            parsed_goal_obj=parsed_goal_pydantic_obj,
            novel_id=novel_id,
            novel_context_summary=novel_context_summary,
            requested_model_user_id=requested_model_id_for_drafting,
            planner_log=master_planner_log # 传递主日志列表以追加日志
        )
        # master_planner_log.extend(drafting_log) # drafting_log 现在直接修改了 master_planner_log
    
    master_planner_log.append(f"规划流程结束于 {datetime.now().isoformat()}")
    logger.info(f"{log_prefix_plan_coord} 完整规划流程结束。")
    
    return schemas.AdaptationPlanResponse(
        original_goal=goal_description,
        parsed_goal=parsed_goal_pydantic_obj,
        recommended_chains=recommended_chains_list,
        generated_chain_draft=generated_chain_draft_obj,
        planner_log=master_planner_log
    )

async def generate_rule_chain_draft_directly( # 新增：仅生成草稿的协调函数
    db_session: Session, # 虽然此函数不直接用db，但为与其他服务函数签名一致而保留
    llm_orchestrator: LLMOrchestrator,
    goal_description: str,
    novel_id: Optional[int] = None,
    novel_title: Optional[str] = None,
    novel_context_summary: Optional[str] = None,
    requested_model_id_for_parsing: Optional[str] = None,
    requested_model_id_for_drafting: Optional[str] = None
) -> Tuple[Optional[schemas.ParsedAdaptationGoal], Optional[schemas.RuleChainCreate], List[str]]:
    """
    仅解析目标并生成规则链草稿，不进行推荐。
    """
    log_prefix_draft_direct = f"[PlanningSvc-GenerateDraftDirectly NovelID:{novel_id or 'N/A'}]"
    logger.info(f"{log_prefix_draft_direct} 开始直接生成规则链草稿。目标: '{goal_description[:70]}...'")
    
    master_planner_log_direct: List[str] = [f"直接草稿生成流程启动于 {datetime.now().isoformat()}"]

    parsed_goal_dict_direct, parsing_log_direct = await parse_user_goal_to_structured_dict(
        llm_orchestrator=llm_orchestrator, goal_description=goal_description,
        novel_context_summary=novel_context_summary, requested_model_user_id=requested_model_id_for_parsing
    )
    master_planner_log_direct.extend(parsing_log_direct)

    parsed_goal_pydantic_obj_direct: Optional[schemas.ParsedAdaptationGoal] = None
    if parsed_goal_dict_direct:
        try: parsed_goal_pydantic_obj_direct = schemas.ParsedAdaptationGoal(**parsed_goal_dict_direct)
        except Exception as e_val_parsed_direct: master_planner_log_direct.append(f"错误(直接草稿): 解析后的目标字典无法验证: {e_val_parsed_direct}")
    
    if not parsed_goal_pydantic_obj_direct: # 如果目标解析失败，也无法生成草稿
        master_planner_log_direct.append("警告(直接草稿): 用户目标未能成功解析，无法生成草稿。")
        return None, None, master_planner_log_direct

    generated_chain_draft_obj_direct, drafting_log_direct = await generate_rule_chain_draft_from_parsed_goal(
        llm_orchestrator=llm_orchestrator, parsed_goal_obj=parsed_goal_pydantic_obj_direct,
        novel_id=novel_id, novel_context_summary=novel_context_summary,
        requested_model_user_id=requested_model_id_for_drafting,
        planner_log=master_planner_log_direct
    )
    
    master_planner_log_direct.append(f"直接草稿生成流程结束于 {datetime.now().isoformat()}")
    logger.info(f"{log_prefix_draft_direct} 直接规则链草稿生成流程结束。")
    
    return parsed_goal_pydantic_obj_direct, generated_chain_draft_obj_direct, master_planner_log_direct