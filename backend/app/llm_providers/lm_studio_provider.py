# backend/app/llm_providers/lm_studio_provider.py
import logging
import time
from typing import Dict, Any, Optional, Tuple, List, Union

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    httpx = None # type: ignore
    HTTPX_AVAILABLE = False
    logging.warning("httpx 未安装。LMStudioProvider 将不可用。请运行 'pip install httpx'")

# 导入新的基类和响应模型
from .base_llm_provider import BaseLLMProvider, LLMResponse
# 导入类型化的配置模型和全局配置服务
from app import schemas, config_service

# 从 app.exceptions 导入统一的异常类
from app.exceptions import (
    LLMAPIError,
    LLMAuthenticationError,
    LLMConnectionError,
    LLMRateLimitError
    # 此提供商不直接处理内容安全，因此不导入 ContentSafetyException
)


logger = logging.getLogger(__name__)

# LM Studio 的默认本地服务器地址
DEFAULT_LM_STUDIO_BASE_URL = "http://localhost:1234/v1"

class LMStudioProvider(BaseLLMProvider):
    """
    与 LM Studio 本地服务器交互的 LLM 提供商。
    LM Studio 提供了一个与 OpenAI API 兼容的端点。
    """
    PROVIDER_TAG = "lm_studio"

    def __init__(
        self,
        model_config: schemas.UserDefinedLLMConfigSchema,
        provider_config: schemas.LLMProviderConfigSchema
    ):
        """
        初始化 LM Studio 提供商的 httpx 客户端。
        """
        super().__init__(model_config, provider_config)

        if not HTTPX_AVAILABLE or httpx is None:
            logger.error("LMStudioProvider 初始化失败：httpx 库不可用。")
            self.client = None
            self._sdk_ready = False
            return
            
        self._sdk_ready = True
        # LM Studio 通常不需要 API 密钥，但如果用户在代理后面配置了，则可以传递
        self.api_key = self.model_config.api_key or "not-needed" 
        
        # 基础 URL 是必需的，默认为 LM Studio 的本地地址
        self.base_url = self.model_config.base_url or DEFAULT_LM_STUDIO_BASE_URL
        
        timeout_seconds = self.provider_config.api_timeout_seconds or 120 # 默认120秒超时

        try:
            self.client: Optional[httpx.AsyncClient] = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=timeout_seconds,
            )
            logger.info(f"LMStudioProvider 客户端 (模型: {self.model_config.user_given_name}) 已成功初始化。Base URL: {self.base_url}, Timeout: {timeout_seconds}s")
        except Exception as e:
            logger.error(f"LMStudioProvider 初始化 httpx 客户端失败: {e}", exc_info=True)
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
            logger.error(f"LMStudioProvider (模型: {self.model_config.user_given_name}) 错误：客户端未初始化。")
            raise LLMConnectionError("LMStudio客户端未初始化或未就绪", provider=self.PROVIDER_TAG)

        messages: List[Dict[str, str]] = []
        if system_prompt and self.model_config.supports_system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        global_llm_settings = config_service.get_config().llm_settings
        
        # 构建与 OpenAI 兼容的请求体
        payload: Dict[str, Any] = {
            "model": self.get_model_identifier_for_api(), # 在 LM Studio 中，这通常被忽略，但为了兼容性而包含
            "messages": messages,
        }

        final_temp = temperature if temperature is not None else global_llm_settings.default_temperature
        if final_temp is not None: payload["temperature"] = final_temp

        final_max_tokens = max_tokens
        if llm_override_parameters and llm_override_parameters.get("max_tokens"):
             final_max_tokens = llm_override_parameters.get("max_tokens")
        elif max_tokens is None:
            final_max_tokens = global_llm_settings.default_max_completion_tokens or 2048
        
        if final_max_tokens is not None: payload["max_tokens"] = final_max_tokens

        if is_json_output:
            # 对于本地模型，JSON 模式通常通过 prompt engineering 实现
            logger.info("LMStudioProvider: is_json_output=True。请确保在提示中明确要求JSON格式，因为本地模型可能不支持 'response_format' 参数。")

        if llm_override_parameters:
            # 传递其他兼容 OpenAI 的参数
            valid_params = ["top_p", "frequency_penalty", "presence_penalty", "stop", "seed"]
            filtered_params = {k: v for k, v in llm_override_parameters.items() if k in valid_params and v is not None}
            payload.update(filtered_params)

        log_prefix = f"[LMStudioProvider(Model:'{self.get_user_defined_model_id()}')]"
        logger.debug(f"{log_prefix} 请求URL: {self.base_url}/chat/completions, Payload (部分): keys={list(payload.keys())}")
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

        try:
            start_time_ns = time.perf_counter_ns()
            response = await self.client.post(
                url="/chat/completions",
                json=payload,
                headers=headers,
            )
            duration_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000
            logger.debug(f"{log_prefix} API 调用耗时: {duration_ms:.2f}ms")

            # 在这里直接检查响应状态，如果失败则抛出 HTTPStatusError
            response.raise_for_status()

            response_data = response.json()

            if not response_data.get("choices") or not response_data["choices"][0].get("message") or response_data["choices"][0]["message"].get("content") is None:
                logger.warning(f"{log_prefix} LM Studio API 响应中缺少有效内容。响应: {response_data}")
                raise LLMAPIError("LM Studio API 响应内容为空或格式不正确。", provider=self.PROVIDER_TAG)

            generated_text = response_data["choices"][0]["message"]["content"]
            
            token_usage = response_data.get("usage", {})
            prompt_tokens = token_usage.get("prompt_tokens", 0)
            completion_tokens = token_usage.get("completion_tokens", 0)
            total_tokens = token_usage.get("total_tokens", 0)
            
            finish_reason = response_data["choices"][0].get("finish_reason", "unknown")

            return LLMResponse(
                text=generated_text,
                model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                finish_reason=finish_reason,
                error=None
            )

        except httpx.HTTPStatusError as e_http:
            status_code = e_http.response.status_code
            error_body = e_http.response.text
            error_message = f"LM Studio API HTTP 错误 (状态码: {status_code}): {error_body}"
            logger.error(f"{log_prefix} {error_message}", exc_info=False)

            if status_code in [401, 403]:
                raise LLMAuthenticationError(f"认证失败。状态码: {status_code}", provider=self.PROVIDER_TAG) from e_http
            elif status_code == 429:
                raise LLMRateLimitError(f"速率限制。状态码: {status_code}", provider=self.PROVIDER_TAG) from e_http
            elif 400 <= status_code < 500: # 其他客户端错误
                raise LLMAPIError(f"客户端请求错误。状态码: {status_code}, 详情: {error_body}", provider=self.PROVIDER_TAG) from e_http
            elif 500 <= status_code < 600: # 服务端错误
                raise LLMConnectionError(f"LM Studio 服务端错误。状态码: {status_code}, 详情: {error_body}", provider=self.PROVIDER_TAG) from e_http
            else: # 其他未分类的 HTTP 错误
                raise LLMAPIError(error_message, provider=self.PROVIDER_TAG) from e_http
        
        except httpx.RequestError as e_req:
            # 这类错误包括网络连接问题、超时等
            error_message = f"无法连接到 LM Studio 服务器 ({self.base_url}): {e_req}"
            logger.error(f"{log_prefix} {error_message}", exc_info=False)
            raise LLMConnectionError(error_message, provider=self.PROVIDER_TAG) from e_req
            
        except Exception as e_unknown:
            # 捕获其他所有未知异常，如 JSON 解析错误
            error_message = f"调用 LM Studio 时发生未知错误: {e_unknown}"
            logger.error(f"{log_prefix} {error_message}", exc_info=True)
            raise LLMAPIError(error_message, provider=self.PROVIDER_TAG) from e_unknown

    def get_model_capabilities(self) -> Dict[str, Any]:
        # 对于本地模型，这些信息通常由用户在配置中手动设置
        return {
            "max_context_tokens": self.model_config.max_context_tokens or 4096, # 提供一个合理的默认值
            "supports_system_prompt": self.model_config.supports_system_prompt if self.model_config.supports_system_prompt is not None else True,
        }

    async def get_available_models_from_api(self) -> List[Dict[str, Any]]:
        # LM Studio 的 /v1/models 端点返回当前加载的模型
        log_prefix_list = f"[LMStudioProvider(ListModels)]"
        if not self.is_client_ready() or not self.client:
            logger.warning(f"{log_prefix_list} 客户端未就绪，无法从API列出模型。")
            return []

        try:
            response = await self.client.get("/models")
            response.raise_for_status()
            models_data = response.json()
            
            available_models: List[Dict[str, Any]] = []
            if models_data and "data" in models_data:
                for model_info in models_data["data"]:
                    available_models.append({
                        "id": model_info.get("id"),
                        "name": model_info.get("id"),
                        "provider_tag": self.PROVIDER_TAG,
                        "notes": "由 LM Studio 服务器提供",
                    })
            
            logger.info(f"{log_prefix_list} 从 LM Studio API 成功获取 {len(available_models)} 个模型。")
            return available_models
            
        except (httpx.RequestError, httpx.HTTPStatusError) as e:
            logger.error(f"{log_prefix_list} 无法从 LM Studio API 获取模型列表: {e}")
            return []
        except Exception as e_generic:
            logger.error(f"{log_prefix_list} 获取 LM Studio 模型列表时发生未知错误: {e_generic}", exc_info=True)
            return []


    async def test_connection(
        self,
        model_api_id_for_test: Optional[str] = None,
    ) -> Tuple[bool, str, Optional[List[str]]]:
        if not self.is_client_ready() or not self.client:
            return False, "LM Studio 客户端未初始化或 httpx 库不可用。", ["请检查依赖库 httpx 是否已正确安装。"]

        test_url = "/models"
        logger.info(f"[LMStudio-TestConnection] 开始测试连接，请求端点: {self.base_url}{test_url}")
        
        try:
            response = await self.client.get(test_url)
            response.raise_for_status()
            
            # 检查响应体是否为预期的JSON格式
            try:
                models_data = response.json()
                if "data" in models_data and isinstance(models_data["data"], list):
                    loaded_models_count = len(models_data["data"])
                    model_names = [m.get('id', 'N/A') for m in models_data["data"]]
                    message = f"成功连接到 LM Studio 服务器 ({self.base_url})。当前已加载 {loaded_models_count} 个模型。"
                    details = [f"模型列表: {', '.join(model_names) or '无'}"]
                    logger.info(f"[LMStudio-TestConnection] {message}")
                    return True, message, details
                else:
                    logger.warning(f"[LMStudio-TestConnection] 连接成功但响应格式不正确: {response.text[:200]}")
                    return False, "连接到 LM Studio 服务器成功，但响应格式不正确。", ["请确保 LM Studio 服务器正在运行且 '/v1/models' 端点可用。"]
            except Exception as e_json:
                logger.error(f"[LMStudio-TestConnection] 连接成功但JSON解析失败: {e_json}", exc_info=False)
                return False, "连接到 LM Studio 服务器成功，但响应内容无法解析为JSON。", [f"响应文本 (预览): {response.text[:200]}..."]

        except httpx.HTTPStatusError as e_http:
            status_code = e_http.response.status_code
            error_body = e_http.response.text
            msg = f"连接到 LM Studio 服务器时返回 HTTP 错误状态 {status_code}。"
            details = [f"请检查 LM Studio 服务器是否正在运行并且配置的 Base URL ({self.base_url}) 是否正确。", f"响应内容: {error_body[:200]}"]
            logger.error(f"[LMStudio-TestConnection] {msg}", exc_info=False)
            return False, msg, details
        
        except httpx.RequestError as e_req:
            msg = "无法建立到 LM Studio 服务器的连接。"
            details = [f"请确保 LM Studio 服务器正在运行，并且网络可以访问地址 {self.base_url}。", f"错误详情: {str(e_req)}"]
            logger.error(f"[LMStudio-TestConnection] {msg}", exc_info=False)
            return False, msg, details
        
        except Exception as e_unknown:
            msg = "测试 LM Studio 连接时发生未知错误。"
            details = [f"错误详情: {str(e_unknown)}"]
            logger.error(f"[LMStudio-TestConnection] {msg}", exc_info=True)
            return False, msg, details

    async def close(self):
        if self.client:
            await self.client.aclose()
            logger.info(f"LMStudioProvider (模型: {self.model_config.user_given_name}) 的 httpx 客户端已关闭。")