# backend/app/routers/conflicts.py
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Body, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

# 导入 CRUD 操作、schemas 和异步 get_db 依赖
from .. import crud, schemas
from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/novels/{novel_id}/conflicts",
    tags=["Conflicts - 冲突管理"]
)


# ==============================================================================
# --- Conflicts (冲突) API Endpoints ---
# ==============================================================================

@router.post(
    "/",
    response_model=schemas.Conflict,
    status_code=status.HTTP_201_CREATED,
    summary="为指定小说创建一个新冲突"
)
async def create_conflict_for_novel(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    conflict_in: schemas.ConflictCreate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    为指定小说创建一个新的冲突。
    """
    log_prefix = f"[Router-CreateConflict NovelID:{novel_id}]"
    logger.info(f"{log_prefix} 收到创建冲突请求。")

    # 验证小说是否存在
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        logger.warning(f"{log_prefix} 创建失败：小说ID {novel_id} 未找到。")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    
    # 确保 conflict_in 中的 novel_id 与路径参数一致
    if conflict_in.novel_id is None:
        conflict_in.novel_id = novel_id
    elif conflict_in.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"请求体中的 novel_id ({conflict_in.novel_id}) 与路径中的 novel_id ({novel_id}) 不匹配。"
        )

    try:
        # 【原生异步调用】
        db_conflict = await crud.create_conflict(db, conflict_create=conflict_in)
        logger.info(f"{log_prefix} 成功创建冲突 ID: {db_conflict.id}。")
        return db_conflict
    except Exception as e:
        logger.error(f"{log_prefix} 创建冲突时发生未知错误: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="创建冲突时发生内部错误。")


# 修改后的代码片段
@router.get(
    "/",
    response_model=schemas.PaginatedResponse[schemas.ConflictRead],
    summary="获取小说的所有冲突（分页）"
)
async def read_conflicts(
    novel_id: int,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200)
):
    skip = (page - 1) * page_size
    items_list, total_count = await crud.get_conflicts_by_novel_and_count(
        db, novel_id=novel_id, skip=skip, limit=page_size
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
    "/{conflict_id}",
    response_model=schemas.Conflict,
    summary="获取单个冲突的详细信息"
)
async def read_single_conflict(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    conflict_id: int = Path(..., gt=0, description="要检索的冲突ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个冲突的详细信息，并验证其属于指定的小说。
    """
    # 【原生异步调用】
    db_conflict = await crud.get_conflict(db, conflict_id=conflict_id)
    if not db_conflict:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"冲突ID {conflict_id} 未找到。")
    
    # 验证冲突是否属于该小说
    if db_conflict.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"冲突ID {conflict_id} 不属于小说ID {novel_id}。"
        )
        
    return db_conflict


@router.put(
    "/{conflict_id}",
    response_model=schemas.Conflict,
    summary="更新指定冲突的信息"
)
async def update_conflict_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    conflict_id: int = Path(..., gt=0, description="要更新的冲突ID"),
    conflict_in: schemas.ConflictUpdate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个冲突，并验证其属于指定的小说。
    """
    log_prefix = f"[Router-UpdateConflict NovelID:{novel_id}, ConflictID:{conflict_id}]"
    logger.info(f"{log_prefix} 收到更新冲突请求。")

    # 【原生异步调用】
    db_conflict_check = await crud.get_conflict(db, conflict_id=conflict_id)
    if not db_conflict_check:
        logger.warning(f"{log_prefix} 更新失败：冲突ID {conflict_id} 未找到。")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"冲突ID {conflict_id} 未找到。")

    if db_conflict_check.novel_id != novel_id:
        logger.error(f"{log_prefix} 更新失败：权限错误，冲突不属于该小说。")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"冲突ID {conflict_id} 不属于小说ID {novel_id}。"
        )

    # 【原生异步调用】
    updated_conflict = await crud.update_conflict(db, conflict_id=conflict_id, conflict_update=conflict_in)
    if not updated_conflict:
        logger.error(f"{log_prefix} 更新冲突失败，在CRUD层未找到对象（理论上不应发生，因为上面已检查）。")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"更新冲突ID {conflict_id} 失败，对象可能已被删除。")
        
    logger.info(f"{log_prefix} 冲突信息更新成功。")
    return updated_conflict


@router.delete(
    "/{conflict_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除指定冲突"
)
async def delete_conflict_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    conflict_id: int = Path(..., gt=0, description="要删除的冲突ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    删除一个冲突，并验证其属于指定的小说。
    """
    log_prefix = f"[Router-DeleteConflict NovelID:{novel_id}, ConflictID:{conflict_id}]"
    logger.info(f"{log_prefix} 收到删除冲突请求。")
    
    # 【原生异步调用】
    db_conflict_check = await crud.get_conflict(db, conflict_id=conflict_id)
    if not db_conflict_check:
        logger.warning(f"{log_prefix} 删除失败：未找到冲突ID {conflict_id}。")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"冲突ID {conflict_id} 未找到。")
    
    if db_conflict_check.novel_id != novel_id:
        logger.error(f"{log_prefix} 删除失败：权限错误，冲突不属于该小说。")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"冲突ID {conflict_id} 不属于小说ID {novel_id}。"
        )
    
    # 【原生异步调用】
    success = await crud.delete_conflict(db, conflict_id=conflict_id)
    if not success:
        logger.error(f"{log_prefix} 删除冲突时在CRUD层失败（理论上不应发生）。")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="删除冲突时发生未知错误。")

    logger.info(f"{log_prefix} 成功删除冲突。")
    return None # 204 No Content
