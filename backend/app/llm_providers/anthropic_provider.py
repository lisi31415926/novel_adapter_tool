# backend/app/llm_providers/anthropic_provider.py
import logging
import os
import time
from typing import Dict, Any, Optional, Tuple, List, Union

# Anthropic SDK
try:
    from anthropic import AsyncAnthropic, APIError as AnthropicAPIError, RateLimitError, APIConnectionError, APITimeoutError
    ANTHROPIC_SDK_AVAILABLE = True
except ImportError:
    AsyncAnthropic = None # type: ignore
    AnthropicAPIError = None # type: ignore
    RateLimitError = None # type: ignore
    APIConnectionError = None # type: ignore
    APITimeoutError = None # type: ignore
    ANTHROPIC_SDK_AVAILABLE = False
    logging.warning("Anthropic SDK 未安装。AnthropicProvider 将不可用。请运行 'pip install anthropic'")

# 导入新的基类和响应模型
from .base_llm_provider import BaseLLMProvider, LLMResponse
# 导入类型化的配置模型和全局配置服务
from app import schemas, config_service

logger = logging.getLogger(__name__)

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
        if not api_key_to_use: # 如果模型配置中没有，尝试从环境变量获取
            api_key_to_use = os.getenv("ANTHROPIC_API_KEY") #
        
        base_url_to_use = self.model_config.base_url # Anthropic SDK 可能不直接支持 base_url 覆盖，但保留以备将来或代理情况

        if not api_key_to_use: #
            logger.error(f"AnthropicProvider (模型: {self.model_config.user_given_name}) 初始化失败：未提供 API 密钥。") #
            self.client = None
            self._sdk_ready = False
            return

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
            return LLMResponse(
                text="", model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=0, completion_tokens=0, total_tokens=0,
                finish_reason="error", error="Anthropic客户端未初始化或未就绪"
            )

        # Anthropic Messages API 使用 "user" 角色的 content 列表
        # 如果需要多轮对话，content 可以是对象列表：[{ "type": "text", "text": "Hi" }]
        # 对于单轮，可以直接是字符串列表： ["Hello, world"]
        # 或者一个包含 "role": "user" 和 "content": "string" 或 "content": List[ContentBlock] 的对象
        messages_for_api: List[Dict[str, Any]] = [{"role": "user", "content": prompt}] # Messages API 需要列表

        # Anthropic API 的参数
        global_llm_settings = config_service.get_config().llm_settings
        api_params: Dict[str, Any] = { #
            "model": self.get_model_identifier_for_api(), #
            "messages": messages_for_api, #
             # Anthropic Messages API 强制要求 max_tokens
            "max_tokens": 1024, # 默认值，会被下方逻辑覆盖
        }

        if system_prompt and self.model_config.supports_system_prompt: # Anthropic Messages API 接受顶层的 system 参数
            api_params["system"] = system_prompt #
        elif system_prompt: # 模型不支持，但提供了系统提示
             logger.warning(f"模型 '{self.model_config.user_given_name}' (Anthropic) 可能不通过顶层 'system' 参数支持系统提示，或此配置禁用。将尝试合并。")
             # 对于不支持 system 参数的模型，通常将其内容预置到 messages 中第一个 user 消息前。
             # 但 Anthropic Messages API 推荐使用顶层 system。如果模型较旧，可能需要不同处理。
             # 此处保持简单，如果 model_config.supports_system_prompt 为 false，则不使用 system 参数。
             # 调用者应负责将系统提示内容适当地融入到 user prompt 中。

        # 处理温度
        if temperature is not None:
            api_params["temperature"] = float(temperature)
        elif global_llm_settings.default_temperature is not None:
            api_params["temperature"] = float(global_llm_settings.default_temperature)
        
        # 处理 max_tokens (Anthropic Messages API 中参数名为 max_tokens)
        effective_max_tokens = max_tokens # 调用时传入的优先级最高
        if llm_override_parameters: #
            if llm_override_parameters.get("max_tokens") is not None: # 兼容通用名
                effective_max_tokens = int(llm_override_parameters["max_tokens"])
            elif llm_override_parameters.get("max_tokens_to_sample") is not None: # 旧版兼容
                effective_max_tokens = int(llm_override_parameters["max_tokens_to_sample"]) #
            elif "max_output_tokens" in llm_override_parameters and llm_override_parameters["max_output_tokens"] is not None: # 也兼容
                effective_max_tokens = int(llm_override_parameters["max_output_tokens"]) #
        
        if effective_max_tokens is None: # 如果都没提供，用全局默认
            effective_max_tokens = global_llm_settings.default_max_completion_tokens
        
        if effective_max_tokens is None or effective_max_tokens <=0 : #
            logger.warning(f"Anthropic API 调用缺少有效的 'max_tokens'。将使用默认值 1024。llm_params: {llm_override_parameters}") #
            api_params["max_tokens"] = 1024 #
        else:
            api_params["max_tokens"] = int(effective_max_tokens)

        # 其他参数
        if llm_override_parameters: #
            if "top_p" in llm_override_parameters and llm_override_parameters["top_p"] is not None: #
                api_params["top_p"] = float(llm_override_parameters["top_p"]) #
            if "top_k" in llm_override_parameters and llm_override_parameters["top_k"] is not None: #
                api_params["top_k"] = int(llm_override_parameters["top_k"]) #
            if "stop_sequences" in llm_override_parameters and llm_override_parameters["stop_sequences"] is not None: #
                stop_seq = llm_override_parameters["stop_sequences"] #
                if isinstance(stop_seq, list) and all(isinstance(s, str) for s in stop_seq): #
                    api_params["stop_sequences"] = stop_seq #
                elif isinstance(stop_seq, str): #
                     api_params["stop_sequences"] = [stop_seq] #
        
        if is_json_output:
            # 对于 Anthropic，通常需要在 prompt 中指示 JSON 输出
            # 例如，可以在 system_prompt 或 user_prompt 的末尾追加 "请确保你的回复是一个格式良好的JSON对象。"
            # 这里可以根据需要添加这种逻辑，或者假设调用者已在prompt中处理
            logger.info(f"AnthropicProvider: is_json_output is True. 建议在提示中明确要求JSON格式。")


        log_prefix = f"[AnthropicProvider(ModelUserCfg:'{self.get_user_defined_model_id()}', APIModel:'{api_params['model']}')]" #
        logger.debug(f"{log_prefix} 请求参数 (部分): model='{api_params.get('model')}', system_prompt_set={bool(api_params.get('system'))}, messages_count={len(messages_for_api)}, other_params_keys={list(set(api_params.keys()) - {'model', 'messages', 'system'})}") #

        try:
            start_time_ns = time.perf_counter_ns() #
            response = await self.client.messages.create(**api_params) # type: ignore[arg-type] #
            duration_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000 #
            logger.debug(f"{log_prefix} API 调用耗时: {duration_ms:.2f}ms") #

            # Anthropic Messages API 的响应结构不同
            # response.content 是一个 ContentBlock 对象的列表，通常第一个是 text 类型
            generated_text = ""
            if response.content and isinstance(response.content, list) and len(response.content) > 0:
                first_content_block = response.content[0]
                if hasattr(first_content_block, 'text'):
                    generated_text = first_content_block.text
            
            if not generated_text.strip() and response.stop_reason not in ["end_turn", "stop_sequence"]: #
                logger.warning(f"{log_prefix} Anthropic API 响应中 content[0].text 为空或不存在，且停止原因异常。Stop Reason: {response.stop_reason}. Response: {response.model_dump_json(indent=2)}") #
                if response.stop_reason == "max_tokens": #
                    # 即使是 max_tokens，如果完全没有内容，也可能是有问题
                    pass #
                # Anthropic 的内容安全通常通过 APIError (status_code 400, type 'invalid_request_error') 指示
                raise ValueError(f"Anthropic API 响应内容为空或非预期停止原因: {response.stop_reason}") #

            token_usage_info = None #
            if response.usage: #
                token_usage_info = { #
                    "prompt_tokens": response.usage.input_tokens, #
                    "completion_tokens": response.usage.output_tokens, #
                    # Anthropic SDK 的 MessageUsage 对象不直接提供 total_tokens，需要自己计算
                    "total_tokens": response.usage.input_tokens + response.usage.output_tokens, #
                }
                logger.debug(f"{log_prefix} Token 使用情况: {token_usage_info}") #
            
            return LLMResponse(
                text=generated_text,
                model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=token_usage_info.get("prompt_tokens",0) if token_usage_info else 0,
                completion_tokens=token_usage_info.get("completion_tokens",0) if token_usage_info else 0,
                total_tokens=token_usage_info.get("total_tokens",0) if token_usage_info else 0,
                finish_reason=response.stop_reason,
                error=None
            )

        except AnthropicAPIError as e: #
            error_text = str(e) #
            if hasattr(e, 'message') and e.message: # SDK v1+ 应该有 message 属性
                error_text = e.message #
            elif hasattr(e, 'body') and e.body and isinstance(e.body, dict) and "error" in e.body: # 兼容旧版或不同错误结构
                error_detail = e.body["error"] #
                if isinstance(error_detail, dict) and "message" in error_detail: #
                    error_text = error_detail["message"] #

            error_type_str = str(getattr(e, 'type', 'N/A'))
            http_status_str = str(getattr(e, 'status_code', 'N/A'))
            error_message = f"Anthropic API 错误 (模型用户ID: {self.get_user_defined_model_id()}, API模型: {self.get_model_identifier_for_api()}, HTTP Status: {http_status_str}, Type: {error_type_str}): {error_text}" #
            logger.error(f"{log_prefix} {error_message}", exc_info=False) #

            is_safety_error = False #
            if e.status_code == 400 and error_type_str == 'invalid_request_error': #
                if any(keyword in error_text.lower() for keyword in ["harmful", "blocked by content filter", "safety guidelines"]): #
                    is_safety_error = True #
            
            if is_safety_error: #
                logger.error(f"{log_prefix} Anthropic API 因内容过滤错误。") #
                raise ContentSafetyException( #
                    message=error_text, #
                    provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(), #
                    details={"http_status": e.status_code, "type": error_type_str, "body": getattr(e, 'body', None)} #
                )
            elif isinstance(e, RateLimitError): #
                 logger.warning(f"{log_prefix} Anthropic API 速率限制错误。将重新抛出。") #
                 raise #
            elif isinstance(e, (APIConnectionError, APITimeoutError)): #
                 logger.warning(f"{log_prefix} Anthropic API 连接或超时错误。将重新抛出。") #
                 raise #

            # 对于其他类型的AnthropicAPIError，返回错误信息
            return LLMResponse(text="", model_id_used=self.get_user_defined_model_id(), prompt_tokens=0, completion_tokens=0, total_tokens=0, finish_reason="error", error=error_message)
        except Exception as e_generate: #
            logger.error(f"{log_prefix} 调用 Anthropic API generate 时发生未知错误: {e_generate}", exc_info=True) #
            return LLMResponse(text="", model_id_used=self.get_user_defined_model_id(), prompt_tokens=0, completion_tokens=0, total_tokens=0, finish_reason="error", error=f"调用 Anthropic 模型时发生未知错误: {str(e_generate)}")


    def get_model_capabilities(self) -> Dict[str, Any]: #
        """获取Anthropic Claude模型的能力。主要信息来自 UserDefinedLLMConfig。"""
        # model_config 已在 self.model_config 中
        supports_system_prompt = self.model_config.supports_system_prompt if self.model_config.supports_system_prompt is not None else True # Claude 模型（尤其是Messages API）支持系统提示
        max_tokens_from_config = self.model_config.max_context_tokens #
        
        # 如果用户配置中未明确指定，则根据API模型ID推断
        if max_tokens_from_config is None:
            model_api_id_lower = self.get_model_identifier_for_api().lower()
            if "claude-3-opus" in model_api_id_lower: max_tokens_from_config = 200000 # 或更高，根据最新文档
            elif "claude-3-5-sonnet" in model_api_id_lower: max_tokens_from_config = 200000 # 假设与Opus一致或更高
            elif "claude-3-sonnet" in model_api_id_lower: max_tokens_from_config = 200000 #
            elif "claude-3-haiku" in model_api_id_lower: max_tokens_from_config = 200000 #
            elif "claude-2.1" in model_api_id_lower: max_tokens_from_config = 200000 #
            elif "claude-2" in model_api_id_lower or "claude-2.0" in model_api_id_lower: max_tokens_from_config = 100000 #
            elif "claude-instant" in model_api_id_lower: max_tokens_from_config = 100000 #
            else: max_tokens_from_config = 100000 # 未知Claude模型的一个保守估计
            logger.debug(f"AnthropicProvider for '{self.get_user_defined_model_id()}': 根据API模型ID '{model_api_id_lower}' 推断 max_context_tokens 为 {max_tokens_from_config} (因用户未配置)。")
        
        return { #
            "max_context_tokens": max_tokens_from_config, #
            "supports_system_prompt": supports_system_prompt, #
        }

    async def get_available_models_from_api(self) -> List[Dict[str, Any]]: #
        """
        Anthropic 通常不提供动态列出模型的API端点。
        这里返回一个基于已知主要模型的硬编码列表。
        用户应在其 UserDefinedLLMConfig 中手动配置他们有权访问的模型。
        """
        logger.info("AnthropicProvider.get_available_models_from_api: 返回已知的兼容模型列表 (硬编码)。用户应根据其权限和Anthropic官方文档手动配置可用的模型ID。") #
        
        # 基于 Anthropic 文档的常见模型列表
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
            # capabilities = self.get_model_capabilities(model["id"]) # 调用自身方法获取推断的能力
            # 这个方法通常被 Orchestrator 调用以填充 UI，这里不需要再调用 get_model_capabilities
            formatted_models.append({ #
                "id": model["id"], #
                "name": model["name"], #
                "provider_tag": self.PROVIDER_TAG, #
                "notes": model.get("notes", f"Anthropic {model['name']} 模型。") #
                # "max_context_tokens": capabilities.get("max_context_tokens"),
                # "supports_system_prompt": capabilities.get("supports_system_prompt"),
            })
            
        return formatted_models #