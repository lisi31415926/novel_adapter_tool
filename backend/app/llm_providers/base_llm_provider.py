# backend/app/llm_providers/base_llm_provider.py
from abc import ABC, abstractmethod
from typing import NamedTuple, Optional, Dict, Any, Tuple # Added Tuple for test_connection

# 导入 schemas 以便在类型提示中使用
# 在实际项目中，请确保 app 目录在PYTHONPATH中，或者使用相对导入
# from .. import schemas # 如果 base_llm_provider.py 在 app/llm_providers/ 目录下
from app import schemas # 假设 app 是顶级可导入包


class LLMResponse(NamedTuple):
    """
    定义一个标准的 LLM 响应结构体，用于所有提供商的统一返回格式。
    """
    text: str                            # LLM生成的文本内容
    model_id_used: str                   # 实际用于生成此响应的模型的用户定义ID (user_given_id)
    prompt_tokens: int                   # 输入提示消耗的token数
    completion_tokens: int               # 生成内容消耗的token数
    total_tokens: int                    # 总消耗token数
    finish_reason: Optional[str] = None  # LLM返回的完成原因 (例如 "stop", "length", "content_filter")
    error: Optional[str] = None          # 如果发生错误，则包含错误信息字符串


class BaseLLMProvider(ABC):
    """
    所有 LLM 提供商的抽象基类。
    它定义了所有提供商必须实现的通用接口。
    """
    PROVIDER_TAG: str = "" # 每个子类都必须定义这个标签

    def __init__(
        self,
        model_config: schemas.UserDefinedLLMConfigSchema,
        provider_config: schemas.LLMProviderConfigSchema
    ):
        """
        初始化基类提供商。
        子类在调用 super().__init__() 后，应根据这些配置初始化其具体的API客户端。
        """
        if not self.PROVIDER_TAG:
            raise NotImplementedError(
                f"LLM 提供商子类 {self.__class__.__name__} 必须定义一个 PROVIDER_TAG 类属性。"
            )

        self.model_config = model_config
        self.provider_config = provider_config
        self.client: Any = None # 子类应该在它们的 __init__ 方法中初始化具体的客户端实例

    @abstractmethod
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
        """
        使用配置的模型生成文本的核心方法。
        """
        pass

    def get_model_identifier_for_api(self) -> str:
        """
        返回此提供商实例配置的、用于API调用的实际模型标识符。
        """
        return self.model_config.model_identifier_for_api

    def get_user_defined_model_id(self) -> str:
        """
        返回此提供商实例对应的用户自定义模型ID (user_given_id)。
        """
        return self.model_config.user_given_id

    def is_client_ready(self) -> bool:
        """
        检查此提供商的API客户端是否已成功初始化并准备好发出请求。
        子类可以根据其客户端的具体状态重写此方法。
        """
        return self.client is not None

    @abstractmethod
    async def test_connection(
        self,
        model_api_id_for_test: Optional[str] = None,
        # 可以考虑加入临时 api_key, base_url 等参数，如果需要测试未保存的配置，但这会使接口复杂化
        # temp_api_key: Optional[str] = None, 
        # temp_base_url: Optional[str] = None
    ) -> Tuple[bool, str, Optional[List[str]]]: # (success, message, details_list)
        """
        测试与LLM提供商的连接。
        子类应实现此方法，尝试一个简单的API调用（如获取模型信息或非常短的生成）。

        Args:
            model_api_id_for_test (Optional[str]): 用于测试的具体模型API ID。如果为None，
                                                 则使用当前provider实例配置的默认模型API ID。
        Returns:
            Tuple[bool, str, Optional[List[str]]]: 一个元组，包含:
                - success (bool): True表示连接成功，False表示失败。
                - message (str): 描述测试结果的消息。
                - details (Optional[List[str]]): 可选的详细信息列表，例如错误细节或成功细节。
        """
        pass

    # get_model_capabilities 和 get_available_models_from_api 通常是具体提供商需要根据其SDK实现的。
    # 如果需要一个通用的基类方法，它们可以从 self.model_config 读取或返回通用信息。
    # 但由于这些信息高度依赖于具体提供商和模型，将它们保留在具体实现中或通过配置管理更为合适。
    
    # def get_model_capabilities(self) -> Dict[str, Any]:
    #     """
    #     返回此模型实例的基本能力信息，主要来自配置。
    #     具体提供商可以覆盖此方法以补充来自API的动态信息（但不推荐频繁调用）。
    #     """
    #     return {
    #         "max_context_tokens": self.model_config.max_context_tokens,
    #         "supports_system_prompt": self.model_config.supports_system_prompt,
    #         "user_defined_id": self.model_config.user_given_id,
    #         "provider_tag": self.model_config.provider_tag,
    #         "api_model_id": self.model_config.model_identifier_for_api,
    #     }

    # async def get_available_models_from_api(self) -> List[Dict[str, Any]]:
    #     """
    #     尝试从提供商的API获取当前凭证可访问的模型列表。
    #     很多提供商可能不支持此功能或实现方式各异。
    #     子类应根据其SDK实现。基类默认返回空列表。
    #     """
    #     return []