import logging
from typing import List, Optional, Tuple, TypeVar

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, desc
from sqlmodel import select, SQLModel
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from . import models, schemas
# 假设在 exceptions.py 中定义了这些自定义异常
from .exceptions import NotFoundError, CRUDError

logger = logging.getLogger(__name__)

T_Model = TypeVar('T_Model', bound=SQLModel)
T_Schema = TypeVar('T_Schema', bound=SQLModel)


# --- Generic Helper Functions ---
def update_db_object_from_schema(db_obj: T_Model, update_schema: T_Schema) -> T_Model:
    """
    [已优化] 通用更新函数：使用一个 Pydantic/SQLModel schema 来更新一个 ORM 对象。
    添加了 hasattr 检查，增强了健壮性。
    """
    update_data = update_schema.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if hasattr(db_obj, key):
            setattr(db_obj, key, value)
    return db_obj


# --- Novel ---
async def get_novel(db: AsyncSession, novel_id: int) -> Optional[models.Novel]:
    """[已优化] 通过ID获取单个小说，并预加载章节。"""
    statement = select(models.Novel).where(models.Novel.id == novel_id).options(selectinload(models.Novel.chapters))
    result = await db.execute(statement)
    return result.scalars().first()

async def get_novel_with_all_data(db: AsyncSession, novel_id: int) -> Optional[models.Novel]:
    """[已优化] 深度预加载小说所有关联数据，包括剧情分支的版本。"""
    statement = (
        select(models.Novel)
        .where(models.Novel.id == novel_id)
        .options(
            selectinload(models.Novel.chapters),
            selectinload(models.Novel.characters),
            selectinload(models.Novel.worldviews),
            selectinload(models.Novel.events),
            selectinload(models.Novel.conflicts),
            selectinload(models.Novel.plot_branches).selectinload(models.PlotBranch.versions), # 嵌套预加载
            selectinload(models.Novel.material_snippets),
            selectinload(models.Novel.analysis_results),
        )
    )
    result = await db.execute(statement)
    return result.scalars().first()

async def get_novels_and_count(db: AsyncSession, skip: int = 0, limit: int = 100) -> Tuple[List[models.Novel], int]:
    count_statement = select(func.count()).select_from(models.Novel)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = select(models.Novel).order_by(models.Novel.id).offset(skip).limit(limit)
    result = await db.execute(statement)
    novels = result.scalars().all()
    return novels, total_count

async def create_novel(db: AsyncSession, novel_create: schemas.NovelCreate) -> models.Novel:
    """[已优化] 创建新小说。如果书名已存在，则抛出 ValueError。"""
    db_novel = models.Novel.model_validate(novel_create)
    try:
        db.add(db_novel)
        await db.commit()
        await db.refresh(db_novel)
        logger.info(f"成功创建小说: {db_novel.title} (ID: {db_novel.id})")
        return db_novel
    except IntegrityError:
        await db.rollback()
        logger.error(f"创建小说失败: 书名 '{db_novel.title}' 可能已存在。")
        raise ValueError(f"书名 '{db_novel.title}' 已存在。")
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建小说时发生数据库错误: {e}", exc_info=True)
        raise CRUDError(f"创建小说时发生数据库错误: {e}")

async def update_novel(db: AsyncSession, novel_id: int, novel_update: schemas.NovelUpdate) -> models.Novel:
    """[已优化] 更新小说。如果未找到则抛出 NotFoundError。"""
    db_novel = await db.get(models.Novel, novel_id)
    if not db_novel:
        raise NotFoundError(f"未找到 ID 为 {novel_id} 的小说。")
    
    db_novel = update_db_object_from_schema(db_novel, novel_update)
    try:
        db.add(db_novel)
        await db.commit()
        await db.refresh(db_novel)
        logger.info(f"成功更新小说 ID: {novel_id}")
        return db_novel
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新小说 ID {novel_id} 时发生数据库错误: {e}", exc_info=True)
        raise CRUDError(f"更新小说 ID {novel_id} 时发生数据库错误: {e}")

async def delete_novel(db: AsyncSession, novel_id: int) -> bool:
    """[已优化] 删除小说。如果未找到则抛出 NotFoundError。"""
    db_novel = await db.get(models.Novel, novel_id)
    if not db_novel:
        raise NotFoundError(f"未找到 ID 为 {novel_id} 的小说。")
    try:
        await db.delete(db_novel)
        await db.commit()
        logger.info(f"成功删除小说 ID: {novel_id}")
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除小说 ID {novel_id} 时发生数据库错误: {e}", exc_info=True)
        raise CRUDError(f"删除小说 ID {novel_id} 时发生数据库错误: {e}")


# --- Chapter ---
async def get_chapter(db: AsyncSession, chapter_id: int) -> Optional[models.Chapter]:
    return await db.get(models.Chapter, chapter_id)

