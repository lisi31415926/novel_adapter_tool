# backend/app/services/tokenizer_service.py
import logging
import os # os 用于读取环境变量，例如 GOOGLE_API_KEY
from typing import Optional, Dict, Any, Tuple # 确保 Tuple 已导入
from functools import lru_cache 

# 修正导入路径: config_service 与 tokenizer_service 在同一目录 (app/services/)
# schemas 在 app/ 目录下，是上级目录
from . import config_service #
from .. import schemas # 导入 schemas 以便访问 UserDefinedLLMConfigSchema 等结构

try:
    import tiktoken
    TIKTOKEN_AVAILABLE = True
except ImportError:
    tiktoken = None # type: ignore
    TIKTOKEN_AVAILABLE = False
    # 在模块级别获取 logger，确保在导入失败时也能记录
    _logger_init = logging.getLogger(__name__)
    _logger_init.warning("tiktoken 未安装。Token数量估算将主要依赖字符数。请运行 'pip install tiktoken'")

try:
    import google.generativeai as genai #
    GEMINI_SDK_FOR_TOKENIZER_AVAILABLE = True #
except ImportError:
    genai = None # type: ignore #
    GEMINI_SDK_FOR_TOKENIZER_AVAILABLE = False #
    _logger_init_gemini = logging.getLogger(__name__)
    _logger_init_gemini.info("google-generativeai SDK 未安装。Gemini模型的Token计数功能将不可用。请运行 'pip install google-generativeai'")


logger = logging.getLogger(__name__) # 全局logger

DEFAULT_CHARS_PER_TOKEN_FALLBACK = 2.5 # 最终的硬编码回退因子

@lru_cache(maxsize=10) # 缓存不同编码名称的编码器实例
def _get_tiktoken_encoding(encoding_name: str) -> Optional[Any]: # 返回类型可以是 tiktoken.Encoding
    """获取（如果可用则缓存）指定名称的tiktoken编码器。"""
    if not TIKTOKEN_AVAILABLE or tiktoken is None: #
        return None
    try:
        return tiktoken.get_encoding(encoding_name) #
    except Exception as e:
        logger.warning(f"获取 tiktoken 编码 '{encoding_name}' 失败: {e}") #
        return None

@lru_cache(maxsize=20) # 为更多模型缓存编码器实例
def _get_tiktoken_encoding_for_model(model_name: str) -> Optional[Any]: # 返回类型可以是 tiktoken.Encoding
    """
    根据模型名称获取（如果可用则缓存）合适的tiktoken编码器。
    针对常见模型系列进行特定编码器选择，并提供通用回退。
    """
    if not TIKTOKEN_AVAILABLE or tiktoken is None: #
        return None
    try:
        # tiktoken.encoding_for_model 会为OpenAI模型返回正确的编码器
        return tiktoken.encoding_for_model(model_name) #
    except KeyError: # 如果模型名称不是tiktoken直接支持的
        logger.debug(f"未找到模型 '{model_name}' 的精确 tiktoken 编码。尝试基于模型名称关键字进行通用编码选择。") #
        # 根据模型名称中的关键字尝试匹配系列
        model_name_lower = model_name.lower() #
        if "gpt-4" in model_name_lower or \
           "gpt-3.5" in model_name_lower or \
           "text-embedding-3" in model_name_lower or \
           "text-embedding-ada" in model_name_lower: #
            return _get_tiktoken_encoding("cl100k_base") #
        elif "davinci" in model_name_lower or \
             "curie" in model_name_lower or \
             "babbage" in model_name_lower or \
             ("ada-" in model_name_lower and "text-embedding-ada" not in model_name_lower) : # 排除ada嵌入模型的新版本
            return _get_tiktoken_encoding("p50k_base") #
        else: 
            logger.warning(f"无法为模型 '{model_name}' 确定特定的 tiktoken 编码，将使用 'cl100k_base' 作为通用估算。") #
            return _get_tiktoken_encoding("cl100k_base") # 最终的通用OpenAI兼容编码
    except Exception as e: # 捕获其他可能的tiktoken异常
        logger.error(f"获取模型 '{model_name}' 的 tiktoken 编码时发生错误: {e}", exc_info=True) #
        # 在异常情况下，也回退到最通用的编码器
        return _get_tiktoken_encoding("cl100k_base") #

