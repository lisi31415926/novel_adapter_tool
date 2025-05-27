# backend/app/llm_providers/grok_provider.py
import logging
import os
import time
from typing import Dict, Any, Optional, Tuple, List, Union

try:
    # 仍然使用 openai SDK 与 Grok 的 OpenAI 兼容 API 进行交互
    from openai import AsyncOpenAI, APIError as OpenAIAPIError, RateLimitError, APIConnectionError, APITimeoutError # type: ignore[attr-defined]
    OPENAI_SDK_FOR_GROK_AVAILABLE = True
except ImportError:
    AsyncOpenAI = None # type: ignore
    OpenAIAPIError = None # type: ignore
    RateLimitError = None # type: ignore
    APIConnectionError = None # type: ignore
    APITimeoutError = None # type: ignore
    OPENAI_SDK_FOR_GROK_AVAILABLE = False
    logging.warning("OpenAI SDK (用于GrokProvider) 未安装。GrokProvider 将不可用。请运行 'pip install openai'")

# 导入新的基类和响应模型
from .base_llm_provider import BaseLLMProvider, LLMResponse
# 导入类型化的配置模型和全局配置服务
from app import schemas, config_service # 确保能访问全局配置

logger = logging.getLogger(__name__)

DEFAULT_GROK_BASE_URL = "https://api.x.ai/v1" # Grok 官方 API 地址

# 临时的 ContentSafetyException 定义。
# TODO: 此异常类应移至 app.llm_orchestrator 或 app.core.exceptions
class ContentSafetyException(RuntimeError): #
    """自定义内容安全违规异常类"""
    def __init__(self, message: str, provider: Optional[str]=None, model_id: Optional[str]=None, details: Optional[Any]=None): #
        self.original_message = message #
        self.provider = provider #
        self.model_id = model_id #
        self.details = details #
        full_message = f"内容安全异常 by Provider='{provider}', Model='{model_id}'. Message: '{message}'. Details: {details}" #
        super().__init__(full_message) #


