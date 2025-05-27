# backend/app/llm_orchestrator.py
import logging
from typing import Dict, Optional, Type, List, Any # Type, List, Any 是必要的

from . import config_service, schemas # 从同级或上级导入配置服务和Pydantic schemas
from .llm_providers import PROVIDER_CLASSES  # 动态导入所有已注册的提供商类
from .llm_providers.base_llm_provider import BaseLLMProvider, LLMResponse, ContentSafetyException # 导入基础提供商和响应模型

logger = logging.getLogger(__name__)

class LLMOrchestrator:
    """
    LLM 提供商编排器。
    负责根据配置动态加载、实例化和管理所有可用的 LLM 提供商。
    这是一个核心服务，旨在解耦应用逻辑与具体的 LLM 提供商实现。
    """
    _instance: Optional['LLMOrchestrator'] = None # 声明 _instance 类型
    _initialized: bool = False # 跟踪初始化状态

    def __new__(cls, *args, **kwargs) -> 'LLMOrchestrator': # 返回类型声明
        # 实现单例模式，确保整个应用只有一个Orchestrator实例
        if not cls._instance:
            cls._instance = super(LLMOrchestrator, cls).__new__(cls)
        return cls._instance

    def __init__(self, config: Optional[config_service.ApplicationSettingsModel] = None):
        """
        初始化 LLMOrchestrator。
        这个过程现在非常轻量，只保存配置引用和初始化缓存，
        实际的 Provider 实例化推迟到第一次被请求时（按需加载）。

        :param config: 应用的配置对象。如果为None，则会尝试从 config_service 加载。
        """
        if self._initialized: # 防止重复初始化
            return
            
        logger.info("正在初始化 LLMOrchestrator 单例...") #
        if config is None:
            self.config = config_service.get_config() # 从配置服务获取配置实例
        else:
            self.config = config

        # _provider_instances 用于缓存已实例化的提供商
        # 键是用户定义的模型ID (user_given_id, 例如 "my-gpt-4o", "local-llama3")
        # 值是对应的 BaseLLMProvider 实例
        self._provider_instances: Dict[str, BaseLLMProvider] = {} #
        
        self._initialized = True
        logger.info("LLMOrchestrator 初始化完成。") #


    def _get_model_config_by_id(self, model_id: str) -> Optional[schemas.UserDefinedLLMConfigSchema]: #
        """通过用户定义的模型ID在配置中查找并返回模型配置对象。"""
        for model_config in self.config.llm_settings.available_models: #
            if model_config.user_given_id == model_id: #
                return model_config #
        logger.warning(f"在配置中未找到模型ID为 '{model_id}' 的用户定义LLM配置。") #
        return None

    def _create_provider_instance(self, model_config: schemas.UserDefinedLLMConfigSchema) -> Optional[BaseLLMProvider]: #
        """
        根据给定的模型配置，创建并返回一个 LLM 提供商的实例。
        这是一个核心的工厂方法。
        """
        provider_tag = model_config.provider_tag #
        ProviderClass = PROVIDER_CLASSES.get(provider_tag) # 从 PROVIDER_CLASSES 字典获取提供商类

        if not ProviderClass:
            logger.error(f"无法为模型 '{model_config.user_given_name}' (ID: {model_config.user_given_id}) 创建提供商实例：未找到标记为 '{provider_tag}' 的提供商类。") #
            return None

        # 检查提供商是否在全局配置中被启用
        provider_global_config = self.config.llm_providers.get(provider_tag) #
        if not provider_global_config or not provider_global_config.enabled: #
            logger.warning(f"提供商 '{provider_tag}' 在全局配置中被禁用，无法为模型 '{model_config.user_given_name}' 创建实例。") #
            return None

        try:
            logger.info(f"正在为模型 '{model_config.user_given_name}' (ID: {model_config.user_given_id}) 创建提供商 '{ProviderClass.__name__}' 的实例...") #
            
            # 实例化提供商，传入其需要的特定模型配置和全局提供商配置
            provider_instance = ProviderClass( #
                model_config=model_config, #
                provider_config=provider_global_config #
            )
            
            # 将新创建的实例存入缓存
            self._provider_instances[model_config.user_given_id] = provider_instance #
            logger.info(f"成功创建并缓存了提供商 '{ProviderClass.__name__}' 的实例 (模型ID: {model_config.user_given_id})。") # 日志优化：增加模型ID
            return provider_instance

        except ImportError as e_import: # 更名为 e_import 以区分
            logger.error( #
                f"创建提供商 '{ProviderClass.__name__}' 失败：缺少必要的依赖库。请安装 '{provider_tag}' 相关的库。错误: {e_import}", #
                exc_info=True
            )
            return None
        except Exception as e_create: # 更名为 e_create
            logger.error( #
                f"创建提供商 '{ProviderClass.__name__}' 实例时发生未知错误: {e_create}", #
                exc_info=True
            )
            return None

    def get_llm_provider(self, model_id: Optional[str] = None) -> BaseLLMProvider: #
        """
        获取指定 model_id 的 LLM 提供商实例。
        如果 model_id 为 None 或未找到，将尝试使用默认的备用模型。

        :param model_id: 用户在配置中定义的模型ID (user_given_id)。
        :return: 一个 BaseLLMProvider 的实例。
        :raises: ValueError 如果请求的模型和备用模型都无法加载。
        """
        target_model_id_to_use = model_id or self.config.llm_settings.default_model_id #
        if not target_model_id_to_use: #
            # 确保日志和异常信息一致
            error_msg_no_target_id = "未指定模型ID，且配置中未设置默认模型ID (default_model_id)。"
            logger.error(error_msg_no_target_id)
            raise ValueError(error_msg_no_target_id) #

        # 1. 尝试从缓存获取实例
        if target_model_id_to_use in self._provider_instances: #
            # logger.debug(f"从缓存中获取到模型ID '{target_model_id_to_use}' 的提供商实例。") #
            return self._provider_instances[target_model_id_to_use] #

        # 2. 如果缓存未命中，则查找配置并创建实例
        target_model_config_obj = self._get_model_config_by_id(target_model_id_to_use) #

        if target_model_config_obj and target_model_config_obj.enabled: #
            instance_created = self._create_provider_instance(target_model_config_obj) #
            if instance_created: #
                return instance_created #
            else: # 创建失败
                logger.warning(f"创建模型ID '{target_model_id_to_use}' 的提供商实例失败。") #
        else: # 配置未找到或模型被禁用
            if not target_model_config_obj: #
                 logger.warning(f"在配置中找不到模型ID '{target_model_id_to_use}'。") #
            else: # model_config exists but is not enabled
                 logger.warning(f"模型ID '{target_model_id_to_use}' 在配置中被禁用。") #

        # 3. 如果初始模型加载失败，尝试使用全局备用模型
        logger.info(f"模型 '{target_model_id_to_use}' 加载失败，正在尝试使用全局备用模型...") #
        fallback_model_id_global = self.config.llm_settings.default_llm_fallback #
        if not fallback_model_id_global: #
            # 保持异常信息一致性
            error_msg_no_fallback = f"请求的模型 '{target_model_id_to_use}' 无法加载，且配置中未定义全局备用模型 (default_llm_fallback)。"
            logger.error(error_msg_no_fallback)
            raise ValueError(error_msg_no_fallback) #
        if fallback_model_id_global == target_model_id_to_use: #
            # 避免无限递归或误解
            error_msg_fallback_is_target = f"请求的模型 '{target_model_id_to_use}' 无法加载，且它本身就是备用模型。请检查配置。"
            logger.error(error_msg_fallback_is_target)
            raise ValueError(error_msg_fallback_is_target) #

        # 尝试获取备用模型的提供商
        if fallback_model_id_global in self._provider_instances: #
            logger.info(f"使用已缓存的备用模型 '{fallback_model_id_global}' 提供商。") #
            return self._provider_instances[fallback_model_id_global] #

        fallback_model_config_obj = self._get_model_config_by_id(fallback_model_id_global) #
        if fallback_model_config_obj and fallback_model_config_obj.enabled: #
            fallback_instance_created = self._create_provider_instance(fallback_model_config_obj) #
            if fallback_instance_created: #
                logger.info(f"成功加载并使用备用模型 '{fallback_model_id_global}' 的提供商。") #
                return fallback_instance_created #

        # 4. 如果备用模型也失败，则抛出异常
        final_error_msg = f"请求的模型 '{target_model_id_to_use}' 和备用模型 '{fallback_model_id_global}' 都无法加载。请检查配置和依赖项。" #
        logger.critical(final_error_msg) #
        raise ValueError(final_error_msg) #


    async def generate(
        self,
        model_id: Optional[str], # 目标模型的 user_given_id
        prompt: str,
        system_prompt: Optional[str] = None,
        is_json_output: bool = False,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        llm_override_parameters: Optional[Dict[str, Any]] = None,
        **kwargs: Any # 接受其他可能的关键字参数
    ) -> LLMResponse:
        """
        使用指定的LLM生成内容。这是对提供商 `generate` 方法的封装。

        :param model_id: 要使用的模型的 user_given_id。
        :param prompt: 主提示词。
        :param system_prompt: 系统级提示词 (如果模型支持)。
        :param is_json_output: 是否期望输出为JSON格式。
        :param temperature: 生成温度。
        :param max_tokens: 最大生成token数。
        :param llm_override_parameters: 覆盖LLM调用的其他参数。
        :param kwargs: 传递给具体提供商generate方法的额外参数。
        :return: LLMResponse 对象。
        """
        requested_model_id_for_log = model_id or self.config.llm_settings.default_model_id or "未指定"
        try:
            provider_instance = self.get_llm_provider(model_id) # 获取提供商实例
            # logger.debug(f"正在通过 {provider_instance.__class__.__name__} (模型: {provider_instance.model_config.model_identifier_for_api}) 发起生成请求。") #
            
            response = await provider_instance.generate( # 调用提供商的 generate 方法
                prompt=prompt,
                system_prompt=system_prompt,
                is_json_output=is_json_output,
                temperature=temperature,
                max_tokens=max_tokens,
                llm_override_parameters=llm_override_parameters,
                **kwargs # 传递额外的kwargs
            )
            # 记录实际使用的模型，以防备用逻辑被触发
            if model_id and model_id != response.model_id_used: # 检查是否使用了备用模型
                logger.info(f"请求的模型 '{model_id}' 无法使用，已由备用模型 '{response.model_id_used}' 完成生成。") #
            elif not model_id and self.config.llm_settings.default_model_id != response.model_id_used: # 如果请求的是默认模型，但实际用了其他（例如备用）
                logger.info(f"请求的默认模型 '{self.config.llm_settings.default_model_id}' 无法使用或被覆盖，实际由模型 '{response.model_id_used}' 完成生成。")

            return response
        except ValueError as e_get_provider_val_err: # 捕获 get_llm_provider 可能抛出的 ValueError
             # 如果 get_llm_provider 抛出异常 (例如, 请求和备用模型都不可用)
            error_msg_provider_unavailable = f"无法获取任何可用的LLM提供商 (请求模型ID: {requested_model_id_for_log}): {e_get_provider_val_err}"
            logger.error(error_msg_provider_unavailable) #
            # 返回一个表示失败的 LLMResponse
            return LLMResponse( #
                text="",
                model_id_used=requested_model_id_for_log, # 使用请求的ID或“未指定”
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                finish_reason="error",
                error=error_msg_provider_unavailable #
            )
        except ContentSafetyException as e_content_safety: # 捕获内容安全异常
            logger.warning(f"LLMOrchestrator: 内容安全策略阻止了生成。模型: {requested_model_id_for_log}。错误: {e_content_safety.original_message}")
            return LLMResponse(
                text="",
                model_id_used=e_content_safety.model_id_used or requested_model_id_for_log,
                prompt_tokens=e_content_safety.prompt_tokens,
                completion_tokens=e_content_safety.completion_tokens,
                total_tokens=e_content_safety.total_tokens,
                finish_reason=e_content_safety.finish_reason or "content_filter",
                error=f"内容安全策略阻止: {e_content_safety.original_message}",
                is_blocked_by_safety=True,
                safety_details=e_content_safety.safety_details
            )
        except Exception as e_generate_general_err: # 捕获其他通用生成错误
            logger.error(f"LLMOrchestrator 在生成过程中遇到错误 (请求模型ID: {requested_model_id_for_log}): {e_generate_general_err}", exc_info=True) #
            return LLMResponse( #
                text="",
                model_id_used=requested_model_id_for_log, #
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                finish_reason="error",
                error=str(e_generate_general_err) #
            )

    def get_all_available_model_ids(self) -> List[str]: #
        """
        返回配置中所有已启用且其提供商也已启用的模型ID列表。
        """
        available_ids_list = [] #
        for model_config_item in self.config.llm_settings.available_models: #
            if not model_config_item.enabled: #
                continue
            
            provider_tag_val = model_config_item.provider_tag #
            provider_global_config_item = self.config.llm_providers.get(provider_tag_val) #
            
            if provider_global_config_item and provider_global_config_item.enabled: #
                available_ids_list.append(model_config_item.user_given_id) #
        
        return available_ids_list #

# 应用启动时创建单例的注释说明 (与您提供的代码一致)
# 实际的依赖注入将在 main.py 中通过 Depends() 完成
# 这里只是为了确保模块被导入时，可以有一个可用的实例（如果其他模块直接导入并使用它）
# llm_orchestrator = LLMOrchestrator() #