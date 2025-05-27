# backend/app/text_processing_utils.py
import logging
import re
import os
import time
import json #
from typing import Dict, Optional, List, Any, Union, Tuple # 确保导入所有需要的类型

# 修正导入路径：假设 utils.py 在 app/ 目录下
from . import schemas # 正确，如果 schemas.py 与 utils.py 同级或在 __init__.py 中导出
from .services.tokenizer_service import estimate_token_count # 修正：从 services 子目录导入
from .services.local_nlp_service import analyze_text_sentiment as analyze_sentiment_for_constraints # 修正：从 services 子目录导入

logger = logging.getLogger(__name__)

_werkzeug_available = False #
try:
    from werkzeug.utils import secure_filename as werkzeug_secure_filename_internal #
    _werkzeug_available = True #
    logger.debug("Werkzeug secure_filename 导入成功，将优先使用。") #
except ImportError:
    logger.warning( #
        "Werkzeug secure_filename 未找到。将使用内置的、更基础的文件名安全化实现。 " #
        "为了增强安全性，建议在生产环境中安装 Werkzeug ('pip install Werkzeug')." #
    )
    _werkzeug_available = False #

# 文件名清理相关的正则表达式和常量 (保持不变)
_filename_ascii_strip_re_util = re.compile(r"[^A-Za-z0-9_.-]") #
_windows_device_files_util = ( #
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", #
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", #
)

def _secure_filename_basic_impl(filename: str) -> str: #
    """内置的基础文件名安全化实现。"""
    if not filename:  #
        return f"unsafe_empty_filename_{int(time.time())}.dat" #
        
    basename, ext = os.path.splitext(filename) #
    basename = str(basename) # 确保是字符串
    
    basename = _filename_ascii_strip_re_util.sub("_", basename) #
    # 移除所有空白字符（包括空格、制表符、换行符等），然后用单个下划线连接
    basename = "_".join(basename.split())  #
    
    if basename.upper() in _windows_device_files_util: #
        basename = f"_{basename}" # 加前缀以避免与Windows设备文件冲突
        
    MAX_BASENAME_LENGTH = 100 # 限制基本名称的最大长度
    if not basename or basename in {".", ".."} or all(c == '_' for c in basename): #
        # 如果处理后基本名称为空、为"."/".."或全为下划线，则生成唯一文件名
        timestamp_suffix = int(time.time() * 1000) # 使用毫秒时间戳增加唯一性
        # 确保文件扩展名安全且合理
        safe_ext = ext if ext and len(ext) < 10 and ext.startswith('.') and not re.search(r'[/\\]', ext) else '.dat' #
        return f"generated_filename_{timestamp_suffix}{safe_ext}" #
        
    if len(basename) > MAX_BASENAME_LENGTH: #
        basename = basename[:MAX_BASENAME_LENGTH] # 截断过长的基本名称
        
    return f"{basename}{ext}" #

def secure_filename(filename: str) -> str: #
    """
    使文件名安全化，优先使用 Werkzeug 的实现（如果可用），否则使用内置的基础实现。
    确保输入是字符串，并处理 None 或转换失败的情况。
    """
    if not isinstance(filename, str): #
        logger.warning(f"secure_filename 收到非字符串输入 (类型: {type(filename)})，将尝试转换或返回一个安全的默认文件名。") #
        if filename is None: #
            return _secure_filename_basic_impl("") # 传递空字符串给基础实现
        try:
            filename_str = str(filename) #
        except Exception:
            logger.error(f"无法将输入值 {filename!r} 转换为字符串以进行安全化处理。") #
            return _secure_filename_basic_impl("") # 转换失败则按空文件名处理
    else:
        filename_str = filename #

    if _werkzeug_available and werkzeug_secure_filename_internal is not None: # 添加 werkzeug_secure_filename_internal 非空检查
        return werkzeug_secure_filename_internal(filename_str) #
    else:
        return _secure_filename_basic_impl(filename_str) #