class GrokProvider(BaseLLMProvider):
    """
    Grok (xAI) LLM 提供商实现。
    假设其 API 与 OpenAI 兼容，因此使用 openai SDK。
    """
    PROVIDER_TAG = "x_grok" #

    def __init__(
        self,
        model_config: schemas.UserDefinedLLMConfigSchema,
        provider_config: schemas.LLMProviderConfigSchema
    ):
        """
        初始化 Grok API 的客户端。
        """
        super().__init__(model_config, provider_config) #

        if not OPENAI_SDK_FOR_GROK_AVAILABLE or AsyncOpenAI is None: #
            logger.error("GrokProvider 初始化失败：OpenAI SDK (用于Grok) 不可用。") #
            self.client = None # 明确设置
            self._sdk_ready = False # 新增状态标记
            return

        self._sdk_ready = True
        api_key_to_use = self.model_config.api_key
        if not api_key_to_use:
            api_key_to_use = os.getenv("GROK_API_KEY", os.getenv("XAI_API_KEY")) #

        base_url_to_use = self.model_config.base_url if self.model_config.base_url is not None else DEFAULT_GROK_BASE_URL #

        if not api_key_to_use: #
            logger.error("GrokProvider 初始化失败：未提供 API 密钥（通过模型配置或 GROK_API_KEY/XAI_API_KEY 环境变量）。") #
            self.client = None # 明确设置
            self._sdk_ready = False
            return

        try:
            client_params: Dict[str, Any] = { #
                "api_key": api_key_to_use, #
                "base_url": base_url_to_use, #
            }
            if self.provider_config.api_timeout_seconds is not None: #
                client_params["timeout"] = self.provider_config.api_timeout_seconds #
            if self.provider_config.max_retries is not None: #
                client_params["max_retries"] = self.provider_config.max_retries #
            else: 
                client_params["max_retries"] = 1 #

            self.client: Optional[AsyncOpenAI] = AsyncOpenAI(**client_params) # type: ignore #

            self.default_jailbreak_prefix = self.provider_config.default_jailbreak_prefix #
            if self.default_jailbreak_prefix: #
                logger.info(f"GrokProvider 将使用默认引导前缀: '{self.default_jailbreak_prefix[:50]}...'") #

            logger.info(f"GrokProvider 客户端 (模型: {self.model_config.user_given_name}) 已成功初始化。Base URL: {base_url_to_use}, Timeout: {client_params.get('timeout')}, Max Retries: {client_params.get('max_retries')}.") #
        except Exception as e:
            logger.error(f"GrokProvider 初始化客户端 (模型: {self.model_config.user_given_name}) 失败: {e}", exc_info=True) #
            self.client = None #
            self._sdk_ready = False


    def is_client_ready(self) -> bool: #
        return bool(self._sdk_ready and self.client is not None) #

    async def generate(
        self,
        prompt: str, 
        system_prompt: Optional[str] = None,
        is_json_output: bool = False, 
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        llm_override_parameters: Optional[Dict[str, Any]] = None,
        **kwargs: Any
    ) -> LLMResponse:
        if not self.is_client_ready() or self.client is None: #
            logger.error(f"GrokProvider (模型: {self.model_config.user_given_name}) 错误：客户端未初始化。") #
            return LLMResponse(
                text="", model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=0, completion_tokens=0, total_tokens=0,
                finish_reason="error", error="Grok客户端未初始化或未就绪"
            )

        current_final_system_prompt = system_prompt #
        if self.default_jailbreak_prefix: #
            if current_final_system_prompt: #
                if self.default_jailbreak_prefix.strip().lower() not in current_final_system_prompt.lower(): #
                    # 使用安全的字符串拼接
                    current_final_system_prompt = self.default_jailbreak_prefix + "\n" + current_final_system_prompt #
            else:
                current_final_system_prompt = self.default_jailbreak_prefix #
        
        messages: List[Dict[str, str]] = [] #
        user_prompt_content = prompt # 将原始 prompt 赋值给一个新变量

        if current_final_system_prompt and self.model_config.supports_system_prompt: #
            messages.append({"role": "system", "content": current_final_system_prompt}) #
        elif current_final_system_prompt: # 如果模型不支持独立系统提示，则合并
            # 安全地合并 system_prompt 和 user_prompt
            user_prompt_content = current_final_system_prompt + "\n\n---\n\n用户请求：\n" + prompt
        
        messages.append({"role": "user", "content": user_prompt_content}) # 使用更新后的 user_prompt_content

        global_llm_settings = config_service.get_config().llm_settings
        
        api_params: Dict[str, Any] = { #
            "model": self.get_model_identifier_for_api(), #
            "messages": messages, #
            "temperature": temperature if temperature is not None else global_llm_settings.default_temperature,
        }

        effective_max_tokens = max_tokens
        if not effective_max_tokens and llm_override_parameters and llm_override_parameters.get("max_tokens") is not None:
            effective_max_tokens = llm_override_parameters.get("max_tokens")
        elif not effective_max_tokens and llm_override_parameters and llm_override_parameters.get("max_output_tokens") is not None: 
            effective_max_tokens = llm_override_parameters.get("max_output_tokens")
        
        if not effective_max_tokens : 
            effective_max_tokens = global_llm_settings.default_max_completion_tokens or 8000
        
        api_params["max_tokens"] = int(effective_max_tokens) #

        if is_json_output: 
            api_params["response_format"] = {"type": "json_object"}
            logger.debug(f"为Grok模型 '{self.get_model_identifier_for_api()}' 启用了JSON输出模式。")

        if llm_override_parameters: #
            valid_grok_params = [ "top_p", "stop", "stream", "user", "seed" ]
            filtered_llm_params = {k: v for k, v in llm_override_parameters.items() if k in valid_grok_params and v is not None} #
            api_params.update(filtered_llm_params) #
        
        log_prefix = f"[GrokProvider(ModelUserCfg:'{self.get_user_defined_model_id()}', APIModel:'{api_params['model']}')]" #
        logger.debug(f"{log_prefix} 请求参数 (部分): system_prompt_applied={bool(current_final_system_prompt)}, messages_count={len(messages)}, other_params_keys={list(set(api_params.keys()) - {'model', 'messages'})}") #

        try:
            start_time_ns = time.perf_counter_ns() #
            response = await self.client.chat.completions.create(**api_params) # type: ignore[arg-type] #
            duration_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000 #
            logger.debug(f"{log_prefix} API 调用耗时: {duration_ms:.2f}ms") #

            if not response.choices or not response.choices[0].message or response.choices[0].message.content is None: #
                logger.warning(f"{log_prefix} Grok API 响应中 choices[0].message.content 为空或不存在。响应: {response.model_dump_json(indent=2)}") #
                if response.choices and response.choices[0].finish_reason == "content_filter": #
                    logger.error(f"{log_prefix} Grok 内容过滤器触发。") #
                    raise ContentSafetyException( #
                        message="Grok API 因内容过滤阻止了响应 (finish_reason: content_filter)。", #
                        provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(), #
                        details={"finish_reason": response.choices[0].finish_reason, "response_dump": response.model_dump(exclude_none=True)} #
                    )
                raise ValueError("Grok API 响应内容为空。") #

            generated_text = response.choices[0].message.content #
            
            token_usage_info = None #
            if response.usage: #
                token_usage_info = { #
                    "prompt_tokens": response.usage.prompt_tokens, #
                    "completion_tokens": response.usage.completion_tokens, #
                    "total_tokens": response.usage.total_tokens, #
                }
                logger.debug(f"{log_prefix} Token 使用情况: {token_usage_info}") #
            
            return LLMResponse(
                text=generated_text,
                model_id_used=self.get_user_defined_model_id(), 
                prompt_tokens=token_usage_info.get("prompt_tokens",0) if token_usage_info else 0,
                completion_tokens=token_usage_info.get("completion_tokens",0) if token_usage_info else 0,
                total_tokens=token_usage_info.get("total_tokens",0) if token_usage_info else 0,
                finish_reason=response.choices[0].finish_reason,
                error=None
            )
        except OpenAIAPIError as e: #
            error_text = e.message if hasattr(e, 'message') and e.message else str(e) #
            error_code_val = getattr(e, 'code', None) #
            error_message_full = f"Grok API (via OpenAI SDK) 错误 (模型用户ID: {self.get_user_defined_model_id()}, API模型: {self.get_model_identifier_for_api()}, HTTP Status: {e.status_code}, Code: {error_code_val}): {error_text}" #
            logger.error(f"{log_prefix} {error_message_full}", exc_info=False) #

            is_safety_err_flag = False #
            if error_code_val == 'content_filter': #
                is_safety_err_flag = True #
            elif any(keyword in error_text.lower() for keyword in ["safety", "blocked by grok filter", "policy violation"]): #
                 is_safety_err_flag = True #
            
            if is_safety_err_flag: #
                logger.error(f"{log_prefix} Grok API 错误指示内容安全问题。") #
                raise ContentSafetyException( #
                    message=error_text, #
                    provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(), #
                    details={"http_status": e.status_code, "code": error_code_val, "body": getattr(e, 'body', None), "type": getattr(e, 'type', None)} #
                )
            elif isinstance(e, RateLimitError): #
                 logger.warning(f"{log_prefix} Grok API 速率限制错误。将重新抛出。") #
                 raise #
            elif isinstance(e, (APIConnectionError, APITimeoutError)): #
                 logger.warning(f"{log_prefix} Grok API 连接或超时错误。将重新抛出。") #
                 raise #
            return LLMResponse(text="", model_id_used=self.get_user_defined_model_id(), prompt_tokens=0, completion_tokens=0, total_tokens=0, finish_reason="error", error=error_message_full)
        except Exception as e_generate_unknown: #
            logger.error(f"{log_prefix} 调用 Grok API generate 时发生未知错误: {e_generate_unknown}", exc_info=True) #
            return LLMResponse(text="", model_id_used=self.get_user_defined_model_id(), prompt_tokens=0, completion_tokens=0, total_tokens=0, finish_reason="error", error=f"调用 Grok 模型时发生未知错误: {str(e_generate_unknown)}")

    def get_model_capabilities(self) -> Dict[str, Any]: #
        base_capabilities = {
            "max_context_tokens": self.model_config.max_context_tokens,
            "supports_system_prompt": self.model_config.supports_system_prompt,
        }
        
        if base_capabilities["max_context_tokens"] is None: #
            model_api_id_lower = self.get_model_identifier_for_api().lower() #
            inferred_max_tokens = None #
            if "grok-3-mini" in model_api_id_lower: #
                inferred_max_tokens = 131072 #
            elif "grok-3" in model_api_id_lower and "mini" not in model_api_id_lower: #
                 inferred_max_tokens = 131072 #
            elif "grok-1.5-flash" in model_api_id_lower: #
                 inferred_max_tokens = 131072 #
            elif "grok-1.5" in model_api_id_lower: #
                 inferred_max_tokens = 131072 #
            elif "grok-1" in model_api_id_lower: #
                inferred_max_tokens = 8192 #
            
            if inferred_max_tokens is not None:
                base_capabilities["max_context_tokens"] = inferred_max_tokens
                logger.debug(f"GrokProvider for '{self.get_user_defined_model_id()}': 根据API模型ID '{model_api_id_lower}' 推断 max_context_tokens 为 {inferred_max_tokens} (因用户未配置)。") #
        
        if base_capabilities["supports_system_prompt"] is None: # 默认为True
             base_capabilities["supports_system_prompt"] = True

        return base_capabilities

    async def get_available_models_from_api(self) -> List[Dict[str, Any]]: #
        logger.info("GrokProvider.get_available_models_from_api: 返回已知的兼容模型列表 (硬编码)。用户应根据其权限和xAI官方文档手动配置。") #
        
        known_models_data = [ #
            { "id": "grok-3-mini", "name": "Grok 3 Mini", "max_context_tokens": 131072, "notes": "xAI 最新的速度优化模型。" }, #
            { "id": "grok-3", "name": "Grok 3", "max_context_tokens": 131072, "notes": "xAI 最新的高性能模型。" }, #
        ]
        
        formatted_models: List[Dict[str, Any]] = [] #
        for model_data in known_models_data: #
            formatted_models.append({ #
                "id": model_data["id"], #
                "name": model_data["name"], #
                "provider_tag": self.PROVIDER_TAG, #
                "max_context_tokens": model_data["max_context_tokens"], #
                "supports_system_prompt": True, #
                "notes": model_data.get("notes", "Grok (xAI) 模型。") #
            })
            
        return formatted_models #