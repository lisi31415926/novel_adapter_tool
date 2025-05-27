# backend/app/database.py
import logging
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlmodel import SQLModel

# 注意：为了解耦和清晰，我们假设 config_service 不依赖数据库本身
# 如果它需要，这个结构需要调整。目前看，它是读取静态配置，是安全的。
from .services.config_service import get_setting

logger = logging.getLogger(__name__)

# --- 1. 异步数据库连接配置 ---
# 从配置服务获取同步的数据库连接字符串
SYNC_DATABASE_URL = get_setting("application_settings.database_url", "sqlite:///./novel_adapter_tool.db")

# 根据同步URL自动转换为对应的异步URL
if SYNC_DATABASE_URL.startswith("sqlite"):
    ASYNC_DATABASE_URL = SYNC_DATABASE_URL.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    engine_args = {}
    logger.info(f"数据库配置：使用异步 SQLite (aiosqlite) - {ASYNC_DATABASE_URL}")
elif SYNC_DATABASE_URL.startswith("postgresql"):
    ASYNC_DATABASE_URL = SYNC_DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
    engine_args = {} # 可在此处为 asyncpg 添加特定参数, e.g., pool_size
    logger.info(f"数据库配置：使用异步 PostgreSQL (asyncpg) - {ASYNC_DATABASE_URL}")
else:
    # 如果未来支持其他数据库，可以在此添加转换逻辑
    raise ValueError(f"不支持的数据库类型: {SYNC_DATABASE_URL}")

# --- 2. 创建异步引擎实例 ---
# echo=False 在生产中是最佳实践，避免打印所有SQL语句
engine = create_async_engine(ASYNC_DATABASE_URL, echo=False, future=True, **engine_args)

# --- 3. 创建异步会话的 sessionmaker ---
#    - class_=AsyncSession 指定会话类型为异步会话
#    - expire_on_commit=False 防止在提交后 ORM 对象过期，这样在API返回时对象仍可访问
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)

# --- 4. FastAPI 异步依赖函数：获取数据库会话 ---
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI 依赖项，为每个请求提供一个数据库会话。
    使用 'async with' 确保会话在使用后被正确关闭。
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception as e:
            # 在会话层面回滚，尽管 'async with' 在退出时也会处理
            await session.rollback()
            logger.error(f"数据库会话中出现异常，已回滚: {e}", exc_info=True)
            raise

# --- 5. 数据库初始化函数 ---
async def create_db_and_tables():
    """
    一个异步函数，用于在应用启动时连接到数据库并创建所有表。
    """
    logger.info("正在初始化数据库连接...")
    try:
        async with engine.begin() as conn:
            # run_sync 方法用于在异步上下文中运行同步的 metadata.create_all
            # 这是在异步设置中使用 SQLModel/SQLAlchemy 创建表的标准方法。
            logger.info("正在检查并创建数据库表...")
            await conn.run_sync(SQLModel.metadata.create_all)
            logger.info("数据库表检查/创建操作完成。")
    except Exception as e:
        logger.error(f"无法连接到数据库或创建表: {e}", exc_info=True)
        # 抛出异常以阻止应用启动，因为数据库是核心依赖
        raise RuntimeError(f"数据库初始化失败: {e}") from e