def format_prompt_with_curly_braces(template_str: str, params: Dict[str, Any]) -> str: #
    """
    使用字典中的值替换模板字符串中用花括号包裹的占位符。
    例如：template_str = "你好, {name}!", params = {"name": "世界"} -> "你好, 世界!"

    **安全警告**: 此函数执行简单的字符串替换。
    它本身不提供针对Prompt注入的复杂防护。
    调用此函数之前，所有插入到模板中的参数值（来自params字典）
    【必须】已经过严格的清理和转义（例如，通过强化的 `sanitize_prompt_parameter` 函数）。
    强烈建议优先使用如 LangChain 的 `PromptTemplate` 等更安全的模板引擎来构建最终的LLM提示，
    尤其当模板字符串本身或其部分内容可能来源于用户输入或不可信数据源时。
    此函数主要作为LangChain不可用时，在`prompt_engineering_service.py`中的一个回退选项，
    或用于其他不涉及LLM交互的、参数值完全可信的简单格式化场景。

    Args:
        template_str: 包含 {key} 格式占位符的模板字符串。
        params: 一个字典，键是占位符的名称，值是替换的内容。

    Returns:
        格式化后的字符串。
    """
    if not isinstance(template_str, str): #
        logger.error(f"format_prompt_with_curly_braces: template_str 必须是字符串，但收到 {type(template_str)}。") #
        raise TypeError("模板必须是字符串。") #
    if not isinstance(params, dict): #
        logger.error(f"format_prompt_with_curly_braces: params 必须是字典，但收到 {type(params)}。") #
        # 或者直接 raise TypeError("参数必须是字典。")

    log_prefix_format_util = "[Utils-FormatPrompt]" #
    logger.debug(f"{log_prefix_format_util} 开始格式化模板。模板预览: '{template_str[:100]}...', 参数键: {list(params.keys())}") #

    # 使用函数进行替换，以便在参数未找到时有更明确的处理
    def replace_match(match): #
        key = match.group(1) # 提取花括号内的占位符名称
        value = params.get(key) #
        if value is None and key not in params: # 键不存在于字典中
             logger.warning(f"{log_prefix_format_util} 在参数字典中未找到占位符 '{key}'，将保留原样。") #
             return f"{{{key}}}" # 保留原始占位符
        return str(value) if value is not None else "" # None 值转换为空字符串

    try:
        formatted_string = re.sub(r"\{([a-zA-Z0-9_]+)\}", replace_match, template_str) #
    except Exception as e_re: #
        logger.error(f"{log_prefix_format_util} 模板替换时发生正则表达式错误: {e_re}", exc_info=True) #
        return template_str #
        
    logger.debug(f"{log_prefix_format_util} 模板格式化完成。结果预览: '{formatted_string[:200]}...'") #
    return formatted_string #


