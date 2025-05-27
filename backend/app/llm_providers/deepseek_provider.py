# backend/app/llm_providers/deepseek_provider.py
import logging
import os
import time
from typing import Dict, Any, Optional, Tuple, List, Union

# DeepSeek API 通常与 OpenAI API 兼容，因此也使用 openai SDK
try:
    from openai import AsyncOpenAI, APIError as OpenAIAPIError, RateLimitError, APIConnectionError, APITimeoutError
    OPENAI_SDK_FOR_DEEPSEEK_AVAILABLE = True
except ImportError:
    AsyncOpenAI = None # type: ignore
    OpenAIAPIError = None # type: ignore
    RateLimitError = None # type: ignore
    APIConnectionError = None # type: ignore
    APITimeoutError = None # type: ignore
    OPENAI_SDK_FOR_DEEPSEEK_AVAILABLE = False
    logging.warning("OpenAI SDK (用于DeepSeekProvider) 未安装。DeepSeekProvider 将不可用。请运行 'pip install openai'")

# 导入新的基类和响应模型
from .base_llm_provider import BaseLLMProvider, LLMResponse
# 导入类型化的配置模型和全局配置服务
from app import schemas, config_service

logger = logging.getLogger(__name__)

DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1" # DeepSeek 官方 API 地址

# 临时的 ContentSafetyException 定义。
# TODO: 此异常类应移至 app.llm_orchestrator 或 app.core.exceptions
class ContentSafetyException(RuntimeError):
    """自定义内容安全违规异常类"""
    def __init__(self, message: str, provider: Optional[str]=None, model_id: Optional[str]=None, details: Optional[Any]=None):
        self.original_message = message
        self.provider = provider
        self.model_id = model_id
        self.details = details
        full_message = f"内容安全异常 by Provider='{provider}', Model='{model_id}'. Message: '{message}'. Details: {details}"
        super().__init__(full_message)


