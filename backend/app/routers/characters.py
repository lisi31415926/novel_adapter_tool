# backend/app/routers/characters.py
import logging
from typing import List, Optional # 移除了 TypeVar, Generic，因为 PaginatedResponse 在 schemas.py 中定义

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Body, status
# 导入异步会话类型
from sqlalchemy.ext.asyncio import AsyncSession

# 修正导入路径：从 .. (app 目录) 导入 crud, schemas
from .. import crud, schemas # 移除了 models 的直接导入，schemas 中已有相关 Read/Create 模型
from ..database import get_db # 导入异步 get_db

logger = logging.getLogger(__name__)

# 定义路由，并将 novel_id 作为共同路径前缀
router = APIRouter(
    prefix="/api/v1/novels/{novel_id}/characters", # 保持大纲中的路由结构
    tags=["Characters - (小说下)角色管理"], # 修正标签名
)


# --- API 端点 ---

@router.post(
    "/",
    response_model=schemas.CharacterRead, # 返回 CharacterRead 以包含所有字段
    status_code=status.HTTP_201_CREATED,
    summary="为指定小说创建一个新角色"
)
async def create_character_for_novel_endpoint( # 函数名稍作调整以表明是端点
    novel_id: int = Path(..., gt=0, description="角色所属的小说ID"),
    character_in: schemas.CharacterCreate = Body(...),
    db: AsyncSession = Depends(get_db) # 使用异步 Session
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
    
    # 确保 character_in 中的 novel_id 与路径参数一致 (如果 schema 中有的话)
    # 根据 schemas.CharacterCreate，novel_id 是必需的
    if character_in.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"请求体中的 novel_id ({character_in.novel_id}) 与路径中的 novel_id ({novel_id}) 不匹配。"
        )
    
    # 调用异步的 crud 函数
    db_character = await crud.create_character(db=db, character_create=character_in)
    return db_character


@router.get(
    "/", 
    response_model=schemas.PaginatedResponse[schemas.CharacterRead], # 使用 CharacterRead
    summary="获取指定小说的所有角色（分页）"
)
async def read_characters_for_novel_paginated( # 函数名修改
    novel_id: int = Path(..., description="所属小说的ID"), # 从路径获取 novel_id
    db: AsyncSession = Depends(get_db), # 使用异步 Session
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量"),
    # 新增：与前端 CharacterListPage.tsx 筛选条件对应的查询参数
    name: Optional[str] = Query(None, description="按角色名称模糊搜索"),
    role_type: Optional[str] = Query(None, description="按角色类型筛选"),
    sort_by: Optional[str] = Query("name", description="排序字段 (例如: name, created_at)"), # 对应 SortableCharacterFieldsList
    sort_dir: Optional[schemas.SortDirectionEnum] = Query(schemas.SortDirectionEnum.ASC, description="排序方向 (asc, desc)") # 使用枚举
):
    """
    获取指定小说下的所有角色，支持分页、筛选和排序。
    """
    # 验证小说是否存在
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")

    skip = (page - 1) * page_size
    # crud.get_characters_by_novel_and_count 需要支持筛选和排序参数
    characters, total_count = await crud.get_characters_by_novel_and_count(
        db, 
        novel_id=novel_id, 
        skip=skip, 
        limit=page_size,
        name_filter=name,      # 传递给 crud
        role_type_filter=role_type, # 传递给 crud
        sort_by=sort_by,       # 传递给 crud
        sort_direction=sort_dir # 传递给 crud
    )
    
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
    
    return schemas.PaginatedResponse(
        total_count=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=characters
    )


@router.get(
    "/{character_id}",
    response_model=schemas.CharacterRead, # 使用 CharacterRead
    summary="获取单个角色的详细信息"
)
async def read_single_character_for_novel_endpoint( # 函数名修改
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    character_id: int = Path(..., gt=0, description="要检索的角色ID"),
    db: AsyncSession = Depends(get_db) # 使用异步 Session
):
    """
    获取单个角色的详细信息，并验证其属于指定的小说。
    """
    db_character = await crud.get_character(db, character_id=character_id)
    if not db_character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"角色ID {character_id} 未找到。")
    
    if db_character.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, # 403 Forbidden 更合适
            detail=f"角色ID {character_id} 不属于小说ID {novel_id}。"
        )
        
    return db_character


@router.put(
    "/{character_id}",
    response_model=schemas.CharacterRead, # 使用 CharacterRead
    summary="更新指定角色的信息"
)
async def update_character_for_novel_endpoint( # 函数名修改
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    character_id: int = Path(..., gt=0, description="要更新的角色ID"),
    character_in: schemas.CharacterUpdate = Body(...), # 明确 Body
    db: AsyncSession = Depends(get_db) # 使用异步 Session
):
    """
    更新一个角色，并验证其属于指定的小说。
    """
    # 首先，验证角色存在且属于该小说
    db_character_to_update = await crud.get_character(db, character_id=character_id)
    if not db_character_to_update:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"角色ID {character_id} 未找到。")

    if db_character_to_update.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"角色ID {character_id} 不属于小说ID {novel_id}。"
        )

    # 调用异步的 crud 函数进行更新
    updated_character = await crud.update_character(db, character_id=character_id, character_update=character_in)
    # crud.update_character 内部会再次获取对象，如果未找到会处理（但理论上不应发生）
    return updated_character


@router.delete(
    "/{character_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除指定角色"
)
async def delete_character_for_novel_endpoint( # 函数名修改
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    character_id: int = Path(..., gt=0, description="要删除的角色ID"),
    db: AsyncSession = Depends(get_db) # 使用异步 Session
):
    """
    删除一个角色，并验证其属于指定的小说。
    """
    # 验证角色存在且属于该小说
    db_character_to_delete = await crud.get_character(db, character_id=character_id)
    if not db_character_to_delete:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"角色ID {character_id} 未找到。")
    
    if db_character_to_delete.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"角色ID {character_id} 不属于小说ID {novel_id}。"
        )
    
    # 调用异步的 crud 函数进行删除
    success = await crud.delete_character(db, character_id=character_id)
    if not success: 
         # crud.delete_character 在未找到时会返回 False 或抛出 NotFoundError (取决于实现)
         # 如果它返回False，我们在这里转换为 HTTPException
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"删除角色ID {character_id} 失败，可能已被删除或不存在。")

    return None # 204 No Content