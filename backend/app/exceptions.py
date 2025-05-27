# backend/app/exceptions.py

class LLMAPIError(Exception):
    """
    所有 LLM Provider 相关错误的基类。
    Base exception for all LLM Provider related errors.
    """
    def __init__(self, message: str, provider: str = "Unknown"):
        self.message = message
        self.provider = provider
        super().__init__(f"LLM Provider '{self.provider}' Error: {self.message}")

class LLMAuthenticationError(LLMAPIError):
    """
    用于认证失败（例如，无效的 API Key）。
    For authentication errors (e.g., invalid API Key).
    """
    pass

class LLMRateLimitError(LLMAPIError):
    """
    用于 API 速率限制错误。
    For API rate limit errors.
    """
    pass

class LLMConnectionError(LLMAPIError):
    """
    用于网络连接问题（例如，无法访问 API 端点）。
    For network connectivity issues (e.g., cannot reach API endpoint).
    """
    pass

class LLMProviderNotFoundError(LLMAPIError):
    """
    当找不到指定的 LLM Provider 时抛出。
    Raised when a specified LLM Provider cannot be found.
    """
    pass

class ContentSafetyException(LLMAPIError):
    """
    当内容被提供商的安全策略阻止时，用于特定于内容的错误。
    For content-specific errors when content is blocked by the provider's safety policies.
    """
    pass