async def get_chapters_by_novel_and_count(db: AsyncSession, novel_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.Chapter], int]:
    count_statement = select(func.count()).select_from(models.Chapter).where(models.Chapter.novel_id == novel_id)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = select(models.Chapter).where(models.Chapter.novel_id == novel_id).order_by(models.Chapter.chapter_order).offset(skip).limit(limit)
    result = await db.execute(statement)
    chapters = result.scalars().all()
    return chapters, total_count

async def create_chapter(db: AsyncSession, chapter_create: schemas.ChapterCreate) -> models.Chapter:
    db_chapter = models.Chapter.model_validate(chapter_create)
    try:
        db.add(db_chapter)
        await db.commit()
        await db.refresh(db_chapter)
        return db_chapter
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建章节时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建章节时发生错误: {e}")

async def bulk_create_chapters(db: AsyncSession, chapters_create: List[schemas.ChapterCreate]) -> List[models.Chapter]:
    """
    [已验证] 批量创建章节。
    现代 SQLAlchemy 异步驱动 (如 asyncpg, aiosqlite) 支持 RETURNING 语句，
    当调用 await db.commit() 时，数据库生成的ID会自动填充回会话中的Python对象实例。
    因此，此方法是高性能且数据可靠的，无需为获取主键而逐一刷新。
    """
    db_chapters = [models.Chapter.model_validate(c) for c in chapters_create]
    try:
        db.add_all(db_chapters)
        await db.commit()
        return db_chapters
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"批量创建章节时发生错误: {e}", exc_info=True)
        raise CRUDError(f"批量创建章节时发生错误: {e}")