class DeepSeekProvider(BaseLLMProvider):
    """
    DeepSeek LLM 提供商实现。
    使用 openai Python 库与 DeepSeek 的 OpenAI 兼容 API 进行交互。
    """
    PROVIDER_TAG = "deepseek"

    def __init__(
        self,
        model_config: schemas.UserDefinedLLMConfigSchema,
        provider_config: schemas.LLMProviderConfigSchema
    ):
        """
        初始化 DeepSeek API 的客户端。
        """
        super().__init__(model_config, provider_config)

        if not OPENAI_SDK_FOR_DEEPSEEK_AVAILABLE or AsyncOpenAI is None:
            logger.error("DeepSeekProvider 初始化失败：OpenAI SDK (用于DeepSeek) 不可用。")
            self.client = None
            self._sdk_ready = False
            return

        self._sdk_ready = True
        api_key_to_use = self.model_config.api_key
        if not api_key_to_use and self.model_config.api_key_is_from_env:
            api_key_to_use = os.getenv("DEEPSEEK_API_KEY")

        base_url_to_use = self.model_config.base_url if self.model_config.base_url is not None else DEFAULT_DEEPSEEK_BASE_URL

        if not api_key_to_use:
            logger.error("DeepSeekProvider 初始化失败：未提供 API 密钥（通过模型配置或 DEEPSEEK_API_KEY 环境变量）。")
            self.client = None
            self._sdk_ready = False
            return

        try:
            client_params: Dict[str, Any] = {
                "api_key": api_key_to_use,
                "base_url": base_url_to_use,
            }
            if self.provider_config.api_timeout_seconds is not None:
                client_params["timeout"] = self.provider_config.api_timeout_seconds
            if self.provider_config.max_retries is not None:
                client_params["max_retries"] = self.provider_config.max_retries
            else:
                client_params["max_retries"] = 1

            self.client: Optional[AsyncOpenAI] = AsyncOpenAI(**client_params)

            logger.info(f"DeepSeekProvider 客户端 (模型: {self.model_config.user_given_name}) 已成功初始化。Base URL: {base_url_to_use}")
        except Exception as e:
            logger.error(f"DeepSeekProvider 初始化客户端 (模型: {self.model_config.user_given_name}) 失败: {e}", exc_info=True)
            self.client = None
            self._sdk_ready = False

    def is_client_ready(self) -> bool:
        return bool(self._sdk_ready and self.client is not None)

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
        if not self.is_client_ready() or self.client is None:
            logger.error(f"DeepSeekProvider (模型: {self.model_config.user_given_name}) 错误：客户端未初始化。")
            return LLMResponse.as_error(
                model_id=self.get_user_defined_model_id(),
                error_message="DeepSeek客户端未初始化或未就绪"
            )

        final_system_prompt = system_prompt
        
        messages: List[Dict[str, str]] = []
        user_prompt_content = prompt # 将原始 prompt 赋值给一个新变量

        if final_system_prompt and self.model_config.supports_system_prompt:
            messages.append({"role": "system", "content": final_system_prompt})
        elif final_system_prompt: # 如果模型不支持独立系统提示，则合并
            logger.warning(
                f"模型 '{self.model_config.user_given_name}' 配置为不支持独立系统提示，"
                f"但调用时提供了系统提示。将尝试将其合并到用户提示中。"
            )
            # 安全地合并 system_prompt 和 user_prompt
            user_prompt_content = final_system_prompt + "\n\n---\n\n用户请求：\n" + prompt
        
        messages.append({"role": "user", "content": user_prompt_content}) # 使用更新后的 user_prompt_content

        global_llm_settings = config_service.get_config().llm_settings
        
        api_params: Dict[str, Any] = {
            "model": self.get_model_identifier_for_api(),
            "messages": messages,
            "temperature": temperature if temperature is not None else global_llm_settings.default_temperature,
        }

        effective_max_tokens = max_tokens
        if not effective_max_tokens and llm_override_parameters and llm_override_parameters.get("max_tokens") is not None:
            effective_max_tokens = llm_override_parameters.get("max_tokens")
        elif not effective_max_tokens and llm_override_parameters and llm_override_parameters.get("max_output_tokens") is not None:
            effective_max_tokens = llm_override_parameters.get("max_output_tokens")
        
        if not effective_max_tokens :
            effective_max_tokens = global_llm_settings.default_max_completion_tokens or 4096
        
        api_params["max_tokens"] = int(effective_max_tokens)

        if is_json_output:
            api_params["response_format"] = {"type": "json_object"}

        if llm_override_parameters:
            valid_deepseek_params = ["top_p", "frequency_penalty", "presence_penalty", "stop", "stream", "seed", "logprobs", "top_logprobs"]
            filtered_llm_params = {k: v for k, v in llm_override_parameters.items() if k in valid_deepseek_params and v is not None}
            api_params.update(filtered_llm_params)
        
        log_prefix = f"[DeepSeekProvider(Model:'{self.get_user_defined_model_id()}')]"
        logger.debug(f"{log_prefix} 请求参数 (部分): messages_count={len(messages)}, other_params_keys={list(set(api_params.keys()) - {'model', 'messages'})}")

        try:
            start_time_ns = time.perf_counter_ns()
            response = await self.client.chat.completions.create(**api_params) # type: ignore[arg-type]
            duration_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000
            logger.debug(f"{log_prefix} API 调用耗时: {duration_ms:.2f}ms")

            if not response.choices or not response.choices[0].message or response.choices[0].message.content is None:
                logger.warning(f"{log_prefix} DeepSeek API 响应中 choices[0].message.content 为空或不存在。响应: {response.model_dump_json(indent=2)}")
                raise ValueError("DeepSeek API 响应内容为空。")

            generated_text = response.choices[0].message.content
            
            token_usage_info = response.usage
            
            return LLMResponse(
                text=generated_text,
                model_id_used=self.get_user_defined_model_id(), 
                prompt_tokens=token_usage_info.prompt_tokens if token_usage_info else 0,
                completion_tokens=token_usage_info.completion_tokens if token_usage_info else 0,
                total_tokens=token_usage_info.total_tokens if token_usage_info else 0,
                finish_reason=response.choices[0].finish_reason,
                error=None
            )
        except OpenAIAPIError as e:
            error_text = e.message if hasattr(e, 'message') and e.message else str(e)
            error_code_val = getattr(e, 'code', None)
            error_message_full = f"DeepSeek API 错误 (HTTP Status: {e.status_code}, Code: {error_code_val}): {error_text}"
            logger.error(f"{log_prefix} {error_message_full}", exc_info=False)
            return LLMResponse.as_error(model_id=self.get_user_defined_model_id(), error_message=error_message_full)
        except Exception as e_generate_unknown:
            logger.error(f"{log_prefix} 调用 DeepSeek API generate 时发生未知错误: {e_generate_unknown}", exc_info=True)
            return LLMResponse.as_error(
                model_id=self.get_user_defined_model_id(),
                error_message=f"调用 DeepSeek 模型时发生未知错误: {str(e_generate_unknown)}"
            )

    def get_model_capabilities(self) -> Dict[str, Any]:
        base_capabilities = {
            "max_context_tokens": self.model_config.max_context_tokens,
            "supports_system_prompt": self.model_config.supports_system_prompt,
        }
        
        if base_capabilities["max_context_tokens"] is None:
            model_api_id_lower = self.get_model_identifier_for_api().lower()
            inferred_max_tokens = 16384 # 默认为 deepseek-chat 的上下文长度
            if "deepseek-coder" in model_api_id_lower:
                inferred_max_tokens = 16384
            
            base_capabilities["max_context_tokens"] = inferred_max_tokens
            logger.debug(f"DeepSeekProvider for '{self.get_user_defined_model_id()}': 根据API模型ID '{model_api_id_lower}' 推断 max_context_tokens 为 {inferred_max_tokens} (因用户未配置)。")
        
        if base_capabilities["supports_system_prompt"] is None: # 默认为True
             base_capabilities["supports_system_prompt"] = True

        return base_capabilities

    async def get_available_models_from_api(self) -> List[Dict[str, Any]]:
        log_prefix_list = f"[DeepSeekProvider(ListModels)]"
        
        client_instance_to_use: Optional[AsyncOpenAI] = self.client
        temp_client_created_for_listing = False

        if not self.is_client_ready() or client_instance_to_use is None:
            logger.warning(f"{log_prefix_list} 主客户端未就绪。尝试使用模型配置中的凭证创建临时客户端以列出模型。")
            temp_api_key_from_cfg = self.model_config.api_key or os.getenv("DEEPSEEK_API_KEY")
            temp_base_url_from_cfg = self.model_config.base_url or DEFAULT_DEEPSEEK_BASE_URL
            
            if not temp_api_key_from_cfg:
                logger.error(f"{log_prefix_list} 无法列出模型：未提供API密钥。")
                return []
            try:
                client_instance_to_use = AsyncOpenAI(api_key=temp_api_key_from_cfg, base_url=temp_base_url_from_cfg)
                temp_client_created_for_listing = True
            except Exception as e_temp_client_create:
                logger.error(f"{log_prefix_list} 创建临时DeepSeek客户端列出模型失败: {e_temp_client_create}")
                return []
        
        if client_instance_to_use is None:
            logger.error(f"{log_prefix_list} 无法确定用于列出模型的DeepSeek客户端实例。")
            return []

        try:
            models_response_obj = await client_instance_to_use.models.list()
            available_models_list: List[Dict[str, Any]] = []
            if models_response_obj and models_response_obj.data:
                for model_api_obj in models_response_obj.data:
                    model_info = {
                        "id": model_api_obj.id,
                        "name": model_api_obj.id, # 使用ID作为名称
                        "provider_tag": self.PROVIDER_TAG,
                        "notes": f"由DeepSeek API发现。Owner: {getattr(model_api_obj, 'owned_by', '未知')}",
                    }
                    available_models_list.append(model_info)
                logger.info(f"{log_prefix_list} 从 DeepSeek API 成功获取 {len(available_models_list)} 个可用模型信息。")
                return available_models_list
            else:
                logger.warning(f"{log_prefix_list} DeepSeek API models.list() 返回了空响应或无数据。")
                return []
        except OpenAIAPIError as e: # 捕获 OpenAI SDK 抛出的错误
            logger.error(f"{log_prefix_list} 从 DeepSeek API 获取可用模型列表失败: {e}")
            return []
        except Exception as e_generic:
            logger.error(f"{log_prefix_list} 获取 DeepSeek 可用模型列表时发生未知错误: {e_generic}", exc_info=True)
            return []
        finally:
            if temp_client_created_for_listing and client_instance_to_use and hasattr(client_instance_to_use, 'aclose'):
                try:
                    await client_instance_to_use.aclose()
                except Exception: pass