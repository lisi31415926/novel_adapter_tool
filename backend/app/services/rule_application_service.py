# backend/app/services/rule_application_service.py
import logging
import json
import re # 导入正则表达式模块用于清理
import time # 导入time模块，用于记录执行时间
from typing import Dict, Any, Optional, List, Union, Tuple

from sqlalchemy.orm import Session # Session 用于类型提示
# 导入SQLModel相关的模型 (models.py) 和非ORM的schemas (schemas.py)
from app import crud, schemas, models
from app.llm_orchestrator import LLMOrchestrator, ContentSafetyException # LLM编排器和内容安全异常
from app.config_service import get_config, get_setting # 获取应用配置
from app.services import novel_data_service # 导入小说数据解析服务
from app.services.tokenizer_service import estimate_token_count # 导入token估算函数

# PromptEngineeringService 现在由 RuleApplicationService 实例化并使用
from app.services.prompt_engineering_service import PromptEngineeringService

logger = logging.getLogger(__name__)

# --- 增强的 Prompt参数清理辅助函数 ---
# 此函数至关重要，用于在参数插入到Prompt模板之前进行清理，以缓解Prompt注入风险。
def sanitize_prompt_parameter(param_value: Any) -> str:
    """
    对单个Prompt参数值进行清理和转义，以减少Prompt注入的风险。
    """
    if param_value is None:
        return ""
    
    str_value = str(param_value)

    str_value = str_value.replace("{{", "{ {")
    str_value = str_value.replace("}}", "} }")
    str_value = str_value.replace("{%", "< %") 
    str_value = str_value.replace("%}", "% >")

    app_config = get_config()
    # 配置文件中 tokenizer_options.max_parameter_length_chars 路径不正确，应该是 llm_settings.tokenizer_options
    # 但为了保持与您原始文件逻辑一致，暂时保留，如果 llm_settings.tokenizer_options.max_parameter_length_chars 存在则使用它
    max_param_len_chars_path = "llm_settings.tokenizer_options.max_parameter_length_chars"
    default_max_param_len = 2000 # 默认值
    
    max_param_len_chars_cfg = get_setting(max_param_len_chars_path)

    if isinstance(max_param_len_chars_cfg, int) and max_param_len_chars_cfg > 0:
        max_param_len_chars = max_param_len_chars_cfg
    else:
        max_param_len_chars = default_max_param_len
        if max_param_len_chars_cfg is not None: # 如果配置了但不是有效的int
            logger.warning(f"配置路径 '{max_param_len_chars_path}' 的值无效 ({max_param_len_chars_cfg})。参数最大长度回退到 {default_max_param_len} 字符。")


    if len(str_value) > max_param_len_chars:
        logger.warning(f"参数值（清理后）超出最大允许长度 {max_param_len_chars}，将被截断。原始预览: {str_value[:80]}...")
        str_value = str_value[:max_param_len_chars] + " [内容已截断]"
        
    return str_value

