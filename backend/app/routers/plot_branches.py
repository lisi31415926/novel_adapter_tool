# backend/app/routers/plot_branches.py
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Path, Body
from sqlalchemy.ext.asyncio import AsyncSession

# 修正导入路径
from .. import crud, schemas
from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/novels/{novel_id}/plot-branches",
    tags=["Plot Branches - (小说下)剧情分支管理"],
)


# --- API 端点 ---

@router.post(
    "/",
    response_model=schemas.PlotBranchRead,
    status_code=status.HTTP_201_CREATED,
    summary="为指定小说创建一个新的剧情分支"
)
async def create_plot_branch_endpoint(
    novel_id: int = Path(..., gt=0, description="分支所属的小说ID"),
    branch_in: schemas.PlotBranchCreate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    为指定小说创建一个新的剧情分支。
    - 可选地，可以指定一个父分支ID来创建层级关系。
    """
    # 1. 验证小说是否存在
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    
    # 2. 确保请求体中的 novel_id 与路径参数一致
    if branch_in.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"请求体中的 novel_id ({branch_in.novel_id}) 与路径中的 novel_id ({novel_id}) 不匹配。"
        )
        
    # 3. 如果提供了父分支ID，验证父分支是否存在且属于同一个小说
    if branch_in.parent_branch_id is not None:
        parent_branch = await crud.get_plot_branch(db, plot_branch_id=branch_in.parent_branch_id)
        if not parent_branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"指定的父分支ID {branch_in.parent_branch_id} 未找到。"
            )
        if parent_branch.novel_id != novel_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="父分支必须与子分支属于同一个小说。"
            )
            
    # 4. 创建剧情分支
    return await crud.create_plot_branch(db=db, plot_branch_create=branch_in)

@router.get(
    "/",
    response_model=List[schemas.PlotBranchTreeNode], # 响应为树状结构节点列表
    summary="获取指定小说的所有剧情分支（树状结构）"
)
async def read_plot_branches_for_novel_structured_endpoint(
    novel_id: int = Path(..., gt=0, description="所属小说的ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取指定小说下的所有剧情分支，并以适合前端渲染的树状结构返回。
    """
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    
    # 调用 crud 中专门获取结构化数据的函数
    structured_branches = await crud.get_plot_branches_for_novel_structured(db, novel_id=novel_id)
    return structured_branches

@router.get(
    "/{branch_id}",
    response_model=schemas.PlotBranchRead,
    summary="获取单个剧情分支的详细信息"
)
async def read_single_plot_branch_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    branch_id: int = Path(..., gt=0, description="要检索的剧情分支ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个剧情分支的详细信息，并验证其属于指定的小说。
    """
    db_branch = await crud.get_plot_branch(db, plot_branch_id=branch_id)
    if not db_branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"剧情分支ID {branch_id} 未找到。")
    
    if db_branch.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"剧情分支ID {branch_id} 不属于小说ID {novel_id}。"
        )
    return db_branch

@router.put(
    "/{branch_id}",
    response_model=schemas.PlotBranchRead,
    summary="更新指定剧情分支的信息"
)
async def update_plot_branch_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    branch_id: int = Path(..., gt=0, description="要更新的剧情分支ID"),
    branch_in: schemas.PlotBranchUpdate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个剧情分支（如名称、描述），并验证其属于指定的小说。
    """
    db_branch_to_update = await crud.get_plot_branch(db, plot_branch_id=branch_id)
    if not db_branch_to_update:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"剧情分支ID {branch_id} 未找到。")

    if db_branch_to_update.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"剧情分支ID {branch_id} 不属于小说ID {novel_id}。"
        )

    # 验证新的父分支ID（如果被修改）
    if branch_in.parent_branch_id is not None:
        # 不能将自己设为自己的父分支
        if branch_in.parent_branch_id == branch_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="一个分支不能成为自己的父分支。")
            
        parent_branch = await crud.get_plot_branch(db, plot_branch_id=branch_in.parent_branch_id)
        if not parent_branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"指定的新父分支ID {branch_in.parent_branch_id} 未找到。"
            )
        if parent_branch.novel_id != novel_id:
             raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="新的父分支必须与当前分支属于同一个小说。"
            )

    return await crud.update_plot_branch(db, plot_branch_id=branch_id, plot_branch_update=branch_in)

@router.delete(
    "/{branch_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除指定剧情分支"
)
async def delete_plot_branch_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    branch_id: int = Path(..., gt=0, description="要删除的剧情分支ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    删除一个剧情分支。
    注意：数据库应配置级联删除，以处理其下的所有剧情版本。
    同时，其子分支的处理策略（一并删除或提升）应在服务或CRUD层定义。
    """
    db_branch_to_delete = await crud.get_plot_branch(db, plot_branch_id=branch_id)
    if not db_branch_to_delete:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"剧情分支ID {branch_id} 未找到。")
    
    if db_branch_to_delete.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"剧情分支ID {branch_id} 不属于小说ID {novel_id}。"
        )
    
    # crud.delete_plot_branch 内部应处理与其子分支相关的逻辑
    success = await crud.delete_plot_branch(db, plot_branch_id=branch_id)
    if not success:
        # crud层可能因为业务规则（如分支非空）而拒绝删除
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail=f"删除剧情分支ID {branch_id} 失败。可能该分支下仍有子分支，或已被删除。"
        )
    return None