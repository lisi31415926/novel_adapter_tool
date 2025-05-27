# backend/app/routers/plot_versions.py
import logging
import asyncio
import difflib
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, schemas, models
from app.dependencies import get_db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/plot-versions",
    tags=["Plot Versions"],
)

@router.post("/", response_model=schemas.PlotVersion, status_code=status.HTTP_201_CREATED)
async def create_plot_version(
    plot_version_in: schemas.PlotVersionCreate,
    db: Session = Depends(get_dbs)
):
    """
    为指定的小说或大纲分支创建一个新的大纲版本。
    """
    # 检查关联的小说或分支是否存在
    if plot_version_in.novel_id:
        db_novel = await asyncio.to_thread(crud.get_novel, db, novel_id=plot_version_in.novel_id)
        if not db_novel:
            raise HTTPException(status_code=404, detail=f"Novel with id {plot_version_in.novel_id} not found")

    if plot_version_in.branch_id:
        db_branch = await asyncio.to_thread(crud.get_plot_branch, db, branch_id=plot_version_in.branch_id)
        if not db_branch:
            raise HTTPException(status_code=404, detail=f"PlotBranch with id {plot_version_in.branch_id} not found")

    try:
        new_plot_version = await asyncio.to_thread(crud.create_plot_version, db=db, plot_version=plot_version_in)
        return new_plot_version
    except Exception as e:
        logger.error(f"创建大纲版本失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error while creating plot version.")

@router.get("/novel/{novel_id}", response_model=List[schemas.PlotVersion])
async def get_plot_versions_for_novel(
    novel_id: int, 
    db: Session = Depends(get_db)
):
    """
    获取指定小说的所有大纲版本。
    """
    db_novel = await asyncio.to_thread(crud.get_novel, db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=404, detail=f"Novel with id {novel_id} not found")
    
    plot_versions = await asyncio.to_thread(crud.get_plot_versions_by_novel_id, db, novel_id=novel_id)
    return plot_versions

@router.get("/compare", response_model=schemas.PlotVersionComparison)
async def compare_plot_versions(
    version1_id: int,
    version2_id: int,
    db: Session = Depends(get_db)
):
    """
    比较两个大纲版本内容的差异。
    """
    if version1_id == version2_id:
        raise HTTPException(status_code=400, detail="Cannot compare a version with itself.")

    # 并发获取两个版本的信息
    v1_task = asyncio.to_thread(crud.get_plot_version, db, version_id=version1_id)
    v2_task = asyncio.to_thread(crud.get_plot_version, db, version_id=version2_id)
    
    version1, version2 = await asyncio.gather(v1_task, v2_task)

    if not version1:
        raise HTTPException(status_code=404, detail=f"PlotVersion with id {version1_id} not found")
    if not version2:
        raise HTTPException(status_code=404, detail=f"PlotVersion with id {version2_id} not found")

    content1 = version1.content or ""
    content2 = version2.content or ""
    
    diff_lines = list(difflib.unified_diff(
        content1.splitlines(keepends=True),
        content2.splitlines(keepends=True),
        fromfile=f"version_{version1.id}_{version1.version_name}",
        tofile=f"version_{version2.id}_{version2.version_name}",
    ))

    return schemas.PlotVersionComparison(
        version1_id=version1.id,
        version1_name=version1.version_name,
        version2_id=version2.id,
        version2_name=version2.version_name,
        diff_output=diff_lines
    )


@router.get("/{version_id}", response_model=schemas.PlotVersion)
async def get_plot_version(
    version_id: int, 
    db: Session = Depends(get_db)
):
    """
    获取单个大纲版本的详细信息。
    """
    db_plot_version = await asyncio.to_thread(crud.get_plot_version, db, version_id=version_id)
    if db_plot_version is None:
        raise HTTPException(status_code=404, detail="PlotVersion not found")
    return db_plot_version

@router.put("/{version_id}", response_model=schemas.PlotVersion)
async def update_plot_version(
    version_id: int,
    plot_version_in: schemas.PlotVersionUpdate,
    db: Session = Depends(get_db)
):
    """
    更新一个大纲版本的信息。
    """
    db_plot_version = await asyncio.to_thread(crud.get_plot_version, db, version_id=version_id)
    if not db_plot_version:
        raise HTTPException(status_code=404, detail="PlotVersion not found")
    
    updated_plot_version = await asyncio.to_thread(crud.update_plot_version, db, db_obj=db_plot_version, obj_in=plot_version_in)
    return updated_plot_version

@router.delete("/{version_id}", response_model=schemas.PlotVersion)
async def delete_plot_version(
    version_id: int, 
    db: Session = Depends(get_db)
):
    """
    删除一个大纲版本。
    """
    db_plot_version = await asyncio.to_thread(crud.get_plot_version, db, version_id=version_id)
    if not db_plot_version:
        raise HTTPException(status_code=404, detail="PlotVersion not found")

    deleted_plot_version = await asyncio.to_thread(crud.delete_plot_version, db, version_id=version_id)
    return deleted_plot_version