async def validate_and_log_llm_output_constraints( #
    generated_text_to_check: str,
    constraints_to_apply: Optional[schemas.GenerationConstraintsSchema], #
    model_id_for_tokens: str # This should be the UserDefinedLLMConfig.user_given_id
) -> Dict[str, bool]:
    """
    验证LLM的输出是否符合给定的生成约束。
    使用 estimate_token_count (来自tokenizer_service) 进行token计数。
    使用 analyze_sentiment_for_constraints (来自local_nlp_service) 进行情感分析。
    """
    if not constraints_to_apply: #
        logger.debug("未提供生成约束 (validate_and_log_llm_output_constraints)，跳过校验。") #
        return {} 

    satisfied_status_result_map: Dict[str, bool] = {} #
    text_lower_for_check = generated_text_to_check.lower() #
    
    try:
        # estimate_token_count 是同步函数，不需要 await
        current_tokens_count_val = estimate_token_count(generated_text_to_check, model_user_id=model_id_for_tokens) #
    except Exception as e_token_count: #
        logger.error(f"约束校验中计算Token数失败 (模型用户ID: {model_id_for_tokens}): {e_token_count}", exc_info=True) #
        current_tokens_count_val = -1 # 表示计数失败

    log_prefix_constraint_val = f"[约束校验 ModelUserCfgID:{model_id_for_tokens}]" #

    if constraints_to_apply.max_length is not None and current_tokens_count_val != -1: #
        is_max_len_met = current_tokens_count_val <= constraints_to_apply.max_length #
        satisfied_status_result_map["max_length"] = is_max_len_met #
        logger.debug(f"{log_prefix_constraint_val} max_length: 目标<={constraints_to_apply.max_length}, 实际={current_tokens_count_val}, 满足={is_max_len_met}") #
    elif constraints_to_apply.max_length is not None and current_tokens_count_val == -1: #
        satisfied_status_result_map["max_length"] = False # Token计数失败，无法验证长度
        logger.warning(f"{log_prefix_constraint_val} max_length: 目标<={constraints_to_apply.max_length}, Token计数失败，视为不满足。") #

    if constraints_to_apply.min_length is not None and current_tokens_count_val != -1: #
        is_min_len_met = current_tokens_count_val >= constraints_to_apply.min_length #
        satisfied_status_result_map["min_length"] = is_min_len_met #
        logger.debug(f"{log_prefix_constraint_val} min_length: 目标>={constraints_to_apply.min_length}, 实际={current_tokens_count_val}, 满足={is_min_len_met}") #
    elif constraints_to_apply.min_length is not None and current_tokens_count_val == -1: #
        satisfied_status_result_map["min_length"] = False #
        logger.warning(f"{log_prefix_constraint_val} min_length: 目标>={constraints_to_apply.min_length}, Token计数失败，视为不满足。") #

    if constraints_to_apply.include_keywords: #
        missing_kws = [kw for kw in constraints_to_apply.include_keywords if kw.lower() not in text_lower_for_check] #
        is_include_kws_met = not missing_kws #
        satisfied_status_result_map["include_keywords"] = is_include_kws_met #
        log_msg_incl = f"{log_prefix_constraint_val} include_keywords: 目标={constraints_to_apply.include_keywords}, 满足={is_include_kws_met}" #
        if not is_include_kws_met: log_msg_incl += f", 缺失={missing_kws}" #
        logger.debug(log_msg_incl) #

    if constraints_to_apply.exclude_keywords: #
        found_excl_kws = [kw for kw in constraints_to_apply.exclude_keywords if kw.lower() in text_lower_for_check] #
        is_exclude_kws_met = not found_excl_kws #
        satisfied_status_result_map["exclude_keywords"] = is_exclude_kws_met #
        log_msg_excl = f"{log_prefix_constraint_val} exclude_keywords: 目标排除={constraints_to_apply.exclude_keywords}, 满足={is_exclude_kws_met}" #
        if not is_exclude_kws_met: log_msg_excl += f", 发现违规={found_excl_kws}" #
        logger.debug(log_msg_excl) #

    if constraints_to_apply.enforce_sentiment: #
        # analyze_sentiment_for_constraints 是同步函数
        sentiment_score_val_check = analyze_sentiment_for_constraints(generated_text_to_check) #
        is_sentiment_met = False #
        if sentiment_score_val_check is not None: #
            target_sentiment_val = constraints_to_apply.enforce_sentiment.value #
            
            sentiment_threshold_settings = config_service.get_setting("sentiment_thresholds") #
            if sentiment_threshold_settings: #
                pos_thresh = sentiment_threshold_settings.positive_min_score #
                neg_thresh = sentiment_threshold_settings.negative_max_score #
            else: # 回退到硬编码的默认值
                pos_thresh, neg_thresh = 0.65, 0.35  #
                logger.warning(f"{log_prefix_constraint_val} 未能从配置中获取情感阈值，使用默认值: Pos>={pos_thresh}, Neg<={neg_thresh}") #

            if target_sentiment_val == schemas.SentimentConstraintEnum.POSITIVE.value and sentiment_score_val_check >= pos_thresh: is_sentiment_met = True #
            elif target_sentiment_val == schemas.SentimentConstraintEnum.NEGATIVE.value and sentiment_score_val_check <= neg_thresh: is_sentiment_met = True #
            elif target_sentiment_val == schemas.SentimentConstraintEnum.NEUTRAL.value and neg_thresh < sentiment_score_val_check < pos_thresh: is_sentiment_met = True # 明确中性区间
            logger.debug(f"{log_prefix_constraint_val} enforce_sentiment: 目标={target_sentiment_val}, 实际得分={sentiment_score_val_check:.3f} (阈值 Pos>={pos_thresh}, Neg<={neg_thresh}), 满足={is_sentiment_met}") #
        else: logger.warning(f"{log_prefix_constraint_val} enforce_sentiment: 无法确定文本情感，约束视为未满足。") #
        satisfied_status_result_map["enforce_sentiment"] = is_sentiment_met #

    if constraints_to_apply.style_hints: #
        satisfied_status_result_map["style_hints"] = True # 假设LLM已收到提示
        logger.debug(f"{log_prefix_constraint_val} style_hints: 已提供风格提示给LLM: {constraints_to_apply.style_hints}。校验通过（不进行内容评估）。") #

    if constraints_to_apply.output_format: #
        format_met_flag = True  #
        format_details = constraints_to_apply.output_format_details or {} #
        output_format_enum = constraints_to_apply.output_format #
        
        if output_format_enum == schemas.OutputFormatConstraintEnum.JSON_OBJECT: #
            try:
                parsed_json = json.loads(generated_text_to_check) #
                if not isinstance(parsed_json, dict): format_met_flag = False; logger.warning(f"{log_prefix_constraint_val} output_format=JSON_OBJECT: 输出非JSON对象 (类型: {type(parsed_json)})") #
                elif "keys" in format_details and isinstance(format_details.get("keys"), list): #
                    missing_keys = [k for k in format_details["keys"] if k not in parsed_json] #
                    if missing_keys: format_met_flag = False; logger.warning(f"{log_prefix_constraint_val} output_format=JSON_OBJECT: 缺失期望键: {missing_keys}") #
            except json.JSONDecodeError: format_met_flag = False; logger.warning(f"{log_prefix_constraint_val} output_format=JSON_OBJECT: 输出不是有效JSON。预览: '{generated_text_to_check[:100]}...'") #
        
        elif output_format_enum == schemas.OutputFormatConstraintEnum.BULLET_LIST or \
             output_format_enum == schemas.OutputFormatConstraintEnum.NUMBERED_LIST: #
            lines = [line.strip() for line in generated_text_to_check.splitlines() if line.strip()] #
            if not lines:  #
                expected_count_val = format_details.get("count") #
                if isinstance(expected_count_val, int) and expected_count_val > 0: #
                    format_met_flag = False #
                    logger.warning(f"{log_prefix_constraint_val} output_format={output_format_enum.value}: 期望列表但输出为空，且期望项数 > 0。") #
            elif lines:  #
                is_numbered_item_func = lambda ln: re.match(r"^\s*\d+[.)]\s+", ln) is not None #
                is_bullet_item_func = lambda ln: any(ln.startswith(s) for s in ['*', '-', '•', '·', '+']) #
                
                if output_format_enum == schemas.OutputFormatConstraintEnum.NUMBERED_LIST and not any(is_numbered_item_func(ln) for ln in lines): #
                     format_met_flag = False; logger.warning(f"{log_prefix_constraint_val} output_format=NUMBERED_LIST: 输出中未找到明显的编号列表项。") #
                elif output_format_enum == schemas.OutputFormatConstraintEnum.BULLET_LIST and not any(is_bullet_item_func(ln) for ln in lines): #
                     format_met_flag = False; logger.warning(f"{log_prefix_constraint_val} output_format=BULLET_LIST: 输出中未找到明显的项目符号列表项。") #
                
                expected_count = format_details.get("count") #
                if isinstance(expected_count, int) and len(lines) != expected_count: #
                     format_met_flag = False; logger.warning(f"{log_prefix_constraint_val} output_format={output_format_enum.value}: 期望项数 {expected_count}, 实际 {len(lines)}。") #
        
        elif output_format_enum == schemas.OutputFormatConstraintEnum.MARKDOWN_TABLE: #
            if not (re.search(r"\|\s*-+\s*\|", generated_text_to_check) and generated_text_to_check.count("|") >= 4): #
                format_met_flag = False; logger.warning(f"{log_prefix_constraint_val} output_format=MARKDOWN_TABLE: 输出不像有效的Markdown表格。") #
        
        elif output_format_enum == schemas.OutputFormatConstraintEnum.XML_STRUCTURE: #
            if not (generated_text_to_check.strip().startswith("<") and \
                    generated_text_to_check.strip().endswith(">") and \
                    re.search(r"<([a-zA-Z0-9_:]+).*?>[\s\S]*?</\1>", generated_text_to_check)): # 检查是否有配对的标签
                format_met_flag = False; logger.warning(f"{log_prefix_constraint_val} output_format=XML_STRUCTURE: 输出不像有效的XML结构。") #

        satisfied_status_result_map["output_format"] = format_met_flag #
        logger.debug(f"{log_prefix_constraint_val} output_format={output_format_enum.value}: 满足={format_met_flag}") #
        
    return satisfied_status_result_map #

# 新增：生成唯一ID的辅助函数 (与您之前在 novel_parser_service.py 中的版本类似)
def generate_unique_id(prefix: str = "item") -> str: #
    """生成一个基于时间戳和随机数的唯一ID字符串。"""
    # 之前 novel_parser_service.py 中使用的是 uuid.uuid4().hex
    # 这里保持您 utils.py 中提供的版本
    return f"{prefix}_{int(time.time() * 1000)}_{os.urandom(4).hex()}" #