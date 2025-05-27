# backend/app/exceptions.py

class LLMAPIError(Exception):
    """Base exception for LLM provider errors."""
    def __init__(self, message: str, provider: str = "Unknown"):
        self.message = message
        self.provider = provider
        super().__init__(f"LLM Provider '{self.provider}' Error: {self.message}")

class LLMAuthenticationError(LLMAPIError):
    """For authentication errors."""
    pass

class LLMRateLimitError(LLMAPIError):
    """For rate limit errors."""
    pass

class LLMConnectionError(LLMAPIError):
    """For connection issues."""
    pass

class LLMProviderNotFoundError(LLMAPIError): # Not directly used in providers but good to have
    """Raised when a specified LLM Provider cannot be found."""
    pass

class ContentSafetyException(LLMAPIError): # This is the one we will use from app.exceptions
    """For content-specific errors when content is blocked by the provider's safety policies."""
    # Add constructor to match how it's used in providers, if different from LLMAPIError
    def __init__(self, message: str, provider: str = "Unknown", model_id: Optional[str] = None, details: Optional[Any] = None,
                 prompt_tokens: Optional[int] = None, completion_tokens: Optional[int] = None, total_tokens: Optional[int] = None,
                 finish_reason: Optional[str] = None):
        super().__init__(message, provider)
        self.original_message = message # Keep original_message attribute
        self.model_id_used = model_id
        self.safety_details = details
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = total_tokens
        self.finish_reason = finish_reason