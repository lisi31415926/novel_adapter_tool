# backend/app/routers/plot_branches.py
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Path
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas # models is not directly used, schemas contains Pydantic models
from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/plot-branches",
    tags=["Plot Branches - 大纲分支管理"],
)

@router.post(
    "/",
    response_model=schemas.PlotBranch,
    status_code=status.HTTP_201_CREATED,
    summary="创建一个新的大纲分支"
)
async def create_plot_branch(
    branch_in: schemas.PlotBranchCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    为指定的小说创建一个新的大纲分支。
    可以指定一个父分支，如果未指定，则它将成为一个顶级分支。
    """
    # 验证 novel_id 是否存在
    novel = await crud.get_novel(db, novel_id=branch_in.novel_id)
    if not novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {branch_in.novel_id} 的小说未找到。")

    # 验证 parent_branch_id (如果提供) 是否存在且属于同一个 novel_id
    if branch_in.parent_branch_id:
        parent_branch = await crud.get_plot_branch(db, branch_id=branch_in.parent_branch_id)
        if not parent_branch:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {branch_in.parent_branch_id} 的父分支未找到。")
        if parent_branch.novel_id != branch_in.novel_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="父分支与新分支不属于同一部小说。")

    return await crud.create_plot_branch(db=db, branch_in=branch_in)

@router.get(
    "/novel/{novel_id}",
    response_model=List[schemas.PlotBranchWithLineage], # 返回带血缘关系的分支列表
    summary="获取指定小说的所有大纲分支（树状结构）"
)
async def read_plot_branches_for_novel(
    novel_id: int = Path(..., description="要检索其大纲分支的小说ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取指定小说的所有大纲分支，并构建成一个层级（树状）结构。
    """
    novel = await crud.get_novel(db, novel_id=novel_id)
    if not novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    
    # crud.get_plot_branches_for_novel_structured 应该返回树状结构
    # 或者在这里处理扁平列表到树状结构的转换
    # 假设 crud.get_plot_branches_for_novel_structured 已经处理
    structured_branches = await crud.get_plot_branches_for_novel_structured(db, novel_id=novel_id)
    return structured_branches


@router.get(
    "/{branch_id}",
    response_model=schemas.PlotBranch, # 或者是 PlotBranchWithVersions? 取决于需求
    summary="获取单个大纲分支的详细信息"
)
async def read_plot_branch(
    branch_id: int = Path(..., description="要检索的大纲分支ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    通过ID获取单个大纲分支的详细信息。
    可能需要同时加载其关联的大纲版本。
    """
    db_branch = await crud.get_plot_branch(db, branch_id=branch_id)
    if db_branch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {branch_id} 的大纲分支未找到。")
    return db_branch


@router.put(
    "/{branch_id}",
    response_model=schemas.PlotBranch,
    summary="更新一个大纲分支的信息"
)
async def update_plot_branch(
    branch_id: int,
    branch_in: schemas.PlotBranchUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个已存在的大纲分支的名称或描述。
    """
    updated_branch = await crud.update_plot_branch(db=db, branch_id=branch_id, branch_in=branch_in)
    if updated_branch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {branch_id} 的大纲分支未找到。")
    return updated_branch


@router.delete(
    "/{branch_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一个大纲分支"
)
async def delete_plot_branch(
    branch_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    永久删除一个大纲分支。
    注意：需要处理其子分支和关联的大纲版本的逻辑（例如：级联删除、设为null或禁止删除）。
    假设 crud.delete_plot_branch 已经考虑了这些情况。
    """
    success = await crud.delete_plot_branch(db, branch_id=branch_id)
    if not success:
        # crud.delete_plot_branch 应该在无法删除时（例如，因为存在子项且策略是禁止删除）或找不到时返回 False
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {branch_id} 的大纲分支未找到或无法删除。")
    return None