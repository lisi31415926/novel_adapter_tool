# routers/plot_branches.py
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Path, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas
from ..database import get_db

router = APIRouter(
    prefix="/novels/{novel_id}/plot-branches",
    tags=["Plot Branches Management"]
)

@router.post(
    "/",
    response_model=schemas.PlotBranchRead,
    status_code=status.HTTP_201_CREATED,
    summary="为小说创建新的剧情分支"
)
async def create_plot_branch(
    novel_id: int,
    branch: schemas.PlotBranchCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    为指定的小说创建一个新的剧情分支。
    - **novel_id**: 路径参数，指定小说ID。
    - **branch**: 请求体，包含新剧情分支的详细信息。
    """
    if branch.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="路径中的 novel_id 与请求体中的 novel_id 不匹配。"
        )

    # 检查同一小说下是否存在同名分支
    existing_branch = await crud.get_plot_branch_by_name(db, novel_id=novel_id, name=branch.name)
    if existing_branch:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"该小说下已存在名为 '{branch.name}' 的剧情分支。"
        )
    
    return await crud.create_plot_branch(db=db, branch=branch)

# 修改后的代码片段
@router.get(
    "/",
    response_model=schemas.PaginatedResponse[schemas.PlotBranchRead],
    summary="获取指定小说的所有剧情分支（分页）"
)
async def read_plot_branches(
    novel_id: int,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200)
):
    skip = (page - 1) * page_size
    items_list, total_count = await crud.get_plot_branches_by_novel_and_count(
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
    "/{branch_id}",
    response_model=schemas.PlotBranchRead,
    summary="根据ID获取剧情分支详情"
)
async def read_plot_branch(
    novel_id: int,
    branch_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个剧情分支的详细信息。
    """
    db_branch = await crud.get_plot_branch(db=db, branch_id=branch_id)
    if db_branch is None or db_branch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="剧情分支未找到")
    return db_branch

@router.put(
    "/{branch_id}",
    response_model=schemas.PlotBranchRead,
    summary="更新剧情分支信息"
)
async def update_plot_branch(
    novel_id: int,
    branch_id: int,
    branch: schemas.PlotBranchUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个已存在剧情分支的信息。
    """
    db_branch = await crud.get_plot_branch(db=db, branch_id=branch_id)
    if db_branch is None or db_branch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="剧情分支未找到")
        
    updated_branch = await crud.update_plot_branch(db=db, branch_id=branch_id, branch_update=branch)
    return updated_branch

@router.delete(
    "/{branch_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除指定剧情分支"
)
async def delete_plot_branch(
    novel_id: int,
    branch_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    根据ID删除一个剧情分支。
    """
    db_branch = await crud.get_plot_branch(db=db, branch_id=branch_id)
    if db_branch is None or db_branch.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="剧情分支未找到")
        
    deleted_branch = await crud.delete_plot_branch(db=db, branch_id=branch_id)
    if not deleted_branch:
         # 这一层检查理论上不会触发，因为上面已经检查过了，但作为保险
         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="删除时剧情分支未找到")

    return None