# backend/app/routers/configuration.py
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, Body
from sqlalchemy.ext.asyncio import AsyncSession

# 修正导入路径
from .. import schemas, crud
from ..database import get_db
from ..services import config_service # 导入配置服务
from ..services.config_service import ConfigUpdateError, ConfigValidationError # 导入自定义异常

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/configuration",
    tags=["Configuration - 应用配置管理"],
)


# --- API 端点 ---

@router.get(
    "/",
    response_model=schemas.ApplicationConfig, # 响应模型为完整的应用配置
    summary="获取当前的应用配置"
)
async def get_application_config_endpoint():
    """
    获取当前加载在内存中的完整应用配置信息。
    """
    # 将此函数转换为 async def 以保持API一致性
    current_config = config_service.get_current_config()
    if not current_config:
         # 这种情况通常只在应用启动失败时发生
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="无法加载应用配置。"
        )
    return current_config


@router.put(
    "/",
    response_model=schemas.ApplicationConfig, # 更新成功后返回新的配置
    summary="更新并保存应用配置"
)
async def update_application_config_endpoint(
    config_data: schemas.ApplicationConfig = Body(...),
):
    """
    接收新的应用配置，验证后更新内存中的配置并保存到 `config.json` 文件中。
    这是一个原子操作，更新会立即生效。
    """
    try:
        # config_service.update_config 是异步的，因为它执行文件I/O
        updated_config = await config_service.update_config(config_data)
        logger.info("应用配置已成功更新。")
        return updated_config
    except ConfigValidationError as e:
        logger.warning(f"配置更新失败，数据校验错误: {e}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"配置数据校验失败: {e}"
        )
    except ConfigUpdateError as e:
        logger.error(f"配置更新失败，写入文件时发生错误: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"更新配置文件时发生错误: {e}"
        )
    except Exception as e:
        logger.exception("更新配置时发生未知错误。")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新配置时发生未知内部错误。"
        )


@router.get(
    "/novels-selector",
    response_model=List[schemas.NovelSelectorItem], # 响应模型为专用的选择器项列表
    summary="获取用于配置页面选择器的小说列表"
)
async def get_novels_for_config_selector_endpoint(
    db: AsyncSession = Depends(get_db)
):
    """
    获取一个简化的小说列表（仅包含id和title），
    主要用于前端配置页面中需要选择小说的下拉菜单。
    """
    try:
        # 获取所有小说，限制数量以防万一，但通常配置页会需要所有
        # crud.get_novels_with_count 已经是异步的
        novels, _ = await crud.get_novels_with_count(db=db, skip=0, limit=1000) # 假设1000个足够了
        
        # 将 Novel 对象转换为 NovelSelectorItem
        return [schemas.NovelSelectorItem(id=novel.id, title=novel.title) for novel in novels]
    except Exception as e:
        logger.error(f"为配置选择器获取小说列表时出错: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="获取小说列表时发生内部错误。"
        )