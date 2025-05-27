# backend/app/routers/chapters.py
import logging
from typing import List, Optional, TypeVar, Generic
from fastapi import (
    APIRouter, Depends, HTTPException, status, 
    Query, Body, Path, BackgroundTasks
)
from pydantic import BaseModel
import math

# 导入异步会话类型
from sqlalchemy.ext.asyncio import AsyncSession

# 导入 CRUD 操作、schemas、依赖项和服务
from .. import crud, schemas, models
from ..database import get_db, AsyncSessionLocal # 导入 AsyncSessionLocal
from ..dependencies import get_llm_orchestrator
from ..llm_orchestrator import LLMOrchestrator
from ..services import background_analysis_service

logger = logging.getLogger(__name__)

# 为保持模块化，我们将 router 分为两个：一个用于小说下的章节，一个用于独立的章节操作
# 这与您原始文件的结构意图一致
router = APIRouter()


# --- 通用分页响应模型 ---
# (这个模型在您的原始文件中存在，予以保留)
DataType = TypeVar('DataType')
class PaginatedResponse(BaseModel, Generic[DataType]):
    total_count: int
    page: int
    page_size: int
    total_pages: int
    items: List[DataType]


# ==============================================================================
# --- Chapters (章节) API Endpoints ---
# ==============================================================================

@router.post(
    "/novels/{novel_id}/chapters",
    response_model=schemas.Chapter, # 响应模型使用 schema 以便控制返回字段
    status_code=status.HTTP_201_CREATED,
    summary="为指定小说创建新章节",
    tags=["Chapters - 章节管理"]
)
async def create_chapter_for_novel(
    novel_id: int,
    chapter: schemas.ChapterCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    为 ID 为 `novel_id` 的小说创建一个新的章节。
    """
    # 在创建之前，先确认小说是否存在
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    
    # 确保将 novel_id 关联到创建的数据上
    if chapter.novel_id is None:
        chapter.novel_id = novel_id
    elif chapter.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请求体中的 novel_id 与路径参数中的 novel_id 不匹配。")
        
    db_chapter = await crud.create_chapter(db=db, chapter_create=chapter)
    return db_chapter


@router.get("/", response_model=schemas.PaginatedResponse[schemas.ChapterRead], summary="获取指定小说的所有章节（分页）")
async def read_chapters(
    novel_id: int,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量")
):
    skip = (page - 1) * page_size
    items_list, total_count = await crud.get_chapters_by_novel_and_count(
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
    "/chapters/{chapter_id}",
    response_model=schemas.Chapter,
    summary="获取单个章节的详细信息",
    tags=["Chapters - 章节管理"]
)
async def read_chapter(
    chapter_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    通过章节自身的 ID 获取其详细信息。
    """
    db_chapter = await crud.get_chapter(db, chapter_id=chapter_id)
    if db_chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到。")
    return db_chapter


@router.put(
    "/chapters/{chapter_id}",
    response_model=schemas.Chapter,
    summary="更新单个章节",
    tags=["Chapters - 章节管理"]
)
async def update_chapter(
    chapter_id: int,
    chapter: schemas.ChapterUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新 ID 为 `chapter_id` 的章节的内容或元数据。
    """
    updated_chapter = await crud.update_chapter(db, chapter_id=chapter_id, chapter_update=chapter)
    if updated_chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到。")
    return updated_chapter


@router.delete(
    "/chapters/{chapter_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除单个章节",
    tags=["Chapters - 章节管理"]
)
async def delete_chapter(
    chapter_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    从数据库中永久删除一个章节。
    """
    success = await crud.delete_chapter(db, chapter_id=chapter_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到。")
    # 204 No Content, so no response body
    return


# 你的原始文件中没有章节排序的CRUD函数，但保留了API端点，这是一个很好的示例
# 我将假设 crud 中存在一个 update_chapters_order 函数，并将其异步化
# 如果不存在，你需要按照 `crud.py` 的风格添加它。
async def update_chapters_order(db: AsyncSession, *, novel_id: int, ordered_ids: List[int]) -> bool:
    """
    (这是一个假设的异步crud函数，用于更新章节顺序)
    """
    try:
        chapters = await crud.get_chapters_by_novel(db, novel_id=novel_id)
        chapter_map = {chap.id: chap for chap in chapters}
        
        if set(chapter_map.keys()) != set(ordered_ids):
             logger.error("提供的章节ID列表与数据库中的不匹配。")
             return False

        for i, chapter_id in enumerate(ordered_ids):
            if chapter_id in chapter_map:
                chapter_map[chapter_id].order = i
        
        await db.commit()
        return True
    except Exception:
        await db.rollback()
        return False


@router.post(
    "/novels/{novel_id}/chapters/reorder",
    response_model=schemas.MessageResponse,
    summary="更新指定小说下所有章节的顺序",
    tags=["Chapters - 章节管理"]
)
async def reorder_chapters(
    novel_id: int,
    reorder_request: schemas.ReorderRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    根据提供的章节ID列表，重新排序小说下的所有章节。
    """
    # 检查小说是否存在
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")

    success = await update_chapters_order(
        db, 
        novel_id=novel_id, 
        ordered_ids=reorder_request.ordered_ids,
    )
    if not success:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="更新章节顺序时发生错误。")
    return schemas.MessageResponse(message="章节顺序更新成功。")


@router.post(
    "/chapters/{chapter_id}/trigger-analysis",
    response_model=schemas.MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="触发对单个章节的分析",
    tags=["Chapters - 章节管理"]
)
async def trigger_chapter_analysis_endpoint(
    chapter_id: int = Path(..., description="要分析的章节ID"),
    background_tasks: BackgroundTasks = Depends(),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator),
    db: AsyncSession = Depends(get_db)
):
    """
    为指定章节启动一个后台分析任务。
    此任务将使用LLM分析章节的情感、提取事件和角色表现等。
    """
    db_chapter = await crud.get_chapter(db, chapter_id)
    if not db_chapter:
        raise HTTPException(status_code=404, detail=f"ID为 {chapter_id} 的章节未找到。")

    try:
        # 假设 background_analysis_service.run_chapter_analysis 也是异步的
        # 创建一个包装函数以便在后台运行
        def chapter_analysis_task():
            import asyncio
            async def async_task():
                async with AsyncSessionLocal() as task_db:
                    await background_analysis_service.run_chapter_analysis(
                        db=task_db,
                        chapter_id=chapter_id,
                        llm_orchestrator=llm_orchestrator
                    )
            asyncio.run(async_task())

        background_tasks.add_task(chapter_analysis_task)
        logger.info(f"已为章节 ID {chapter_id} 添加后台分析任务。")
        return schemas.MessageResponse(message="章节分析任务已成功添加到后台执行队列。")
    except Exception as e:
        logger.error(f"为章节 {chapter_id} 添加分析任务时失败: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="添加章节分析任务失败。")

