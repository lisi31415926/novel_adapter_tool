from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas
from ..database import get_db

# 为事件和事件关系分别创建路由器
event_router = APIRouter(
    prefix="/novels/{novel_id}/events",
    tags=["Events Management"]
)

event_relationship_router = APIRouter(
    prefix="/novels/{novel_id}/event-relationships",
    tags=["Event Relationships Management"]
)

# =============================================================================
# --- Events (事件) API Endpoints ---
# =============================================================================

@event_router.post(
    "/",
    response_model=schemas.EventRead,
    status_code=status.HTTP_201_CREATED,
    summary="为小说创建新事件"
)
async def create_event(
    novel_id: int,
    event: schemas.EventCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    为指定的小说创建一个新的事件。
    """
    if event.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="路径中的 novel_id 与请求体中的 novel_id 不匹配。"
        )
    return await crud.create_event(db=db, event=event)

@event_router.get(
    "/{event_id}",
    response_model=schemas.EventRead,
    summary="根据ID获取事件详情"
)
async def read_event(
    event_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个事件的详细信息，包含其关联的所有关系。
    """
    db_event = await crud.get_event(db=db, event_id=event_id)
    if db_event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="事件未找到")
    return db_event

@event_router.get("/", response_model=schemas.PaginatedResponse[schemas.EventRead], summary="获取小说的所有事件（分页）")
async def read_events(
    novel_id: int,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(100, ge=1, le=200, description="每页数量")
):
    skip = (page - 1) * page_size
    items_list, total_count = await crud.get_events_by_novel_and_count(
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

@event_router.put(
    "/{event_id}",
    response_model=schemas.EventRead,
    summary="更新事件信息"
)
async def update_event(
    event_id: int,
    event: schemas.EventUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个已存在事件的信息。
    """
    db_event = await crud.get_event(db, event_id=event_id)
    if not db_event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="事件未找到")
    
    updated_event = await crud.update_event(db=db, event_id=event_id, event_update=event)
    return updated_event


@event_router.delete(
    "/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一个事件"
)
async def delete_event(
    event_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    根据ID删除一个事件。
    """
    db_event = await crud.delete_event(db=db, event_id=event_id)
    if db_event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="事件未找到")
    return None

# =============================================================================
# --- Event Relationships API Endpoints ---
# =============================================================================

@event_relationship_router.post(
    "/",
    response_model=schemas.EventRelationshipRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建新的事件关系"
)
async def create_event_relationship(
    novel_id: int,
    relationship: schemas.EventRelationshipCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    在两个事件之间创建一个新的关系。
    """
    if relationship.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="路径中的 novel_id 与请求体中的 novel_id 不匹配。"
        )
    return await crud.create_event_relationship(db=db, relationship=relationship)


@event_relationship_router.get(
    "/{relationship_id}",
    response_model=schemas.EventRelationshipRead,
    summary="获取事件关系详情"
)
async def read_event_relationship(
    relationship_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    根据ID获取单个事件关系的详细信息。
    """
    db_rel = await crud.get_event_relationship(db, relationship_id=relationship_id)
    if not db_rel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"事件关系ID {relationship_id} 未找到。")
    return db_rel

@event_relationship_router.get("/", response_model=schemas.PaginatedResponse[schemas.EventRelationshipRead], summary="获取小说的所有事件关系（分页）")
async def read_event_relationships(
    novel_id: int,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(100, ge=1, le=200, description="每页数量")
):
    skip = (page - 1) * page_size
    items_list, total_count = await crud.get_event_relationships_by_novel_and_count(
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


@event_relationship_router.put(
    "/{relationship_id}",
    response_model=schemas.EventRelationshipRead,
    summary="更新事件关系"
)
async def update_event_relationship(
    relationship_id: int,
    relationship_update: schemas.EventRelationshipUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个事件关系的信息。
    """
    db_rel = await crud.get_event_relationship(db, relationship_id=relationship_id)
    if not db_rel:
         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"事件关系ID {relationship_id} 未找到。")
    
    updated_rel = await crud.update_event_relationship(db=db, relationship_id=relationship_id, relationship_update=relationship_update)
    return updated_rel


@event_relationship_router.delete(
    "/{relationship_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除事件关系"
)
async def delete_event_relationship(
    relationship_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    根据ID删除一个事件关系。
    """
    deleted_rel = await crud.delete_event_relationship(db, relationship_id=relationship_id)
    if not deleted_rel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"事件关系ID {relationship_id} 未找到。")
    return None