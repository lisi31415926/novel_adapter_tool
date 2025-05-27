# backend/app/routers/characters.py
import logging
from typing import List, Optional, TypeVar, Generic
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Body, status
from pydantic import BaseModel

# 导入异步会话类型
from sqlalchemy.ext.asyncio import AsyncSession

# 导入 CRUD 操作、schemas 和异步 get_db 依赖
from .. import crud, schemas, models
from ..database import get_db

logger = logging.getLogger(__name__)

# 定义路由，并将 novel_id 作为共同路径前缀
router = APIRouter(
    prefix="/novels/{novel_id}/characters",
    tags=["Characters - 角色管理"]
)


# --- API 端点 ---

@router.post(
    "/",
    response_model=schemas.Character,
    status_code=status.HTTP_201_CREATED,
    summary="为指定小说创建一个新角色"
)
async def create_character_for_novel(
    # novel_id 从路径中获取
    novel_id: int = Path(..., gt=0, description="角色所属的小说ID"),
    # character_in 从请求体中获取
    character_in: schemas.CharacterCreate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    为指定小说创建一个新角色。
    - novel_id 在路径中提供。
    - 角色数据在请求体中提供。
    """
    # 验证小说是否存在
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    
    # 确保 character_in 中的 novel_id 与路径参数一致
    if character_in.novel_id is None:
        character_in.novel_id = novel_id
    elif character_in.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"请求体中的 novel_id ({character_in.novel_id}) 与路径中的 novel_id ({novel_id}) 不匹配。"
        )

    # 【原生异步调用】
    db_character = await crud.create_character(db=db, character_create=character_in)
    return db_character


@router.get("/", response_model=schemas.PaginatedResponse[schemas.CharacterRead], summary="获取指定小说的所有角色（分页）")
async def read_characters(
    novel_id: int,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量")
):
    skip = (page - 1) * page_size
    items_list, total_count = await crud.get_characters_by_novel_and_count(
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
    "/{character_id}",
    response_model=schemas.Character,
    summary="获取单个角色的详细信息"
)
async def read_single_character_for_novel(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    character_id: int = Path(..., gt=0, description="要检索的角色ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个角色的详细信息，并验证其属于指定的小说。
    """
    # 【原生异步调用】
    db_character = await crud.get_character(db, character_id=character_id)
    if not db_character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"角色ID {character_id} 未找到。")
    
    # 验证角色是否属于该小说
    if db_character.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"角色ID {character_id} 不属于小说ID {novel_id}。"
        )
        
    return db_character


@router.put(
    "/{character_id}",
    response_model=schemas.Character,
    summary="更新指定角色的信息"
)
async def update_character_for_novel(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    character_id: int = Path(..., gt=0, description="要更新的角色ID"),
    character_in: schemas.CharacterUpdate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个角色，并验证其属于指定的小说。
    """
    # 【原生异步调用】
    db_character = await crud.get_character(db, character_id=character_id)
    if not db_character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"角色ID {character_id} 未找到。")

    if db_character.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"角色ID {character_id} 不属于小说ID {novel_id}。"
        )

    # 【原生异步调用】
    updated_character = await crud.update_character(db, character_id=character_id, character_update=character_in)
    return updated_character


@router.delete(
    "/{character_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除指定角色"
)
async def delete_character_for_novel(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    character_id: int = Path(..., gt=0, description="要删除的角色ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    删除一个角色，并验证其属于指定的小说。
    """
    # 【原生异步调用】
    db_character_to_delete = await crud.get_character(db, character_id=character_id)
    if not db_character_to_delete:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"角色ID {character_id} 未找到。")
    
    if db_character_to_delete.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"角色ID {character_id} 不属于小说ID {novel_id}。"
        )
    
    # 【原生异步调用】
    success = await crud.delete_character(db, character_id=character_id)
    if not success:
         # 这一步理论上不会发生，因为前面已经检查过了
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="删除角色时发生未知错误。")

    return None # 204 No Content