def _estimate_tokens_by_chars(text: str, model_user_id_for_factor: Optional[str] = None, specific_chars_per_token: Optional[float] = None) -> int: #
    """
    通过字符数估算token数量。
    优先级: specific_chars_per_token > 本地模型配置因子 > 提供商配置因子 > 通用配置因子 > 硬编码回退。
    """
    if not text: # 空文本直接返回0
        return 0
    
    log_prefix = f"[CharEstimate(ModelUserCfgID:'{model_user_id_for_factor or 'N/A'}')]" # 日志前缀
    factor_to_use: Optional[float] = None # 初始化使用的因子

    # 1. 优先使用直接传入的 specific_chars_per_token
    if specific_chars_per_token is not None and specific_chars_per_token > 0: #
        factor_to_use = specific_chars_per_token #
        logger.debug(f"{log_prefix} 使用传入的特定因子: {factor_to_use:.2f}") #
    else:
        # 获取分词器选项配置
        tokenizer_options_cfg = config_service.get_setting("llm_settings.tokenizer_options", {}) #
        
        model_config_dict_val: Optional[Dict[str, Any]] = None # 使用字典以匹配配置中存储的原始格式
        if model_user_id_for_factor: # 如果提供了模型用户ID
            all_user_models_list_val = config_service.get_setting("llm_settings.available_models", []) # 获取 UserDefinedLLMConfig 列表 (字典形式)
            model_config_dict_val = next( #
                (m_conf for m_conf in all_user_models_list_val if isinstance(m_conf, dict) and m_conf.get("user_given_id") == model_user_id_for_factor), #
                None
            )

        # 2. 尝试本地模型特定因子 (如果模型配置存在且匹配)
        if model_config_dict_val and model_config_dict_val.get("provider_tag", "").startswith("lm_studio"): # 示例：判断为本地LM Studio模型
            local_model_factors_cfg_map_val = tokenizer_options_cfg.get("local_model_token_estimation_factors", {}) # 获取本地模型因子映射
            model_api_id_from_config_val = model_config_dict_val.get("model_identifier_for_api") #
            specific_factor_config_dict_val = local_model_factors_cfg_map_val.get( #
                model_user_id_for_factor, 
                local_model_factors_cfg_map_val.get(model_api_id_from_config_val if model_api_id_from_config_val else "", {}) #
            )
            if isinstance(specific_factor_config_dict_val, dict) and "chars_per_token" in specific_factor_config_dict_val: #
                chars_factor_val_local_val = specific_factor_config_dict_val["chars_per_token"] #
                if isinstance(chars_factor_val_local_val, (int, float)) and chars_factor_val_local_val > 0: #
                    factor_to_use = chars_factor_val_local_val #
                    logger.debug(f"{log_prefix} 使用为本地模型 '{model_config_dict_val.get('user_given_name')}' 配置的chars_per_token: {factor_to_use:.2f}") #

        # 3. 如果本地模型因子未找到或无效，尝试提供商特定因子
        if (factor_to_use is None or factor_to_use <= 0) and model_config_dict_val: #
            provider_specific_factors_map_val: Optional[Dict[str, float]] = tokenizer_options_cfg.get("default_estimation_factors_by_provider") #
            if provider_specific_factors_map_val and isinstance(provider_specific_factors_map_val, dict): #
                provider_tag_val_model = model_config_dict_val.get("provider_tag") #
                if provider_tag_val_model and provider_tag_val_model in provider_specific_factors_map_val: #
                    provider_factor_from_cfg = provider_specific_factors_map_val[provider_tag_val_model] #
                    if isinstance(provider_factor_from_cfg, (int, float)) and provider_factor_from_cfg > 0: #
                        factor_to_use = provider_factor_from_cfg #
                        logger.debug(f"{log_prefix} 使用为提供商 '{provider_tag_val_model}' 配置的因子: {factor_to_use:.2f}") #
        
        # 4. 如果上述因子均未找到或无效，回退到通用配置因子
        if factor_to_use is None or factor_to_use <= 0: #
            factor_to_use = tokenizer_options_cfg.get("default_chars_per_token_general", DEFAULT_CHARS_PER_TOKEN_FALLBACK) #
            logger.debug(f"{log_prefix} 使用配置的通用因子: {factor_to_use:.2f}") #

    # 5. 最终安全回退，确保因子有效
    if factor_to_use is None or factor_to_use <= 0:  #
        factor_to_use = DEFAULT_CHARS_PER_TOKEN_FALLBACK #
        logger.warning(f"{log_prefix} 所有因子查找均失败或无效，使用硬编码回退因子: {factor_to_use:.2f}") #

    estimated_tokens_val = int(len(text) / factor_to_use)  #
    return max(1, estimated_tokens_val) if text.strip() else 0 # 如果文本非空但全是空白，也视为0；否则至少为1个token

