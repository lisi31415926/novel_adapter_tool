# backend/app/llm_providers/openai_provider.py
import logging
import os
import time
from typing import Dict, Any, Optional, List, Union # 确保导入 Union

import openai # 最新的openai SDK导入方式
from openai import AsyncOpenAI, APIError as OpenAIAPIError, RateLimitError, APIConnectionError, APITimeoutError

# 导入新的基类和响应模型
from .base_llm_provider import BaseLLMProvider, LLMResponse
# 导入类型化的配置模型
from app import schemas, config_service # 确保能访问全局配置

logger = logging.getLogger(__name__)

# 临时的 ContentSafetyException 定义。
# TODO: 此异常类应移至 app.llm_orchestrator (如bug.txt建议) 或 app.core.exceptions
# 以避免在各 provider 文件之间潜在的循环导入问题。
class ContentSafetyException(RuntimeError):
    """自定义内容安全违规异常类"""
    def __init__(self, message: str, provider: Optional[str]=None, model_id: Optional[str]=None, details: Optional[Any]=None):
        self.original_message = message
        self.provider = provider
        self.model_id = model_id
        self.details = details
        full_message = f"内容安全异常 by Provider='{provider}', Model='{model_id}'. Message: '{message}'. Details: {details}"
        super().__init__(full_message)


