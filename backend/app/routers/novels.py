# backend/app/routers/novels.py
import logging
from typing import List, Optional, Any
from fastapi import (
    APIRouter, Depends, HTTPException, status, Query,
    UploadFile, File, Form, BackgroundTasks, Path
)
from pydantic import BaseModel

# 导入异步会话类型
from sqlalchemy.ext.asyncio import AsyncSession

# 导入 CRUD 操作、schemas 和异步 get_db 依赖
from .. import crud, schemas, models
from ..database import get_db, AsyncSessionLocal # 导入 AsyncSessionLocal
from ..dependencies import get_llm_orchestrator
from ..services import background_analysis_service, novel_parser_service
from ..services.vector_store_service import VectorStoreService, get_vector_store_service # 统一使用 VectorStoreService
from ..llm_orchestrator import LLMOrchestrator

logger = logging.getLogger(__name__)
# 定义路由，并设置固定的前缀和标签
router = APIRouter(
    prefix="/api/v1/novels",
    tags=["Novels - 小说管理"],
)


# --- 响应模型 ---
class PaginatedNovels(BaseModel):
    total: int
    novels: List[schemas.Novel]


# --- 后台任务辅助函数 ---
# 注意：理想情况下，后台任务也应是异步的。
# 这里的同步实现是为了最小化改动，但它会在一个单独的线程/进程中运行，
# 需要自己创建数据库会话。由于我们的 SessionLocal 已改为异步，
# 这里需要一种方式来同步地运行异步代码，或者创建一个同步的 SessionLocal。
# 为了简化，我们暂时保留同步创建会话的逻辑，但这在实际生产中需要谨慎处理。
def run_full_analysis_in_background(novel_id: int, llm_orchestrator_instance: LLMOrchestrator):
    """
    在后台运行完整的分析流程。
    警告：此函数在一个同步的上下文中运行，但需要与异步数据库交互。
    这是一个复杂点，理想的解决方案是使用如 `anyio` 或 `asyncio.run`
    来执行异步的后台服务，或者使用像 Celery/ARQ 这样的专用任务队列。
    """
    import asyncio

    async def analysis_task():
        async with AsyncSessionLocal() as db:
            try:
                logger.info(f"后台任务开始：为小说 {novel_id} 运行完整分析。")
                await background_analysis_service.run_full_analysis(
                    db=db,
                    novel_id=novel_id,
                    llm_orchestrator=llm_orchestrator_instance
                )
                logger.info(f"后台任务成功完成：小说 {novel_id} 的完整分析。")
            except Exception as e:
                logger.error(f"后台任务失败：小说 {novel_id} 的分析过程中发生错误。错误: {e}", exc_info=True)
                # 可以在此处更新数据库，标记任务失败
                try:
                    novel_to_update = await crud.get_novel(db, novel_id)
                    if novel_to_update:
                        novel_to_update.analysis_status = schemas.AnalysisStatus.FAILED
                        novel_to_update.analysis_errors = str(e)
                        await crud.update_novel(db, novel_id=novel_id, novel_update=novel_to_update)
                except Exception as db_update_error:
                     logger.error(f"更新小说 {novel_id} 失败状态时再次发生错误: {db_update_error}", exc_info=True)

    # 在同步函数中运行异步任务
    asyncio.run(analysis_task())


