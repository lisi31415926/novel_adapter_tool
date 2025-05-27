# backend/app/routers/events.py
import logging
from typing import Optional
from sqlalchemy.exc import IntegrityError

from fastapi import APIRouter, Depends, HTTPException, status, Path, Query, Body
from sqlalchemy.ext.asyncio import AsyncSession

# 修正导入路径
from .. import crud, schemas
from ..database import get_db
from .. import crud, schemas, models # 引入 models 用于类型提示

logger = logging.getLogger(__name__)

# --- 事件 (Events) 路由 ---
events_router = APIRouter(
    prefix="/api/v1/novels/{novel_id}/events",
    tags=["Events - (小说下)事件管理"],
)

@events_router.post(
    "/",
    response_model=schemas.EventRead,
    status_code=status.HTTP_201_CREATED,
    summary="为指定小说创建一个新事件"
)
async def create_event_endpoint(
    novel_id: int = Path(..., gt=0, description="事件所属的小说ID"),
    event_in: schemas.EventCreate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    为指定小说创建一个新的事件。
    """
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    
    if event_in.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"请求体中的 novel_id ({event_in.novel_id}) 与路径中的 novel_id ({novel_id}) 不匹配。"
        )
    
    return await crud.create_event(db=db, event_create=event_in)

@events_router.get(
    "/",
    response_model=schemas.PaginatedResponse[schemas.EventRead],
    summary="获取指定小说的所有事件（分页）"
)
async def get_events_for_novel_paginated(
    novel_id: int = Path(..., gt=0, description="所属小说的ID"),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量"),
    sort_by: Optional[str] = Query("event_time", description="排序字段 (e.g., event_time, name)"),
    sort_dir: Optional[schemas.SortDirectionEnum] = Query(schemas.SortDirectionEnum.ASC, description="排序方向 (asc, desc)")
):
    """
    获取指定小说下的所有事件，支持分页和排序。
    """
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")

    skip = (page - 1) * page_size
    events, total_count = await crud.get_events_by_novel_and_count(
        db, 
        novel_id=novel_id, 
        skip=skip, 
        limit=page_size,
        sort_by=sort_by,
        sort_direction=sort_dir
    )
    
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
    
    return schemas.PaginatedResponse(
        total_count=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=events
    )

@events_router.get(
    "/{event_id}",
    response_model=schemas.EventRead,
    summary="获取单个事件的详细信息"
)
async def get_single_event_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    event_id: int = Path(..., gt=0, description="要检索的事件ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个事件的详细信息，并验证其属于指定的小说。
    """
    db_event = await crud.get_event(db, event_id=event_id)
    if not db_event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"事件ID {event_id} 未找到。")
    
    if db_event.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"事件ID {event_id} 不属于小说ID {novel_id}。"
        )
    return db_event

@events_router.put(
    "/{event_id}",
    response_model=schemas.EventRead,
    summary="更新指定事件的信息"
)
async def update_event_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    event_id: int = Path(..., gt=0, description="要更新的事件ID"),
    event_in: schemas.EventUpdate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个事件，并验证其属于指定的小说。
    """
    db_event_to_update = await crud.get_event(db, event_id=event_id)
    if not db_event_to_update:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"事件ID {event_id} 未找到。")

    if db_event_to_update.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"事件ID {event_id} 不属于小说ID {novel_id}。"
        )

    return await crud.update_event(db, event_id=event_id, event_update=event_in)

@events_router.delete(
    "/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除指定事件"
)
async def delete_event_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    event_id: int = Path(..., gt=0, description="要删除的事件ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    删除一个事件，并验证其属于指定的小说。
    """
    db_event_to_delete = await crud.get_event(db, event_id=event_id)
    if not db_event_to_delete:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"事件ID {event_id} 未找到。")
    
    if db_event_to_delete.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"事件ID {event_id} 不属于小说ID {novel_id}。"
        )
    
    success = await crud.delete_event(db, event_id=event_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"删除事件ID {event_id} 失败，可能已被删除或不存在。"
        )
    return None

# --- 事件关系 (Event Relationships) 路由 ---
event_relationships_router = APIRouter(
    prefix="/api/v1/novels/{novel_id}/event-relationships",
    tags=["Event Relationships - (小说下)事件关系管理"],
)