class OpenAIProvider(BaseLLMProvider):
    """
    OpenAI LLM 提供商实现。
    使用 openai Python 库与 OpenAI API (或兼容API, 如LM Studio) 进行交互。
    """
    PROVIDER_TAG = "openai"  # 必须与 llm_providers/__init__.py 中发现和注册的键一致

    def __init__(
        self,
        model_config: schemas.UserDefinedLLMConfigSchema,
        provider_config: schemas.LLMProviderConfigSchema # 这是全局的OpenAI提供商配置
    ):
        """
        初始化 OpenAI 提供商。

        Args:
            model_config: 此特定模型的用户定义配置。
            provider_config: OpenAI 提供商的全局配置。
        """
        super().__init__(model_config, provider_config) # 调用基类构造函数

        api_key_to_use = self.model_config.api_key
        base_url_to_use = self.model_config.base_url
        timeout_seconds = self.provider_config.api_timeout_seconds
        max_retries_count = self.provider_config.max_retries

        try:
            client_params: Dict[str, Any] = {
                "api_key": api_key_to_use, 
            }
            if base_url_to_use:
                client_params["base_url"] = base_url_to_use
            if timeout_seconds is not None:
                client_params["timeout"] = timeout_seconds
            if max_retries_count is not None:
                client_params["max_retries"] = max_retries_count
            
            self.client: Optional[AsyncOpenAI] = AsyncOpenAI(**client_params)
            
            log_message_parts = [
                f"OpenAIProvider for model '{self.model_config.user_given_name}' (API ID: {self.get_model_identifier_for_api()}) 实例已创建.",
                f"Target Base URL: {base_url_to_use or 'Official OpenAI'}.",
                f"Timeout: {timeout_seconds or 'SDK Default'}s.",
                f"Max Retries: {max_retries_count or 'SDK Default'}.",
                f"API Key Source Hint: {'Provided in Model Config' if api_key_to_use else 'SDK Default (e.g., env var)'}."
            ]
            logger.info(" ".join(log_message_parts))

        except Exception as e:
            logger.error(
                f"初始化 OpenAI 客户端 (模型: {self.model_config.user_given_name}) 失败: {e}",
                exc_info=True
            )
            self.client = None 

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
            logger.error(f"OpenAIProvider (模型: {self.model_config.user_given_name}) 客户端未就绪，无法执行生成操作。")
            return LLMResponse(
                text="", model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=0, completion_tokens=0, total_tokens=0,
                finish_reason="error", error="OpenAI客户端未初始化或未就绪"
            )

        messages: List[Dict[str, str]] = []
        user_prompt_content = prompt # 将原始 prompt 赋值给一个新变量

        if self.model_config.supports_system_prompt:
            if system_prompt: 
                messages.append({"role": "system", "content": system_prompt})
        elif system_prompt: 
            logger.warning(
                f"模型 '{self.model_config.user_given_name}' 配置为不支持独立系统提示，"
                f"但调用时提供了系统提示。将尝试将其合并到用户提示中。"
            )
            # 改为安全的字符串拼接，避免在此处使用f-string直接插入可能未完全净化的外部prompt变量
            user_prompt_content = system_prompt + "\n\n---\n\n用户请求：\n" + prompt

        messages.append({"role": "user", "content": user_prompt_content})

        global_llm_settings = config_service.get_config().llm_settings
        final_params: Dict[str, Any] = {
            "model": self.get_model_identifier_for_api(), 
            "messages": messages,
            "temperature": temperature if temperature is not None else global_llm_settings.default_temperature,
        }
        
        effective_max_tokens = global_llm_settings.default_max_completion_tokens
        if llm_override_parameters:
            if "max_tokens" in llm_override_parameters and llm_override_parameters["max_tokens"] is not None:
                effective_max_tokens = llm_override_parameters["max_tokens"]
            elif "max_output_tokens" in llm_override_parameters and llm_override_parameters["max_output_tokens"] is not None:
                effective_max_tokens = llm_override_parameters["max_output_tokens"]
        if max_tokens is not None:
            effective_max_tokens = max_tokens
        final_params["max_tokens"] = effective_max_tokens
        
        if is_json_output:
            final_params["response_format"] = {"type": "json_object"}

        if llm_override_parameters:
            valid_openai_api_params = {
                "top_p", "frequency_penalty", "presence_penalty", "stop", "n", 
                "stream", "logprobs", "top_logprobs", "seed", "user"
            }
            for key, value in llm_override_parameters.items():
                if key in valid_openai_api_params and value is not None:
                    final_params[key] = value
        
        log_prefix_generate = f"[OpenAIProvider(ModelUserCfg:'{self.get_user_defined_model_id()}', APIModel:'{final_params['model']}')]"
        logger.debug(f"{log_prefix_generate} 请求参数 (部分): messages_count={len(messages)}, other_params_keys={list(set(final_params.keys()) - {'model', 'messages'})}")

        try:
            start_time_ns = time.perf_counter_ns()
            api_response = await self.client.chat.completions.create(**final_params) # type: ignore[arg-type]
            duration_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000
            logger.debug(f"{log_prefix_generate} API调用耗时: {duration_ms:.2f}ms")

            if not api_response.choices or not api_response.choices[0].message or api_response.choices[0].message.content is None:
                logger.warning(f"{log_prefix_generate} OpenAI API响应中 choices[0].message.content 为空或不存在。响应: {api_response.model_dump_json(indent=2)}")
                
                if api_response.choices and api_response.choices[0].finish_reason == "content_filter":
                    logger.error(f"{log_prefix_generate} OpenAI内容过滤器触发。")
                    error_details: Dict[str, Any] = {
                        "finish_reason": api_response.choices[0].finish_reason,
                        "response_dump": api_response.model_dump(exclude_none=True) 
                    }
                    if hasattr(api_response, 'prompt_filter_results') and api_response.prompt_filter_results:
                        error_details["azure_prompt_filter_results"] = api_response.prompt_filter_results
                    elif api_response.choices and hasattr(api_response.choices[0], 'content_filter_results') and api_response.choices[0].content_filter_results:
                        error_details["azure_choice_content_filter_results"] = api_response.choices[0].content_filter_results

                    raise ContentSafetyException(
                        message="OpenAI API 因内容过滤阻止了响应 (finish_reason: content_filter)。",
                        provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                        details=error_details
                    )
                raise ValueError("OpenAI API 响应内容为空，且非内容过滤导致。")

            generated_text = api_response.choices[0].message.content
            
            token_usage_info = None
            if api_response.usage:
                token_usage_info = {
                    "prompt_tokens": api_response.usage.prompt_tokens,
                    "completion_tokens": api_response.usage.completion_tokens,
                    "total_tokens": api_response.usage.total_tokens,
                }
                logger.debug(f"{log_prefix_generate} Token使用情况: {token_usage_info}")
            
            return LLMResponse(
                text=generated_text,
                model_id_used=self.get_user_defined_model_id(), 
                prompt_tokens=token_usage_info.get("prompt_tokens",0) if token_usage_info else 0,
                completion_tokens=token_usage_info.get("completion_tokens",0) if token_usage_info else 0,
                total_tokens=token_usage_info.get("total_tokens",0) if token_usage_info else 0,
                finish_reason=api_response.choices[0].finish_reason,
                error=None
            )

        except OpenAIAPIError as e_api: 
            error_text = e_api.message if hasattr(e_api, 'message') and e_api.message else str(e_api)
            error_code_from_api = getattr(e_api, 'code', None)
            http_status_from_api = getattr(e_api, 'status_code', None)
            error_body_from_api = getattr(e_api, 'body', None)

            log_msg_api_err = f"OpenAI API错误 (模型用户ID: {self.get_user_defined_model_id()}, API模型: {self.get_model_identifier_for_api()}, HTTP状态: {http_status_from_api}, Code: {error_code_from_api}): {error_text}"
            logger.error(f"{log_prefix_generate} {log_msg_api_err}", exc_info=False) 
            
            is_safety_error_flag = False
            if error_code_from_api == 'content_filter':
                is_safety_error_flag = True
            elif isinstance(error_body_from_api, dict):
                inner_error = error_body_from_api.get('error', {})
                if isinstance(inner_error, dict) and inner_error.get('code') == 'content_filter':
                    is_safety_error_flag = True
                if "prompt_filter_results" in error_body_from_api or "prompt_annotations" in error_body_from_api:
                    prompt_filter_results = error_body_from_api.get("prompt_filter_results")
                    if isinstance(prompt_filter_results, list) and prompt_filter_results:
                        for result in prompt_filter_results:
                            if isinstance(result, dict) and result.get("content_filter_results"):
                                for category, cat_details in result["content_filter_results"].items():
                                    if isinstance(cat_details, dict) and cat_details.get("filtered") is True:
                                        is_safety_error_flag = True
                                        logger.warning(f"{log_prefix_generate} Azure OpenAI 内容过滤在 '{category}' 检测到问题 (Severity: {cat_details.get('severity')}).")
                                        break;
                            if is_safety_error_flag: break;
            
            if is_safety_error_flag:
                final_error_msg_for_safety = error_text if error_text else "OpenAI API 因内容过滤阻止了响应。"
                logger.error(f"{log_prefix_generate} OpenAI API 因内容过滤错误 (Code: {error_code_from_api}, Body snippet: {str(error_body_from_api)[:200]}...).")
                raise ContentSafetyException(
                    message=final_error_msg_for_safety,
                    provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                    details={"http_status": http_status_from_api, "code": error_code_from_api, "body": error_body_from_api, "type": getattr(e_api, 'type', None)}
                )

            return LLMResponse(
                text="", model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=0, completion_tokens=0, total_tokens=0,
                finish_reason="error", error=f"OpenAI API 错误 (状态 {http_status_from_api}, Code: {error_code_from_api}): {error_text}"
            )
        except Exception as e_generate_unknown:
            logger.error(f"{log_prefix_generate} 调用 OpenAI API generate 时发生未知错误: {e_generate_unknown}", exc_info=True)
            return LLMResponse(
                text="", model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=0, completion_tokens=0, total_tokens=0,
                finish_reason="error", error=f"调用 OpenAI 模型时发生未知错误: {str(e_generate_unknown)}"
            )

    def get_model_capabilities(self) -> Dict[str, Any]:
        # ... (此函数内容保持不变)
        base_capabilities = {
            "max_context_tokens": self.model_config.max_context_tokens,
            "supports_system_prompt": self.model_config.supports_system_prompt,
        }
        
        if base_capabilities["max_context_tokens"] is None:
            model_api_id = self.get_model_identifier_for_api().lower() 
            inferred_max_tokens = None
            if "gpt-4o" in model_api_id: inferred_max_tokens = 128000
            elif "gpt-4-turbo" in model_api_id: inferred_max_tokens = 128000
            elif "gpt-4-32k" in model_api_id: inferred_max_tokens = 32768
            elif "gpt-4" in model_api_id: inferred_max_tokens = 8192 
            elif "gpt-3.5-turbo-0125" in model_api_id: inferred_max_tokens = 16385
            elif "gpt-3.5-turbo-16k" in model_api_id: inferred_max_tokens = 16385
            elif "gpt-3.5-turbo-1106" in model_api_id: inferred_max_tokens = 16385 
            elif "gpt-3.5-turbo" in model_api_id: inferred_max_tokens = 4096 
            
            if inferred_max_tokens is not None:
                base_capabilities["max_context_tokens"] = inferred_max_tokens
                logger.debug(f"OpenAIProvider for '{self.get_user_defined_model_id()}': 根据API模型ID '{model_api_id}' 推断 max_context_tokens 为 {inferred_max_tokens} (因用户未配置)。")

        return base_capabilities

    async def get_available_models_from_api(self) -> List[Dict[str, Any]]:
        # ... (此函数内容保持不变)
        log_prefix_list = f"[OpenAIProvider(ListModels for UserCfg:'{self.get_user_defined_model_id()}')]"
        
        client_instance_to_use: Optional[AsyncOpenAI] = self.client
        temp_client_used_for_listing = False

        if not self.is_client_ready() or client_instance_to_use is None:
            logger.warning(f"{log_prefix_list} 主客户端未就绪。尝试使用模型配置中的凭证创建临时客户端以列出模型。")
            temp_api_key_from_cfg = self.model_config.api_key
            temp_base_url_from_cfg = self.model_config.base_url
            
            if not temp_api_key_from_cfg and self.model_config.api_key_is_from_env:
                env_key_name = self.model_config.provider_tag.upper().replace('-', '_') + "_API_KEY" 
                temp_api_key_from_cfg = os.getenv(env_key_name)

            if not temp_api_key_from_cfg: 
                logger.error(f"{log_prefix_list} 无法列出模型：未提供API密钥 (来自配置或环境变量)。")
                return []
            try:
                temp_client_params: Dict[str, Any] = {"api_key": temp_api_key_from_cfg}
                if temp_base_url_from_cfg: temp_client_params["base_url"] = temp_base_url_from_cfg
                
                client_instance_to_use = AsyncOpenAI(**temp_client_params)
                temp_client_used_for_listing = True
                logger.info(f"{log_prefix_list} 已为模型列表功能创建临时OpenAI客户端。")
            except Exception as e_temp_client_create:
                logger.error(f"{log_prefix_list} 创建临时OpenAI客户端列出模型失败: {e_temp_client_create}")
                return []
        
        if client_instance_to_use is None: 
            logger.error(f"{log_prefix_list} 无法确定用于列出模型的OpenAI客户端实例。")
            return []

        try:
            models_response_obj = await client_instance_to_use.models.list()
            available_models_result: List[Dict[str, Any]] = []
            if models_response_obj and models_response_obj.data:
                for model_api_obj in models_response_obj.data:
                    model_info_dict = {
                        "id": model_api_obj.id, 
                        "name": model_api_obj.id, 
                        "provider_tag": self.PROVIDER_TAG, 
                        "notes": f"由API发现。创建时间: {model_api_obj.created if hasattr(model_api_obj, 'created') and model_api_obj.created else '未知'}",
                    }
                    available_models_result.append(model_info_dict)
                logger.info(f"{log_prefix_list} 从API成功获取 {len(available_models_result)} 个可用模型信息。")
                return available_models_result
            else:
                logger.warning(f"{log_prefix_list} models.list() API返回了空响应或无数据。")
                return []
        except OpenAIAPIError as e_api_list:
            logger.error(f"{log_prefix_list} 从API获取可用模型列表失败: {e_api_list}")
            return []
        except Exception as e_generic_list:
            logger.error(f"{log_prefix_list} 获取可用模型列表时发生未知错误: {e_generic_list}", exc_info=True)
            return []
        finally:
            if temp_client_used_for_listing and client_instance_to_use and hasattr(client_instance_to_use, 'aclose'):
                try:
                    await client_instance_to_use.aclose()
                    logger.info(f"{log_prefix_list} 已关闭为列出模型创建的临时OpenAI客户端。")
                except Exception as e_aclose_temp:
                    logger.warning(f"{log_prefix_list} 关闭临时OpenAI客户端时出错: {e_aclose_temp}")