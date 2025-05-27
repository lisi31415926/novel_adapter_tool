# backend/app/llm_providers/lm_studio_provider.py
import logging
import time
import httpx
from typing import Dict, Any, Optional, List

# 导入基类和响应模型
from .base_llm_provider import BaseLLMProvider, LLMResponse
# 导入类型化的配置模型
from app import schemas, config_service

logger = logging.getLogger(__name__)

class LMStudioProvider(BaseLLMProvider):
    """
    与 LM Studio 本地服务器交互的 LLM 提供商。
    LM Studio 提供了一个与 OpenAI API 兼容的端点。
    """
    PROVIDER_TAG = "lm-studio" # 必须与 llm_providers/__init__.py 中注册的键一致

    def __init__(
        self,
        model_config: schemas.UserDefinedLLMConfigSchema,
        provider_config: schemas.LLMProviderConfigSchema
    ):
        """
        初始化 LM Studio 提供商。

        Args:
            model_config: 此特定模型的用户定义配置。
            provider_config: 全局的提供商配置（尽管LM-Studio主要依赖模型配置）。
        """
        super().__init__(model_config, provider_config)
        
        # 对于 LM Studio, API Key 通常不是必需的，但 base_url 至关重要
        if not self.model_config.base_url:
            raise ValueError(f"LM Studio Provider (模型: '{self.model_config.user_given_name}') 必须配置 'base_url'。")

        self.api_endpoint = f"{self.model_config.base_url.rstrip('/')}/v1/completions"

        timeout_seconds = self.provider_config.api_timeout_seconds or 120 # 为本地服务设置一个合理的默认超时
        self.client = httpx.AsyncClient(timeout=timeout_seconds)

        logger.info(
            f"LMStudioProvider for model '{self.model_config.user_given_name}' 实例已创建. "
            f"Target Endpoint: {self.api_endpoint}"
        )

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
        
        log_prefix_generate = f"[LMStudioProvider(Model:'{self.get_user_defined_model_id()}')]"

        # 准备最终的 prompt 字符串
        final_prompt = prompt
        if system_prompt:
            # 对于 LM Studio，通常最好将系统提示和用户提示合并。
            # 常见且简单的做法是预置系统提示，并使用某种模板结构。
            # 改为安全的字符串拼接
            final_prompt = system_prompt + "\n\n### User:\n" + prompt + "\n\n### Assistant:"

        global_llm_settings = config_service.get_config().llm_settings
        final_params: Dict[str, Any] = {
            "prompt": final_prompt,
            "temperature": temperature if temperature is not None else global_llm_settings.default_temperature,
            "stop": ["\n### User:", "\n### Assistant:"], # 帮助模型停在正确的位置
        }

        # 处理 max_tokens 参数
        effective_max_tokens = global_llm_settings.default_max_completion_tokens
        if llm_override_parameters:
            # 兼容 openai_provider 使用的 `max_output_tokens`
            if "max_tokens" in llm_override_parameters and llm_override_parameters["max_tokens"] is not None:
                effective_max_tokens = llm_override_parameters["max_tokens"]
            elif "max_output_tokens" in llm_override_parameters and llm_override_parameters["max_output_tokens"] is not None:
                effective_max_tokens = llm_override_parameters["max_output_tokens"]
        if max_tokens is not None:
            effective_max_tokens = max_tokens
        final_params["max_tokens"] = effective_max_tokens

        # 合并其他覆盖参数
        if llm_override_parameters:
            # 添加 LM Studio/Llama.cpp 支持的参数
            valid_lm_studio_params = {
                "top_p", "top_k", "repeat_penalty", "seed", "stream", "n", "mirostat", "mirostat_tau", "mirostat_eta"
            }
            for key, value in llm_override_parameters.items():
                if key in valid_lm_studio_params and value is not None:
                    final_params[key] = value

        logger.debug(f"{log_prefix_generate} 请求参数 (部分): keys={list(final_params.keys())}, prompt_len={len(final_params.get('prompt', ''))}")

        try:
            start_time_ns = time.perf_counter_ns()
            response = await self.client.post(
                self.api_endpoint,
                json=final_params,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status() # 如果HTTP状态码是 4xx 或 5xx，则抛出异常
            duration_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000
            
            response_data = response.json()
            logger.debug(f"{log_prefix_generate} API调用耗时: {duration_ms:.2f}ms. 响应预览: {str(response_data)[:200]}")

            if not response_data.get("choices") or not response_data["choices"][0].get("text"):
                logger.warning(f"{log_prefix_generate} LM Studio API 响应中 choices[0].text 为空。")
                raise ValueError("LM Studio API 响应内容为空。")
            
            generated_text = response_data["choices"][0]["text"].strip()
            
            # LM Studio 的 /v1/completions 端点通常不返回详细的 token 使用情况
            # 这里的 token 计数是估算的/缺失的
            token_usage = response_data.get("usage", {})
            prompt_tokens_val = token_usage.get("prompt_tokens", 0)
            completion_tokens_val = token_usage.get("completion_tokens", 0)
            
            # 如果API没有返回，我们可以粗略估计完成的token数
            if completion_tokens_val == 0 and generated_text:
                completion_tokens_val = len(generated_text) // 4 # 非常粗略的估计

            return LLMResponse(
                text=generated_text,
                model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=prompt_tokens_val,
                completion_tokens=completion_tokens_val,
                total_tokens=token_usage.get("total_tokens", prompt_tokens_val + completion_tokens_val),
                finish_reason=response_data["choices"][0].get("finish_reason", "unknown"),
                error=None
            )

        except httpx.HTTPStatusError as e_http:
            error_details = e_http.response.text
            logger.error(
                f"{log_prefix_generate} 调用 LM Studio API 时发生 HTTP 状态错误 "
                f"(状态码: {e_http.response.status_code}): {error_details}",
                exc_info=False # 通常不需要完整堆栈跟踪，因为错误信息已足够清晰
            )
            return LLMResponse(
                text="", model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=0, completion_tokens=0, total_tokens=0,
                finish_reason="error",
                error=f"LM Studio API 错误 (状态码 {e_http.response.status_code}): {error_details}"
            )
        except httpx.RequestError as e_req:
            logger.error(f"{log_prefix_generate} 调用 LM Studio API 时发生请求错误: {e_req}", exc_info=True)
            return LLMResponse(
                text="", model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=0, completion_tokens=0, total_tokens=0,
                finish_reason="error",
                error=f"无法连接到 LM Studio 服务: {e_req}"
            )
        except Exception as e_unknown:
            logger.error(f"{log_prefix_generate} 调用 LM Studio generate 时发生未知错误: {e_unknown}", exc_info=True)
            return LLMResponse(
                text="", model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=0, completion_tokens=0, total_tokens=0,
                finish_reason="error",
                error=f"调用 LM Studio 时发生未知内部错误: {str(e_unknown)}"
            )

    def is_client_ready(self) -> bool:
        """检查客户端是否已正确初始化。"""
        return self.client is not None and self.model_config.base_url is not None

    def get_model_capabilities(self) -> Dict[str, Any]:
        """
        返回此模型的能力。对于 LM Studio，这些值通常是通用的，
        因为实际能力取决于加载到服务器中的具体模型。
        """
        return {
            "max_context_tokens": self.model_config.max_context_tokens or 2048, # 提供一个合理的默认值
            "supports_system_prompt": self.model_config.supports_system_prompt, # 通常为 False
        }

    async def get_available_models_from_api(self) -> List[Dict[str, Any]]:
        """
        尝试从 LM Studio 的 /v1/models 端点获取加载的模型。
        """
        log_prefix_list = f"[LMStudioProvider(ListModels for '{self.get_user_defined_model_id()}')]"
        if not self.is_client_ready() or self.client is None:
            logger.warning(f"{log_prefix_list} 客户端未就绪，无法获取可用模型列表。")
            return []
            
        models_endpoint = f"{self.model_config.base_url.rstrip('/')}/v1/models"

        try:
            response = await self.client.get(models_endpoint)
            response.raise_for_status()
            models_data = response.json()

            if "data" in models_data and isinstance(models_data["data"], list):
                available_models = []
                for model_info in models_data["data"]:
                    model_id = model_info.get("id")
                    if model_id:
                        available_models.append({
                            "id": model_id,
                            "name": f"LM Studio: {model_id.split('/')[-1]}", # 使用更友好的名称
                            "provider_tag": self.PROVIDER_TAG,
                            "notes": "由 LM Studio API 发现（当前已加载）"
                        })
                logger.info(f"{log_prefix_list} 从 LM Studio API 成功获取 {len(available_models)} 个模型。")
                return available_models
            else:
                logger.warning(f"{log_prefix_list} LM Studio 模型列表API的响应格式不正确：缺少 'data' 字段。")
                return []

        except (httpx.RequestError, httpx.HTTPStatusError) as e:
            logger.error(f"{log_prefix_list} 从 LM Studio API 获取可用模型列表失败: {e}")
            return []
        except Exception as e_generic:
            logger.error(f"{log_prefix_list} 获取可用模型列表时发生未知错误: {e_generic}", exc_info=True)
            return []