# --- API 端点 ---
@router.post(
    "/upload",
    response_model=schemas.Novel,
    status_code=status.HTTP_202_ACCEPTED,
    summary="上传小说文件并创建小说条目"
)
async def create_novel_and_process_file(
    title: str = Form(..., description="小说的标题"),
    author: str = Form(..., description="小说的作者"),
    description: Optional[str] = Form(None, description="小说的简要描述"),
    file: UploadFile = File(..., description="包含小说内容的文本文件"),
    background_tasks: BackgroundTasks = Depends(),
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    上传一个文本文件来创建一本新的小说。
    - **创建小说记录**: 在数据库中创建一个新的小说条目。
    - **处理文件内容**: 读取文件内容并将其存储。
    - **触发后台分析**: 将完整的小说分析任务添加到后台执行。
    """
    try:
        novel_create_schema = schemas.NovelCreate(
            title=title,
            author=author,
            description=description,
            # 初始状态
            analysis_status=schemas.AnalysisStatus.PENDING,
            vectorization_status=schemas.VectorizationStatus.PENDING
        )
        # 创建小说条目
        db_novel = await crud.create_novel(db, novel_create=novel_create_schema)

        # 读取并处理文件内容
        file_content = (await file.read()).decode('utf-8')
        chapters_to_create = novel_parser_service.parse_novel_text(file_content)

        # 为章节设置 novel_id
        for chap in chapters_to_create:
            chap.novel_id = db_novel.id

        # 批量创建章节
        if chapters_to_create:
            await crud.bulk_create_chapters(db, chapters=chapters_to_create)

        # 将分析任务添加到后台
        background_tasks.add_task(run_full_analysis_in_background, db_novel.id, llm_orchestrator)
        logger.info(f"已为小说 '{db_novel.title}' (ID: {db_novel.id}) 添加后台分析任务。")

        return db_novel
    except Exception as e:
        logger.error(f"上传和处理小说文件时出错: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"处理小说文件失败: {str(e)}"
        )


@router.get("/", response_model=schemas.PaginatedResponse[schemas.Novel], summary="获取小说分页列表")
async def read_novels(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量")
):
    skip = (page - 1) * page_size
    items_list, total_count = await crud.get_novels_and_count(db, skip=skip, limit=page_size)
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
    return schemas.PaginatedResponse(total_count=total_count, page=page, page_size=page_size, total_pages=total_pages, items=items_list)


@router.get(
    "/{novel_id}",
    response_model=schemas.Novel,
    summary="获取单本小说的详细信息"
)
async def read_novel(
    novel_id: int = Path(..., description="要检索的小说的ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    通过ID获取单本小说的详细信息，包括其关联的章节。
    """
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if db_novel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    return db_novel


@router.put(
    "/{novel_id}",
    response_model=schemas.Novel,
    summary="更新一本小说的信息"
)
async def update_novel(
    novel_id: int,
    novel: schemas.NovelUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新数据库中已存在的小说的信息。
    """
    updated_novel = await crud.update_novel(db, novel_id=novel_id, novel_update=novel)
    if updated_novel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    return updated_novel


@router.delete(
    "/{novel_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一本小说"
)
async def delete_novel(
    novel_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    从数据库中永久删除一本小说及其所有关联数据。
    """
    success = await crud.delete_novel(db, novel_id=novel_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    return None # 对于 204 No Content，不返回任何 body


@router.get(
    "/{novel_id}/analysis-status",
    response_model=schemas.NovelAnalysisStatusInfo,
    summary="获取小说的分析状态"
)
async def get_novel_analysis_status(
    novel_id: int = Path(..., description="要查询状态的小说的ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    查询并返回指定小说的当前分析和向量化状态。
    """
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if db_novel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")
    
    return schemas.NovelAnalysisStatusInfo(
        novel_id=db_novel.id,
        analysis_status=db_novel.analysis_status,
        vectorization_status=db_novel.vectorization_status,
        analysis_errors=db_novel.analysis_errors,
        vectorization_errors=db_novel.vectorization_errors,
        qdrant_collection_name=db_novel.qdrant_collection_name,
        last_updated=db_novel.updated_at.isoformat() if db_novel.updated_at else None,
    )


@router.post(
    "/{novel_id}/vectorize",
    status_code=status.HTTP_202_ACCEPTED,
    summary="触发指定小শনের后台向量化任务"
)
async def trigger_novel_vectorization(
    novel_id: int = Path(..., description="要进行向量化的小说的ID"),
    background_tasks: BackgroundTasks = Depends(),
    vector_store_service: VectorStoreService = Depends(get_vector_store_service),
    db: AsyncSession = Depends(get_db)
):
    """
    将指定小说的内容向量化任务添加到后台执行。
    """
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if db_novel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")

    # 注意：后台任务的数据库会话处理逻辑同上
    def vectorize_task():
        import asyncio
        async def async_vectorize_task():
            async with AsyncSessionLocal() as task_db:
                await background_analysis_service.run_vectorization(
                    db=task_db,
                    novel_id=novel_id,
                    vector_store_service=vector_store_service
                )
        asyncio.run(async_vectorize_task())

    background_tasks.add_task(vectorize_task)
    logger.info(f"已为小说 ID {novel_id} 添加后台向量化任务。")
    
    return {"message": "小说向量化任务已成功添加到后台执行队列。"}

