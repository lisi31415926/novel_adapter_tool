# backend/app/llm_providers/gemini_provider.py
import logging
import os
import asyncio # 确保导入 asyncio
import time
from typing import Dict, Any, Optional, Tuple, List, Union # 确保导入 Union

# Google Generative AI SDK
try:
    import google.generativeai as genai
    from google.generativeai.types import GenerationConfig, ContentDict, PartDict # type: ignore[attr-defined]
    from google.generativeai.types import HarmCategory, HarmBlockThreshold, SafetySettingDict # type: ignore[attr-defined]
    from google.api_core import exceptions as GoogleAPICoreExceptions # type: ignore[attr-defined]
    GEMINI_SDK_AVAILABLE = True
except ImportError:
    genai = None # type: ignore
    GenerationConfig = None # type: ignore
    ContentDict = None # type: ignore
    PartDict = None # type: ignore
    HarmCategory = None # type: ignore
    HarmBlockThreshold = None # type: ignore
    SafetySettingDict = None # type: ignore
    GoogleAPICoreExceptions = None # type: ignore
    GEMINI_SDK_AVAILABLE = False
    logging.warning(
        "Google Generative AI SDK (google-generativeai) 未安装。"
        "GeminiProvider 将不可用。请运行 'pip install google-generativeai'"
    )

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

# 移除本地定义的 ContentSafetyException
# class ContentSafetyException(RuntimeError):
# ... (本地定义已移除)

# 将字符串映射到 HarmCategory 和 HarmBlockThreshold 枚举成员
HARM_CATEGORY_MAP: Dict[str, Any] = {
    name: getattr(HarmCategory, name) for name in dir(HarmCategory) if name.startswith("HARM_CATEGORY_")
} if HarmCategory else {}

HARM_BLOCK_THRESHOLD_MAP: Dict[str, Any] = {
    name: getattr(HarmBlockThreshold, name) for name in dir(HarmBlockThreshold) if name.startswith("BLOCK_")
} if HarmBlockThreshold else {}


