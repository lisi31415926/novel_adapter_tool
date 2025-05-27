# backend/app/llm_providers/openai_provider.py
import logging
import os
import time
from typing import Dict, Any, Optional, Tuple, List, Union

try:
    from openai import AsyncOpenAI, AsyncAzureOpenAI, APIError as OpenAIAPIError, RateLimitError, APIConnectionError, APITimeoutError, AuthenticationError as OpenAIAuthenticationError, BadRequestError as OpenAIBadRequestError
    OPENAI_SDK_AVAILABLE = True
except ImportError:
    AsyncOpenAI, AsyncAzureOpenAI = None, None # type: ignore
    OpenAIAPIError, RateLimitError, APIConnectionError, APITimeoutError, OpenAIAuthenticationError, OpenAIBadRequestError = (None,) * 6 # type: ignore
    OPENAI_SDK_AVAILABLE = False
    logging.warning("OpenAI SDK 未安装。OpenAIProvider 将不可用。请运行 'pip install openai'")

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
    ContentSafetyException as GlobalContentSafetyException
)


logger = logging.getLogger(__name__)

# 移除本地定义的 ContentSafetyException
# class ContentSafetyException(RuntimeError):
# ... (本地定义已移除)


class OpenAIProvider(BaseLLMProvider):
    """
    OpenAI LLM 提供商实现 (包括 Azure OpenAI)。
    """
    PROVIDER_TAG = "openai"

    def __init__(
        self,
        model_config: schemas.UserDefinedLLMConfigSchema,
        provider_config: schemas.LLMProviderConfigSchema
    ):
        super().__init__(model_config, provider_config)

        if not OPENAI_SDK_AVAILABLE or AsyncOpenAI is None or AsyncAzureOpenAI is None:
            logger.error("OpenAIProvider 初始化失败：OpenAI SDK 不可用。")
            self.client = None
            self._sdk_ready = False
            return

        self._sdk_ready = True
        self.is_azure = self.provider_config.is_azure or (self.model_config.base_url and "azure.com" in self.model_config.base_url)

        api_key_to_use = self.model_config.api_key
        if not api_key_to_use:
            env_key = "AZURE_OPENAI_API_KEY" if self.is_azure else "OPENAI_API_KEY"
            api_key_to_use = os.getenv(env_key)
            if api_key_to_use:
                logger.info(f"OpenAIProvider (模型: {self.model_config.user_given_name}): 从环境变量 {env_key} 加载了API密钥。")
            else:
                logger.error(f"OpenAIProvider ({'Azure' if self.is_azure else 'OpenAI'}) 初始化失败：未提供 API 密钥。")
                self.client = None
                self._sdk_ready = False
                return

        try:
            if self.is_azure:
                azure_endpoint = self.model_config.base_url or os.getenv("AZURE_OPENAI_ENDPOINT")
                api_version = self.provider_config.azure_api_version or os.getenv("AZURE_OPENAI_API_VERSION")
                
                if not azure_endpoint or not api_version:
                    logger.error("Azure OpenAI 初始化失败：必须提供 Azure Endpoint 和 API Version。")
                    self.client = None
                    self._sdk_ready = False
                    return

                self.client = AsyncAzureOpenAI(
                    api_key=api_key_to_use,
                    azure_endpoint=azure_endpoint,
                    api_version=api_version,
                    timeout=self.provider_config.api_timeout_seconds,
                    max_retries=self.provider_config.max_retries or 2
                )
                logger.info(f"Azure OpenAI 客户端 (模型: {self.model_config.user_given_name}) 已初始化。Endpoint: {azure_endpoint}")
            else: # 标准 OpenAI
                self.client = AsyncOpenAI(
                    api_key=api_key_to_use,
                    base_url=self.model_config.base_url, # 允许覆盖以用于代理
                    timeout=self.provider_config.api_timeout_seconds,
                    max_retries=self.provider_config.max_retries or 2
                )
                logger.info(f"OpenAI 客户端 (模型: {self.model_config.user_given_name}) 已初始化。Base URL: {self.model_config.base_url or '默认'}")

        except Exception as e:
            logger.error(f"OpenAIProvider 初始化客户端失败: {e}", exc_info=True)
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
            logger.error(f"OpenAIProvider (模型: {self.model_config.user_given_name}) 错误：客户端未初始化。")
            raise LLMConnectionError("OpenAI客户端未初始化或未就绪", provider=self.PROVIDER_TAG)

        messages: List[Dict[str, str]] = []
        if system_prompt and self.model_config.supports_system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        global_llm_settings = config_service.get_config().llm_settings
        
        # 对于 Azure，模型 ID 是部署名称 (deployment name)
        model_id_for_api = self.get_model_identifier_for_api()

        api_params: Dict[str, Any] = {
            "model": model_id_for_api,
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
            if "gpt-3.5-turbo-1106" in model_id_for_api or "gpt-4-1106-preview" in model_id_for_api or "gpt-4-turbo" in model_id_for_api:
                api_params["response_format"] = {"type": "json_object"}
            else:
                logger.warning(f"模型 '{model_id_for_api}' 可能不支持 JSON 模式。请在提示中明确要求 JSON 格式。")

        if llm_override_parameters:
            valid_params = ["top_p", "frequency_penalty", "presence_penalty", "stop", "seed", "logprobs", "top_logprobs"]
            filtered_params = {k: v for k, v in llm_override_parameters.items() if k in valid_params and v is not None}
            api_params.update(filtered_params)

        log_prefix = f"[{'Azure' if self.is_azure else 'OpenAI'}Provider(Model:'{self.get_user_defined_model_id()}')]"
        logger.debug(f"{log_prefix} 请求参数 (部分): messages_count={len(messages)}, other_params_keys={list(set(api_params.keys()) - {'model', 'messages'})}")

        prompt_tokens_for_safety_exc = 0
        completion_tokens_for_safety_exc = 0

        try:
            start_time_ns = time.perf_counter_ns()
            response = await self.client.chat.completions.create(**api_params) # type: ignore[arg-type]
            duration_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000
            logger.debug(f"{log_prefix} API 调用耗时: {duration_ms:.2f}ms")
            
            # --- Azure 内容安全处理 (在正常响应中检查) ---
            if self.is_azure and response.choices and response.choices[0].finish_reason == "content_filter":
                logger.error(f"{log_prefix} Azure 内容过滤器在响应中触发。")
                prompt_filter_results = response.prompt_filter_results
                finish_details = getattr(response.choices[0], 'finish_details', None) # 新版SDK可能有finish_details
                
                details_for_exc = {
                    "finish_reason": "content_filter",
                    "prompt_filter_results": [r.model_dump() for r in prompt_filter_results] if prompt_filter_results else None,
                    "finish_details": finish_details.model_dump() if finish_details else None
                }
                
                raise GlobalContentSafetyException(
                    message="Azure OpenAI 服务因内容过滤阻止了响应 (finish_reason: content_filter)。",
                    provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                    details=details_for_exc,
                    prompt_tokens=response.usage.prompt_tokens if response.usage else 0,
                    finish_reason="content_filter"
                )
            
            if not response.choices or not response.choices[0].message or response.choices[0].message.content is None:
                logger.warning(f"{log_prefix} OpenAI API 响应中 choices[0].message.content 为空或不存在。响应: {response.model_dump_json(indent=2)}")
                raise LLMAPIError("OpenAI API 响应内容为空。", provider=self.PROVIDER_TAG)

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

        except OpenAIAuthenticationError as e:
            error_message = f"OpenAI/Azure API 认证失败: {e.message if hasattr(e, 'message') else str(e)}"
            logger.error(f"{log_prefix} {error_message}", exc_info=False)
            raise LLMAuthenticationError(error_message, provider=self.PROVIDER_TAG) from e
        except RateLimitError as e:
            error_message = f"OpenAI/Azure API 速率限制错误: {e.message if hasattr(e, 'message') else str(e)}"
            logger.warning(f"{log_prefix} {error_message}")
            raise LLMRateLimitError(error_message, provider=self.PROVIDER_TAG) from e
        except APIConnectionError as e:
            error_message = f"OpenAI/Azure API 连接错误: {e.message if hasattr(e, 'message') else str(e)}"
            logger.warning(f"{log_prefix} {error_message}")
            raise LLMConnectionError(error_message, provider=self.PROVIDER_TAG) from e
        except APITimeoutError as e:
            error_message = f"OpenAI/Azure API 超时错误: {e.message if hasattr(e, 'message') else str(e)}"
            logger.warning(f"{log_prefix} {error_message}")
            raise LLMConnectionError(error_message, provider=self.PROVIDER_TAG) from e
        
        except OpenAIBadRequestError as e: # 捕获 400 错误，通常包含内容过滤信息
            error_code_from_api = getattr(e, 'code', None)
            error_message = e.message if hasattr(e, 'message') and e.message else str(e)

            # 标准 OpenAI 内容过滤 (通过 error code)
            is_safety_error_openai = (error_code_from_api == 'content_filter')
            
            # Azure 内容过滤 (通过 error message, status 400)
            is_safety_error_azure = (
                self.is_azure and
                e.status_code == 400 and
                "content management policy" in error_message.lower()
            )
            
            if is_safety_error_openai or is_safety_error_azure:
                logger.error(f"{log_prefix} OpenAI/Azure API 因内容安全策略在请求阶段阻止。Code: {error_code_from_api}")
                raise GlobalContentSafetyException(
                    message=error_message,
                    provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                    details={"http_status": e.status_code, "code": error_code_from_api, "body": getattr(e, 'body', None)},
                    prompt_tokens=prompt_tokens_for_safety_exc,
                    finish_reason="content_filter"
                ) from e
            else: # 其他 400 Bad Request 错误
                error_message_full = f"OpenAI/Azure API 请求无效 (HTTP Status: {e.status_code}, Code: {error_code_from_api}): {error_message}"
                logger.error(f"{log_prefix} {error_message_full}", exc_info=False)
                raise LLMAPIError(error_message_full, provider=self.PROVIDER_TAG) from e

        except OpenAIAPIError as e_api: # 捕获其他所有 OpenAI API 错误
            error_text = e_api.message if hasattr(e_api, 'message') and e_api.message else str(e_api)
            error_code = getattr(e_api, 'code', None)
            error_message_full = f"OpenAI/Azure API 通用错误 (HTTP Status: {e_api.status_code}, Code: {error_code}): {error_text}"
            logger.error(f"{log_prefix} {error_message_full}", exc_info=False)
            raise LLMAPIError(error_message_full, provider=self.PROVIDER_TAG) from e_api

        except Exception as e_generate_unknown:
            logger.error(f"{log_prefix} 调用 OpenAI API generate 时发生未知错误: {e_generate_unknown}", exc_info=True)
            raise LLMAPIError(f"调用 OpenAI/Azure 模型时发生未知错误: {str(e_generate_unknown)}", provider=self.PROVIDER_TAG) from e_generate_unknown

    def get_model_capabilities(self) -> Dict[str, Any]:
        return {
            "max_context_tokens": self.model_config.max_context_tokens or 8192,
            "supports_system_prompt": self.model_config.supports_system_prompt if self.model_config.supports_system_prompt is not None else True,
        }

    async def get_available_models_from_api(self) -> List[Dict[str, Any]]:
        # Azure 不支持列出模型，它使用“部署”
        if self.is_azure:
            logger.info("OpenAIProvider (Azure): list_models 不适用于 Azure。请在配置中手动添加部署名称作为模型。")
            return []

        log_prefix_list = "[OpenAIProvider(ListModels)]"
        if not self.is_client_ready() or not self.client:
            logger.warning(f"{log_prefix_list} 客户端未就绪，无法从API列出模型。")
            return []
        
        try:
            models_response = await self.client.models.list()
            available_models: List[Dict[str, Any]] = []
            if models_response and models_response.data:
                for model_obj in models_response.data:
                    # 过滤掉非 gpt 模型和旧模型
                    if "gpt" in model_obj.id and "instruct" not in model_obj.id:
                        available_models.append({
                            "id": model_obj.id,
                            "name": model_obj.id,
                            "provider_tag": self.PROVIDER_TAG,
                            "notes": f"由 OpenAI API 提供。Owner: {getattr(model_obj, 'owned_by', 'OpenAI')}",
                        })
                logger.info(f"{log_prefix_list} 从 OpenAI API 成功获取 {len(available_models)} 个可用模型。")
                return sorted(available_models, key=lambda x: x['id'], reverse=True)
            else:
                logger.warning(f"{log_prefix_list} OpenAI API models.list() 返回了空响应或无数据。")
                return []
        except OpenAIAPIError as e:
            logger.error(f"{log_prefix_list} 从 OpenAI API 获取模型列表失败: {e}")
            return []
        except Exception as e_generic:
            logger.error(f"{log_prefix_list} 获取 OpenAI 模型列表时发生未知错误: {e_generic}", exc_info=True)
            return []

    async def test_connection(
        self,
        model_api_id_for_test: Optional[str] = None,
    ) -> Tuple[bool, str, Optional[List[str]]]:
        if not self.is_client_ready() or self.client is None:
            return False, "OpenAI/Azure 客户端未初始化或SDK不可用。", ["请检查依赖库 openai 是否已正确安装和配置。"]

        test_model_id = model_api_id_for_test or self.provider_config.default_test_model_id or self.get_model_identifier_for_api()
        if not test_model_id:
            return False, "无法确定用于测试的 OpenAI/Azure 模型ID/部署名。", ["请在配置中指定 default_test_model_id 或确保当前模型配置了 model_identifier_for_api。"]

        logger.info(f"[OpenAI-TestConnection] 开始测试连接，使用模型: {test_model_id}")
        test_messages: List[Dict[str, Any]] = [{"role": "user", "content": "Hi"}]
        test_api_params: Dict[str, Any] = {
            "model": test_model_id, "messages": test_messages, "max_tokens": 5, "temperature": 0.1,
        }
        try:
            response = await self.client.chat.completions.create(**test_api_params) # type: ignore[arg-type]
            if response.choices and response.choices[0].message and response.choices[0].message.content:
                msg = f"成功连接到 {'Azure' if self.is_azure else 'OpenAI'} 并从模型/部署 '{test_model_id}' 收到响应。"
                details = [f"响应预览: {response.choices[0].message.content[:100]}..."]
                logger.info(f"[OpenAI-TestConnection] {msg}")
                return True, msg, details
            else:
                msg = f"连接到 {'Azure' if self.is_azure else 'OpenAI'} 模型 '{test_model_id}' 成功，但返回了空响应。"
                details = [f"原始响应对象: {str(response)[:200]}..."]
                logger.warning(f"[OpenAI-TestConnection] {msg}")
                return False, msg, details

        except OpenAIAuthenticationError as e_auth:
            msg = f"{'Azure' if self.is_azure else 'OpenAI'} API认证失败。"
            details = [f"请检查您的API密钥是否正确并具有访问模型/部署 '{test_model_id}' 的权限。", f"错误详情: {str(e_auth)[:200]}"]
            logger.error(f"[OpenAI-TestConnection] {msg} (模型: {test_model_id}): {e_auth}", exc_info=False)
            return False, msg, details
        except RateLimitError as e_rate:
            msg = f"{'Azure' if self.is_azure else 'OpenAI'} API速率限制。"
            details = [f"请稍后再试或检查您的API使用限制。", f"错误详情: {str(e_rate)[:200]}"]
            logger.warning(f"[OpenAI-TestConnection] {msg} (模型: {test_model_id}): {e_rate}")
            return False, msg, details
        except (APIConnectionError, APITimeoutError) as e_conn:
            msg = f"无法连接到 {'Azure' if self.is_azure else 'OpenAI'} API或请求超时。"
            details = [f"请检查您的网络连接、Endpoint/Base URL配置和API服务状态。", f"错误详情: {str(e_conn)[:200]}"]
            logger.error(f"[OpenAI-TestConnection] {msg} (模型: {test_model_id}): {e_conn}", exc_info=False)
            return False, msg, details
        except OpenAIAPIError as e_api:
            msg = f"调用 {'Azure' if self.is_azure else 'OpenAI'} API时发生错误 (模型: {test_model_id})。"
            details = [f"状态码: {getattr(e_api, 'status_code', 'N/A')}", f"错误码: {getattr(e_api, 'code', 'N/A')}", f"错误消息: {str(e_api)[:200]}"]
            logger.error(f"[OpenAI-TestConnection] {msg} (HTTP: {getattr(e_api, 'status_code', 'N/A')}, Code: {getattr(e_api, 'code', 'N/A')}): {e_api}", exc_info=True)
            return False, msg, details
        except Exception as e_unknown:
            msg = f"测试 {'Azure' if self.is_azure else 'OpenAI'} 连接时发生未知错误。"
            details = [f"错误详情: {str(e_unknown)[:200]}"]
            logger.error(f"[OpenAI-TestConnection] {msg} (模型: {test_model_id}): {e_unknown}", exc_info=True)
            return False, msg, details