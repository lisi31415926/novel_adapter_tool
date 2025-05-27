# backend/app/routers/character_relationships.py
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Body, status, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

# 导入 CRUD 操作、schemas 和异步 get_db 依赖
from .. import crud, schemas
from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/character-relationships",
    tags=["Character Relationships - 角色关系管理"]
)


# --- API 端点 ---

@router.post(
    "/",
    response_model=schemas.CharacterRelationship,
    status_code=status.HTTP_201_CREATED,
    summary="创建一个新的角色关系"
)
async def create_character_relationship(
    relationship_in: schemas.CharacterRelationshipCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    创建一个新的角色关系。

    在创建之前，会验证源角色和目标角色是否存在，并确保它们属于同一个小说。
    """
    # 验证源角色和目标角色是否存在
    source_char = await crud.get_character(db, character_id=relationship_in.source_character_id)
    target_char = await crud.get_character(db, character_id=relationship_in.target_character_id)

    if not source_char or not target_char:
        missing_ids = []
        if not source_char:
            missing_ids.append(f"源角色ID {relationship_in.source_character_id}")
        if not target_char:
            missing_ids.append(f"目标角色ID {relationship_in.target_character_id}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{' 和 '.join(missing_ids)} 未找到。")

    # 验证两个角色是否属于同一本小说
    if source_char.novel_id != target_char.novel_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="源角色和目标角色必须属于同一本小说。")
    
    # 将 novel_id 设置到待创建的数据中
    if relationship_in.novel_id is None:
        relationship_in.novel_id = source_char.novel_id
    elif relationship_in.novel_id != source_char.novel_id:
         raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"请求体中的 novel_id ({relationship_in.novel_id}) 与角色所属的小说ID ({source_char.novel_id}) 不匹配。"
        )

    try:
        # 【原生异步调用】
        db_relationship = await crud.create_character_relationship(db, relationship_create=relationship_in)
        return db_relationship
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="已存在一个从源角色到目标角色的关系。"
        )


# 修改后的代码片段
@router.get(
    "/",
    response_model=schemas.PaginatedResponse[schemas.CharacterRelationshipRead],
    summary="获取小说的所有角色关系（分页）"
)
async def read_character_relationships(
    novel_id: int,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200)
):
    skip = (page - 1) * page_size
    items_list, total_count = await crud.get_character_relationships_by_novel_and_count(
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


@router.put(
    "/{relationship_id}",
    response_model=schemas.CharacterRelationship,
    summary="更新指定角色关系的信息"
)
async def update_character_relationship(
    relationship_id: int = Path(..., gt=0, description="要更新的关系ID"),
    relationship_in: schemas.CharacterRelationshipUpdate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个角色关系的信息。
    """
    # 【原生异步调用】
    db_relationship = await crud.get_character_relationship(db, relationship_id=relationship_id)
    if not db_relationship:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"角色关系ID {relationship_id} 未找到。")
    
    # 【原生异步调用】
    updated_relationship = await crud.update_character_relationship(
        db, relationship_id=relationship_id, relationship_update=relationship_in
    )
    return updated_relationship


@router.delete(
    "/{relationship_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除指定角色关系"
)
async def delete_character_relationship(
    relationship_id: int = Path(..., gt=0, description="要删除的关系ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    删除一个角色关系。
    """
    # 【原生异步调用】
    success = await crud.delete_character_relationship(db, relationship_id=relationship_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"角色关系ID {relationship_id} 未找到。")
    
    return None # 204 No Content

