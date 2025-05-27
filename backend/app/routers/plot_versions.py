import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Path, Body, status, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas, services
from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/plot-branches/{plot_branch_id}/versions",
    tags=["Plot Versions Management"]
)

# 为章节重排定义一个清晰的请求体模型
class ChapterReorderRequest(BaseModel):
    ordered_chapter_ids: List[int] = Field(..., description="按新顺序排列的章节ID列表。")


# =============================================================================
# --- Plot Versions (剧情版本) API Endpoints ---
# =============================================================================

@router.post(
    "/",
    response_model=schemas.PlotVersionRead,
    status_code=status.HTTP_201_CREATED,
    summary="为剧情分支创建新版本"
)
async def create_plot_version(
    plot_branch_id: int,
    version: schemas.PlotVersionCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    为指定的剧情分支创建一个新的剧情版本。
    """
    if version.plot_branch_id != plot_branch_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="路径中的 plot_branch_id 与请求体中的 plot_branch_id 不匹配。"
        )

    # 验证父分支是否存在
    parent_branch = await crud.get_plot_branch(db, branch_id=plot_branch_id)
    if not parent_branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="所属的剧情分支未找到。")
    
    return await crud.create_plot_version(db=db, version=version)


# 修改后的代码片段
@router.get(
    "/",
    response_model=schemas.PaginatedResponse[schemas.PlotVersionRead],
    summary="获取剧情分支的所有版本（分页）"
)
async def read_plot_versions(
    plot_branch_id: int,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200)
):
    parent_branch = await crud.get_plot_branch(db, branch_id=plot_branch_id)
    if not parent_branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="所属的剧情分支未找到。")
    
    skip = (page - 1) * page_size
    items_list, total_count = await crud.get_plot_versions_by_branch_and_count(
        db, branch_id=plot_branch_id, skip=skip, limit=page_size
    )
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
    
    return schemas.PaginatedResponse(
        total_count=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=items_list
    )


@router.get(
    "/{version_id}",
    response_model=schemas.PlotVersionRead,
    summary="根据ID获取剧情版本详情"
)
async def read_plot_version(
    plot_branch_id: int,
    version_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个剧情版本的详细信息。
    """
    db_version = await crud.get_plot_version(db=db, version_id=version_id)
    if db_version is None or db_version.plot_branch_id != plot_branch_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="剧情版本未找到")
    return db_version


@router.put(
    "/{version_id}",
    response_model=schemas.PlotVersionRead,
    summary="更新剧情版本信息"
)
async def update_plot_version(
    plot_branch_id: int,
    version_id: int,
    version: schemas.PlotVersionUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个已存在剧情版本的信息。
    """
    db_version = await crud.get_plot_version(db=db, version_id=version_id)
    if db_version is None or db_version.plot_branch_id != plot_branch_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="剧情版本未找到")
        
    updated_version = await crud.update_plot_version(db=db, version_id=version_id, version_update=version)
    return updated_version


@router.delete(
    "/{version_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除指定剧情版本"
)
async def delete_plot_version(
    plot_branch_id: int,
    version_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    根据ID删除一个剧情版本。
    """
    db_version = await crud.get_plot_version(db=db, version_id=version_id)
    if db_version is None or db_version.plot_branch_id != plot_branch_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="剧情版本未找到")

    await crud.delete_plot_version(db=db, version_id=version_id)
    return None


@router.post(
    "/{version_id}/reorder-chapters",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="对剧情版本内的章节重新排序"
)
async def reorder_version_chapters(
    plot_branch_id: int,
    version_id: int,
    reorder_request: ChapterReorderRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    根据给定的章节ID列表，批量更新一个剧情版本下所有章节的 `chapter_order`。
    """
    db_version = await crud.get_plot_version(db=db, version_id=version_id)
    if db_version is None or db_version.plot_branch_id != plot_branch_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="剧情版本未找到")
    
    # 假设 bulk_update_chapter_order 在 crud 中也已异步化
    # 并且它能处理好验证章节是否都属于该版本等逻辑
    success = await crud.bulk_update_chapter_order(
        db,
        plot_version_id=version_id,
        ordered_ids=reorder_request.ordered_chapter_ids
    )

    if not success:
        # 这个错误可能由多种原因导致，例如部分章节ID不存在、数据库更新失败等
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="章节重排失败，请检查提供的章节ID是否都有效且属于该剧情版本。"
        )
    
    return None


# 假设 planning_service 是一个异步服务
# @router.get("/{version_id}/suggestions", response_model=schemas.Plan)
# async def get_plot_version_suggestions(
#     plot_branch_id: int,
#     version_id: int,
#     db: AsyncSession = Depends(get_db)
# ):
#     """
#     （示例）调用AI服务为当前剧情版本生成下一步的写作建议。
#     """
#     db_version = await crud.get_plot_version(db=db, version_id=version_id)
#     if db_version is None or db_version.plot_branch_id != plot_branch_id:
#         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="剧情版本未找到")
    
#     # 假设存在一个异步的AI规划服务
#     suggestion_plan = await services.planning_service.suggest_next_steps_for_version(
#         db_session=db,
#         version=db_version
#     )
#     return suggestion_plan