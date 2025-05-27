# backend/app/routers/character_relationships.py
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Path, Query, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError # 用于捕获唯一性约束冲突

# 修正导入路径
from .. import crud, schemas
from ..database import get_db

logger = logging.getLogger(__name__)

# 定义路由，将 novel_id 作为共同路径前缀
router = APIRouter(
    prefix="/api/v1/novels/{novel_id}/character-relationships",
    tags=["Character Relationships - (小说下)角色关系管理"],
)


# --- API 端点 ---

@router.post(
    "/",
    response_model=schemas.CharacterRelationshipRead,
    status_code=status.HTTP_201_CREATED,
    summary="为指定小说创建一条新的角色关系"
)
async def create_character_relationship_endpoint(
    novel_id: int = Path(..., gt=0, description="关系所属的小说ID"),
    relationship_in: schemas.CharacterRelationshipCreate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    为指定小说中的两个角色创建一条关系。
    - 在创建前会验证小说和两个角色是否存在，并确保它们都属于该小说。
    """
    if relationship_in.source_character_id == relationship_in.target_character_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="角色不能与自身建立关系。"
        )

    # 并发获取小说和两个角色的信息
    novel_task = crud.get_novel(db, novel_id=novel_id)
    source_char_task = crud.get_character(db, character_id=relationship_in.source_character_id)
    target_char_task = crud.get_character(db, character_id=relationship_in.target_character_id)

    db_novel, source_char, target_char = await crud.asyncio.gather(novel_task, source_char_task, target_char_task)

    # 统一进行校验
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    if not source_char:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"源角色ID {relationship_in.source_character_id} 未找到。")
    if not target_char:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"目标角色ID {relationship_in.target_character_id} 未找到。")

    # 校验角色是否都属于该小说
    if source_char.novel_id != novel_id or target_char.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="源角色和目标角色必须都属于同一个小说。"
        )

    # 确保 relationship_in 中的 novel_id 与路径参数一致
    if relationship_in.novel_id != novel_id:
         raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"请求体中的 novel_id ({relationship_in.novel_id}) 与路径中的 novel_id ({novel_id}) 不匹配。"
        )

    try:
        # crud.create_character_relationship 已经是异步的
        db_relationship = await crud.create_character_relationship(db, relationship_create=relationship_in)
        return db_relationship
    except IntegrityError: # 捕获唯一性约束错误 (例如，同一对角色关系已存在)
        await db.rollback() # crud 层可能已经回滚，但在这里显式回滚是安全的
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="这条角色关系已存在。"
        )


@router.get(
    "/",
    response_model=schemas.PaginatedResponse[schemas.CharacterRelationshipRead],
    summary="获取指定小说的所有角色关系（分页）"
)
async def read_character_relationships_for_novel_paginated(
    novel_id: int = Path(..., gt=0, description="所属小说的ID"),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量")
):
    """
    获取指定小说下的所有角色关系，支持分页。
    """
    # 验证小说是否存在
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")

    skip = (page - 1) * page_size
    relationships, total_count = await crud.get_character_relationships_by_novel_and_count(
        db, novel_id=novel_id, skip=skip, limit=page_size
    )

    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0

    return schemas.PaginatedResponse(
        total_count=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=relationships
    )


@router.get(
    "/{relationship_id}",
    response_model=schemas.CharacterRelationshipRead,
    summary="获取单个角色关系的详细信息"
)
async def read_single_character_relationship_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    relationship_id: int = Path(..., gt=0, description="要检索的关系ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个角色关系的详细信息，并验证其属于指定的小说。
    """
    db_relationship = await crud.get_character_relationship(db, relationship_id=relationship_id)
    if not db_relationship:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"角色关系ID {relationship_id} 未找到。")
    
    # 验证关系是否属于该小说
    if db_relationship.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"角色关系ID {relationship_id} 不属于小说ID {novel_id}。"
        )
        
    return db_relationship


@router.put(
    "/{relationship_id}",
    response_model=schemas.CharacterRelationshipRead,
    summary="更新指定角色关系的信息"
)
async def update_character_relationship_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    relationship_id: int = Path(..., gt=0, description="要更新的关系ID"),
    relationship_in: schemas.CharacterRelationshipUpdate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    更新一条角色关系，并验证其属于指定的小说。
    """
    # 验证关系是否存在且属于该小说
    db_relationship_to_update = await crud.get_character_relationship(db, relationship_id=relationship_id)
    if not db_relationship_to_update:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"角色关系ID {relationship_id} 未找到。")

    if db_relationship_to_update.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"角色关系ID {relationship_id} 不属于小说ID {novel_id}。"
        )

    # 调用 crud 更新
    updated_relationship = await crud.update_character_relationship(
        db, relationship_id=relationship_id, relationship_update=relationship_in
    )
    return updated_relationship


@router.delete(
    "/{relationship_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除指定角色关系"
)
async def delete_character_relationship_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    relationship_id: int = Path(..., gt=0, description="要删除的关系ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    删除一条角色关系，并验证其属于指定的小说。
    """
    # 验证关系是否存在且属于该小说
    db_relationship_to_delete = await crud.get_character_relationship(db, relationship_id=relationship_id)
    if not db_relationship_to_delete:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"角色关系ID {relationship_id} 未找到。")

    if db_relationship_to_delete.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"角色关系ID {relationship_id} 不属于小说ID {novel_id}。"
        )
    
    success = await crud.delete_character_relationship(db, relationship_id=relationship_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"删除角色关系ID {relationship_id} 失败，可能已被删除或不存在。"
        )

    return None # 204 No Content