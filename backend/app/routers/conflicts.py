# backend/app/routers/conflicts.py
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Path, Query, Body
from sqlalchemy.ext.asyncio import AsyncSession

# 修正导入路径
from .. import crud, schemas
from ..database import get_db

logger = logging.getLogger(__name__)

# 定义路由，将 novel_id 作为共同路径前缀
router = APIRouter(
    prefix="/api/v1/novels/{novel_id}/conflicts",
    tags=["Conflicts - (小说下)冲突与矛盾管理"],
)


# --- API 端点 ---

@router.post(
    "/",
    response_model=schemas.ConflictRead,
    status_code=status.HTTP_201_CREATED,
    summary="为指定小说创建一个新的冲突"
)
async def create_conflict_for_novel_endpoint(
    novel_id: int = Path(..., gt=0, description="冲突所属的小说ID"),
    conflict_in: schemas.ConflictCreate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    为指定小说创建一个新的冲突/矛盾。
    - 在创建前会验证小说是否存在。
    """
    # 验证小说是否存在
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    
    # 确保 conflict_in 中的 novel_id 与路径参数一致
    if conflict_in.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"请求体中的 novel_id ({conflict_in.novel_id}) 与路径中的 novel_id ({novel_id}) 不匹配。"
        )
    
    # 调用异步的 crud 函数
    db_conflict = await crud.create_conflict(db=db, conflict_create=conflict_in)
    return db_conflict


@router.get(
    "/",
    response_model=schemas.PaginatedResponse[schemas.ConflictRead],
    summary="获取指定小说的所有冲突（分页）"
)
async def get_conflicts_for_novel_paginated(
    novel_id: int = Path(..., gt=0, description="所属小说的ID"),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量"),
    # 新增：与前端 ConflictListPage.tsx 筛选条件对应的查询参数
    conflict_type: Optional[str] = Query(None, description="按冲突类型筛选"),
    status_filter: Optional[str] = Query(None, alias="status", description="按解决状态筛选 (e.g., unresolved, resolved)"),
    sort_by: Optional[str] = Query("name", description="排序字段 (e.g., name, conflict_type, status)"),
    sort_dir: Optional[schemas.SortDirectionEnum] = Query(schemas.SortDirectionEnum.ASC, description="排序方向 (asc, desc)")
):
    """
    获取指定小说下的所有冲突/矛盾，支持分页、筛选和排序。
    """
    # 验证小说是否存在
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")

    skip = (page - 1) * page_size
    # crud.get_conflicts_by_novel_and_count 需要支持筛选和排序参数
    conflicts, total_count = await crud.get_conflicts_by_novel_and_count(
        db, 
        novel_id=novel_id, 
        skip=skip, 
        limit=page_size,
        conflict_type_filter=conflict_type,
        status_filter=status_filter,
        sort_by=sort_by,
        sort_direction=sort_dir
    )
    
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
    
    return schemas.PaginatedResponse(
        total_count=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=conflicts
    )


@router.get(
    "/{conflict_id}",
    response_model=schemas.ConflictRead,
    summary="获取单个冲突的详细信息"
)
async def get_single_conflict_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    conflict_id: int = Path(..., gt=0, description="要检索的冲突ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个冲突的详细信息，并验证其属于指定的小说。
    """
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
    response_model=schemas.ConflictRead,
    summary="更新指定冲突的信息"
)
async def update_conflict_for_novel_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    conflict_id: int = Path(..., gt=0, description="要更新的冲突ID"),
    conflict_in: schemas.ConflictUpdate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个冲突，并验证其属于指定的小说。
    """
    # 验证冲突存在且属于该小说
    db_conflict_to_update = await crud.get_conflict(db, conflict_id=conflict_id)
    if not db_conflict_to_update:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"冲突ID {conflict_id} 未找到。")

    if db_conflict_to_update.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"冲突ID {conflict_id} 不属于小说ID {novel_id}。"
        )

    # 调用异步的 crud 函数进行更新
    updated_conflict = await crud.update_conflict(db, conflict_id=conflict_id, conflict_update=conflict_in)
    return updated_conflict


@router.delete(
    "/{conflict_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除指定冲突"
)
async def delete_conflict_for_novel_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    conflict_id: int = Path(..., gt=0, description="要删除的冲突ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    删除一个冲突，并验证其属于指定的小说。
    """
    # 验证冲突存在且属于该小说
    db_conflict_to_delete = await crud.get_conflict(db, conflict_id=conflict_id)
    if not db_conflict_to_delete:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"冲突ID {conflict_id} 未找到。")
    
    if db_conflict_to_delete.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"冲突ID {conflict_id} 不属于小说ID {novel_id}。"
        )
    
    # 调用异步的 crud 函数进行删除
    success = await crud.delete_conflict(db, conflict_id=conflict_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"删除冲突ID {conflict_id} 失败，可能已被删除或不存在。"
        )

    return None # 204 No Content