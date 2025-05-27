# backend/app/llm_providers/grok_provider.py
import logging
import os
import time
from typing import Dict, Any, Optional, Tuple, List, Union

# Grok API 与 OpenAI API 兼容，因此使用 openai SDK
try:
    from openai import AsyncOpenAI, APIError as OpenAIAPIError, RateLimitError, APIConnectionError, APITimeoutError, AuthenticationError as OpenAIAuthenticationError, BadRequestError as OpenAIBadRequestError
    OPENAI_SDK_FOR_GROK_AVAILABLE = True
except ImportError:
    AsyncOpenAI = None # type: ignore
    OpenAIAPIError = None # type: ignore
    RateLimitError = None # type: ignore
    APIConnectionError = None # type: ignore
    APITimeoutError = None # type: ignore
    OpenAIAuthenticationError = None # type: ignore
    OpenAIBadRequestError = None # type: ignore
    OPENAI_SDK_FOR_GROK_AVAILABLE = False
    logging.warning("OpenAI SDK (用于GrokProvider) 未安装。GrokProvider 将不可用。请运行 'pip install openai'")

# 导入新的基类和响应模型
from .base_llm_provider import BaseLLMProvider, LLMResponse
# 导入类型化的配置模型和全局配置服务
from app import schemas, config_service

# 从 app.exceptions 导入统一的异常类
from app.exceptions import (
    LLMAPIError,
    LLMAuthenticationError,
    LLMConnectionError,
    LLMRateLimitError,
    ContentSafetyException as GlobalContentSafetyException # 使用别名
)


logger = logging.getLogger(__name__)

DEFAULT_GROK_BASE_URL = "https://api.groq.com/openai/v1" # Groq (注意是'q') 官方 API 地址

# 移除本地定义的 ContentSafetyException
# class ContentSafetyException(RuntimeError):
# ... (本地定义已移除)

