# backend/app/llm_providers/gemini_provider.py
import logging
import os
import asyncio
import time
from typing import Dict, Any, Optional, Tuple, List, Union # 确保导入 Union

# Google Generative AI SDK
try:
    import google.generativeai as genai
    # 导入类型时，如果SDK版本变化导致路径改变，需要相应调整
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

logger = logging.getLogger(__name__)

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

# 将字符串映射到 HarmCategory 和 HarmBlockThreshold 枚举成员
# (保持与您上传的文件一致)
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

        Args:
            model_config: 此特定模型的用户定义配置。
            provider_config: Gemini 提供商的全局配置。
        """
        super().__init__(model_config, provider_config) # 调用基类构造函数

        if not GEMINI_SDK_AVAILABLE or not genai:
            logger.error("GeminiProvider 初始化失败：google-generativeai SDK 未安装或未成功导入。")
            self.client = None # 明确 client 为 None
            self._sdk_ready = False
            return

        self._sdk_ready = True
        # API Key 从 model_config 中获取，如果为空，genai.configure 内部会尝试环境变量
        api_key_to_use = self.model_config.api_key

        if not api_key_to_use:
            # 尝试从环境变量获取 (作为备用，因为 model_config.api_key 应该是经过配置服务处理的最终值)
            api_key_to_use = os.getenv("GOOGLE_API_KEY", os.getenv("GEMINI_API_KEY"))
            if not api_key_to_use:
                 logger.error(
                    f"GeminiProvider (模型: {self.model_config.user_given_name}) 初始化失败："
                    "未在模型配置中提供API密钥，也未在环境变量 GOOGLE_API_KEY 或 GEMINI_API_KEY 中找到。"
                )
                 self.client = None # 明确 client 为 None
                 self._sdk_ready = False # 标记SDK配置失败
                 return

        try:
            # 配置Google AI SDK的API密钥 (全局配置)
            # 注意：genai.configure 是全局性的，多次调用可能会覆盖。
            # 理想情况下，如果SDK支持每个模型实例使用不同密钥，会更好。
            # 当前Gemini Python SDK似乎主要通过 genai.configure 进行全局设置。
            # 这意味着如果同时使用多个不同API Key的Gemini模型配置，可能会有问题。
            # 此处假设所有 Gemini 模型配置共享同一个通过 genai.configure 设置的 API Key。
            # 如果 UserDefinedLLMConfig 中指定了 api_key，则使用它配置SDK。
            genai.configure(api_key=api_key_to_use)
            
            # self.client 在Gemini中不是一个持久的客户端对象，而是在每次请求时创建 GenerativeModel
            # 因此，这里可以将 self.client 设为 True 或 genai 本身，以通过 is_client_ready() 检查
            self.client = genai # 表示 genai 已配置
            
            # 从应用配置的 llm_settings 中获取 Gemini 的全局安全设置
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

    # 覆盖基类的 is_client_ready
    def is_client_ready(self) -> bool:
        return bool(self._sdk_ready and self.client is not None)

    async def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        is_json_output: bool = False, # Gemini 对 JSON 输出有特定要求
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        llm_override_parameters: Optional[Dict[str, Any]] = None,
        **kwargs: Any
    ) -> LLMResponse:

        if not self.is_client_ready() or not genai or not GenerationConfig:
            logger.error(f"GeminiProvider (模型: {self.model_config.user_given_name}) 客户端未就绪或SDK组件缺失，无法执行生成。")
            return LLMResponse(
                text="", model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=0, completion_tokens=0, total_tokens=0,
                finish_reason="error", error="Gemini客户端未初始化或SDK组件缺失"
            )

        effective_model_api_id = self.get_model_identifier_for_api()
        log_prefix = f"[GeminiProvider(ModelUserCfg:'{self.get_user_defined_model_id()}', APIModel:'{effective_model_api_id}')]"

        # 准备 GenerationConfig
        gen_config_dict: Dict[str, Any] = {}
        global_llm_settings = config_service.get_config().llm_settings

        final_temp = temperature if temperature is not None else global_llm_settings.default_temperature
        if final_temp is not None: gen_config_dict["temperature"] = float(final_temp)
        
        # Gemini 使用 max_output_tokens
        final_max_tokens = max_tokens
        if llm_override_parameters and llm_override_parameters.get("max_output_tokens") is not None:
            final_max_tokens = int(llm_override_parameters["max_output_tokens"])
        elif llm_override_parameters and llm_override_parameters.get("max_tokens") is not None: # 兼容通用名
            final_max_tokens = int(llm_override_parameters["max_tokens"])
        elif max_tokens is None: # 如果调用时没传，也没有覆盖，则用全局默认
            final_max_tokens = global_llm_settings.default_max_completion_tokens

        if final_max_tokens is not None: gen_config_dict["max_output_tokens"] = int(final_max_tokens)


        # 其他常见可覆盖参数
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
        
        # 处理 is_json_output
        # Gemini 1.5 Pro and Flash support JSON mode via response_mime_type
        if is_json_output and ("1.5" in effective_model_api_id or "2.5" in effective_model_api_id): # 根据模型名称判断是否支持
            gen_config_dict["response_mime_type"] = "application/json"
            logger.debug(f"{log_prefix} 已为模型 '{effective_model_api_id}' 启用JSON输出模式 (response_mime_type)。")
        elif is_json_output:
            logger.warning(f"{log_prefix} 模型 '{effective_model_api_id}' 可能不支持通过 response_mime_type 强制JSON输出。建议在Prompt中明确指示JSON格式。")
            # 可以在 system_prompt 或 user_prompt 中追加 "请确保输出是有效的JSON对象。"

        generation_config_obj = GenerationConfig(**gen_config_dict) if gen_config_dict else None
        
        model_init_params: Dict[str, Any] = {}
        # Gemini 通过 system_instruction 参数支持系统提示
        if system_prompt and self.model_config.supports_system_prompt:
            model_init_params["system_instruction"] = system_prompt
        elif system_prompt: # 模型不支持独立系统提示，但调用时提供了
            logger.warning(f"{log_prefix} 模型 '{self.get_user_defined_model_id()}' 配置为不支持独立系统提示，但调用时提供了。将尝试合并到用户提示。")
            prompt = f"{system_prompt}\n\n---\n\n用户请求：\n{prompt}"

        # Gemini 的 contents API 更灵活，但对于简单 User->Model 交互，可以直接传递字符串
        # 为了更可控，这里构建 ContentDict 列表
        contents_for_api: List[Union[str, ContentDict]] = [prompt] # type: ignore[assignment] #

        # 创建模型实例 (每次调用都创建，因为 system_instruction 是模型初始化参数)
        try:
            model_instance = genai.GenerativeModel(
                model_name=effective_model_api_id,
                **model_init_params, # 包含 system_instruction
                safety_settings=self.default_safety_settings or kwargs.get("safety_settings") # 优先使用实例的，其次是kwargs传入的
            )
        except Exception as e_model_init:
            logger.error(f"{log_prefix} 创建Gemini GenerativeModel实例失败: {e_model_init}", exc_info=True)
            return LLMResponse( text="", model_id_used=self.get_user_defined_model_id(), prompt_tokens=0, completion_tokens=0, total_tokens=0, finish_reason="error", error=f"创建Gemini模型实例失败: {e_model_init}" )

        logger.debug(f"{log_prefix} 请求 (部分): System Instruction Provided: {bool(model_init_params.get('system_instruction'))}, GenerationConfig: {generation_config_obj}, SafetySettings: {model_instance.safety_settings}")

        try:
            start_time_ns = time.perf_counter_ns()
            # 使用 asyncio.to_thread 运行同步的SDK调用，避免阻塞事件循环
            # response = await asyncio.to_thread(
            #     model_instance.generate_content,
            #     contents=contents_for_api,
            #     generation_config=generation_config_obj,
            #     # safety_settings 在模型初始化时已设置
            #     request_options={"timeout": self.provider_config.api_timeout_seconds} if self.provider_config.api_timeout_seconds else None
            # )
            # Gemini SDK v0.5.0+ 的 generate_content 是异步的
            response = await model_instance.generate_content(
                contents=contents_for_api, # type: ignore
                generation_config=generation_config_obj,
                request_options={"timeout": self.provider_config.api_timeout_seconds} if self.provider_config.api_timeout_seconds else None
            )

            duration_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000
            logger.debug(f"{log_prefix} API调用耗时: {duration_ms:.2f}ms")

            # 处理响应
            if response.prompt_feedback and response.prompt_feedback.block_reason:
                block_reason_msg = response.prompt_feedback.block_reason.name
                logger.error(f"{log_prefix} Gemini API 因提示内容安全问题阻止了请求: {block_reason_msg}. Details: {response.prompt_feedback.safety_ratings}")
                raise ContentSafetyException(
                    message=f"Gemini API 因提示内容安全阻止了请求: {block_reason_msg}",
                    provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                    details={"prompt_feedback": str(response.prompt_feedback)}
                )

            if not response.candidates:
                logger.error(f"{log_prefix} Gemini API 响应中 candidates 为空。Response: {response}")
                raise ValueError(f"Gemini API 响应中 candidates 为空 (模型: {effective_model_api_id})")

            candidate = response.candidates[0]
            # Gemini SDK v0.5.0 finish_reason 是枚举类型 HarmCategory
            # finish_reason.name 可能是 "STOP", "MAX_TOKENS", "SAFETY", "RECITATION", "OTHER"
            finish_reason_name = candidate.finish_reason.name if candidate.finish_reason else "UNKNOWN"

            if finish_reason_name not in ["STOP", "MAX_TOKENS", "MODEL_LENGTH", "OTHER"]: # 允许 OTHER 作为一种可能的完成
                logger.error(f"{log_prefix} Gemini API 响应的完成原因为 '{finish_reason_name}' (非预期)。Safety Ratings: {candidate.safety_ratings}")
                if finish_reason_name == "SAFETY":
                    raise ContentSafetyException(
                        message=f"Gemini API 因生成内容安全问题阻止了响应 (finish_reason: SAFETY)。",
                        provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                        details={"candidate_feedback": str(candidate)}
                    )
                # 对于其他非预期的 finish_reason，也视为一种错误
                raise ValueError(f"Gemini API 响应的完成原因为 '{finish_reason_name}' (非预期，模型: {effective_model_api_id})")

            generated_text = "".join(part.text for part in candidate.content.parts if hasattr(part, 'text') and part.text)
            if not generated_text.strip() and finish_reason_name != "STOP":
                 logger.warning(f"{log_prefix} Gemini API 返回空文本，但完成原因不是 STOP (而是 {finish_reason_name})。")
            
            # Token 计数 (Gemini SDK 自身不直接在 generate_content 响应中返回 usage_metadata)
            # 需要分别调用 model.count_tokens
            prompt_tokens = 0; completion_tokens = 0
            try:
                # prompt_tokens_resp = await asyncio.to_thread(model_instance.count_tokens, contents_for_api)
                prompt_tokens_resp = await model_instance.count_tokens(contents_for_api) # type: ignore
                prompt_tokens = prompt_tokens_resp.total_tokens
                
                # completion_tokens_resp = await asyncio.to_thread(model_instance.count_tokens, generated_text)
                completion_tokens_resp = await model_instance.count_tokens(generated_text)
                completion_tokens = completion_tokens_resp.total_tokens
            except Exception as e_count_tokens:
                logger.warning(f"{log_prefix} 调用 Gemini count_tokens 失败: {e_count_tokens}。Token数将设为0。")

            total_tokens = prompt_tokens + completion_tokens
            logger.debug(f"{log_prefix} Token 使用情况: Prompt={prompt_tokens}, Completion={completion_tokens}, Total={total_tokens}")
            
            return LLMResponse(
                text=generated_text,
                model_id_used=self.get_user_defined_model_id(), # 返回用户配置的ID
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                finish_reason=finish_reason_name,
                error=None
            )

        except ContentSafetyException: # 直接重新抛出由我们定义的 ContentSafetyException
            raise
        except GoogleAPICoreExceptions.GoogleAPIError as e_google_api: # 捕获所有Google API核心错误
            error_message_str = getattr(e_google_api, 'message', str(e_google_api))
            logger.error(f"{log_prefix} Google API 错误 (模型: {effective_model_api_id}): {error_message_str}", exc_info=False)
            
            # 尝试从错误中判断是否为内容安全相关
            err_str_lower = error_message_str.lower()
            is_api_safety_error = any(keyword in err_str_lower for keyword in ["safety", "blocked", "policy violation", "recitation", "prohibited"]) or \
                                  (isinstance(e_google_api, GoogleAPICoreExceptions.PermissionDenied) and "API key not valid" not in err_str_lower and "permission" not in err_str_lower) # 排除权限问题

            if is_api_safety_error:
                logger.error(f"{log_prefix} Google API 错误似乎与内容安全相关: {e_google_api}")
                raise ContentSafetyException(
                    message=f"Google API 错误可能与内容安全相关: {error_message_str}",
                    provider=self.PROVIDER_TAG, model_id=self.get_user_defined_model_id(),
                    details={"error_type": type(e_google_api).__name__, "error_details": str(e_google_api)}
                )
            # 对于其他类型的 GoogleAPIError，返回包含错误信息的LLMResponse
            return LLMResponse(
                text="", model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=prompt_tokens, completion_tokens=completion_tokens, total_tokens=total_tokens,
                finish_reason="error", error=f"Google API 错误: {error_message_str}"
            )
        except Exception as e_generate_unknown:
            logger.error(f"{log_prefix} 调用 Gemini API generate 时发生未知错误: {e_generate_unknown}", exc_info=True)
            return LLMResponse(
                text="", model_id_used=self.get_user_defined_model_id(),
                prompt_tokens=0, completion_tokens=0, total_tokens=0,
                finish_reason="error", error=f"调用 Gemini 模型时发生未知错误: {str(e_generate_unknown)}"
            )

    def get_model_capabilities(self) -> Dict[str, Any]:
        """获取此Gemini模型实例的能力。主要信息来自 UserDefinedLLMConfig。"""
        # 基类中的 get_model_identifier_for_api() 和 get_user_defined_model_id() 可用
        # model_config 已在 self.model_config 中
        base_capabilities = {
            "max_context_tokens": self.model_config.max_context_tokens,
            "supports_system_prompt": self.model_config.supports_system_prompt,
        }
        
        # 如果用户配置中未明确指定最大token数，则尝试根据API模型ID推断
        if base_capabilities["max_context_tokens"] is None:
            model_api_id = self.get_model_identifier_for_api().lower()
            inferred_max_tokens = None
            # 根据Google官方文档或常见模型更新此列表
            if "gemini-1.5-pro" in model_api_id or "gemini-1.5-flash" in model_api_id: inferred_max_tokens = 1048576 # 1M
            elif "gemini-2.5-pro" in model_api_id or "gemini-2.5-flash" in model_api_id: inferred_max_tokens = 1048576 # 假设2.5系列也支持1M或更高
            elif "gemini-1.0-pro" in model_api_id or model_api_id == "gemini-pro": inferred_max_tokens = 32768
            # ... 其他 Gemini 模型
            
            if inferred_max_tokens is not None:
                base_capabilities["max_context_tokens"] = inferred_max_tokens
                logger.debug(f"GeminiProvider for '{self.get_user_defined_model_id()}': 根据API模型ID '{model_api_id}' 推断 max_context_tokens 为 {inferred_max_tokens} (因用户未配置)。")

        return base_capabilities

    async def get_available_models_from_api(self) -> List[Dict[str, Any]]:
        """
        从 Google Gemini API 获取当前 API 密钥可访问的模型列表 (如果SDK支持)。
        Gemini SDK 通常通过 `genai.list_models()` 获取。
        """
        log_prefix_list = f"[GeminiProvider(ListModels for UserCfg:'{self.get_user_defined_model_id()}')]"
        if not self.is_client_ready() or not genai:
            logger.warning(f"{log_prefix_list} SDK 未就绪，无法从API列出模型。")
            return []
        
        try:
            logger.info(f"{log_prefix_list} 尝试从Google API列出可用模型...")
            # SDK的 list_models() 是同步的，需要在线程中运行
            # model_infos_iterator = await asyncio.to_thread(genai.list_models)
            # genai.list_models() 返回一个迭代器，我们需要将其转换为列表
            # 在新版SDK中，genai.list_models() 返回 ModelInfo 的迭代器

            # 查找支持 'generateContent' 方法的模型（即文本生成模型）
            # 并且通常我们只关心以 "models/gemini-" 开头的模型
            # 注意：如果 genai.list_models() 内部有网络IO，且非异步，则此调用仍可能阻塞
            # 理想情况下，SDK会提供异步版本。
            # 当前版本(0.5.0)的 genai.list_models() 似乎是同步的。
            
            available_models_result: List[Dict[str, Any]] = []
            # for model_info in model_infos_iterator:
            #     if 'generateContent' in model_info.supported_generation_methods and \
            #        model_info.name.startswith("models/gemini-"):
            #         api_model_id = model_info.name.replace("models/", "") # 去掉 "models/" 前缀
            #         model_dict = {
            #             "id": api_model_id,
            #             "name": model_info.display_name or api_model_id,
            #             "provider_tag": self.PROVIDER_TAG,
            #             "notes": model_info.description or f"由 Google Gemini API 发现。",
            #             "max_context_tokens": model_info.input_token_limit or None,
            #             "supports_system_prompt": True # Gemini 模型通常支持系统提示
            #         }
            #         available_models_result.append(model_dict)
            
            # 由于 genai.list_models() 是同步的，这里用一个硬编码列表作为示例，
            # 与您原始文件中的 get_available_models 行为类似。
            # 实际应用中，如果需要动态获取，应确保 genai.list_models() 异步执行或在后台任务中缓存。
            # 此处返回与您配置中已定义的 Gemini 模型相似的信息，或更通用的已知模型。
            # 最好是让用户在前端配置他们有权限访问的具体模型ID。
            
            logger.warning(f"{log_prefix_list} Gemini SDK 的 `list_models` 是同步的，目前返回已知模型列表而非实时API查询结果。")
            known_gemini_models_for_ui = [ # 与 schemas.py 中的 get_available_models 示例对齐
                {"id": "gemini-1.5-pro-latest", "name": "Gemini 1.5 Pro (Latest)", "max_tokens": 1048576, "notes": "Google的高性能、超长上下文模型。"},
                {"id": "gemini-1.5-flash-latest", "name": "Gemini 1.5 Flash (Latest)", "max_tokens": 1048576, "notes": "Google的快速响应、长上下文模型。"},
                {"id": "gemini-1.0-pro", "name": "Gemini 1.0 Pro (Legacy)", "max_tokens": 32768, "notes": "Google的旧版Pro模型。"},
                # 更多模型可以从官方文档获取
            ]
            for model_data in known_gemini_models_for_ui:
                 available_models_result.append({
                    "id": model_data["id"],
                    "name": model_data["name"],
                    "provider_tag": self.PROVIDER_TAG,
                    "notes": model_data.get("notes", "Google Gemini 模型。"),
                    "max_context_tokens": model_data.get("max_tokens"),
                    "supports_system_prompt": True,
                 })

            logger.info(f"{log_prefix_list} 返回 {len(available_models_result)} 个已知的 Gemini 模型信息 (非实时API查询)。")
            return available_models_result
            
        except Exception as e_list_models:
            logger.error(f"{log_prefix_list} 从Google API列出模型时发生错误: {e_list_models}", exc_info=True)
            return []