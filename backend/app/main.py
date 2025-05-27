# backend/app/main.py

import logging
import logging.config
import os
import traceback # 引入 traceback 模块用于获取堆栈跟踪信息

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse # 引入 JSONResponse

# 使用相对导入
# 【重要】从 database.py 导入的是新的异步初始化函数
from .database import create_db_and_tables as init_db
from .routers import ( #
    novels, chapters, characters, 
    character_relationships,
    conflicts, plot_branches, plot_versions, rule_chains,
    rule_templates, llm_utils, configuration, text_processing,
    planning
)
# 单独导入 events.py 中的路由器实例
from .routers.events import event_router as novel_events_router # 小说下的事件
from .routers.events import global_event_router # 全局事件ID操作 (用于 /events/{event_id} 等)
from .routers.events import event_relationship_router # 事件关系路由

from .services.config_service import load_config, get_config # 导入配置加载和获取函数

# --- 日志配置 ---
# 与您提供的版本一致，从配置服务动态设置日志级别
LOGGING_CONFIG = { #
    "version": 1, #
    "disable_existing_loggers": False, #
    "formatters": { #
        "default": { #
            "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s", #
        },
    },
    "handlers": { #
        "console": { #
            "class": "logging.StreamHandler", #
            "formatter": "default", #
        },
    },
    "root": { #
        "handlers": ["console"], #
        "level": get_config().get("application_settings", {}).get("log_level", "INFO").upper(), #
    },
}

logging.config.dictConfig(LOGGING_CONFIG) # 应用日志配置
logger_main_module = logging.getLogger(__name__) # 获取本模块的 logger 实例


# --- 创建 FastAPI 应用实例 ---
# 可以在此处添加应用元数据，如标题、版本等
app = FastAPI(
    title="小说改编辅助工具 API",
    description="提供小说结构化、分析、情节推演等功能的后端API服务。",
    version="1.0.0",
)


# --- 全局异常处理器 ---
@app.exception_handler(Exception) #
async def global_exception_handler(request: Request, exc: Exception): #
    """
    一个全局异常处理器，用于捕获所有未被特定处理器处理的异常。
    """
    # 记录详细的错误信息，包括堆栈跟踪
    error_details = {
        "error_type": type(exc).__name__,
        "message": str(exc),
        "traceback": traceback.format_exc().splitlines()
    }
    logger_main_module.error(
        f"未处理的服务器内部错误: {type(exc).__name__} - {exc} 在请求 {request.method} {request.url}",
        extra={"error_details": error_details}
    )
    # 返回一个标准的500错误响应
    return JSONResponse(
        status_code=500,
        content={
            "detail": "服务器内部发生未知错误。",
            "error_type": type(exc).__name__,
        },
    )


# --- 中间件配置 ---
# CORS (跨源资源共享) 中间件
# 允许来自指定源的前端应用访问API
origins = get_config().get("application_settings", {}).get("cors_origins", []) #

if not origins: # 如果配置中未指定 origins，则提供一个默认值以方便开发
    origins = [
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:5173", # 常见的前端开发服务器端口
    ]
    logger_main_module.warning(f"CORS origins 未在配置中找到，使用默认值: {origins}") #

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"], # 允许所有标准的HTTP方法
    allow_headers=["*"], # 允许所有请求头
)
logger_main_module.info(f"CORS 中间件已启用，允许的来源: {origins}") #


# --- 应用生命周期事件 ---
@app.on_event("startup")
async def on_startup(): # 【重要】将启动函数改为异步
    """
    应用启动时执行的逻辑。
    """
    logger_main_module.info("应用正在启动...")
    try:
        # 加载应用配置
        load_config()
        logger_main_module.info("应用配置加载成功。")

        # 【重要】调用异步的数据库初始化函数
        await init_db()
        logger_main_module.info("数据库初始化成功。")
    except Exception as e_db_init_startup:
        logger_main_module.critical(f"数据库初始化失败，应用可能无法正常工作: {e_db_init_startup}", exc_info=True)


@app.on_event("shutdown")
def on_shutdown():
    """
    应用关闭时执行的逻辑。
    """
    logger_main_module.info("应用正在关闭...")
    # 在异步模式下，SQLAlchemy 引擎会自动处理连接池的关闭，通常无需手动操作。
    # from .database import engine
    # await engine.dispose() # 如果需要显式关闭，应该是异步操作


# --- 根路由 ---
@app.get("/", tags=["Root"])
async def read_root():
    return {"message": "欢迎使用小说改编辅助工具 API"}


# --- 注册所有路由 ---
# 路由文件内部已经定义了完整的前缀 (如 "/api/v1/novels")
# 因此，在 include_router 时不再需要添加全局 prefix。
app.include_router(novels.router)
app.include_router(chapters.router)
app.include_router(characters.router)
app.include_router(character_relationships.router)
app.include_router(conflicts.router)
app.include_router(plot_branches.router)
app.include_router(plot_versions.router)
app.include_router(rule_chains.router)
app.include_router(rule_templates.router)
app.include_router(llm_utils.router)
app.include_router(configuration.router)
app.include_router(text_processing.router)
app.include_router(planning.router)

# 单独注册 events 相关的路由
app.include_router(novel_events_router)
app.include_router(global_event_router)
app.include_router(event_relationship_router)

logger_main_module.info("所有API路由均已成功注册。")