class GrokProvider(BaseLLMProvider):
    """
    Grok (由 Groq 提供) LLM 提供商实现。
    使用 openai Python 库与 Groq 的 OpenAI 兼容 API 进行交互。
    """
    PROVIDER_TAG = "grok" # 注意：这里指 xAI 的 Grok 模型，但通过 Groq API 访问

    def __init__(
        self,
        model_config: schemas.UserDefinedLLMConfigSchema,
        provider_config: schemas.LLMProviderConfigSchema
    ):
        """
        初始化 Groq API 的客户端。
        """
        super().__init__(model_config, provider_config)

        if not OPENAI_SDK_FOR_GROK_AVAILABLE or AsyncOpenAI is None:
            logger.error("GrokProvider 初始化失败：OpenAI SDK (用于Grok) 不可用。")
            self.client = None
            self._sdk_ready = False
            return

        self._sdk_ready = True
        api_key_to_use = self.model_config.api_key

        if not api_key_to_use:
            # Groq 使用 GROQ_API_KEY 环境变量
            env_api_key = os.getenv("GROQ_API_KEY")
            if env_api_key:
                api_key_to_use = env_api_key
                logger.info(f"GrokProvider (模型: {self.model_config.user_given_name}): 从环境变量 GROQ_API_KEY 加载了API密钥。")
            else:
                logger.error(f"GrokProvider 初始化失败：未提供 API 密钥（通过模型配置或 GROQ_API_KEY 环境变量）。")
                self.client = None
                self._sdk_ready = False
                return
        
        # Groq API 的 base_url 是固定的，但允许用户覆盖以用于代理
        base_url_to_use = self.model_config.base_url if self.model_config.base_url is not None else DEFAULT_GROK_BASE_URL

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
                client_params["max_retries"] = 1 # Groq API 速度快，默认重试1次

            self.client: Optional[AsyncOpenAI] = AsyncOpenAI(**client_params)
            logger.info(f"GrokProvider 客户端 (模型: {self.model_config.user_given_name}) 已成功初始化。Base URL: {base_url_to_use}")

        except Exception as e:
            logger.error(f"GrokProvider 初始化客户端 (模型: {self.model_config.user_given_name}) 失败: {e}", exc_info=True)
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
            logger.error(f"GrokProvider (模型: {self.model_config.user_given_name}) 错误：客户端未初始化。")
            raise LLMConnectionError("Grok客户端未初始化或未就绪", provider=self.PROVIDER_TAG)

        messages: List[Dict[str, str]] = []
        if system_prompt and self.model_config.supports_system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        global_llm_settings = config_service.get_config().llm_settings
        
        api_params: Dict[str, Any] = {
            "model": self.get_model_identifier_for_api(),
            "messages": messages,
        }

        final_temp = temperature if temperature is not None else global_llm_settings.default_temperature
        if final_temp is not None: api_params["temperature"] = final_temp

        final_max_tokens = max_tokens
        if llm_override_parameters and llm_override_parameters.get("max_tokens"):
             final_max_tokens = llm_override_parameters.get("max_tokens")
        elif max_tokens is None:
            final_max_tokens = global_llm_settings.default_max_completion_tokens
        
        if final_max_tokens is not None: api_params["max_tokens"] = final_max_tokens

        if is_json_output:
            api_params["response_format"] = {"type": "json_object"}
            logger.debug(f"为Grok模型 '{self.get_model_identifier_for_api()}' 启用了JSON输出模式。")

        if llm_override_parameters:
            valid_grok_params = ["top_p", "stop", "stream", "seed"]
            filtered_llm_params = {k: v for k, v in llm_override_parameters.items() if k in valid_grok_params and v is not None}
            api_params.update(filtered_llm_params)

        log_prefix = f"[GrokProvider(Model:'{self.get_user_defined_model_id()}')]"
        logger.debug(f"{log_prefix} 请求参数 (部分): messages_count={len(messages)}, other_params_keys={list(set(api_params.keys()) - {'model', 'messages'})}")
        
        prompt_tokens_for_safety_exc = 0
        completion_tokens_for_safety_exc = 0

        try:
            start_time_ns = time.perf_counter_ns()
            response = await self.client.chat.completions.create(**api_params) # type: ignore[arg-type]
            duration_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000
            logger.info(f"{log_prefix} Groq API 调用耗时: {duration_ms:.2f}ms")

            if not response.choices or not response.choices[0].message or response.choices[0].message.content is None:
                logger.warning(f"{log_prefix} Groq API 响应中 choices[0].message.content 为空或不存在。响应: {response.model_dump_json(indent=2)}")
                if response.choices and response.choices[0].finish_reason == "content_filter":
                     logger.error(f"{log_prefix} Groq 内容过滤器触发。")
                     raise GlobalContentSafetyException(
                        message="Groq API 因内容过滤阻止了响应 (finish_reason: content_filter)。",
                        provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                        details={"finish_reason": "content_filter", "response_dump": response.model_dump(exclude_none=True)},
                        prompt_tokens=response.usage.prompt_tokens if response.usage else 0,
                        finish_reason="content_filter"
                     )
                raise LLMAPIError("Groq API 响应内容为空。", provider=self.PROVIDER_TAG)

            generated_text = response.choices[0].message.content
            
            token_usage_info = response.usage
            if token_usage_info:
                prompt_tokens_for_safety_exc = token_usage_info.prompt_tokens
                completion_tokens_for_safety_exc = token_usage_info.completion_tokens
            
            return LLMResponse(
                text=generated_text,
                model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=token_usage_info.prompt_tokens if token_usage_info else 0,
                completion_tokens=token_usage_info.completion_tokens if token_usage_info else 0,
                total_tokens=token_usage_info.total_tokens if token_usage_info else 0,
                finish_reason=response.choices[0].finish_reason,
                error=None
            )
        # Map OpenAI SDK exceptions to custom LLM exceptions
        except OpenAIAuthenticationError as e:
            error_message = f"Grok API 认证失败: {e.message if hasattr(e, 'message') else str(e)}"
            logger.error(f"{log_prefix} {error_message}", exc_info=False)
            raise LLMAuthenticationError(error_message, provider=self.PROVIDER_TAG) from e
        except RateLimitError as e:
            error_message = f"Grok API 速率限制错误: {e.message if hasattr(e, 'message') else str(e)}"
            logger.warning(f"{log_prefix} {error_message}")
            raise LLMRateLimitError(error_message, provider=self.PROVIDER_TAG) from e
        except APIConnectionError as e:
            error_message = f"Grok API 连接错误: {e.message if hasattr(e, 'message') else str(e)}"
            logger.warning(f"{log_prefix} {error_message}")
            raise LLMConnectionError(error_message, provider=self.PROVIDER_TAG) from e
        except APITimeoutError as e:
            error_message = f"Grok API 超时错误: {e.message if hasattr(e, 'message') else str(e)}"
            logger.warning(f"{log_prefix} {error_message}")
            raise LLMConnectionError(error_message, provider=self.PROVIDER_TAG) from e
        except OpenAIBadRequestError as e: # Catches 400 errors
            error_text = e.message if hasattr(e, 'message') and e.message else str(e)
            error_code_val = getattr(e, 'code', None)
            
            is_safety_error = False
            if error_code_val == 'content_filter' or any(keyword in error_text.lower() for keyword in ["safety policy", "content blocked"]):
                is_safety_error = True
            
            if is_safety_error:
                logger.error(f"{log_prefix} Groq API 错误指示内容安全问题 (Code: {error_code_val})。")
                raise GlobalContentSafetyException(
                    message=error_text,
                    provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                    details={"http_status": e.status_code, "code": error_code_val, "body": getattr(e, 'body', None)},
                    prompt_tokens=prompt_tokens_for_safety_exc,
                    finish_reason="content_filter"
                ) from e
            else:
                error_message_full = f"Grok API 请求无效 (HTTP Status: {e.status_code}, Code: {error_code_val}): {error_text}"
                logger.error(f"{log_prefix} {error_message_full}", exc_info=False)
                raise LLMAPIError(error_message_full, provider=self.PROVIDER_TAG) from e
        except OpenAIAPIError as e:
            error_text = e.message if hasattr(e, 'message') and e.message else str(e)
            error_code_val = getattr(e, 'code', None)
            error_message_full = f"Grok API 通用错误 (HTTP Status: {e.status_code}, Code: {error_code_val}): {error_text}"
            logger.error(f"{log_prefix} {error_message_full}", exc_info=False)
            raise LLMAPIError(error_message_full, provider=self.PROVIDER_TAG) from e
        except Exception as e_generate_unknown:
            logger.error(f"{log_prefix} 调用 Grok API generate 时发生未知错误: {e_generate_unknown}", exc_info=True)
            raise LLMAPIError(f"调用 Grok 模型时发生未知错误: {str(e_generate_unknown)}", provider=self.PROVIDER_TAG) from e_generate_unknown

    def get_model_capabilities(self) -> Dict[str, Any]:
        base_capabilities = {
            "max_context_tokens": self.model_config.max_context_tokens,
            "supports_system_prompt": self.model_config.supports_system_prompt,
        }
        
        if base_capabilities["max_context_tokens"] is None:
            model_api_id_lower = self.get_model_identifier_for_api().lower()
            inferred_max_tokens = 8192 # Llama3-8b 和 Mixtral 的默认值
            if "llama3-70b" in model_api_id_lower: inferred_max_tokens = 8192
            elif "gemma" in model_api_id_lower: inferred_max_tokens = 8192
            
            base_capabilities["max_context_tokens"] = inferred_max_tokens
            logger.debug(f"GrokProvider for '{self.get_user_defined_model_id()}': 推断 max_context_tokens 为 {inferred_max_tokens} (因用户未配置)。")
        
        if base_capabilities["supports_system_prompt"] is None:
            base_capabilities["supports_system_prompt"] = True # Groq 上的模型通常支持 system prompt

        return base_capabilities

    async def get_available_models_from_api(self) -> List[Dict[str, Any]]:
        log_prefix_list = f"[GrokProvider(ListModels)]"
        client_to_use = self.client
        if not self.is_client_ready() or not client_to_use:
            logger.warning(f"{log_prefix_list} 主客户端未就绪，无法从API列出模型。")
            return []

        try:
            models_response = await client_to_use.models.list()
            available_models: List[Dict[str, Any]] = []
            if models_response and models_response.data:
                for model_obj in models_response.data:
                    available_models.append({
                        "id": model_obj.id,
                        "name": model_obj.id,
                        "provider_tag": self.PROVIDER_TAG,
                        "notes": f"由 Groq API 提供。Owner: {getattr(model_obj, 'owned_by', 'Groq')}",
                    })
                logger.info(f"{log_prefix_list} 从 Groq API 成功获取 {len(available_models)} 个可用模型。")
                return available_models
            else:
                logger.warning(f"{log_prefix_list} Groq API models.list() 返回了空响应或无数据。")
                return []
        except OpenAIAPIError as e:
            logger.error(f"{log_prefix_list} 从 Groq API 获取模型列表失败: {e}")
            return []
        except Exception as e_generic:
            logger.error(f"{log_prefix_list} 获取 Groq 模型列表时发生未知错误: {e_generic}", exc_info=True)
            return []

    async def test_connection(
        self,
        model_api_id_for_test: Optional[str] = None,
    ) -> Tuple[bool, str, Optional[List[str]]]:
        if not self.is_client_ready() or self.client is None:
            return False, "Grok (Groq) 客户端未初始化或SDK不可用。", ["请检查依赖库 openai 是否已正确安装和配置。"]

        test_model_id = model_api_id_for_test or self.provider_config.default_test_model_id or self.get_model_identifier_for_api()
        if not test_model_id:
            return False, "无法确定用于测试的Grok模型ID。", ["请在配置中指定 default_test_model_id 或确保当前模型配置了 model_identifier_for_api。"]

        logger.info(f"[Grok-TestConnection] 开始测试连接，使用模型: {test_model_id}")
        test_messages: List[Dict[str, Any]] = [{"role": "user", "content": "Hello. Are you operational?"}]
        test_api_params: Dict[str, Any] = {
            "model": test_model_id, "messages": test_messages, "max_tokens": 10, "temperature": 0.1,
        }
        try:
            response = await self.client.chat.completions.create(**test_api_params) # type: ignore[arg-type]
            if response.choices and response.choices[0].message and response.choices[0].message.content:
                logger.info(f"[Grok-TestConnection] 连接成功。模型响应 (预览): {response.choices[0].message.content[:50]}...")
                return True, f"成功连接到Grok (Groq) 并从模型 {test_model_id} 收到响应。", [f"响应预览: {response.choices[0].message.content[:100]}..."]
            else:
                logger.warning(f"[Grok-TestConnection] 连接测试：模型 {test_model_id} 返回了空内容。")
                return False, f"连接到Grok (Groq) 模型 {test_model_id} 成功，但模型返回了空响应。", [f"原始响应对象: {str(response)[:200]}..."]

        except OpenAIAuthenticationError as e_auth:
            logger.error(f"[Grok-TestConnection] 认证失败 (模型: {test_model_id}): {e_auth}", exc_info=False)
            return False, "Grok (Groq) API认证失败。", [f"请检查您的 GROQ_API_KEY 是否正确并具有访问模型 {test_model_id} 的权限。", f"错误详情: {str(e_auth)[:200]}"]
        except RateLimitError as e_rate:
            logger.warning(f"[Grok-TestConnection] 遭遇速率限制 (模型: {test_model_id}): {e_rate}")
            return False, "Grok (Groq) API速率限制。", [f"请稍后再试或检查您的API使用限制。", f"错误详情: {str(e_rate)[:200]}"]
        except (APIConnectionError, APITimeoutError) as e_conn:
            logger.error(f"[Grok-TestConnection] 连接或超时错误 (模型: {test_model_id}): {e_conn}", exc_info=False)
            return False, "无法连接到Grok (Groq) API或请求超时。", [f"请检查您的网络连接和Groq服务状态。", f"错误详情: {str(e_conn)[:200]}"]
        except OpenAIAPIError as e_api:
            status_code = getattr(e_api, 'status_code', 'N/A')
            error_code = getattr(e_api, 'code', 'N/A')
            logger.error(f"[Grok-TestConnection] API调用时发生错误 (模型: {test_model_id}, HTTP: {status_code}, Code: {error_code}): {e_api}", exc_info=True)
            details = [f"状态码: {status_code}", f"错误码: {error_code}", f"错误消息: {str(e_api)[:200]}"]
            return False, f"调用Grok (Groq) API时发生错误 (模型: {test_model_id})。", details
        except Exception as e_unknown:
            logger.error(f"[Grok-TestConnection] 测试连接时发生未知错误 (模型: {test_model_id}): {e_unknown}", exc_info=True)
            return False, "测试Grok (Groq) 连接时发生未知错误。", [f"错误详情: {str(e_unknown)[:200]}"]