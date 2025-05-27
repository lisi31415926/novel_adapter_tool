# backend/app/routers/configuration.py
import logging
from typing import List

from fastapi import APIRouter, HTTPException, Body, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas
from ..dependencies import get_db, get_llm_orchestrator
from ..llm_orchestrator import LLMOrchestrator
from ..llm_providers import PROVIDER_CLASSES
from ..services.config_service import ConfigService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/configuration",
    tags=["Application Configuration"]
)

@router.get(
    "/",
    response_model=schemas.ConfigSchema,
    summary="获取当前完整的应用配置"
)
async def get_application_config(config_service: ConfigService = Depends()):
    """
    获取应用程序当前的全部配置信息。
    """
    return await config_service.get_config()

@router.put(
    "/",
    response_model=schemas.ConfigSchema,
    summary="更新并保存应用配置"
)
async def update_application_config(
    config_data: schemas.ConfigSchema,
    config_service: ConfigService = Depends()
):
    """
    接收新的配置数据，验证后保存到 `config.json` 文件。
    """
    try:
        updated_config = await config_service.update_config(config_data)
        return updated_config
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"更新配置时发生未知错误: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新配置文件时发生未知错误。"
        )

@router.get(
    "/providers",
    response_model=List[str],
    summary="获取所有可用的LLM Provider"
)
async def get_available_providers():
    """
    返回系统中所有已注册的LLM Provider的名称列表。
    """
    return list(PROVIDER_CLASSES.keys())

@router.post(
    "/test-llm-connection",
    response_model=schemas.LLMResponse,
    summary="测试到LLM的连接"
)
async def test_llm_connection(
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    使用当前配置，向LLM发送一个简单的测试请求，以验证连接和API密钥是否有效。
    """
    try:
        response = await llm_orchestrator.generate_completion(
            prompt="Hello, world! Say 'test successful'.",
            max_tokens=10
        )
        return schemas.LLMResponse(response=response)
    except Exception as e:
        logger.error(f"测试LLM连接失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"测试LLM连接失败: {e}"
        )

@router.get(
    "/referable-files",
    response_model=schemas.PaginatedReferableFilesResponse,
    summary="获取可作为引用来源的文件列表"
)
async def get_referable_files_list(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """
    获取可作为引用来源的小说文件信息（当前实现仅为小说）。
    """
    skip = (page - 1) * page_size
    
    # 直接异步调用CRUD函数
    novels, total_count = await crud.get_novels_with_count(db, skip=skip, limit=page_size)
    
    items = [
        schemas.ReferableFileItem(
            id=f"novel_content_{novel.id}",
            name=novel.title,
            file_type="novel_content",
            created_at=novel.created_at,
            updated_at=novel.updated_at,
            description=novel.description or "",
            novel_id=novel.id
        ) for novel in novels
    ]
    
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
    
    return schemas.PaginatedReferableFilesResponse(
        total_count=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=items
    )