# backend/app/llm_providers/anthropic_provider.py
import logging
import os
import time
from typing import Dict, Any, Optional, Tuple, List, Union

# Anthropic SDK
try:
    from anthropic import AsyncAnthropic, APIError as AnthropicAPIError, RateLimitError, APIConnectionError, APITimeoutError, AuthenticationError as AnthropicAuthenticationError, BadRequestError as AnthropicBadRequestError
    ANTHROPIC_SDK_AVAILABLE = True
except ImportError:
    AsyncAnthropic = None # type: ignore
    AnthropicAPIError = None # type: ignore
    RateLimitError = None # type: ignore
    APIConnectionError = None # type: ignore
    APITimeoutError = None # type: ignore
    AnthropicAuthenticationError = None # type: ignore
    AnthropicBadRequestError = None # type: ignore
    ANTHROPIC_SDK_AVAILABLE = False
    logging.warning("Anthropic SDK 未安装。AnthropicProvider 将不可用。请运行 'pip install anthropic'")

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
    ContentSafetyException as GlobalContentSafetyException # 使用别名以避免与下面可能存在的同名变量冲突
)

logger = logging.getLogger(__name__)

# 移除本地定义的 ContentSafetyException
# class ContentSafetyException(RuntimeError): #
#     """自定义内容安全违规异常类"""
# ... (本地定义已移除)