@lru_cache(maxsize=5) # 缓存不同Gemini模型API ID的实例
def _get_gemini_model_for_counting(model_api_id: str, api_key: Optional[str]) -> Optional[Any]: # 返回类型可以是 genai.GenerativeModel
    """获取（如果可用则缓存）用于计数的Gemini模型实例。"""
    if not GEMINI_SDK_FOR_TOKENIZER_AVAILABLE or genai is None: #
        return None
    try:
        # API密钥获取逻辑：优先传入的key，其次是环境变量
        current_api_key_to_use = api_key if api_key else os.getenv("GOOGLE_API_KEY", os.getenv("GEMINI_API_KEY")) #
        if not current_api_key_to_use: #
            logger.warning(f"Gemini token计数：未找到模型 '{model_api_id}' 的API密钥 (通过参数或环境变量 GOOGLE_API_KEY/GEMINI_API_KEY)。") #
            return None
        
        # 尝试配置并获取模型
        try:
            return genai.GenerativeModel(model_api_id) # 尝试直接获取
        except Exception: # 如果直接获取失败 (例如，API Key未配置)
            logger.debug(f"Gemini token计数：直接获取模型 '{model_api_id}' 失败，尝试配置API密钥后获取。") #
            genai.configure(api_key=current_api_key_to_use) # 配置API密钥
            return genai.GenerativeModel(model_api_id) # 再次尝试获取
    except Exception as e:
        logger.error(f"为 token 计数准备 Gemini 模型 '{model_api_id}' 失败: {e}", exc_info=True) #
        return None

def estimate_token_count(text: str, model_user_id: Optional[str] = None) -> int: #
    """
    估算给定文本的token数量。
    会尝试根据 model_user_id (用户自定义LLM配置的ID) 选择合适的分词器或估算因子。
    """
    if not text or not text.strip(): # 如果文本为空或仅含空白，则token数为0
        return 0

    # tokenizer_options_cfg_val = config_service.get_setting("llm_settings.tokenizer_options", {}) # 减少不必要的重复调用，可在需要时获取
    log_prefix_main_est = f"[TokenEstimate(ModelUserCfgID:'{model_user_id or 'Generic'}')]" #

    if model_user_id: # 如果提供了模型用户ID
        # 从配置中查找该模型ID对应的详细配置 (字典形式)
        all_user_models_list_main_est = config_service.get_setting("llm_settings.available_models", []) #
        model_config_dict_main_est: Optional[Dict[str, Any]] = next( #
            (m_conf for m_conf in all_user_models_list_main_est if isinstance(m_conf, dict) and m_conf.get("user_given_id") == model_user_id), #
            None
        )

        if model_config_dict_main_est: # 如果找到了模型配置
            provider_tag_main_est = model_config_dict_main_est.get("provider_tag") #
            model_api_id_main_est = model_config_dict_main_est.get("model_identifier_for_api") # 这是提供商API实际使用的模型名
            user_given_name_main_est = model_config_dict_main_est.get("user_given_name") #
            logger.debug(f"{log_prefix_main_est} 找到用户配置: Name='{user_given_name_main_est}', Provider='{provider_tag_main_est}', APIModel='{model_api_id_main_est}'") #

            # 1. 优先使用精确分词器
            if provider_tag_main_est in ["openai", "deepseek", "x_grok"] or "openai_compatible" in str(provider_tag_main_est): #
                if TIKTOKEN_AVAILABLE and model_api_id_main_est: #
                    encoding_val = _get_tiktoken_encoding_for_model(model_api_id_main_est) #
                    if encoding_val: #
                        logger.debug(f"{log_prefix_main_est} 使用 tiktoken ({encoding_val.name}) 为模型 '{model_api_id_main_est}' 进行精确计数。") #
                        return len(encoding_val.encode(text)) #
            
            elif provider_tag_main_est == "anthropic_claude": #
                if TIKTOKEN_AVAILABLE: #
                    encoding_claude_val = _get_tiktoken_encoding("cl100k_base") # Claude近似
                    if encoding_claude_val: #
                        logger.debug(f"{log_prefix_main_est} 使用 tiktoken (cl100k_base) 近似估算 Claude模型 '{model_api_id_main_est}'。") #
                        return len(encoding_claude_val.encode(text)) #
            
            elif provider_tag_main_est == "google_gemini" and GEMINI_SDK_FOR_TOKENIZER_AVAILABLE and genai and model_api_id_main_est: #
                gemini_api_key_from_cfg_val = model_config_dict_main_est.get("api_key") # 从模型配置中获取密钥
                gemini_model_instance_val = _get_gemini_model_for_counting(model_api_id_main_est, gemini_api_key_from_cfg_val) #
                if gemini_model_instance_val: #
                    try:
                        # 注意：Gemini的count_tokens调用可能涉及网络请求
                        token_count_response = gemini_model_instance_val.count_tokens(text) #
                        if hasattr(token_count_response, 'total_tokens'): #
                            logger.debug(f"{log_prefix_main_est} 使用 Gemini SDK count_tokens ({model_api_id_main_est}) 进行精确计数。") #
                            return token_count_response.total_tokens # type: ignore[no-any-return]
                    except Exception as e_gemini_sdk_count_val: #
                        logger.warning(f"{log_prefix_main_est} 使用 Gemini SDK count_tokens ({model_api_id_main_est}) 失败: {e_gemini_sdk_count_val}。将回退到字符估算。") #
            
            logger.debug(f"{log_prefix_main_est} Provider '{provider_tag_main_est}' 无专用精确分词器或分词失败，将使用基于字符的估算。") #
            return _estimate_tokens_by_chars(text, model_user_id_for_factor=model_user_id) #
        
        else: # 未找到 model_user_id 对应的配置
            logger.warning(f"{log_prefix_main_est} 未找到 model_user_id '{model_user_id}' 对应的用户LLM配置。将使用通用估算策略。") #
    
    # 如果没有提供 model_user_id，或查找失败，则进行通用估算
    # 1. 通用 TikToken 回退 (cl100k_base 通常对多种现代模型有较好的近似效果)
    if TIKTOKEN_AVAILABLE: #
        encoding_generic_val = _get_tiktoken_encoding("cl100k_base") #
        if encoding_generic_val: #
            logger.debug(f"{log_prefix_main_est} 使用通用 tiktoken (cl100k_base) 进行估算。") #
            return len(encoding_generic_val.encode(text)) #

    # 2. 最终回退：基于字符数的估算 (不带 model_user_id，将使用全局通用因子)
    logger.debug(f"{log_prefix_main_est} 执行最终回退：使用通用字符数估算（无特定模型上下文）。") #
    return _estimate_tokens_by_chars(text) #


