# backend/app/dependencies.py
import logging
from typing import Annotated

from fastapi import Depends
# 导入异步会话类型，用于类型提示
from sqlalchemy.ext.asyncio import AsyncSession

# 从我们已修改好的 database.py 中导入异步的 get_db 函数
from .database import get_db
# 从 llm_orchestrator.py 导入 LLMOrchestrator 类
from .llm_orchestrator import LLMOrchestrator

logger = logging.getLogger(__name__)

# --- LLM Orchestrator 依赖 (保持不变) ---
# LLMOrchestrator 类本身通过 __new__ 和 _initialized 实现了单例模式。
# 因此，每次调用 LLMOrchestrator() 都会返回同一个正确初始化的实例。
def get_llm_orchestrator() -> LLMOrchestrator:
    """
    FastAPI 依赖项，用于提供 LLMOrchestrator 的单例实例。
    LLMOrchestrator 负责管理和调用不同的LLM提供商，
    其构造函数会自动从 config_service 加载配置。
    """
    # logger.debug("正在请求 LLMOrchestrator 实例...") # 可按需启用调试日志
    return LLMOrchestrator() # 直接实例化，单例逻辑在类内部处理

# --- 类型提示别名，方便在路由函数中使用 ---
# DBSession 现在指向异步会话 (AsyncSession)，并与 get_db 依赖关联
DBSession = Annotated[AsyncSession, Depends(get_db)]

# LLMOrchestrator 的依赖别名 (保持不变)
LLMOrchestratorDep = Annotated[LLMOrchestrator, Depends(get_llm_orchestrator)]