class AnthropicProvider(BaseLLMProvider):
    """
    Anthropic LLM 提供商实现 (Claude 模型)。
    """
    PROVIDER_TAG = "anthropic_claude" # 与 config.json 和 __init__.py 一致

    def __init__(
        self,
        model_config: schemas.UserDefinedLLMConfigSchema,
        provider_config: schemas.LLMProviderConfigSchema
    ):
        """
        初始化 AnthropicProvider。
        """
        super().__init__(model_config, provider_config) #

        if not ANTHROPIC_SDK_AVAILABLE or AsyncAnthropic is None: #
            logger.error("AnthropicProvider 初始化失败：Anthropic SDK 不可用。") #
            self.client = None
            self._sdk_ready = False
            return

        self._sdk_ready = True
        api_key_to_use = self.model_config.api_key
        # 根据 api_key_is_from_env 标志和 config.json 的 api_key_source 决定如何处理
        # 您的 config_service 和 LLMOrchestrator 应该已经处理了 api_key 的最终确定。
        # 这里直接使用 model_config.api_key。

        if not api_key_to_use: #
            env_api_key = os.getenv("ANTHROPIC_API_KEY")
            if env_api_key:
                api_key_to_use = env_api_key
                logger.info(f"AnthropicProvider (模型: {self.model_config.user_given_name}): 从环境变量 ANTHROPIC_API_KEY 加载了API密钥。")
            else:
                logger.error(f"AnthropicProvider (模型: {self.model_config.user_given_name}) 初始化失败：未提供 API 密钥。") #
                self.client = None
                self._sdk_ready = False
                return

        base_url_to_use = self.model_config.base_url # Anthropic SDK 可能不直接支持 base_url 覆盖，但保留以备将来或代理情况

        try:
            client_params: Dict[str, Any] = { #
                "api_key": api_key_to_use, #
            }
            if base_url_to_use: #
                client_params["base_url"] = base_url_to_use #
                logger.info(f"AnthropicProvider 将使用自定义基础URL: {base_url_to_use}") #
            
            if self.provider_config.api_timeout_seconds is not None: #
                client_params["timeout"] = self.provider_config.api_timeout_seconds # Anthropic SDK 支持 timeout
            if self.provider_config.max_retries is not None: #
                client_params["max_retries"] = self.provider_config.max_retries # Anthropic SDK 支持 max_retries
            else: #
                client_params["max_retries"] = 2 # SDK 默认值

            self.client: Optional[AsyncAnthropic] = AsyncAnthropic(**client_params) # type: ignore #
            logger.info(f"AnthropicProvider 客户端 (模型配置: {self.model_config.user_given_name}) 已成功初始化。Timeout: {client_params.get('timeout')}, Max Retries: {client_params.get('max_retries')}.") #
        except Exception as e:
            logger.error(f"AnthropicProvider 初始化 AsyncAnthropic 客户端 (模型配置: {self.model_config.user_given_name}) 失败: {e}", exc_info=True) #
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
            logger.error(f"AnthropicProvider (模型: {self.model_config.user_given_name}) 错误：客户端未初始化。") #
            # 根据新的错误处理策略，这里应该抛出异常而不是返回LLMResponse
            raise LLMConnectionError("Anthropic客户端未初始化或未就绪", provider=self.PROVIDER_TAG)

        messages_for_api: List[Dict[str, Any]] = [{"role": "user", "content": prompt}]
        global_llm_settings = config_service.get_config().llm_settings
        api_params: Dict[str, Any] = {
            "model": self.get_model_identifier_for_api(),
            "messages": messages_for_api,
            "max_tokens": 1024, # Default, will be overridden
        }

        if system_prompt and self.model_config.supports_system_prompt:
            api_params["system"] = system_prompt
        elif system_prompt:
             logger.warning(f"模型 '{self.model_config.user_given_name}' (Anthropic) 可能不通过顶层 'system' 参数支持系统提示，或此配置禁用。将尝试合并。")

        if temperature is not None:
            api_params["temperature"] = float(temperature)
        elif global_llm_settings.default_temperature is not None:
            api_params["temperature"] = float(global_llm_settings.default_temperature)
        
        effective_max_tokens = max_tokens
        if llm_override_parameters:
            if llm_override_parameters.get("max_tokens") is not None:
                effective_max_tokens = int(llm_override_parameters["max_tokens"])
            elif llm_override_parameters.get("max_tokens_to_sample") is not None:
                effective_max_tokens = int(llm_override_parameters["max_tokens_to_sample"])
            elif "max_output_tokens" in llm_override_parameters and llm_override_parameters["max_output_tokens"] is not None:
                effective_max_tokens = int(llm_override_parameters["max_output_tokens"])
        
        if effective_max_tokens is None:
            effective_max_tokens = global_llm_settings.default_max_completion_tokens
        
        if effective_max_tokens is None or effective_max_tokens <= 0:
            logger.warning(f"Anthropic API 调用缺少有效的 'max_tokens'。将使用默认值 1024。llm_params: {llm_override_parameters}")
            api_params["max_tokens"] = 1024
        else:
            api_params["max_tokens"] = int(effective_max_tokens)

        if llm_override_parameters:
            if "top_p" in llm_override_parameters and llm_override_parameters["top_p"] is not None:
                api_params["top_p"] = float(llm_override_parameters["top_p"])
            if "top_k" in llm_override_parameters and llm_override_parameters["top_k"] is not None:
                api_params["top_k"] = int(llm_override_parameters["top_k"])
            if "stop_sequences" in llm_override_parameters and llm_override_parameters["stop_sequences"] is not None:
                stop_seq = llm_override_parameters["stop_sequences"]
                if isinstance(stop_seq, list) and all(isinstance(s, str) for s in stop_seq):
                    api_params["stop_sequences"] = stop_seq
                elif isinstance(stop_seq, str):
                     api_params["stop_sequences"] = [stop_seq]
        
        if is_json_output:
            logger.info(f"AnthropicProvider: is_json_output is True. 建议在提示中明确要求JSON格式。")

        log_prefix = f"[AnthropicProvider(ModelUserCfg:'{self.get_user_defined_model_id()}', APIModel:'{api_params['model']}')]"
        logger.debug(f"{log_prefix} 请求参数 (部分): model='{api_params.get('model')}', system_prompt_set={bool(api_params.get('system'))}, messages_count={len(messages_for_api)}, other_params_keys={list(set(api_params.keys()) - {'model', 'messages', 'system'})}")

        prompt_tokens_for_safety_exc = 0 # Placeholder for safety exception
        completion_tokens_for_safety_exc = 0 # Placeholder

        try:
            start_time_ns = time.perf_counter_ns()
            response = await self.client.messages.create(**api_params) # type: ignore[arg-type]
            duration_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000
            logger.debug(f"{log_prefix} API 调用耗时: {duration_ms:.2f}ms")

            generated_text = ""
            if response.content and isinstance(response.content, list) and len(response.content) > 0:
                first_content_block = response.content[0]
                if hasattr(first_content_block, 'text'):
                    generated_text = first_content_block.text
            
            if not generated_text.strip() and response.stop_reason not in ["end_turn", "stop_sequence"]:
                logger.warning(f"{log_prefix} Anthropic API 响应中 content[0].text 为空或不存在，且停止原因异常。Stop Reason: {response.stop_reason}. Response: {response.model_dump_json(indent=2)}")
                if response.stop_reason == "max_tokens":
                    pass
                raise LLMAPIError(f"Anthropic API 响应内容为空或非预期停止原因: {response.stop_reason}", provider=self.PROVIDER_TAG)

            token_usage_info = None
            if response.usage:
                prompt_tokens_for_safety_exc = response.usage.input_tokens
                completion_tokens_for_safety_exc = response.usage.output_tokens
                token_usage_info = {
                    "prompt_tokens": response.usage.input_tokens,
                    "completion_tokens": response.usage.output_tokens,
                    "total_tokens": response.usage.input_tokens + response.usage.output_tokens,
                }
                logger.debug(f"{log_prefix} Token 使用情况: {token_usage_info}")
            
            return LLMResponse(
                text=generated_text,
                model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=token_usage_info.get("prompt_tokens",0) if token_usage_info else 0,
                completion_tokens=token_usage_info.get("completion_tokens",0) if token_usage_info else 0,
                total_tokens=token_usage_info.get("total_tokens",0) if token_usage_info else 0,
                finish_reason=response.stop_reason,
                error=None
            )
        
        except AnthropicAuthenticationError as e: # SDK's specific auth error
            error_message = f"Anthropic API 认证失败: {e.message if hasattr(e, 'message') else str(e)}"
            logger.error(f"{log_prefix} {error_message}", exc_info=False)
            raise LLMAuthenticationError(error_message, provider=self.PROVIDER_TAG) from e
        except RateLimitError as e:
            error_message = f"Anthropic API 速率限制错误: {e.message if hasattr(e, 'message') else str(e)}"
            logger.warning(f"{log_prefix} {error_message}")
            raise LLMRateLimitError(error_message, provider=self.PROVIDER_TAG) from e
        except APIConnectionError as e:
            error_message = f"Anthropic API 连接错误: {e.message if hasattr(e, 'message') else str(e)}"
            logger.warning(f"{log_prefix} {error_message}")
            raise LLMConnectionError(error_message, provider=self.PROVIDER_TAG) from e
        except APITimeoutError as e:
            error_message = f"Anthropic API 超时错误: {e.message if hasattr(e, 'message') else str(e)}"
            logger.warning(f"{log_prefix} {error_message}")
            raise LLMConnectionError(error_message, provider=self.PROVIDER_TAG) from e
        except AnthropicBadRequestError as e: # Handles 400 errors which might include content safety
            error_text = e.message if hasattr(e, 'message') and e.message else str(e)
            error_type_str = str(getattr(e, 'type', 'N/A')) # type: ignore
            http_status_str = str(getattr(e, 'status_code', 'N/A'))
            error_message_full = f"Anthropic API 错误 (HTTP Status: {http_status_str}, Type: {error_type_str}): {error_text}"
            logger.error(f"{log_prefix} {error_message_full}", exc_info=False)

            # Check for content safety: status_code 400 and type 'invalid_request_error'
            # with specific keywords in the message.
            is_safety_error = False
            if e.status_code == 400 and error_type_str == 'invalid_request_error':
                if any(keyword in error_text.lower() for keyword in ["harmful", "blocked by content filter", "safety guidelines"]):
                    is_safety_error = True
            
            if is_safety_error:
                logger.error(f"{log_prefix} Anthropic API 因内容过滤错误。")
                # 提取finish_reason和tokens，如果可用
                finish_reason_from_error = "content_filter"
                # Anthropic errors might not directly provide token counts in the error object itself
                # for blocked content. We'll use the placeholders.
                raise GlobalContentSafetyException(
                    message=error_text,
                    provider=self.PROVIDER_TAG,
                    model_id=self.get_user_defined_model_id(),
                    details={"http_status": e.status_code, "type": error_type_str, "body": getattr(e, 'body', None)},
                    prompt_tokens=prompt_tokens_for_safety_exc,
                    completion_tokens=completion_tokens_for_safety_exc, # Usually 0 for blocked output
                    total_tokens=prompt_tokens_for_safety_exc + completion_tokens_for_safety_exc,
                    finish_reason=finish_reason_from_error
                ) from e
            else: # Other 400 Bad Request errors
                raise LLMAPIError(error_message_full, provider=self.PROVIDER_TAG) from e
        except AnthropicAPIError as e: # Catch other Anthropic API errors
            error_text = str(e)
            if hasattr(e, 'message') and e.message:
                error_text = e.message
            error_type_str = str(getattr(e, 'type', 'N/A')) # type: ignore
            http_status_str = str(getattr(e, 'status_code', 'N/A'))
            error_message = f"Anthropic API 通用错误 (HTTP Status: {http_status_str}, Type: {error_type_str}): {error_text}"
            logger.error(f"{log_prefix} {error_message}", exc_info=False)
            raise LLMAPIError(error_message, provider=self.PROVIDER_TAG) from e
        except Exception as e_generate:
            logger.error(f"{log_prefix} 调用 Anthropic API generate 时发生未知错误: {e_generate}", exc_info=True)
            raise LLMAPIError(f"调用 Anthropic 模型时发生未知错误: {str(e_generate)}", provider=self.PROVIDER_TAG) from e_generate


    def get_model_capabilities(self) -> Dict[str, Any]: #
        """获取Anthropic Claude模型的能力。主要信息来自 UserDefinedLLMConfig。"""
        supports_system_prompt = self.model_config.supports_system_prompt if self.model_config.supports_system_prompt is not None else True
        max_tokens_from_config = self.model_config.max_context_tokens
        
        if max_tokens_from_config is None:
            model_api_id_lower = self.get_model_identifier_for_api().lower()
            if "claude-3-opus" in model_api_id_lower: max_tokens_from_config = 200000
            elif "claude-3-5-sonnet" in model_api_id_lower: max_tokens_from_config = 200000
            elif "claude-3-sonnet" in model_api_id_lower: max_tokens_from_config = 200000
            elif "claude-3-haiku" in model_api_id_lower: max_tokens_from_config = 200000
            elif "claude-2.1" in model_api_id_lower: max_tokens_from_config = 200000
            elif "claude-2" in model_api_id_lower or "claude-2.0" in model_api_id_lower: max_tokens_from_config = 100000
            elif "claude-instant" in model_api_id_lower: max_tokens_from_config = 100000
            else: max_tokens_from_config = 100000
            logger.debug(f"AnthropicProvider for '{self.get_user_defined_model_id()}': 根据API模型ID '{model_api_id_lower}' 推断 max_context_tokens 为 {max_tokens_from_config} (因用户未配置)。")
        
        return { #
            "max_context_tokens": max_tokens_from_config, #
            "supports_system_prompt": supports_system_prompt, #
        }

    async def get_available_models_from_api(self) -> List[Dict[str, Any]]: #
        logger.info("AnthropicProvider.get_available_models_from_api: 返回已知的兼容模型列表 (硬编码)。用户应根据其权限和Anthropic官方文档手动配置可用的模型ID。") #
        
        known_models = [ #
            {"id": "claude-3-opus-20240229", "name": "Claude 3 Opus", "notes": "旗舰模型，性能最高。"}, #
            {"id": "claude-3-5-sonnet-20240620", "name": "Claude 3.5 Sonnet", "notes": "能力强于Opus，速度Sonnet级别，性价比高。"}, # 新增 Claude 3.5 Sonnet
            {"id": "claude-3-sonnet-20240229", "name": "Claude 3 Sonnet", "notes": "平衡性能与速度。"}, #
            {"id": "claude-3-haiku-20240307", "name": "Claude 3 Haiku", "notes": "速度最快，最紧凑。"}, #
            {"id": "claude-2.1", "name": "Claude 2.1 (旧版)", "notes": "200K 上下文窗口。"}, #
            {"id": "claude-2.0", "name": "Claude 2.0 (旧版)", "notes": "100K 上下文窗口。"}, #
            {"id": "claude-instant-1.2", "name": "Claude Instant 1.2 (旧版)", "notes": "低延迟，轻量级。"}, #
        ]
        
        formatted_models = [] #
        for model in known_models: #
            formatted_models.append({ #
                "id": model["id"], #
                "name": model["name"], #
                "provider_tag": self.PROVIDER_TAG, #
                "notes": model.get("notes", f"Anthropic {model['name']} 模型。") #
            })
            
        return formatted_models #

    async def test_connection(
        self,
        model_api_id_for_test: Optional[str] = None,
    ) -> Tuple[bool, str, Optional[List[str]]]:
        if not self.is_client_ready() or self.client is None:
            return False, "Anthropic客户端未初始化或SDK不可用。", ["请检查依赖库 anthropic 是否已正确安装和配置。"]

        test_model_id = model_api_id_for_test or self.provider_config.default_test_model_id or self.get_model_identifier_for_api()
        if not test_model_id:
            return False, "无法确定用于测试的Anthropic模型ID。", ["请在配置中为此提供商或具体模型指定 default_test_model_id，或确保当前模型配置了 model_identifier_for_api。"]

        logger.info(f"[Anthropic-TestConnection] 开始测试连接，使用模型: {test_model_id}")
        try:
            # 使用一个非常简短、安全的提示进行测试
            test_messages: List[Dict[str, Any]] = [{"role": "user", "content": "Hello, world. Briefly confirm you are operational."}]
            test_api_params: Dict[str, Any] = {
                "model": test_model_id,
                "messages": test_messages,
                "max_tokens": 10,
                "temperature": 0.1,
            }
            
            response = await self.client.messages.create(**test_api_params) # type: ignore[arg-type]

            if response.content and response.content[0].text:
                logger.info(f"[Anthropic-TestConnection] 连接成功。模型响应 (预览): {response.content[0].text[:50]}...")
                return True, f"成功连接到Anthropic并从模型 {test_model_id} 收到响应。", [f"响应预览: {response.content[0].text[:100]}..."]
            else:
                logger.warning(f"[Anthropic-TestConnection] 连接测试：模型 {test_model_id} 返回了空内容。")
                return False, f"连接到Anthropic模型 {test_model_id} 成功，但模型返回了空响应。", [f"原始响应对象: {str(response)[:200]}..."]

        except AnthropicAuthenticationError as e_auth:
            logger.error(f"[Anthropic-TestConnection] 认证失败 (模型: {test_model_id}): {e_auth}", exc_info=False)
            return False, "Anthropic API认证失败。", [f"请检查您的API密钥是否正确并具有访问模型 {test_model_id} 的权限。", f"错误详情: {str(e_auth)[:200]}"]
        except RateLimitError as e_rate:
            logger.warning(f"[Anthropic-TestConnection] 遭遇速率限制 (模型: {test_model_id}): {e_rate}")
            return False, "Anthropic API速率限制。", [f"请稍后再试或检查您的API使用限制。", f"错误详情: {str(e_rate)[:200]}"]
        except (APIConnectionError, APITimeoutError) as e_conn:
            logger.error(f"[Anthropic-TestConnection] 连接或超时错误 (模型: {test_model_id}): {e_conn}", exc_info=False)
            return False, "无法连接到Anthropic API或请求超时。", [f"请检查您的网络连接和Anthropic服务状态。", f"错误详情: {str(e_conn)[:200]}"]
        except AnthropicAPIError as e_api:
            error_body = getattr(e_api, 'body', None)
            error_type = getattr(error_body, 'type', None) if isinstance(error_body, dict) else None
            status_code = getattr(e_api, 'status_code', 'N/A')
            
            if status_code == 400 and error_type == 'invalid_request_error' and "API key is invalid" in str(e_api).lower():
                 logger.error(f"[Anthropic-TestConnection] API密钥无效 (模型: {test_model_id}): {e_api}", exc_info=False)
                 return False, "Anthropic API密钥无效。", [f"请验证您的API密钥。", f"错误详情: {str(e_api)[:200]}"]
            
            logger.error(f"[Anthropic-TestConnection] API调用时发生错误 (模型: {test_model_id}): {e_api}", exc_info=True)
            details = [f"状态码: {status_code}", f"错误类型: {error_type or 'N/A'}", f"错误消息: {str(e_api)[:200]}"]
            return False, f"调用Anthropic API时发生错误 (模型: {test_model_id})。", details
        except Exception as e_unknown:
            logger.error(f"[Anthropic-TestConnection] 测试连接时发生未知错误 (模型: {test_model_id}): {e_unknown}", exc_info=True)
            return False, "测试Anthropic连接时发生未知错误。", [f"错误详情: {str(e_unknown)[:200]}"]