async def update_chapter(db: AsyncSession, chapter_id: int, chapter_update: schemas.ChapterUpdate) -> models.Chapter:
    db_chapter = await db.get(models.Chapter, chapter_id)
    if not db_chapter:
        raise NotFoundError(f"未找到 ID 为 {chapter_id} 的章节。")
    db_chapter = update_db_object_from_schema(db_chapter, chapter_update)
    try:
        db.add(db_chapter)
        await db.commit()
        await db.refresh(db_chapter)
        return db_chapter
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新章节 ID {chapter_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新章节 ID {chapter_id} 时发生错误: {e}")

async def delete_chapter(db: AsyncSession, chapter_id: int) -> bool:
    db_chapter = await db.get(models.Chapter, chapter_id)
    if not db_chapter:
        raise NotFoundError(f"未找到 ID 为 {chapter_id} 的章节。")
    try:
        await db.delete(db_chapter)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除章节 ID {chapter_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除章节 ID {chapter_id} 时发生错误: {e}")


# --- Character ---
async def get_character(db: AsyncSession, character_id: int) -> Optional[models.Character]:
    return await db.get(models.Character, character_id)

async def get_characters_by_novel_and_count(db: AsyncSession, novel_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.Character], int]:
    count_statement = select(func.count()).select_from(models.Character).where(models.Character.novel_id == novel_id)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = select(models.Character).where(models.Character.novel_id == novel_id).order_by(models.Character.id).offset(skip).limit(limit)
    result = await db.execute(statement)
    characters = result.scalars().all()
    return characters, total_count

async def create_character(db: AsyncSession, character_create: schemas.CharacterCreate) -> models.Character:
    db_character = models.Character.model_validate(character_create)
    try:
        db.add(db_character)
        await db.commit()
        await db.refresh(db_character)
        return db_character
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建角色时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建角色时发生错误: {e}")

async def update_character(db: AsyncSession, character_id: int, character_update: schemas.CharacterUpdate) -> models.Character:
    db_character = await db.get(models.Character, character_id)
    if not db_character:
        raise NotFoundError(f"未找到 ID 为 {character_id} 的角色。")
    db_character = update_db_object_from_schema(db_character, character_update)
    try:
        db.add(db_character)
        await db.commit()
        await db.refresh(db_character)
        return db_character
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新角色 ID {character_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新角色 ID {character_id} 时发生错误: {e}")

async def delete_character(db: AsyncSession, character_id: int) -> bool:
    db_character = await db.get(models.Character, character_id)
    if not db_character:
        raise NotFoundError(f"未找到 ID 为 {character_id} 的角色。")
    try:
        await db.delete(db_character)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除角色 ID {character_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除角色 ID {character_id} 时发生错误: {e}")


# --- Worldview ---
async def get_worldview(db: AsyncSession, worldview_id: int) -> Optional[models.Worldview]:
    return await db.get(models.Worldview, worldview_id)

async def get_worldviews_by_novel_and_count(db: AsyncSession, novel_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.Worldview], int]:
    """[已优化] 获取世界观列表并支持分页。"""
    count_statement = select(func.count()).select_from(models.Worldview).where(models.Worldview.novel_id == novel_id)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = select(models.Worldview).where(models.Worldview.novel_id == novel_id).order_by(models.Worldview.id).offset(skip).limit(limit)
    result = await db.execute(statement)
    worldviews = result.scalars().all()
    return worldviews, total_count

async def create_worldview(db: AsyncSession, worldview_create: schemas.WorldviewCreate) -> models.Worldview:
    db_worldview = models.Worldview.model_validate(worldview_create)
    try:
        db.add(db_worldview)
        await db.commit()
        await db.refresh(db_worldview)
        return db_worldview
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建世界观时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建世界观时发生错误: {e}")

async def update_worldview(db: AsyncSession, worldview_id: int, worldview_update: schemas.WorldviewUpdate) -> models.Worldview:
    db_worldview = await db.get(models.Worldview, worldview_id)
    if not db_worldview:
        raise NotFoundError(f"未找到 ID 为 {worldview_id} 的世界观。")
    db_worldview = update_db_object_from_schema(db_worldview, worldview_update)
    try:
        db.add(db_worldview)
        await db.commit()
        await db.refresh(db_worldview)
        return db_worldview
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新世界观 ID {worldview_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新世界观 ID {worldview_id} 时发生错误: {e}")

async def delete_worldview(db: AsyncSession, worldview_id: int) -> bool:
    db_worldview = await db.get(models.Worldview, worldview_id)
    if not db_worldview:
        raise NotFoundError(f"未找到 ID 为 {worldview_id} 的世界观。")
    try:
        await db.delete(db_worldview)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除世界观 ID {worldview_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除世界观 ID {worldview_id} 时发生错误: {e}")


# --- CharacterRelationship ---
async def get_character_relationship(db: AsyncSession, relationship_id: int) -> Optional[models.CharacterRelationship]:
    return await db.get(models.CharacterRelationship, relationship_id)

async def get_character_relationships_by_novel_and_count(db: AsyncSession, novel_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.CharacterRelationship], int]:
    count_statement = select(func.count()).select_from(models.CharacterRelationship).where(models.CharacterRelationship.novel_id == novel_id)
    total_count = (await db.execute(count_statement)).scalar_one()
    
    statement = (
        select(models.CharacterRelationship)
        .where(models.CharacterRelationship.novel_id == novel_id)
        .options(
            selectinload(models.CharacterRelationship.source_character),
            selectinload(models.CharacterRelationship.target_character)
        )
        .order_by(models.CharacterRelationship.id)
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(statement)
    relationships = result.scalars().all()
    return relationships, total_count

async def create_character_relationship(db: AsyncSession, relationship_create: schemas.CharacterRelationshipCreate) -> models.CharacterRelationship:
    db_relationship = models.CharacterRelationship.model_validate(relationship_create)
    try:
        db.add(db_relationship)
        await db.commit()
        await db.refresh(db_relationship)
        return db_relationship
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建角色关系时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建角色关系时发生错误: {e}")

async def update_character_relationship(db: AsyncSession, relationship_id: int, relationship_update: schemas.CharacterRelationshipUpdate) -> models.CharacterRelationship:
    db_relationship = await db.get(models.CharacterRelationship, relationship_id)
    if not db_relationship:
        raise NotFoundError(f"未找到 ID 为 {relationship_id} 的角色关系。")
    db_relationship = update_db_object_from_schema(db_relationship, relationship_update)
    try:
        db.add(db_relationship)
        await db.commit()
        await db.refresh(db_relationship)
        return db_relationship
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新角色关系 ID {relationship_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新角色关系 ID {relationship_id} 时发生错误: {e}")

async def delete_character_relationship(db: AsyncSession, relationship_id: int) -> bool:
    db_relationship = await db.get(models.CharacterRelationship, relationship_id)
    if not db_relationship:
        raise NotFoundError(f"未找到 ID 为 {relationship_id} 的角色关系。")
    try:
        await db.delete(db_relationship)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除角色关系 ID {relationship_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除角色关系 ID {relationship_id} 时发生错误: {e}")


# --- Event ---
async def get_event(db: AsyncSession, event_id: int) -> Optional[models.Event]:
    statement = (
        select(models.Event)
        .where(models.Event.id == event_id)
        .options(
            selectinload(models.Event.source_relationships),
            selectinload(models.Event.target_relationships)
        )
    )
    result = await db.execute(statement)
    return result.scalars().first()

async def get_events_by_novel_and_count(db: AsyncSession, novel_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.Event], int]:
    count_statement = select(func.count()).select_from(models.Event).where(models.Event.novel_id == novel_id)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = (
        select(models.Event)
        .where(models.Event.novel_id == novel_id)
        .options(
            selectinload(models.Event.source_relationships),
            selectinload(models.Event.target_relationships)
        )
        .order_by(models.Event.id)
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(statement)
    events = result.scalars().all()
    return events, total_count

async def create_event(db: AsyncSession, event_create: schemas.EventCreate) -> models.Event:
    db_event = models.Event.model_validate(event_create)
    try:
        db.add(db_event)
        await db.commit()
        await db.refresh(db_event)
        return db_event
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建事件时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建事件时发生错误: {e}")

async def update_event(db: AsyncSession, event_id: int, event_update: schemas.EventUpdate) -> models.Event:
    db_event = await db.get(models.Event, event_id)
    if not db_event:
        raise NotFoundError(f"未找到 ID 为 {event_id} 的事件。")
    db_event = update_db_object_from_schema(db_event, event_update)
    try:
        db.add(db_event)
        await db.commit()
        await db.refresh(db_event)
        return db_event
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新事件 ID {event_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新事件 ID {event_id} 时发生错误: {e}")

async def delete_event(db: AsyncSession, event_id: int) -> bool:
    db_event = await db.get(models.Event, event_id)
    if not db_event:
        raise NotFoundError(f"未找到 ID 为 {event_id} 的事件。")
    try:
        await db.delete(db_event)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除事件 ID {event_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除事件 ID {event_id} 时发生错误: {e}")


# --- EventRelationship ---
async def get_event_relationship(db: AsyncSession, relationship_id: int) -> Optional[models.EventRelationship]:
    return await db.get(models.EventRelationship, relationship_id)

async def get_event_relationships_by_novel_and_count(db: AsyncSession, novel_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.EventRelationship], int]:
    count_statement = select(func.count()).select_from(models.EventRelationship).where(models.EventRelationship.novel_id == novel_id)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = (
        select(models.EventRelationship)
        .where(models.EventRelationship.novel_id == novel_id)
        .options(
            selectinload(models.EventRelationship.source_event),
            selectinload(models.EventRelationship.target_event)
        )
        .order_by(models.EventRelationship.id)
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(statement)
    relationships = result.scalars().all()
    return relationships, total_count

async def create_event_relationship(db: AsyncSession, relationship_create: schemas.EventRelationshipCreate) -> models.EventRelationship:
    db_relationship = models.EventRelationship.model_validate(relationship_create)
    try:
        db.add(db_relationship)
        await db.commit()
        await db.refresh(db_relationship)
        return db_relationship
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建事件关系时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建事件关系时发生错误: {e}")

async def update_event_relationship(db: AsyncSession, relationship_id: int, relationship_update: schemas.EventRelationshipUpdate) -> models.EventRelationship:
    db_relationship = await db.get(models.EventRelationship, relationship_id)
    if not db_relationship:
        raise NotFoundError(f"未找到 ID 为 {relationship_id} 的事件关系。")
    db_relationship = update_db_object_from_schema(db_relationship, relationship_update)
    try:
        db.add(db_relationship)
        await db.commit()
        await db.refresh(db_relationship)
        return db_relationship
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新事件关系 ID {relationship_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新事件关系 ID {relationship_id} 时发生错误: {e}")

async def delete_event_relationship(db: AsyncSession, relationship_id: int) -> bool:
    db_relationship = await db.get(models.EventRelationship, relationship_id)
    if not db_relationship:
        raise NotFoundError(f"未找到 ID 为 {relationship_id} 的事件关系。")
    try:
        await db.delete(db_relationship)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除事件关系 ID {relationship_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除事件关系 ID {relationship_id} 时发生错误: {e}")


# --- Conflict ---
async def get_conflict(db: AsyncSession, conflict_id: int) -> Optional[models.Conflict]:
    return await db.get(models.Conflict, conflict_id)

async def get_conflicts_by_novel_and_count(db: AsyncSession, novel_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.Conflict], int]:
    count_statement = select(func.count()).select_from(models.Conflict).where(models.Conflict.novel_id == novel_id)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = select(models.Conflict).where(models.Conflict.novel_id == novel_id).order_by(models.Conflict.id).offset(skip).limit(limit)
    result = await db.execute(statement)
    conflicts = result.scalars().all()
    return conflicts, total_count

async def create_conflict(db: AsyncSession, conflict_create: schemas.ConflictCreate) -> models.Conflict:
    db_conflict = models.Conflict.model_validate(conflict_create)
    try:
        db.add(db_conflict)
        await db.commit()
        await db.refresh(db_conflict)
        return db_conflict
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建冲突时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建冲突时发生错误: {e}")

async def update_conflict(db: AsyncSession, conflict_id: int, conflict_update: schemas.ConflictUpdate) -> models.Conflict:
    db_conflict = await db.get(models.Conflict, conflict_id)
    if not db_conflict:
        raise NotFoundError(f"未找到 ID 为 {conflict_id} 的冲突。")
    db_conflict = update_db_object_from_schema(db_conflict, conflict_update)
    try:
        db.add(db_conflict)
        await db.commit()
        await db.refresh(db_conflict)
        return db_conflict
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新冲突 ID {conflict_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新冲突 ID {conflict_id} 时发生错误: {e}")

async def delete_conflict(db: AsyncSession, conflict_id: int) -> bool:
    db_conflict = await db.get(models.Conflict, conflict_id)
    if not db_conflict:
        raise NotFoundError(f"未找到 ID 为 {conflict_id} 的冲突。")
    try:
        await db.delete(db_conflict)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除冲突 ID {conflict_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除冲突 ID {conflict_id} 时发生错误: {e}")


# --- PlotBranch & PlotVersion ---
async def get_plot_branch(db: AsyncSession, plot_branch_id: int) -> Optional[models.PlotBranch]:
    statement = select(models.PlotBranch).where(models.PlotBranch.id == plot_branch_id).options(selectinload(models.PlotBranch.versions))
    result = await db.execute(statement)
    return result.scalars().first()

async def get_plot_branches_by_novel_and_count(db: AsyncSession, novel_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.PlotBranch], int]:
    count_statement = select(func.count()).select_from(models.PlotBranch).where(models.PlotBranch.novel_id == novel_id)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = select(models.PlotBranch).where(models.PlotBranch.novel_id == novel_id).order_by(models.PlotBranch.id).offset(skip).limit(limit)
    result = await db.execute(statement)
    branches = result.scalars().all()
    return branches, total_count

async def create_plot_branch(db: AsyncSession, plot_branch_create: schemas.PlotBranchCreate) -> models.PlotBranch:
    db_branch = models.PlotBranch.model_validate(plot_branch_create)
    try:
        db.add(db_branch)
        await db.commit()
        await db.refresh(db_branch)
        return db_branch
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建剧情分支时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建剧情分支时发生错误: {e}")

async def update_plot_branch(db: AsyncSession, plot_branch_id: int, plot_branch_update: schemas.PlotBranchUpdate) -> models.PlotBranch:
    db_branch = await db.get(models.PlotBranch, plot_branch_id)
    if not db_branch:
        raise NotFoundError(f"未找到 ID 为 {plot_branch_id} 的剧情分支。")
    db_branch = update_db_object_from_schema(db_branch, plot_branch_update)
    try:
        db.add(db_branch)
        await db.commit()
        await db.refresh(db_branch)
        return db_branch
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新剧情分支 ID {plot_branch_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新剧情分支 ID {plot_branch_id} 时发生错误: {e}")

async def delete_plot_branch(db: AsyncSession, plot_branch_id: int) -> bool:
    db_branch = await db.get(models.PlotBranch, plot_branch_id)
    if not db_branch:
        raise NotFoundError(f"未找到 ID 为 {plot_branch_id} 的剧情分支。")
    try:
        await db.delete(db_branch)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除剧情分支 ID {plot_branch_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除剧情分支 ID {plot_branch_id} 时发生错误: {e}")

async def get_plot_version(db: AsyncSession, plot_version_id: int) -> Optional[models.PlotVersion]:
    return await db.get(models.PlotVersion, plot_version_id)

async def get_plot_versions_by_branch_and_count(db: AsyncSession, plot_branch_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.PlotVersion], int]:
    count_statement = select(func.count()).select_from(models.PlotVersion).where(models.PlotVersion.plot_branch_id == plot_branch_id)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = select(models.PlotVersion).where(models.PlotVersion.plot_branch_id == plot_branch_id).order_by(desc(models.PlotVersion.version_number)).offset(skip).limit(limit)
    result = await db.execute(statement)
    versions = result.scalars().all()
    return versions, total_count

async def create_plot_version(db: AsyncSession, plot_version_create: schemas.PlotVersionCreate) -> models.PlotVersion:
    db_version = models.PlotVersion.model_validate(plot_version_create)
    try:
        db.add(db_version)
        await db.commit()
        await db.refresh(db_version)
        return db_version
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建剧情版本时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建剧情版本时发生错误: {e}")


# --- RuleTemplate ---
async def get_rule_template(db: AsyncSession, rule_template_id: int) -> Optional[models.RuleTemplate]:
    return await db.get(models.RuleTemplate, rule_template_id)

async def get_rule_templates_and_count(db: AsyncSession, category: Optional[str] = None, skip: int = 0, limit: int = 100) -> Tuple[List[models.RuleTemplate], int]:
    statement = select(models.RuleTemplate)
    count_statement = select(func.count()).select_from(models.RuleTemplate)

    if category:
        statement = statement.where(models.RuleTemplate.category == category)
        count_statement = count_statement.where(models.RuleTemplate.category == category)

    total_count = (await db.execute(count_statement)).scalar_one()
    
    statement = statement.order_by(models.RuleTemplate.id).offset(skip).limit(limit)
    result = await db.execute(statement)
    templates = result.scalars().all()
    return templates, total_count

async def create_rule_template(db: AsyncSession, rule_template_create: schemas.RuleTemplateCreate) -> models.RuleTemplate:
    db_template = models.RuleTemplate.model_validate(rule_template_create)
    try:
        db.add(db_template)
        await db.commit()
        await db.refresh(db_template)
        return db_template
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建规则模板时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建规则模板时发生错误: {e}")

async def update_rule_template(db: AsyncSession, rule_template_id: int, rule_template_update: schemas.RuleTemplateUpdate) -> models.RuleTemplate:
    db_template = await db.get(models.RuleTemplate, rule_template_id)
    if not db_template:
        raise NotFoundError(f"未找到 ID 为 {rule_template_id} 的规则模板。")
    db_template = update_db_object_from_schema(db_template, rule_template_update)
    try:
        db.add(db_template)
        await db.commit()
        await db.refresh(db_template)
        return db_template
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新规则模板 ID {rule_template_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新规则模板 ID {rule_template_id} 时发生错误: {e}")

async def delete_rule_template(db: AsyncSession, rule_template_id: int) -> bool:
    db_template = await db.get(models.RuleTemplate, rule_template_id)
    if not db_template:
        raise NotFoundError(f"未找到 ID 为 {rule_template_id} 的规则模板。")
    try:
        await db.delete(db_template)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除规则模板 ID {rule_template_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除规则模板 ID {rule_template_id} 时发生错误: {e}")


# --- RuleChain & RuleStep ---
async def get_rule_chain(db: AsyncSession, rule_chain_id: int) -> Optional[models.RuleChain]:
    statement = select(models.RuleChain).where(models.RuleChain.id == rule_chain_id).options(selectinload(models.RuleChain.steps).selectinload(models.RuleStep.template))
    result = await db.execute(statement)
    return result.scalars().first()

async def get_rule_chains_by_novel_and_count(db: AsyncSession, novel_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.RuleChain], int]:
    count_statement = select(func.count()).select_from(models.RuleChain).where(models.RuleChain.novel_id == novel_id)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = select(models.RuleChain).where(models.RuleChain.novel_id == novel_id).order_by(models.RuleChain.id).offset(skip).limit(limit)
    result = await db.execute(statement)
    chains = result.scalars().all()
    return chains, total_count

async def create_rule_chain(db: AsyncSession, rule_chain_create: schemas.RuleChainCreate) -> models.RuleChain:
    db_chain = models.RuleChain.model_validate(rule_chain_create, exclude={'steps'})
    
    if rule_chain_create.steps:
        for step_create in rule_chain_create.steps:
            db_step = models.RuleStep.model_validate(step_create)
            db_chain.steps.append(db_step)
            
    try:
        db.add(db_chain)
        await db.commit()
        await db.refresh(db_chain)
        return db_chain
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建规则链时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建规则链时发生错误: {e}")

async def update_rule_chain(db: AsyncSession, rule_chain_id: int, rule_chain_update: schemas.RuleChainUpdate) -> models.RuleChain:
    db_chain = await get_rule_chain(db, rule_chain_id)
    if not db_chain:
        raise NotFoundError(f"未找到 ID 为 {rule_chain_id} 的规则链。")

    update_db_object_from_schema(db_chain, rule_chain_update)

    if rule_chain_update.steps is not None:
        existing_steps = {step.id: step for step in db_chain.steps}
        update_steps_data = {step.id: step for step in rule_chain_update.steps if step.id}
        
        new_steps_data = []
        for step_data in rule_chain_update.steps:
            if step_data.id and step_data.id in existing_steps:
                update_db_object_from_schema(existing_steps[step_data.id], step_data)
            elif not step_data.id:
                new_steps_data.append(step_data)

        steps_to_delete_ids = set(existing_steps.keys()) - set(update_steps_data.keys())
        for step_id in steps_to_delete_ids:
            await db.delete(existing_steps[step_id])

        for step_create in new_steps_data:
            new_step = models.RuleStep.model_validate(step_create, update={'rule_chain_id': rule_chain_id})
            db.add(new_step)
            
    try:
        db.add(db_chain)
        await db.commit()
        await db.refresh(db_chain)
        await db.refresh(db_chain, attribute_names=['steps'])
        return db_chain
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新规则链 ID {rule_chain_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新规则链 ID {rule_chain_id} 时发生错误: {e}")

async def delete_rule_chain(db: AsyncSession, rule_chain_id: int) -> bool:
    db_chain = await db.get(models.RuleChain, rule_chain_id)
    if not db_chain:
        raise NotFoundError(f"未找到 ID 为 {rule_chain_id} 的规则链。")
    try:
        await db.delete(db_chain)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除规则链 ID {rule_chain_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除规则链 ID {rule_chain_id} 时发生错误: {e}")


# --- MaterialSnippet ---
async def get_material_snippet(db: AsyncSession, snippet_id: int) -> Optional[models.MaterialSnippet]:
    return await db.get(models.MaterialSnippet, snippet_id)

async def get_material_snippets_by_novel_and_count(db: AsyncSession, novel_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.MaterialSnippet], int]:
    count_statement = select(func.count()).select_from(models.MaterialSnippet).where(models.MaterialSnippet.novel_id == novel_id)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = select(models.MaterialSnippet).where(models.MaterialSnippet.novel_id == novel_id).order_by(desc(models.MaterialSnippet.created_at)).offset(skip).limit(limit)
    result = await db.execute(statement)
    snippets = result.scalars().all()
    return snippets, total_count

async def create_material_snippet(db: AsyncSession, snippet_create: schemas.MaterialSnippetCreate) -> models.MaterialSnippet:
    db_snippet = models.MaterialSnippet.model_validate(snippet_create)
    try:
        db.add(db_snippet)
        await db.commit()
        await db.refresh(db_snippet)
        return db_snippet
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建素材片段时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建素材片段时发生错误: {e}")

async def update_material_snippet(db: AsyncSession, snippet_id: int, snippet_update: schemas.MaterialSnippetUpdate) -> models.MaterialSnippet:
    db_snippet = await db.get(models.MaterialSnippet, snippet_id)
    if not db_snippet:
        raise NotFoundError(f"未找到 ID 为 {snippet_id} 的素材片段。")
    db_snippet = update_db_object_from_schema(db_snippet, snippet_update)
    try:
        db.add(db_snippet)
        await db.commit()
        await db.refresh(db_snippet)
        return db_snippet
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新素材片段 ID {snippet_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新素材片段 ID {snippet_id} 时发生错误: {e}")

async def delete_material_snippet(db: AsyncSession, snippet_id: int) -> bool:
    db_snippet = await db.get(models.MaterialSnippet, snippet_id)
    if not db_snippet:
        raise NotFoundError(f"未找到 ID 为 {snippet_id} 的素材片段。")
    try:
        await db.delete(db_snippet)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除素材片段 ID {snippet_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除素材片段 ID {snippet_id} 时发生错误: {e}")


# --- AnalysisTask, AnalysisResult, AnalysisResultItem ---
async def get_analysis_task(db: AsyncSession, task_id: int) -> Optional[models.AnalysisTask]:
    return await db.get(models.AnalysisTask, task_id)

async def get_analysis_tasks_by_novel_and_count(db: AsyncSession, novel_id: int, skip: int = 0, limit: int = 100) -> Tuple[List[models.AnalysisTask], int]:
    """[已新增] 获取小说的分析任务列表并支持分页。此查询简单，无需 .unique()"""
    count_statement = select(func.count()).select_from(models.AnalysisTask).where(models.AnalysisTask.novel_id == novel_id)
    total_count = (await db.execute(count_statement)).scalar_one()

    statement = select(models.AnalysisTask).where(models.AnalysisTask.novel_id == novel_id).order_by(desc(models.AnalysisTask.created_at)).offset(skip).limit(limit)
    result = await db.execute(statement)
    tasks = result.scalars().all()
    return tasks, total_count
    
async def create_analysis_task(db: AsyncSession, task_create: schemas.AnalysisTaskCreate) -> models.AnalysisTask:
    db_task = models.AnalysisTask.model_validate(task_create)
    try:
        db.add(db_task)
        await db.commit()
        await db.refresh(db_task)
        return db_task
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建分析任务时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建分析任务时发生错误: {e}")

async def update_analysis_task_status(db: AsyncSession, task_id: int, status: str, error_message: Optional[str] = None) -> models.AnalysisTask:
    db_task = await db.get(models.AnalysisTask, task_id)
    if not db_task:
        raise NotFoundError(f"未找到 ID 为 {task_id} 的分析任务。")
    db_task.status = status
    if status == "completed":
        db_task.completed_at = datetime.utcnow()
    elif status == "failed":
        db_task.error_message = error_message
        db_task.completed_at = datetime.utcnow()
    try:
        db.add(db_task)
        await db.commit()
        await db.refresh(db_task)
        return db_task
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新分析任务状态 ID {task_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新分析任务状态 ID {task_id} 时发生错误: {e}")

async def delete_analysis_task(db: AsyncSession, task_id: int) -> bool:
    """[已新增] 删除一个分析任务。"""
    db_task = await db.get(models.AnalysisTask, task_id)
    if not db_task:
        raise NotFoundError(f"未找到 ID 为 {task_id} 的分析任务。")
    try:
        await db.delete(db_task)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除分析任务 ID {task_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除分析任务 ID {task_id} 时发生错误: {e}")

async def get_analysis_result(db: AsyncSession, result_id: int) -> Optional[models.AnalysisResult]:
    statement = select(models.AnalysisResult).where(models.AnalysisResult.id == result_id).options(selectinload(models.AnalysisResult.items))
    result = await db.execute(statement)
    return result.scalars().first()

async def create_analysis_result(db: AsyncSession, result_create: schemas.AnalysisResultCreate) -> models.AnalysisResult:
    db_result = models.AnalysisResult.model_validate(result_create, exclude={'items'})
    if result_create.items:
        for item_create in result_create.items:
            db_item = models.AnalysisResultItem.model_validate(item_create)
            db_result.items.append(db_item)
            
    try:
        db.add(db_result)
        await db.commit()
        await db.refresh(db_result)
        return db_result
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建分析结果时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建分析结果时发生错误: {e}")

async def update_analysis_result(db: AsyncSession, result_id: int, result_update: schemas.AnalysisResultUpdate) -> models.AnalysisResult:
    db_result = await get_analysis_result(db, result_id)
    if not db_result:
        raise NotFoundError(f"未找到 ID 为 {result_id} 的分析结果。")

    update_db_object_from_schema(db_result, result_update)

    if result_update.items is not None:
        existing_items = {item.id: item for item in db_result.items}
        update_items_data = {item.id: item for item in result_update.items if item.id}
        
        new_items_data = []
        for item_data in result_update.items:
            if item_data.id and item_data.id in existing_items:
                update_db_object_from_schema(existing_items[item_data.id], item_data)
            elif not item_data.id:
                new_items_data.append(item_data)

        items_to_delete_ids = set(existing_items.keys()) - set(update_items_data.keys())
        for item_id in items_to_delete_ids:
            await db.delete(existing_items[item_id])

        for item_create in new_items_data:
            new_item = models.AnalysisResultItem.model_validate(item_create, update={'analysis_result_id': result_id})
            db.add(new_item)
            
    try:
        db.add(db_result)
        await db.commit()
        await db.refresh(db_result)
        await db.refresh(db_result, attribute_names=['items'])
        return db_result
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新分析结果 ID {result_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新分析结果 ID {result_id} 时发生错误: {e}")
        
async def delete_analysis_result(db: AsyncSession, result_id: int) -> bool:
    """[已新增] 删除一个分析结果及其所有关联项。"""
    db_result = await db.get(models.AnalysisResult, result_id)
    if not db_result:
        raise NotFoundError(f"未找到 ID 为 {result_id} 的分析结果。")
    try:
        await db.delete(db_result)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除分析结果 ID {result_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除分析结果 ID {result_id} 时发生错误: {e}")

async def get_analysis_result_item(db: AsyncSession, item_id: int) -> Optional[models.AnalysisResultItem]:
    return await db.get(models.AnalysisResultItem, item_id)

async def create_analysis_result_item(db: AsyncSession, item_create: schemas.AnalysisResultItemCreate) -> models.AnalysisResultItem:
    db_item = models.AnalysisResultItem.model_validate(item_create)
    try:
        db.add(db_item)
        await db.commit()
        await db.refresh(db_item)
        return db_item
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"创建分析结果项时发生错误: {e}", exc_info=True)
        raise CRUDError(f"创建分析结果项时发生错误: {e}")

async def update_analysis_result_item(db: AsyncSession, item_id: int, item_update: schemas.AnalysisResultItemUpdate) -> models.AnalysisResultItem:
    db_item = await db.get(models.AnalysisResultItem, item_id)
    if not db_item:
        raise NotFoundError(f"未找到 ID 为 {item_id} 的分析结果项。")
    db_item = update_db_object_from_schema(db_item, item_update)
    try:
        db.add(db_item)
        await db.commit()
        await db.refresh(db_item)
        return db_item
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"更新分析结果项 ID {item_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"更新分析结果项 ID {item_id} 时发生错误: {e}")

async def delete_analysis_result_item(db: AsyncSession, item_id: int) -> bool:
    db_item = await db.get(models.AnalysisResultItem, item_id)
    if not db_item:
        raise NotFoundError(f"未找到 ID 为 {item_id} 的分析结果项。")
    try:
        await db.delete(db_item)
        await db.commit()
        return True
    except SQLAlchemyError as e:
        await db.rollback()
        logger.error(f"删除分析结果项 ID {item_id} 时发生错误: {e}", exc_info=True)
        raise CRUDError(f"删除分析结果项 ID {item_id} 时发生错误: {e}")