async def _validate_events_for_relationship(db: AsyncSession, novel_id: int, source_id: int, target_id: int) -> tuple[models.Event, models.Event]:
    """Helper function to validate events before creating/updating a relationship."""
    if source_id == target_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="事件不能与自身建立关系。")

    source_task = crud.get_event(db, event_id=source_id)
    target_task = crud.get_event(db, event_id=target_id)
    source_event, target_event = await crud.asyncio.gather(source_task, target_task)

    if not source_event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"源事件ID {source_id} 未找到。")
    if not target_event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"目标事件ID {target_id} 未找到。")

    if source_event.novel_id != novel_id or target_event.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="源事件和目标事件必须都属于同一个小说。")
    
    return source_event, target_event

@event_relationships_router.post(
    "/",
    response_model=schemas.EventRelationshipRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建一条新的事件关系"
)
async def create_event_relationship_endpoint(
    novel_id: int = Path(..., gt=0, description="关系所属的小说ID"),
    relationship_in: schemas.EventRelationshipCreate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    为指定小说中的两个事件创建一条关系（如因果、时间先后等）。
    """
    await _validate_events_for_relationship(db, novel_id, relationship_in.source_event_id, relationship_in.target_event_id)
    
    try:
        return await crud.create_event_relationship(db, relationship_create=relationship_in)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该事件关系已存在。")

@event_relationships_router.get(
    "/",
    response_model=schemas.PaginatedResponse[schemas.EventRelationshipRead],
    summary="获取指定小说的所有事件关系（分页）"
)
async def get_event_relationships_for_novel_paginated(
    novel_id: int = Path(..., gt=0, description="所属小说的ID"),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量")
):
    """
    获取指定小说下的所有事件关系，支持分页。
    """
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
        
    skip = (page - 1) * page_size
    relationships, total_count = await crud.get_event_relationships_by_novel_and_count(
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

@event_relationships_router.get(
    "/{relationship_id}",
    response_model=schemas.EventRelationshipRead,
    summary="获取单个事件关系的详细信息"
)
async def get_single_event_relationship_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    relationship_id: int = Path(..., gt=0, description="要检索的关系ID"),
    db: AsyncSession = Depends(get_db)
):
    db_relationship = await crud.get_event_relationship(db, relationship_id=relationship_id)
    if not db_relationship:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"事件关系ID {relationship_id} 未找到。")
    
    # 验证关系是否属于该小说 (通过源事件的 novel_id)
    if db_relationship.source_event.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"事件关系ID {relationship_id} 不属于小说ID {novel_id}。"
        )
    return db_relationship

@event_relationships_router.put(
    "/{relationship_id}",
    response_model=schemas.EventRelationshipRead,
    summary="更新指定事件关系的信息"
)
async def update_event_relationship_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    relationship_id: int = Path(..., gt=0, description="要更新的关系ID"),
    relationship_in: schemas.EventRelationshipUpdate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    db_relationship_to_update = await crud.get_event_relationship(db, relationship_id=relationship_id)
    if not db_relationship_to_update:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"事件关系ID {relationship_id} 未找到。")

    if db_relationship_to_update.source_event.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"事件关系ID {relationship_id} 不属于小说ID {novel_id}。"
        )

    return await crud.update_event_relationship(db, relationship_id=relationship_id, relationship_update=relationship_in)

@event_relationships_router.delete(
    "/{relationship_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除指定事件关系"
)
async def delete_event_relationship_endpoint(
    novel_id: int = Path(..., gt=0, description="所属的小说ID"),
    relationship_id: int = Path(..., gt=0, description="要删除的关系ID"),
    db: AsyncSession = Depends(get_db)
):
    db_relationship_to_delete = await crud.get_event_relationship(db, relationship_id=relationship_id)
    if not db_relationship_to_delete:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"事件关系ID {relationship_id} 未找到。")
    
    if db_relationship_to_delete.source_event.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"事件关系ID {relationship_id} 不属于小说ID {novel_id}。"
        )
    
    success = await crud.delete_event_relationship(db, relationship_id=relationship_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"删除事件关系ID {relationship_id} 失败，可能已被删除或不存在。"
        )
    return None