class GeminiProvider(BaseLLMProvider):
    """
    Google Gemini LLM 提供商实现。
    """
    PROVIDER_TAG = "google_gemini" # 与 llm_providers/__init__.py 中注册的键一致

    def __init__(
        self,
        model_config: schemas.UserDefinedLLMConfigSchema,
        provider_config: schemas.LLMProviderConfigSchema
    ):
        """
        初始化 Google Gemini 提供商。
        """
        super().__init__(model_config, provider_config)

        if not GEMINI_SDK_AVAILABLE or not genai:
            logger.error("GeminiProvider 初始化失败：google-generativeai SDK 未安装或未成功导入。")
            self.client = None
            self._sdk_ready = False
            return

        self._sdk_ready = True
        api_key_to_use = self.model_config.api_key

        if not api_key_to_use:
            env_api_key = os.getenv("GOOGLE_API_KEY", os.getenv("GEMINI_API_KEY"))
            if env_api_key:
                api_key_to_use = env_api_key
                logger.info(f"GeminiProvider (模型: {self.model_config.user_given_name}): 从环境变量 GOOGLE_API_KEY/GEMINI_API_KEY 加载了API密钥。")
            else:
                logger.error(
                    f"GeminiProvider (模型: {self.model_config.user_given_name}) 初始化失败："
                    "未在模型配置中提供API密钥，也未在环境变量 GOOGLE_API_KEY 或 GEMINI_API_KEY 中找到。"
                )
                self.client = None
                self._sdk_ready = False
                return
        try:
            genai.configure(api_key=api_key_to_use)
            self.client = genai # 表示 genai 已配置
            
            app_config_obj = config_service.get_config()
            gemini_safety_config_dict = app_config_obj.llm_settings.gemini_safety_settings or {}
            
            self.default_safety_settings: Optional[List[SafetySettingDict]] = None
            if isinstance(gemini_safety_config_dict, dict) and gemini_safety_config_dict:
                parsed_settings: List[SafetySettingDict] = []
                for category_str, threshold_str in gemini_safety_config_dict.items():
                    category_enum = HARM_CATEGORY_MAP.get(category_str.upper())
                    threshold_enum = HARM_BLOCK_THRESHOLD_MAP.get(threshold_str.upper())
                    if category_enum and threshold_enum:
                        parsed_settings.append({ # type: ignore[misc]
                            "category": category_enum,
                            "threshold": threshold_enum
                        })
                    else:
                        logger.warning(f"GeminiProvider: 无效的安全设置类别 '{category_str}' 或阈值 '{threshold_str}'。将忽略。")
                if parsed_settings:
                    self.default_safety_settings = parsed_settings
            
            logger.info(
                f"GeminiProvider for model '{self.model_config.user_given_name}' (API ID: {self.get_model_identifier_for_api()}) "
                f"已配置。API Key来源: {'模型配置' if self.model_config.api_key else '环境变量或先前配置'}。 "
                f"安全设置: {self.default_safety_settings or 'SDK默认'}."
            )
        except Exception as e:
            logger.error(f"GeminiProvider (模型: {self.model_config.user_given_name}) 配置 google.generativeai 失败: {e}", exc_info=True)
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

        if not self.is_client_ready() or not genai or not GenerationConfig:
            logger.error(f"GeminiProvider (模型: {self.model_config.user_given_name}) 客户端未就绪或SDK组件缺失，无法执行生成。")
            raise LLMConnectionError("Gemini客户端未初始化或SDK组件缺失", provider=self.PROVIDER_TAG)

        effective_model_api_id = self.get_model_identifier_for_api()
        log_prefix = f"[GeminiProvider(ModelUserCfg:'{self.get_user_defined_model_id()}', APIModel:'{effective_model_api_id}')]"

        gen_config_dict: Dict[str, Any] = {}
        global_llm_settings = config_service.get_config().llm_settings

        final_temp = temperature if temperature is not None else global_llm_settings.default_temperature
        if final_temp is not None: gen_config_dict["temperature"] = float(final_temp)
        
        final_max_tokens = max_tokens
        if llm_override_parameters and llm_override_parameters.get("max_output_tokens") is not None:
            final_max_tokens = int(llm_override_parameters["max_output_tokens"])
        elif llm_override_parameters and llm_override_parameters.get("max_tokens") is not None:
            final_max_tokens = int(llm_override_parameters["max_tokens"])
        elif max_tokens is None:
            final_max_tokens = global_llm_settings.default_max_completion_tokens

        if final_max_tokens is not None: gen_config_dict["max_output_tokens"] = int(final_max_tokens)

        if llm_override_parameters:
            if "top_p" in llm_override_parameters and llm_override_parameters["top_p"] is not None:
                gen_config_dict["top_p"] = float(llm_override_parameters["top_p"])
            if "top_k" in llm_override_parameters and llm_override_parameters["top_k"] is not None:
                gen_config_dict["top_k"] = int(llm_override_parameters["top_k"])
            if "stop_sequences" in llm_override_parameters and llm_override_parameters["stop_sequences"] is not None:
                stop_seq = llm_override_parameters["stop_sequences"]
                if isinstance(stop_seq, list) and all(isinstance(s, str) for s in stop_seq):
                    gen_config_dict["stop_sequences"] = stop_seq
                elif isinstance(stop_seq, str):
                    gen_config_dict["stop_sequences"] = [stop_seq]
        
        if is_json_output and ("1.5" in effective_model_api_id or "2.5" in effective_model_api_id):
            gen_config_dict["response_mime_type"] = "application/json"
            logger.debug(f"{log_prefix} 已为模型 '{effective_model_api_id}' 启用JSON输出模式 (response_mime_type)。")
        elif is_json_output:
            logger.warning(f"{log_prefix} 模型 '{effective_model_api_id}' 可能不支持通过 response_mime_type 强制JSON输出。建议在Prompt中明确指示JSON格式。")

        generation_config_obj = GenerationConfig(**gen_config_dict) if gen_config_dict else None
        
        model_init_params: Dict[str, Any] = {}
        if system_prompt and self.model_config.supports_system_prompt:
            model_init_params["system_instruction"] = system_prompt
        elif system_prompt:
            logger.warning(f"{log_prefix} 模型 '{self.get_user_defined_model_id()}' 配置为不支持独立系统提示，但调用时提供了。将尝试合并到用户提示。")
            prompt = f"{system_prompt}\n\n---\n\n用户请求：\n{prompt}"

        contents_for_api: List[Union[str, ContentDict]] = [prompt] # type: ignore[assignment]

        try:
            model_instance = genai.GenerativeModel(
                model_name=effective_model_api_id,
                **model_init_params,
                safety_settings=self.default_safety_settings or kwargs.get("safety_settings")
            )
        except Exception as e_model_init:
            logger.error(f"{log_prefix} 创建Gemini GenerativeModel实例失败: {e_model_init}", exc_info=True)
            raise LLMAPIError(f"创建Gemini模型实例失败: {e_model_init}", provider=self.PROVIDER_TAG) from e_model_init

        logger.debug(f"{log_prefix} 请求 (部分): System Instruction Provided: {bool(model_init_params.get('system_instruction'))}, GenerationConfig: {generation_config_obj}, SafetySettings: {model_instance.safety_settings}")
        
        prompt_tokens_count_for_exc = 0 # For safety exception

        try:
            start_time_ns = time.perf_counter_ns()
            # Count prompt tokens before generation for more accurate cost/error reporting
            try:
                prompt_tokens_resp = await model_instance.count_tokens(contents_for_api) # type: ignore
                prompt_tokens_count_for_exc = prompt_tokens_resp.total_tokens
            except Exception as e_count_prompt_tokens:
                logger.warning(f"{log_prefix} 调用 Gemini count_tokens (prompt) 失败: {e_count_prompt_tokens}。Prompt token数将设为0。")


            response = await model_instance.generate_content(
                contents=contents_for_api, # type: ignore
                generation_config=generation_config_obj,
                request_options={"timeout": self.provider_config.api_timeout_seconds} if self.provider_config.api_timeout_seconds else None
            )
            duration_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000
            logger.debug(f"{log_prefix} API调用耗时: {duration_ms:.2f}ms")

            if response.prompt_feedback and response.prompt_feedback.block_reason:
                block_reason_msg = response.prompt_feedback.block_reason.name
                logger.error(f"{log_prefix} Gemini API 因提示内容安全问题阻止了请求: {block_reason_msg}. Details: {response.prompt_feedback.safety_ratings}")
                raise GlobalContentSafetyException(
                    message=f"Gemini API 因提示内容安全阻止了请求: {block_reason_msg}",
                    provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                    details={"prompt_feedback": str(response.prompt_feedback)},
                    prompt_tokens=prompt_tokens_count_for_exc,
                    finish_reason="prompt_content_filter" # Or map block_reason_msg
                )

            if not response.candidates:
                logger.error(f"{log_prefix} Gemini API 响应中 candidates 为空。Response: {response}")
                raise LLMAPIError(f"Gemini API 响应中 candidates 为空 (模型: {effective_model_api_id})", provider=self.PROVIDER_TAG)

            candidate = response.candidates[0]
            finish_reason_name = candidate.finish_reason.name if candidate.finish_reason else "UNKNOWN"

            if finish_reason_name == "SAFETY":
                logger.error(f"{log_prefix} Gemini API 响应的完成原因为 'SAFETY'。Safety Ratings: {candidate.safety_ratings}")
                raise GlobalContentSafetyException(
                    message=f"Gemini API 因生成内容安全问题阻止了响应 (finish_reason: SAFETY)。",
                    provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                    details={"candidate_feedback": str(candidate)},
                    prompt_tokens=prompt_tokens_count_for_exc,
                    finish_reason=finish_reason_name
                )
            elif finish_reason_name not in ["STOP", "MAX_TOKENS", "MODEL_LENGTH", "OTHER"]: # Allow OTHER
                logger.error(f"{log_prefix} Gemini API 响应的完成原因为 '{finish_reason_name}' (非预期)。Safety Ratings: {candidate.safety_ratings}")
                raise LLMAPIError(f"Gemini API 响应的完成原因为 '{finish_reason_name}' (非预期，模型: {effective_model_api_id})", provider=self.PROVIDER_TAG)

            generated_text = "".join(part.text for part in candidate.content.parts if hasattr(part, 'text') and part.text)
            if not generated_text.strip() and finish_reason_name != "STOP":
                 logger.warning(f"{log_prefix} Gemini API 返回空文本，但完成原因不是 STOP (而是 {finish_reason_name})。")
            
            completion_tokens_count = 0
            try:
                completion_tokens_resp = await model_instance.count_tokens(generated_text)
                completion_tokens_count = completion_tokens_resp.total_tokens
            except Exception as e_count_completion_tokens:
                logger.warning(f"{log_prefix} 调用 Gemini count_tokens (completion) 失败: {e_count_completion_tokens}。Completion token数将设为0。")

            total_tokens_count = prompt_tokens_count_for_exc + completion_tokens_count
            logger.debug(f"{log_prefix} Token 使用情况: Prompt={prompt_tokens_count_for_exc}, Completion={completion_tokens_count}, Total={total_tokens_count}")
            
            return LLMResponse(
                text=generated_text,
                model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=prompt_tokens_count_for_exc,
                completion_tokens=completion_tokens_count,
                total_tokens=total_tokens_count,
                finish_reason=finish_reason_name,
                error=None
            )
        
        except GlobalContentSafetyException: # Re-raise our specific safety exception
            raise
        except GoogleAPICoreExceptions.PermissionDenied as e:
            error_message = f"Gemini API 权限被拒绝: {e.message if hasattr(e, 'message') else str(e)}"
            logger.error(f"{log_prefix} {error_message}", exc_info=False)
            raise LLMAuthenticationError(error_message, provider=self.PROVIDER_TAG) from e
        except GoogleAPICoreExceptions.ResourceExhausted as e: # Often for rate limits
            error_message = f"Gemini API 资源耗尽 (可能速率限制): {e.message if hasattr(e, 'message') else str(e)}"
            logger.warning(f"{log_prefix} {error_message}")
            raise LLMRateLimitError(error_message, provider=self.PROVIDER_TAG) from e
        except (GoogleAPICoreExceptions.DeadlineExceeded, GoogleAPICoreExceptions.ServiceUnavailable) as e:
            error_message = f"Gemini API 连接或超时错误: {e.message if hasattr(e, 'message') else str(e)}"
            logger.warning(f"{log_prefix} {error_message}")
            raise LLMConnectionError(error_message, provider=self.PROVIDER_TAG) from e
        except GoogleAPICoreExceptions.GoogleAPIError as e_google_api:
            error_message_str = getattr(e_google_api, 'message', str(e_google_api))
            logger.error(f"{log_prefix} Google API 通用错误 (模型: {effective_model_api_id}): {error_message_str}", exc_info=False)
            
            err_str_lower = error_message_str.lower()
            # Check for safety related terms, excluding known non-safety permission/API key errors
            is_api_safety_error = any(keyword in err_str_lower for keyword in ["safety", "blocked", "policy violation", "recitation", "prohibited"]) and \
                                  not ("api key" in err_str_lower or "permission" in err_str_lower or "quota" in err_str_lower)

            if is_api_safety_error:
                logger.error(f"{log_prefix} Google API 错误似乎与内容安全相关: {e_google_api}")
                raise GlobalContentSafetyException(
                    message=f"Google API 错误可能与内容安全相关: {error_message_str}",
                    provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                    details={"error_type": type(e_google_api).__name__, "error_details": str(e_google_api)},
                    prompt_tokens=prompt_tokens_count_for_exc,
                    finish_reason="safety_related_api_error"
                )
            raise LLMAPIError(f"Google API 错误: {error_message_str}", provider=self.PROVIDER_TAG) from e_google_api
        except Exception as e_generate_unknown:
            logger.error(f"{log_prefix} 调用 Gemini API generate 时发生未知错误: {e_generate_unknown}", exc_info=True)
            raise LLMAPIError(f"调用 Gemini 模型时发生未知错误: {str(e_generate_unknown)}", provider=self.PROVIDER_TAG) from e_generate_unknown

    def get_model_capabilities(self) -> Dict[str, Any]:
        base_capabilities = {
            "max_context_tokens": self.model_config.max_context_tokens,
            "supports_system_prompt": self.model_config.supports_system_prompt,
        }
        
        if base_capabilities["max_context_tokens"] is None:
            model_api_id = self.get_model_identifier_for_api().lower()
            inferred_max_tokens = None
            if "gemini-1.5-pro" in model_api_id or "gemini-1.5-flash" in model_api_id: inferred_max_tokens = 1048576
            elif "gemini-2.5-pro" in model_api_id or "gemini-2.5-flash" in model_api_id: inferred_max_tokens = 1048576
            elif "gemini-1.0-pro" in model_api_id or model_api_id == "gemini-pro": inferred_max_tokens = 32768
            
            if inferred_max_tokens is not None:
                base_capabilities["max_context_tokens"] = inferred_max_tokens
                logger.debug(f"GeminiProvider for '{self.get_user_defined_model_id()}': 根据API模型ID '{model_api_id}' 推断 max_context_tokens 为 {inferred_max_tokens} (因用户未配置)。")

        return base_capabilities

    async def get_available_models_from_api(self) -> List[Dict[str, Any]]:
        log_prefix_list = f"[GeminiProvider(ListModels for UserCfg:'{self.get_user_defined_model_id()}')]"
        if not self.is_client_ready() or not genai:
            logger.warning(f"{log_prefix_list} SDK 未就绪，无法从API列出模型。")
            return []
        
        try:
            logger.info(f"{log_prefix_list} 尝试从Google API列出可用模型...")
            
            # list_models is synchronous, so wrap in to_thread for async context
            def sync_list_models():
                if not genai: return []
                model_infos_list = []
                for m in genai.list_models():
                    if 'generateContent' in m.supported_generation_methods and \
                       m.name.startswith("models/gemini-"): # Ensure it's a Gemini text generation model
                        model_infos_list.append(m)
                return model_infos_list

            model_infos_iterator = await asyncio.to_thread(sync_list_models)
            
            available_models_result: List[Dict[str, Any]] = []
            for model_info in model_infos_iterator:
                api_model_id = model_info.name.replace("models/", "")
                model_dict = {
                    "id": api_model_id,
                    "name": model_info.display_name or api_model_id,
                    "provider_tag": self.PROVIDER_TAG,
                    "notes": model_info.description or f"由 Google Gemini API 发现。",
                    "max_context_tokens": model_info.input_token_limit or None,
                    "supports_system_prompt": True # Gemini models generally support system prompts
                }
                available_models_result.append(model_dict)
            
            if not available_models_result: # Fallback if API returns empty or filtered list is empty
                logger.warning(f"{log_prefix_list} Google API 未返回任何 Gemini 生成模型，或过滤后为空。返回已知模型列表。")
                # (Fallback known models list from previous response)
                known_gemini_models_for_ui = [
                    {"id": "gemini-1.5-pro-latest", "name": "Gemini 1.5 Pro (Latest)", "max_tokens": 1048576, "notes": "Google的高性能、超长上下文模型。"},
                    {"id": "gemini-1.5-flash-latest", "name": "Gemini 1.5 Flash (Latest)", "max_tokens": 1048576, "notes": "Google的快速响应、长上下文模型。"},
                    {"id": "gemini-1.0-pro", "name": "Gemini 1.0 Pro (Legacy)", "max_tokens": 32768, "notes": "Google的旧版Pro模型。"},
                ]
                for model_data in known_gemini_models_for_ui:
                     available_models_result.append({
                        "id": model_data["id"], "name": model_data["name"],
                        "provider_tag": self.PROVIDER_TAG, "notes": model_data.get("notes", "Google Gemini 模型。"),
                        "max_context_tokens": model_data.get("max_tokens"), "supports_system_prompt": True,
                     })

            logger.info(f"{log_prefix_list} 返回 {len(available_models_result)} 个 Gemini 模型信息。")
            return available_models_result
            
        except Exception as e_list_models:
            logger.error(f"{log_prefix_list} 从Google API列出模型时发生错误: {e_list_models}", exc_info=True)
            return []

    async def test_connection(
        self,
        model_api_id_for_test: Optional[str] = None,
    ) -> Tuple[bool, str, Optional[List[str]]]:
        if not self.is_client_ready() or not genai:
            return False, "Gemini SDK未初始化或不可用。", ["请检查依赖库 google-generativeai 是否已正确安装和配置API密钥。"]

        test_model_id = model_api_id_for_test or self.provider_config.default_test_model_id or self.get_model_identifier_for_api()
        if not test_model_id:
            return False, "无法确定用于测试的Gemini模型ID。", ["请在配置中指定 default_test_model_id 或确保当前模型配置了 model_identifier_for_api。"]
        
        # 如果测试模型ID包含 "models/" 前缀，则移除它，因为 GenerativeModel 初始化时不需要
        if test_model_id.startswith("models/"):
            test_model_id_cleaned = test_model_id.split("models/", 1)[-1]
        else:
            test_model_id_cleaned = test_model_id

        logger.info(f"[Gemini-TestConnection] 开始测试连接，使用模型: {test_model_id_cleaned}")
        
        model_instance_for_test: Optional[Any] = None
        try:
            model_instance_for_test = genai.GenerativeModel(
                model_name=test_model_id_cleaned,
                safety_settings=self.default_safety_settings # 使用配置的安全设置
            )
        except Exception as e_model_create_test:
            logger.error(f"[Gemini-TestConnection] 创建测试模型实例 '{test_model_id_cleaned}' 失败: {e_model_create_test}", exc_info=False)
            return False, f"创建Gemini测试模型实例 '{test_model_id_cleaned}' 失败。", [f"错误: {str(e_model_create_test)[:200]}"]

        if not model_instance_for_test:
             return False, f"未能为测试创建Gemini模型 '{test_model_id_cleaned}' 实例。", None

        try:
            # response = await asyncio.to_thread(
            #     model_instance_for_test.generate_content, "Hello!",
            #     generation_config=GenerationConfig(max_output_tokens=5, temperature=0.1) if GenerationConfig else None
            # )
            response = await model_instance_for_test.generate_content(
                "Hello!", # type: ignore
                generation_config=GenerationConfig(max_output_tokens=5, temperature=0.1) if GenerationConfig else None # type: ignore
            )


            if response.prompt_feedback and response.prompt_feedback.block_reason:
                block_reason_msg = response.prompt_feedback.block_reason.name
                logger.warning(f"[Gemini-TestConnection] 测试请求被安全策略阻止: {block_reason_msg}")
                return False, f"测试请求被Gemini安全策略阻止 (原因: {block_reason_msg})。", [f"Safety Ratings: {response.prompt_feedback.safety_ratings}"]

            if response.candidates and response.candidates[0].content and response.candidates[0].content.parts[0].text:
                logger.info(f"[Gemini-TestConnection] 连接成功。模型响应 (预览): {response.candidates[0].content.parts[0].text[:50]}...")
                return True, f"成功连接到Gemini并从模型 {test_model_id_cleaned} 收到响应。", [f"响应预览: {response.candidates[0].content.parts[0].text[:100]}..."]
            else:
                finish_reason_val = response.candidates[0].finish_reason.name if response.candidates and response.candidates[0].finish_reason else "未知"
                logger.warning(f"[Gemini-TestConnection] 连接测试：模型 {test_model_id_cleaned} 返回了空内容。完成原因: {finish_reason_val}")
                return False, f"连接到Gemini模型 {test_model_id_cleaned} 成功，但模型返回了空响应 (完成原因: {finish_reason_val})。", [f"原始响应对象 (部分): {str(response)[:200]}..."]

        except GoogleAPICoreExceptions.PermissionDenied as e_auth:
            logger.error(f"[Gemini-TestConnection] 认证失败 (模型: {test_model_id_cleaned}): {e_auth}", exc_info=False)
            return False, "Gemini API认证失败。", [f"请检查您的API密钥是否正确并具有访问模型 {test_model_id_cleaned} 的权限。", f"错误详情: {str(e_auth)[:200]}"]
        except GoogleAPICoreExceptions.ResourceExhausted as e_rate: # 通常是速率限制
            logger.warning(f"[Gemini-TestConnection] 遭遇资源耗尽/速率限制 (模型: {test_model_id_cleaned}): {e_rate}")
            return False, "Gemini API资源耗尽或速率限制。", [f"请稍后再试或检查您的API使用限制。", f"错误详情: {str(e_rate)[:200]}"]
        except (GoogleAPICoreExceptions.DeadlineExceeded, GoogleAPICoreExceptions.ServiceUnavailable) as e_conn:
            logger.error(f"[Gemini-TestConnection] 连接或超时错误 (模型: {test_model_id_cleaned}): {e_conn}", exc_info=False)
            return False, "无法连接到Gemini API或请求超时。", [f"请检查您的网络连接和Google Cloud服务状态。", f"错误详情: {str(e_conn)[:200]}"]
        except GoogleAPICoreExceptions.GoogleAPIError as e_api:
            msg = getattr(e_api, 'message', str(e_api))
            logger.error(f"[Gemini-TestConnection] API调用时发生错误 (模型: {test_model_id_cleaned}): {msg}", exc_info=True)
            details = [f"错误类型: {type(e_api).__name__}", f"错误消息: {str(msg)[:200]}"]
            return False, f"调用Gemini API时发生错误 (模型: {test_model_id_cleaned})。", details
        except Exception as e_unknown_test:
            logger.error(f"[Gemini-TestConnection] 测试连接时发生未知错误 (模型: {test_model_id_cleaned}): {e_unknown_test}", exc_info=True)
            return False, "测试Gemini连接时发生未知错误。", [f"错误详情: {str(e_unknown_test)[:200]}"]