class RuleApplicationService:
    def __init__(self, db: Session, llm_orchestrator: LLMOrchestrator):
        self.db = db 
        self.llm_orchestrator = llm_orchestrator
        self.prompt_engineer = PromptEngineeringService(db_session=db, llm_orchestrator=llm_orchestrator)
        self.novel_data_resolver = novel_data_service.NovelDataResolver(db_session=db)
        self.app_config = get_config()

    async def _resolve_parameter_value(
        self,
        novel_id: int,
        param_definition: schemas.RuleStepParameterDefinition,
        user_provided_params: Dict[str, Any], 
        previous_step_outputs: Dict[str, Any] 
    ) -> Any:
        """
        解析单个规则步骤参数定义，获取其实际值。
        所有最终返回的字符串类型的值都会经过 sanitize_prompt_parameter 清理。
        """
        if not isinstance(param_definition, schemas.RuleStepParameterDefinition):
            if isinstance(param_definition, dict): 
                try:
                    param_definition = schemas.RuleStepParameterDefinition(**param_definition)
                except Exception as e_pydantic_conv:
                    logger.error(f"无法将参数定义字典转换为Pydantic模型: {param_definition}, 错误: {e_pydantic_conv}")
                    return sanitize_prompt_parameter(param_definition.get("value"))
            else:
                 logger.error(f"参数定义类型未知: {type(param_definition)}。将返回其原始值（经清理）。")
                 return sanitize_prompt_parameter(getattr(param_definition, "value", None))

        param_type = param_definition.param_type
        param_value_source = param_definition.value 

        if param_type == schemas.ParameterTypeEnum.PREVIOUS_STEP_OUTPUT_FIELD:
            if isinstance(param_value_source, str) and param_value_source in previous_step_outputs:
                resolved_val = previous_step_outputs[param_value_source]
                logger.debug(f"参数 '{param_definition.label or param_value_source}' 从上一步骤输出 '{param_value_source}' 解析得到值 (清理前): {str(resolved_val)[:100]}")
                return sanitize_prompt_parameter(resolved_val)
            logger.warning(f"无法从上一步骤输出中找到字段 '{param_value_source}' 用于参数 '{param_definition.label}'。可用输出键: {list(previous_step_outputs.keys())}")
            if param_definition.required:
                raise ValueError(f"必需的步骤间参数 '{param_value_source}' 未在上一步输出中找到。")
            return None

        if param_type in [schemas.ParameterTypeEnum.USER_INPUT_TEXT, schemas.ParameterTypeEnum.USER_INPUT_CHOICE]:
            user_input_key = str(param_value_source) 
            if user_input_key in user_provided_params:
                user_val = user_provided_params[user_input_key]
                logger.debug(f"参数 '{param_definition.label or user_input_key}' 从用户动态输入中获取值 (清理前): {str(user_val)[:100]}")
                return sanitize_prompt_parameter(user_val)
            
            if param_definition.required:
                raise ValueError(f"必需的用户输入参数 '{param_definition.label or user_input_key}' 未在执行时提供。")
            logger.debug(f"可选的用户输入参数 '{param_definition.label or user_input_key}' 未提供。")
            return None

        try:
            resolved_value_from_resolver = await self.novel_data_resolver.resolve_data(
                param_type=param_type, 
                identifier=param_value_source, 
                novel_id=novel_id,
                context_config=param_definition.config if param_definition.config else {}
            )
            logger.debug(f"参数 '{param_definition.label or param_value_source}' (类型 {param_type}) 由 NovelDataResolver 解析得到值 (清理前): {str(resolved_value_from_resolver)[:100]}")
            return sanitize_prompt_parameter(resolved_value_from_resolver)
        except ValueError as ve: 
            logger.warning(f"解析参数 '{param_definition.label or param_value_source}' (类型: {param_type}) 失败: {ve}")
            if param_definition.required:
                raise 
            return None 

    async def _resolve_step_parameters(
        self,
        novel_id: int,
        parameter_definitions: Dict[str, schemas.RuleStepParameterDefinition],
        user_provided_params: Dict[str, Any], 
        previous_step_outputs: Dict[str, Any] 
    ) -> Dict[str, Any]:
        """
        解析规则步骤的所有参数定义，返回一个包含最终实际值的字典。
        所有解析出的字符串类型的值都已通过 sanitize_prompt_parameter 清理。
        """
        resolved_params_map: Dict[str, Any] = {}
        log_prefix_resolve_all = f"[RAS-ResolveAllParams NovelID:{novel_id}]"
        logger.debug(f"{log_prefix_resolve_all} 开始解析步骤的所有参数定义。定义键: {list(parameter_definitions.keys())}")

        for param_name, param_def_obj in parameter_definitions.items():
            logger.debug(f"{log_prefix_resolve_all} 正在解析参数 '{param_name}' (定义类型: {param_def_obj.param_type})")
            try:
                resolved_value = await self._resolve_parameter_value(
                    novel_id=novel_id,
                    param_definition=param_def_obj, 
                    user_provided_params=user_provided_params, 
                    previous_step_outputs=previous_step_outputs
                )
                resolved_params_map[param_name] = resolved_value
                logger.debug(f"{log_prefix_resolve_all} 参数 '{param_name}' 解析完成。最终值 (清理后, 预览): {str(resolved_value)[:100] if resolved_value is not None else 'None'}")
            except ValueError as e_resolve_single: 
                logger.error(f"{log_prefix_resolve_all} 解析必需参数 '{param_name}' 失败: {e_resolve_single}", exc_info=False) 
                raise ValueError(f"解析步骤参数失败：必需参数 '{param_name}' ({param_def_obj.label or ''}) 无法确定值。错误: {e_resolve_single}") from e_resolve_single
            except Exception as e_resolve_unknown: 
                logger.error(f"{log_prefix_resolve_all} 解析参数 '{param_name}' 时发生未知严重错误: {e_resolve_unknown}", exc_info=True)
                raise 
        
        logger.debug(f"{log_prefix_resolve_all} 所有步骤参数解析完成。")
        return resolved_params_map

    async def apply_rule_to_text(
        self,
        novel_id: int, 
        rule_step_schema: Union[schemas.RuleStepPublic, schemas.RuleTemplateInChainPublic, schemas.RuleStepCreatePrivate],
        source_text: str, 
        user_provided_params: Dict[str, Any], 
        previous_step_outputs: Dict[str, Any] = None 
    ) -> Tuple[Optional[str], Optional[Dict[str, Any]], List[Dict[str, str]]]:
        """
        将单个规则（步骤）应用于输入文本。
        返回：(处理后的文本, 可选的结构化输出, 错误列表)
        """
        log_prefix_apply_rule = f"[RuleAppSvc-ApplyRule NovelID:{novel_id}, Task:{rule_step_schema.task_type if hasattr(rule_step_schema, 'task_type') else 'TemplateStep'}]" # 兼容模板步骤
        if previous_step_outputs is None: previous_step_outputs = {}
        
        parameter_definitions_for_step: Dict[str, schemas.RuleStepParameterDefinition]
        
        # 检查 rule_step_schema.parameters 是否为字典，并进行必要的转换
        # rule_step_schema.parameters 应该是 Dict[str, Union[RuleStepParameterDefinition, Dict]]
        # 我们需要确保它最终是 Dict[str, RuleStepParameterDefinition]
        if isinstance(rule_step_schema.parameters, dict):
            parsed_param_defs_dict: Dict[str, schemas.RuleStepParameterDefinition] = {}
            for p_name, p_def_val in rule_step_schema.parameters.items():
                if isinstance(p_def_val, schemas.RuleStepParameterDefinition):
                    parsed_param_defs_dict[p_name] = p_def_val
                elif isinstance(p_def_val, dict): # 如果是字典，尝试Pydantic校验转换
                    try: 
                        parsed_param_defs_dict[p_name] = schemas.RuleStepParameterDefinition.model_validate(p_def_val)
                    except Exception as e_inner_parse:
                        logger.warning(f"{log_prefix_apply_rule} 参数定义 '{p_name}' 值不是有效 RuleStepParameterDefinition 字典: {e_inner_parse}. 跳过此参数定义。原始值: {p_def_val}")
                else: 
                    logger.warning(f"{log_prefix_apply_rule} 参数定义 '{p_name}' 的值类型未知: {type(p_def_val)}. 跳过。")
            parameter_definitions_for_step = parsed_param_defs_dict
        elif rule_step_schema.parameters is None: # 如果参数字段为 None，则视为空字典
            parameter_definitions_for_step = {}
        else:
            logger.error(f"{log_prefix_apply_rule} 规则步骤的参数定义格式不正确: {type(rule_step_schema.parameters)}。应为字典或None。")
            return source_text, None, [{"task": str(getattr(rule_step_schema, 'task_type', 'UnknownTask')), "error": "参数定义格式错误", "details": "步骤参数定义必须是字典或None。"}]


        try:
            resolved_params_for_prompt_build = await self._resolve_step_parameters(
                novel_id=novel_id,
                parameter_definitions=parameter_definitions_for_step,
                user_provided_params=user_provided_params,
                previous_step_outputs=previous_step_outputs
            )
        except ValueError as e_resolve_step_params: 
            current_task_type_str = str(getattr(rule_step_schema, 'task_type', 'UnknownTask'))
            logger.error(f"{log_prefix_apply_rule} 解析规则步骤所有参数时失败: {e_resolve_step_params}", exc_info=False) 
            return source_text, None, [{"task": current_task_type_str, "error": "步骤参数解析失败", "details": str(e_resolve_step_params)}]
        
        current_input_text_for_step = source_text 
        if rule_step_schema.input_source == schemas.StepInputSourceEnum.ORIGINAL:
            original_chain_input = previous_step_outputs.get("_ORIGINAL_CHAIN_INPUT_", source_text)
            current_input_text_for_step = original_chain_input
            logger.debug(f"{log_prefix_apply_rule} 输入源为 'ORIGINAL'。使用链的初始输入。")
        elif rule_step_schema.input_source == schemas.StepInputSourceEnum.PREVIOUS_STEP:
            logger.debug(f"{log_prefix_apply_rule} 输入源为 'PREVIOUS_STEP'。使用上一步输出作为输入。")
        
        novel_orm_model_for_context = crud.get_novel(self.db, novel_id=novel_id) if novel_id else None

        try:
            prompt_data_obj: schemas.PromptData = await self.prompt_engineer.build_prompt_for_step(
                rule_step_schema=rule_step_schema, 
                novel_id=novel_id,
                novel_obj=novel_orm_model_for_context, 
                dynamic_params=resolved_params_for_prompt_build, 
                main_input_text=current_input_text_for_step 
            )
            logger.info(f"{log_prefix_apply_rule} Prompt构建完成。SysPrompt (预览): {prompt_data_obj.system_prompt[:100] if prompt_data_obj.system_prompt else '无'}... UserPrompt (预览): {prompt_data_obj.user_prompt[:100]}...")
        except ValueError as e_prompt_build_val_err:
            current_task_type_str_pb_val = str(getattr(rule_step_schema, 'task_type', 'UnknownTask'))
            logger.error(f"{log_prefix_apply_rule} 构建Prompt时出错 (ValueError): {e_prompt_build_val_err}", exc_info=False)
            return current_input_text_for_step, None, [{"task": current_task_type_str_pb_val, "error": "Prompt构建失败", "details": str(e_prompt_build_val_err)}]
        except Exception as e_prompt_build_generic_err:
            current_task_type_str_pb_gen = str(getattr(rule_step_schema, 'task_type', 'UnknownTask'))
            logger.error(f"{log_prefix_apply_rule} 构建Prompt时发生未知严重错误: {e_prompt_build_generic_err}", exc_info=True)
            return current_input_text_for_step, None, [{"task": current_task_type_str_pb_gen, "error": "Prompt构建严重错误", "details": str(e_prompt_build_generic_err)}]

        model_id_for_llm_call_step = rule_step_schema.model_id or self.app_config.llm_settings.default_model_id \
                                  or self.app_config.llm_settings.default_llm_fallback 
        
        current_task_type_for_err = str(getattr(rule_step_schema, 'task_type', 'UnknownTask')) # 用于错误报告

        if not model_id_for_llm_call_step:
            err_detail_model = "步骤和全局均未指定模型ID。"
            logger.error(f"{log_prefix_apply_rule} 无法确定用于LLM调用的模型ID。{err_detail_model}")
            return current_input_text_for_step, None, [{"task": current_task_type_for_err, "error": "模型ID未配置", "details": err_detail_model}]

        llm_override_params_for_call_step = rule_step_schema.llm_override_parameters or {}
        
        try:
            llm_response_obj = await self.llm_orchestrator.generate(
                model_id=model_id_for_llm_call_step,
                prompt=prompt_data_obj.user_prompt,
                system_prompt=prompt_data_obj.system_prompt,
                is_json_output=prompt_data_obj.is_json_output_hint,
                temperature=llm_override_params_for_call_step.get("temperature"),
                max_tokens=llm_override_params_for_call_step.get("max_tokens"),
                llm_override_parameters=llm_override_params_for_call_step 
            )
        except ContentSafetyException as e_safety_apply_rule: 
            logger.error(f"{log_prefix_apply_rule} LLM调用因内容安全问题失败: {e_safety_apply_rule.original_message}")
            return current_input_text_for_step, None, [{"task": current_task_type_for_err, "error": "内容安全异常", "details": e_safety_apply_rule.original_message[:200]}]
        except Exception as e_llm_apply_rule: 
            logger.error(f"{log_prefix_apply_rule} LLM调用失败: {e_llm_apply_rule}", exc_info=True)
            return current_input_text_for_step, None, [{"task": current_task_type_for_err, "error": "LLM调用失败", "details": str(e_llm_apply_rule)[:200]}]

        if llm_response_obj.error:
            logger.error(f"{log_prefix_apply_rule} LLM响应错误: {llm_response_obj.error}")
            return current_input_text_for_step, None, [{"task": current_task_type_for_err, "error": "LLM响应错误", "details": llm_response_obj.error[:200]}]

        processed_text_val = llm_response_obj.text
        
        final_text_output_after_postproc = processed_text_val
        structured_dict_output_final: Optional[Dict[str, Any]] = None
        errors_list_from_postproc: List[Dict[str, str]] = []

        for rule_pp_enum in rule_step_schema.post_processing_rules or []: 
            try:
                if rule_pp_enum == schemas.PostProcessingRuleEnum.STRIP:
                    final_text_output_after_postproc = final_text_output_after_postproc.strip()
                elif rule_pp_enum == schemas.PostProcessingRuleEnum.TO_JSON:
                    try: structured_dict_output_final = json.loads(final_text_output_after_postproc)
                    except json.JSONDecodeError as e_json_pp_val:
                        logger.warning(f"{log_prefix_apply_rule} 后处理TO_JSON失败: {e_json_pp_val}. 文本: {final_text_output_after_postproc[:100]}...")
                        errors_list_from_postproc.append({"rule": rule_pp_enum.value, "error": "JSON解析失败", "details": str(e_json_pp_val)})
                elif rule_pp_enum == schemas.PostProcessingRuleEnum.EXTRACT_JSON_FROM_MARKDOWN:
                    match_json_md_val = re.search(r"```json\s*([\s\S]+?)\s*```", final_text_output_after_postproc, re.IGNORECASE | re.DOTALL)
                    if match_json_md_val:
                        json_str_from_md_val = match_json_md_val.group(1).strip()
                        try:
                            structured_dict_output_final = json.loads(json_str_from_md_val)
                            final_text_output_after_postproc = json_str_from_md_val 
                        except json.JSONDecodeError as e_json_md_pp_val:
                            logger.warning(f"{log_prefix_apply_rule} 后处理EXTRACT_JSON_FROM_MARKDOWN的JSON解析失败: {e_json_md_pp_val}. 提取内容: {json_str_from_md_val[:100]}...")
                            errors_list_from_postproc.append({"rule": rule_pp_enum.value, "error": "Markdown中JSON解析失败", "details": str(e_json_md_pp_val)})
                    else: logger.warning(f"{log_prefix_apply_rule} 后处理EXTRACT_JSON_FROM_MARKDOWN未找到JSON代码块。")
            except Exception as e_pp_generic_val:
                logger.error(f"{log_prefix_apply_rule} 执行后处理规则 '{rule_pp_enum.value}' 时出错: {e_pp_generic_val}", exc_info=True)
                errors_list_from_postproc.append({"rule": rule_pp_enum.value, "error": "后处理规则执行失败", "details": str(e_pp_generic_val)})

        return final_text_output_after_postproc, structured_dict_output_final, errors_list_from_postproc

    async def apply_rule_chain_to_text(
        self,
        novel_id: int,
        chain_id: Optional[int] = None,
        chain_definition: Optional[models.RuleChain] = None, 
        source_text: str = "", 
        user_provided_params: Optional[Dict[str, Any]] = None 
    ) -> schemas.RuleChainExecuteResponse:
        """
        按顺序执行规则链中的所有启用步骤。
        """
        if user_provided_params is None: user_provided_params = {}
        # 日志前缀，根据是动态链定义还是ID加载来确定名称
        chain_name_for_log = "DynamicChain"
        if chain_definition: chain_name_for_log = chain_definition.name
        elif chain_id: 
            temp_chain_for_name = crud.get_rule_chain(self.db, chain_id=chain_id)
            if temp_chain_for_name: chain_name_for_log = temp_chain_for_name.name
            else: chain_name_for_log = f"ID_{chain_id}_NotFound"

        log_prefix_chain = f"[RuleAppSvc-ApplyChain NovelID:{novel_id}, Chain:'{chain_name_for_log}']"
        
        chain_to_execute: Optional[models.RuleChain] = None 
        if chain_definition:
            chain_to_execute = chain_definition
            logger.info(f"{log_prefix_chain} 使用提供的动态规则链定义 ('{chain_to_execute.name}')。")
        elif chain_id:
            chain_to_execute = crud.get_rule_chain(self.db, chain_id=chain_id) 
            if not chain_to_execute:
                logger.error(f"{log_prefix_chain} 未找到规则链ID {chain_id}。")
                raise ValueError(f"规则链ID {chain_id} 未找到。")
            logger.info(f"{log_prefix_chain} 已加载规则链 '{chain_to_execute.name}' (ID: {chain_id})。")
        else:
            raise ValueError("必须提供 chain_id 或 chain_definition。")

        if not chain_to_execute.steps and not chain_to_execute.template_associations:
            logger.warning(f"{log_prefix_chain} 规则链 '{chain_to_execute.name}' 为空。")
            return schemas.RuleChainExecuteResponse(original_text=source_text, final_output_text=source_text, steps_results=[], executed_chain_id=chain_to_execute.id, executed_chain_name=chain_to_execute.name)

        all_steps_for_execution: List[Union[schemas.RuleStepPublic, schemas.RuleTemplateInChainPublic]] = []
        if chain_to_execute.steps: 
            for step_orm in chain_to_execute.steps:
                try: all_steps_for_execution.append(schemas.RuleStepPublic.model_validate(step_orm))
                except Exception as e_val_private: logger.error(f"验证私有步骤(ID:{step_orm.id})为Schema时失败: {e_val_private}", exc_info=True)
        
        if chain_to_execute.template_associations: 
            for assoc_orm in chain_to_execute.template_associations:
                if assoc_orm.template: 
                    template_data_for_schema = assoc_orm.template.model_dump() 
                    template_data_for_schema.update({ 
                        'step_type': 'template', 
                        'step_order': assoc_orm.step_order,
                        'is_enabled': assoc_orm.is_enabled,
                        'template_id': assoc_orm.template_id 
                    })
                    try: all_steps_for_execution.append(schemas.RuleTemplateInChainPublic.model_validate(template_data_for_schema))
                    except Exception as e_val_template: logger.error(f"验证模板引用步骤(TemplateID:{assoc_orm.template_id})为Schema时失败: {e_val_template}", exc_info=True)
                else: logger.warning(f"规则链 '{chain_to_execute.name}' 中的模板关联 (Order: {assoc_orm.step_order}) 缺少有效的模板对象。")
        
        sorted_steps_for_execution = sorted(all_steps_for_execution, key=lambda s: s.step_order)

        current_text_in_chain = source_text
        step_outputs_history_map: Dict[str, Any] = {"_ORIGINAL_CHAIN_INPUT_": source_text}
        execution_results_list_chain: List[schemas.StepExecutionResult] = []
        chain_start_time_val = time.perf_counter()

        for step_schema_to_run in sorted_steps_for_execution:
            if not step_schema_to_run.is_enabled:
                step_task_type_display = getattr(step_schema_to_run, 'task_type', f"TemplateRef(ID:{getattr(step_schema_to_run, 'template_id', 'N/A')})")
                logger.info(f"{log_prefix_chain} 步骤 {step_schema_to_run.step_order} (类型: {step_task_type_display}) 已禁用，跳过。")
                continue
            
            step_input_text_chain = "" 
            if step_schema_to_run.input_source == schemas.StepInputSourceEnum.ORIGINAL:
                step_input_text_chain = source_text
            elif step_schema_to_run.input_source == schemas.StepInputSourceEnum.PREVIOUS_STEP:
                step_input_text_chain = current_text_in_chain
            
            step_task_type_log = getattr(step_schema_to_run, 'task_type', f"模板ID {getattr(step_schema_to_run, 'template_id', 'N/A')}")
            logger.info(f"{log_prefix_chain} 执行步骤 {step_schema_to_run.step_order + 1} (类型: {step_task_type_log}). 输入预览: {step_input_text_chain[:50]}...")

            processed_text_result_step, structured_output_result_step, errors_list_step = await self.apply_rule_to_text(
                novel_id=novel_id,
                rule_step_schema=step_schema_to_run, 
                source_text=step_input_text_chain,
                user_provided_params=user_provided_params, 
                previous_step_outputs=step_outputs_history_map
            )
            
            step_status_final = schemas.StepExecutionStatusEnum.SUCCESS if not errors_list_step else schemas.StepExecutionStatusEnum.FAILURE
            
            step_result_log_item = schemas.StepExecutionResult(
                step_order=step_schema_to_run.step_order,
                task_type=step_task_type_log, # 使用前面获取的显示用任务类型
                input_text_snippet=step_input_text_chain[:200] + ("..." if len(step_input_text_chain) > 200 else ""),
                output_text_snippet=(processed_text_result_step[:200] + ("..." if processed_text_result_step and len(processed_text_result_step) > 200 else "") if processed_text_result_step else "N/A"),
                status=step_status_final,
                error=json.dumps(errors_list_step, ensure_ascii=False) if errors_list_step else None,
                model_used=getattr(step_schema_to_run, 'model_id', None) or chain_to_execute.global_model_id, # 记录模型使用
                # parameters_used: 记录解析后的参数较为复杂，暂时简化
                # custom_instruction_used: getattr(step_schema_to_run, 'custom_instruction', None),
                # post_processing_rules_applied: getattr(step_schema_to_run, 'post_processing_rules', None),
                # constraints_satisfied: (需要从 apply_rule_to_text 返回)
            )
            execution_results_list_chain.append(step_result_log_item)

            if step_status_final == schemas.StepExecutionStatusEnum.FAILURE:
                logger.error(f"{log_prefix_chain} 步骤 {step_schema_to_run.step_order} 执行失败。错误: {errors_list_step}")
            
            current_text_in_chain = processed_text_result_step if processed_text_result_step is not None else current_text_in_chain
            
            output_var_name_step = getattr(step_schema_to_run, 'output_variable_name', None) 
            if output_var_name_step:
                output_to_store_hist = structured_output_result_step if structured_output_result_step is not None else processed_text_result_step
                step_outputs_history_map[output_var_name_step] = output_to_store_hist
            step_outputs_history_map["_PREVIOUS_STEP_TEXT_OUTPUT_"] = current_text_in_chain 

        chain_execution_duration = time.perf_counter() - chain_start_time_val
        logger.info(f"{log_prefix_chain} 执行完成，总耗时: {chain_execution_duration:.2f}s。")
        
        return schemas.RuleChainExecuteResponse(
            original_text=source_text,
            final_output_text=current_text_in_chain,
            executed_chain_id=chain_to_execute.id, 
            executed_chain_name=chain_to_execute.name,
            steps_results=execution_results_list_chain,
            total_execution_time=round(chain_execution_duration, 3)
        )

    async def dry_run_rule_chain(
        self,
        novel_id: int,
        chain_id: Optional[int] = None,
        chain_definition: Optional[models.RuleChain] = None, # 接收 SQLModel 实例
        source_text: str = "",
        user_provided_params: Optional[Dict[str, Any]] = None
    ) -> schemas.RuleChainDryRunResponse:
        """
        试运行规则链以估算Token消耗和成本，不实际调用LLM的生成接口。
        """
        if user_provided_params is None: user_provided_params = {}
        chain_name_for_log_dry_run = "DynamicChainDryRun"
        if chain_definition: chain_name_for_log_dry_run = chain_definition.name
        elif chain_id: 
            temp_chain_for_name_dry_run = crud.get_rule_chain(self.db, chain_id=chain_id)
            if temp_chain_for_name_dry_run: chain_name_for_log_dry_run = temp_chain_for_name_dry_run.name
            else: chain_name_for_log_dry_run = f"ID_{chain_id}_NotFound"
        
        log_prefix_dry_run = f"[RuleAppSvc-DryRunChain NovelID:{novel_id}, Chain:'{chain_name_for_log_dry_run}']"
        logger.info(f"{log_prefix_dry_run} 开始试运行规则链。")

        chain_to_dry_run: Optional[models.RuleChain] = None
        if chain_definition:
            chain_to_dry_run = chain_definition
        elif chain_id:
            chain_to_dry_run = crud.get_rule_chain(self.db, chain_id=chain_id)
            if not chain_to_dry_run:
                raise ValueError(f"规则链ID {chain_id} 未找到。")
        else:
            raise ValueError("必须提供 chain_id 或 chain_definition 进行试运行。")

        if not chain_to_dry_run.steps and not chain_to_dry_run.template_associations:
            logger.warning(f"{log_prefix_dry_run} 规则链 '{chain_to_dry_run.name}' 为空，无法进行试运行。")
            return schemas.RuleChainDryRunResponse(
                estimated_total_prompt_tokens=0,
                estimated_total_completion_tokens=0,
                token_cost_level=schemas.TokenCostLevelEnum.UNKNOWN,
                steps_estimates=[],
                warnings=["规则链为空，无法估算。"]
            )

        # 与 apply_rule_chain_to_text 类似的步骤准备逻辑
        all_steps_for_dry_run_schema: List[Union[schemas.RuleStepPublic, schemas.RuleTemplateInChainPublic]] = []
        if chain_to_dry_run.steps:
            for step_orm_dry in chain_to_dry_run.steps:
                try: all_steps_for_dry_run_schema.append(schemas.RuleStepPublic.model_validate(step_orm_dry))
                except Exception as e_val_private_dry: logger.error(f"DryRun: 验证私有步骤(ID:{step_orm_dry.id})为Schema时失败: {e_val_private_dry}", exc_info=True)
        
        if chain_to_dry_run.template_associations:
            for assoc_orm_dry in chain_to_dry_run.template_associations:
                if assoc_orm_dry.template:
                    template_data_for_schema_dry = assoc_orm_dry.template.model_dump()
                    template_data_for_schema_dry.update({
                        'step_type': 'template', 'step_order': assoc_orm_dry.step_order,
                        'is_enabled': assoc_orm_dry.is_enabled, 'template_id': assoc_orm_dry.template_id
                    })
                    try: all_steps_for_dry_run_schema.append(schemas.RuleTemplateInChainPublic.model_validate(template_data_for_schema_dry))
                    except Exception as e_val_template_dry: logger.error(f"DryRun: 验证模板引用步骤(TemplateID:{assoc_orm_dry.template_id})为Schema时失败: {e_val_template_dry}", exc_info=True)
        
        sorted_steps_for_dry_run = sorted(all_steps_for_dry_run_schema, key=lambda s: s.step_order)

        total_prompt_tokens_estimate = 0
        total_max_completion_tokens_estimate = 0
        step_estimates_list: List[schemas.RuleChainStepCostEstimate] = []
        dry_run_warnings: List[str] = []
        
        current_input_text_for_dry_run_step = source_text # Dry run时，我们无法知道上一步的实际输出，因此对依赖上一步输出的步骤，输入token估算可能不准
        step_outputs_history_dry_run: Dict[str, Any] = {"_ORIGINAL_CHAIN_INPUT_": source_text}


        novel_orm_for_dry_run_context = crud.get_novel(self.db, novel_id=novel_id) if novel_id else None

        for step_schema_dry in sorted_steps_for_dry_run:
            if not step_schema_dry.is_enabled: continue

            # 1. 解析参数 (与实际执行类似，因为参数内容影响prompt长度)
            parameter_definitions_dry_run: Dict[str, schemas.RuleStepParameterDefinition] = {}
            if isinstance(step_schema_dry.parameters, dict):
                for p_name, p_def_val in step_schema_dry.parameters.items():
                    if isinstance(p_def_val, schemas.RuleStepParameterDefinition): parameter_definitions_dry_run[p_name] = p_def_val
                    elif isinstance(p_def_val, dict): 
                        try: parameter_definitions_dry_run[p_name] = schemas.RuleStepParameterDefinition.model_validate(p_def_val)
                        except: pass # 忽略无法解析的
            
            try:
                resolved_params_dry_run = await self._resolve_step_parameters(
                    novel_id, parameter_definitions_dry_run, user_provided_params or {}, step_outputs_history_dry_run
                )
            except ValueError as e_resolve_dry_run:
                dry_run_warnings.append(f"步骤 {step_schema_dry.step_order + 1} 参数解析失败: {e_resolve_dry_run}。此步骤估算可能不准。")
                resolved_params_dry_run = {} # 使用空参数继续，或跳过此步骤的估算

            # 2. 确定此步骤的输入文本
            step_input_text_for_this_dry_run = source_text # 默认
            if step_schema_dry.input_source == schemas.StepInputSourceEnum.PREVIOUS_STEP:
                # 对于Dry Run，我们没有前一步的真实输出。
                # 可以用一个占位符文本，或者如果前一步有output_variable_name，就尝试用它的（可能是None或空）
                # 一个简单的策略是，如果前一步的输出是文本，就假设其长度与当前输入文本相似，或用一个平均值
                # 这里为了简化，我们还是用上一个 "模拟" 的 current_input_text_for_dry_run_step
                # 这意味着如果链条很长，后面的步骤输入估算会越来越不准。
                step_input_text_for_this_dry_run = current_input_text_for_dry_run_step
                if not step_input_text_for_this_dry_run: # 如果上一步模拟输出为空
                     dry_run_warnings.append(f"步骤 {step_schema_dry.step_order + 1} 输入依赖上一步，但上一步模拟输出为空，此步骤输入Token估算可能为0。")


            # 3. 构建Prompt
            prompt_data_dry_run = await self.prompt_engineer.build_prompt_for_step(
                step_schema_dry, novel_id, novel_orm_for_dry_run_context, resolved_params_dry_run, step_input_text_for_this_dry_run
            )

            # 4. 估算Prompt Tokens
            model_id_for_token_count = step_schema_dry.model_id or \
                                       chain_to_dry_run.global_model_id or \
                                       self.app_config.llm_settings.default_model_id or \
                                       self.app_config.llm_settings.default_llm_fallback
            if not model_id_for_token_count:
                dry_run_warnings.append(f"步骤 {step_schema_dry.step_order + 1} 无法确定模型ID进行Token估算。")
                prompt_tokens_this_step = len(prompt_data_dry_run.user_prompt) // 2 # 粗略估算
            else:
                prompt_tokens_this_step = estimate_token_count(prompt_data_dry_run.user_prompt, model_user_id=model_id_for_token_count)
                if prompt_data_dry_run.system_prompt:
                    prompt_tokens_this_step += estimate_token_count(prompt_data_dry_run.system_prompt, model_user_id=model_id_for_token_count)
            
            total_prompt_tokens_estimate += prompt_tokens_this_step

            # 5. 获取最大完成Token数
            max_completion_this_step: Optional[int] = None
            llm_overrides_step_dry = step_schema_dry.llm_override_parameters or {}
            gen_constraints_step_dry = step_schema_dry.generation_constraints
            
            if llm_overrides_step_dry.get("max_tokens") is not None: max_completion_this_step = llm_overrides_step_dry["max_tokens"]
            elif llm_overrides_step_dry.get("max_output_tokens") is not None: max_completion_this_step = llm_overrides_step_dry["max_output_tokens"] # 兼容
            elif gen_constraints_step_dry and gen_constraints_step_dry.max_length is not None: max_completion_this_step = gen_constraints_step_dry.max_length
            elif chain_to_dry_run.global_llm_override_parameters and chain_to_dry_run.global_llm_override_parameters.get("max_tokens") is not None: max_completion_this_step = chain_to_dry_run.global_llm_override_parameters["max_tokens"]
            elif chain_to_dry_run.global_generation_constraints and chain_to_dry_run.global_generation_constraints.max_length is not None: max_completion_this_step = chain_to_dry_run.global_generation_constraints.max_length
            else: max_completion_this_step = self.app_config.llm_settings.default_max_completion_tokens

            if max_completion_this_step is not None: # 可能为0或负数，确保是正数或None
                 max_completion_this_step = max(0, max_completion_this_step) if isinstance(max_completion_this_step, int) else None

            if max_completion_this_step is not None:
                total_max_completion_tokens_estimate += max_completion_this_step
            else: # 如果无法确定max_tokens，给一个警告，并使用一个默认值进行总估算
                dry_run_warnings.append(f"步骤 {step_schema_dry.step_order + 1} 未能确定最大完成Token数，将使用默认值 {self.app_config.llm_settings.default_max_completion_tokens} 进行总估算。")
                total_max_completion_tokens_estimate += self.app_config.llm_settings.default_max_completion_tokens
            
            step_estimates_list.append(schemas.RuleChainStepCostEstimate(
                step_order=step_schema_dry.step_order,
                task_type=getattr(step_schema_dry, 'task_type', f"TemplateRef(ID:{getattr(step_schema_dry, 'template_id', 'N/A')})"),
                model_to_be_used=model_id_for_token_count or "未知模型",
                estimated_prompt_tokens=prompt_tokens_this_step,
                max_completion_tokens=max_completion_this_step
            ))
            
            # 为Dry Run模拟输出，用占位符更新历史
            # 这对于依赖前序输出的步骤的prompt token估算非常重要
            simulated_output_length_chars = (max_completion_this_step or self.app_config.llm_settings.default_max_completion_tokens) * 2 # 假设每个token平均2字符
            simulated_output_text = "A" * simulated_output_length_chars # 模拟输出文本
            
            # 更新 "上一步输出" 以便下一个步骤的输入估算
            current_input_text_for_dry_run_step = simulated_output_text 
            
            # 如果此步骤有输出变量名，也用模拟输出更新历史
            output_var_name_dry_run = getattr(step_schema_dry, 'output_variable_name', None)
            if output_var_name_dry_run:
                # 如果步骤期望JSON输出，模拟一个简单的JSON对象字符串
                if prompt_data_dry_run.is_json_output_hint:
                    step_outputs_history_dry_run[output_var_name_dry_run] = json.dumps({"simulated_key": "simulated_value_of_length_" + str(simulated_output_length_chars)})
                else:
                    step_outputs_history_dry_run[output_var_name_dry_run] = simulated_output_text
            
            step_outputs_history_dry_run["_PREVIOUS_STEP_TEXT_OUTPUT_"] = simulated_output_text


        # 6. 根据总Token数确定成本级别
        cost_tiers = self.app_config.cost_estimation_tiers
        total_tokens_for_cost_level = total_prompt_tokens_estimate + total_max_completion_tokens_estimate
        cost_level_final: schemas.TokenCostLevelEnum
        if total_tokens_for_cost_level <= cost_tiers.low_max_tokens:
            cost_level_final = schemas.TokenCostLevelEnum.LOW
        elif total_tokens_for_cost_level <= cost_tiers.medium_max_tokens:
            cost_level_final = schemas.TokenCostLevelEnum.MEDIUM
        else:
            cost_level_final = schemas.TokenCostLevelEnum.HIGH
        
        logger.info(f"{log_prefix_dry_run} 试运行完成。总预估Prompt Tokens: {total_prompt_tokens_estimate}, 总预估Max Completion Tokens: {total_max_completion_tokens_estimate}, 成本级别: {cost_level_final.value}")

        return schemas.RuleChainDryRunResponse(
            estimated_total_prompt_tokens=total_prompt_tokens_estimate,
            estimated_total_completion_tokens=total_max_completion_tokens_estimate,
            token_cost_level=cost_level_final,
            steps_estimates=step_estimates_list,
            warnings=dry_run_warnings if dry_run_warnings else None
        )