async def truncate_text_by_tokens(text: str, max_tokens: int, model_user_id: Optional[str] = None) -> Tuple[str, int]: #
    """
    将文本截断到大约指定的max_tokens数量。
    会优先使用与model_user_id关联的分词器进行精确估算，然后是通用分词器，最后是字符估算。
    返回截断后的文本和估算的最终token数。
    """
    if not text or not text.strip() or max_tokens <= 0: # 如果文本为空或目标token数无效
        return "", 0

    # 获取用于初步字符切片的估算因子
    initial_char_per_token_factor: float = DEFAULT_CHARS_PER_TOKEN_FALLBACK #
    tokenizer_options_main_cfg = config_service.get_setting("llm_settings.tokenizer_options", {}) #

    if model_user_id: # 如果指定了模型用户ID
        all_user_models_schemas_main_list = config_service.get_setting("llm_settings.available_models", []) #
        model_cfg_dict_for_trunc: Optional[Dict[str, Any]] = next( #
            (m_conf for m_conf in all_user_models_schemas_main_list if isinstance(m_conf, dict) and m_conf.get("user_given_id") == model_user_id), None ) #
        if model_cfg_dict_for_trunc: # 如果找到模型配置
            provider_tag_for_trunc = model_cfg_dict_for_trunc.get("provider_tag") #
            provider_factors_for_trunc: Optional[Dict[str, float]] = tokenizer_options_main_cfg.get("default_estimation_factors_by_provider") #
            if provider_factors_for_trunc and isinstance(provider_factors_for_trunc, dict) and provider_tag_for_trunc and provider_tag_for_trunc in provider_factors_for_trunc: #
                factor_from_provider = provider_factors_for_trunc[provider_tag_for_trunc] #
                if isinstance(factor_from_provider, (int, float)) and factor_from_provider > 0: #
                    initial_char_per_token_factor = factor_from_provider #
            elif provider_tag_for_trunc and provider_tag_for_trunc.startswith("lm_studio"): #
                 local_model_factor_val = tokenizer_options_main_cfg.get("default_estimation_factors_by_provider", {}).get("lm_studio_local", initial_char_per_token_factor) #
                 if isinstance(local_model_factor_val, (int,float)) and local_model_factor_val > 0: initial_char_per_token_factor = local_model_factor_val #

    if initial_char_per_token_factor == DEFAULT_CHARS_PER_TOKEN_FALLBACK: # 如果上面没找到特定因子，用通用配置
        initial_char_per_token_factor = tokenizer_options_main_cfg.get("default_chars_per_token_general", DEFAULT_CHARS_PER_TOKEN_FALLBACK) #
    
    log_prefix_trunc_main = f"[TruncateText(ModelUserCfgID:'{model_user_id or 'Generic'}')]" #
    logger.debug(f"{log_prefix_trunc_main} 初步切片因子: {initial_char_per_token_factor:.2f} chars/token.") #

    # 从配置中获取截断参数
    initial_slice_multiplier_cfg = tokenizer_options_main_cfg.get("truncate_initial_slice_multiplier", 1.3) # 多取一点字符的倍数
    max_refinement_attempts_cfg = tokenizer_options_main_cfg.get("truncate_max_refinement_attempts", 10) # 最大调整次数
    refinement_step_factor_cfg = tokenizer_options_main_cfg.get("truncate_refinement_step_factor", 5) # 每次调整相当于多少个token的字符量
    
    initial_char_limit_calc = int(max_tokens * initial_char_per_token_factor * initial_slice_multiplier_cfg) #
    min_initial_chars_calc = int(max_tokens * initial_char_per_token_factor * 0.8) 
    initial_char_limit_calc = max(initial_char_limit_calc, min_initial_chars_calc, 1) 

    sliced_text_iter = text[:initial_char_limit_calc] # 初步切片

    final_text_result_slice = sliced_text_iter #
    # estimate_token_count 是同步函数，truncate_text_by_tokens 是异步函数，可以直接调用
    final_token_count_result = estimate_token_count(final_text_result_slice, model_user_id) #

    attempts_count = 0 #
    min_chars_per_refinement = int(initial_char_per_token_factor * refinement_step_factor_cfg)  #
    if min_chars_per_refinement <=0: min_chars_per_refinement = 10 # 保证最小调整步长不为0

    # 如果初步切片后的token数已超出目标，则尝试缩减
    while final_token_count_result > max_tokens and attempts_count < max_refinement_attempts_cfg: #
        over_tokens_val = final_token_count_result - max_tokens # 超出目标多少token
        chars_to_remove_val = int(over_tokens_val * initial_char_per_token_factor * 0.8) # 尝试移除估算超出部分字符量的80%
        chars_to_remove_val = max(min_chars_per_refinement, chars_to_remove_val) #
        
        if len(final_text_result_slice) - chars_to_remove_val <= 0 : # 如果要移除的量大于等于当前长度
            final_text_result_slice = final_text_result_slice[:int(len(final_text_result_slice)*0.5)] if len(final_text_result_slice) > 10 else "" #
            if not final_text_result_slice.strip() : break # 如果缩减后为空或全是空白，则停止
        else:
             final_text_result_slice = final_text_result_slice[:-chars_to_remove_val] # 从末尾移除

        final_token_count_result = estimate_token_count(final_text_result_slice, model_user_id) # 重新估算
        attempts_count += 1 #
    
    if final_token_count_result > max_tokens and len(final_text_result_slice) > 0: #
        logger.warning(f"{log_prefix_trunc_main} 迭代调整后仍超出目标 ({final_token_count_result} > {max_tokens})。执行最终硬字符截断。") #
        safety_margin_val = 0.95 #
        hard_cut_char_len = int(max_tokens * initial_char_per_token_factor * safety_margin_val) #
        final_text_result_slice = final_text_result_slice[:hard_cut_char_len] #
        final_token_count_result = estimate_token_count(final_text_result_slice, model_user_id) #
        if final_token_count_result > max_tokens and len(final_text_result_slice) > 0: #
             final_text_result_slice = final_text_result_slice[:int(len(final_text_result_slice)*0.9)] # 再砍10%字符
             final_token_count_result = estimate_token_count(final_text_result_slice, model_user_id) #

    logger.debug(f"{log_prefix_trunc_main} 截断调整: 尝试 {attempts_count} 次后，文本长度 {len(final_text_result_slice)} chars, 估算 tokens {final_token_count_result} (目标 <= {max_tokens})") #
    
    return final_text_result_slice, final_token_count_result #