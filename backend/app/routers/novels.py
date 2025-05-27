# backend/app/routers/novels.py
import logging
from typing import Optional

from fastapi import (
    APIRouter, Depends, HTTPException, status, File, UploadFile, Form, BackgroundTasks, Path, Query, Body
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

# 修正导入路径
from .. import crud, schemas
from ..database import get_db
from ..services import text_processing_utils
from ..services import background_analysis_service
from ..services.vector_store_service import VectorStoreService, get_vector_store_service # 引入向量存储服务

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/novels",
    tags=["Novels - 小说管理"],
)


# --- 基本 CRUD 端点 ---

@router.post(
    "/",
    response_model=schemas.NovelRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建新小说（通过上传文件）"
)
async def create_novel_and_process_file_endpoint(
    title: str = Form(...),
    author: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """
    上传一个 .txt 文件来创建一本新的小说。
    服务端会读取文件内容，按章节切分，并将小说和章节信息存入数据库。
    这个过程在一个数据库事务中完成，确保原子性。
    """
    if not file.filename or not file.filename.endswith('.txt'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无效的文件类型。请上传 .txt 文件。"
        )
    try:
        content_bytes = await file.read()
        content = content_bytes.decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="文件编码错误。请确保文件为 UTF-8 编码。"
        )
    
    chapters_data = text_processing_utils.split_text_into_chapters(content)
    if not chapters_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未能从文件中解析出任何章节。请检查文件格式。"
        )

    novel_create_schema = schemas.NovelCreate(title=title, author=author, description=description)
    
    try:
        async with db.begin():
            db_novel = await crud.create_novel(db=db, novel_create=novel_create_schema)
            chapters_to_create = [
                schemas.ChapterCreate(
                    title=chap['title'],
                    content=chap['content'],
                    novel_id=db_novel.id,
                    chapter_index=i
                ) for i, chap in enumerate(chapters_data)
            ]
            await crud.bulk_create_chapters(db=db, chapters_create=chapters_to_create)
        
        logger.info(f"成功创建小说 '{title}' (ID: {db_novel.id}) 及 {len(chapters_to_create)} 个章节。")
        return db_novel
    except IntegrityError as e:
        logger.warning(f"创建小说 '{title}' 失败，可能标题已存在: {e}")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"创建小说失败，可能标题 '{title}' 已存在。"
        )
    except Exception as e:
        logger.error(f"创建小说 '{title}' 过程中发生未知错误: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="创建小说过程中发生内部错误。"
        )

@router.get(
    "/",
    response_model=schemas.PaginatedResponse[schemas.NovelRead],
    summary="获取所有小说（分页）"
)
async def read_novels_paginated(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量")
):
    skip = (page - 1) * page_size
    novels, total_count = await crud.get_novels_and_count(db, skip=skip, limit=page_size)
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
    return schemas.PaginatedResponse(total_count=total_count, page=page, page_size=page_size, total_pages=total_pages, items=novels)

@router.get(
    "/{novel_id}",
    response_model=schemas.NovelReadWithDetails,
    summary="获取单个小说的详细信息"
)
async def read_novel_details(
    novel_id: int = Path(..., gt=0, description="要检索的小说ID"),
    db: AsyncSession = Depends(get_db)
):
    db_novel = await crud.get_novel_with_details(db, novel_id=novel_id)
    if db_novel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"小说ID {novel_id} 未找到。")
    return db_novel

@router.put(
    "/{novel_id}",
    response_model=schemas.NovelRead,
    summary="更新小说信息"
)
async def update_novel_endpoint(
    novel_id: int = Path(..., gt=0, description="要更新的小说ID"),
    novel_in: schemas.NovelUpdate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    db_novel = await crud.update_novel(db, novel_id=novel_id, novel_update=novel_in)
    if db_novel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"小说ID {novel_id} 未找到，无法更新。")
    return db_novel

@router.delete(
    "/{novel_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一本小说"
)
async def delete_novel_endpoint(
    novel_id: int = Path(..., gt=0, description="要删除的小说ID"),
    db: AsyncSession = Depends(get_db)
):
    success = await crud.delete_novel(db, novel_id=novel_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"小说ID {novel_id} 未找到，无法删除。")
    logger.info(f"小说ID {novel_id} 已被删除。")
    return None

# --- 高级功能性端点 ---

@router.post(
    "/{novel_id}/reanalyze",
    response_model=schemas.JobSubmissionResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="触发对小说的后台重新分析"
)
async def reanalyze_novel_endpoint(
    novel_id: int = Path(..., gt=0, description="要重新分析的小说ID"),
    background_tasks: BackgroundTasks = Depends(),
    db: AsyncSession = Depends(get_db)
):
    """
    触发一个后台任务，对指定小说进行全面的重新分析。
    """
    if not await crud.get_novel(db, novel_id=novel_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"小说ID {novel_id} 未找到。")
    
    background_tasks.add_task(background_analysis_service.start_full_analysis, novel_id=novel_id)
    
    message = f"已提交对小说ID {novel_id} 的重新分析任务。"
    logger.info(message)
    return schemas.JobSubmissionResponse(message=message, job_id=str(novel_id))

@router.post(
    "/{novel_id}/vectorize",
    response_model=schemas.JobSubmissionResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="为小说内容创建或更新向量索引"
)
async def vectorize_novel_endpoint(
    novel_id: int = Path(..., gt=0, description="要向量化的小说ID"),
    background_tasks: BackgroundTasks = Depends(),
    db: AsyncSession = Depends(get_db),
    vector_store_service: VectorStoreService = Depends(get_vector_store_service)
):
    """
    为指定小说触发后台向量化任务。
    服务会提取所有章节内容，进行切分，然后存入向量数据库。
    """
    if not await crud.get_novel(db, novel_id=novel_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"小说ID {novel_id} 未找到。")

    # 检查向量存储服务是否就绪
    if not vector_store_service.is_ready():
         raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="向量存储服务未配置或未就绪，无法执行向量化。"
        )

    # 将耗时的向量化操作放入后台任务
    background_tasks.add_task(vector_store_service.create_or_update_novel_vector_index, novel_id=novel_id)
    
    message = f"已提交对小说ID {novel_id} 的向量化任务。"
    logger.info(message)
    return schemas.JobSubmissionResponse(message=message, job_id=f"vectorize_{novel_id}")

@router.get(
    "/{novel_id}/analysis-status",
    response_model=schemas.NovelAnalysisStatus,
    summary="获取小说的分析状态"
)
async def get_novel_analysis_status_endpoint(
    novel_id: int = Path(..., gt=0, description="要查询的小说ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取指定小说的各类分析任务（如向量化）的当前状态。
    """
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"小说ID {novel_id} 未找到。")
    
    # 在实际应用中，这些状态信息可能存储在 novel 表的字段中，或一个专门的状态跟踪表中
    # 这里我们使用 NovelRead 模型中已有的字段
    return schemas.NovelAnalysisStatus(
        id=db_novel.id,
        title=db_novel.title,
        vectorization_status=db_novel.vectorization_status,
        last_analyzed_at=db_novel.last_analyzed_at
    )

@router.get(
    "/{novel_id}/character-relationship-graph",
    response_model=schemas.GraphData,
    summary="获取角色关系图数据"
)
async def get_character_relationship_graph_data(
    novel_id: int = Path(..., gt=0, description="小说ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取用于可视化展示的角色关系网络图数据。
    """
    # 验证小说是否存在
    if not await crud.get_novel(db, novel_id=novel_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"小说ID {novel_id} 未找到。")

    graph_data = await crud.get_character_relationship_graph(db, novel_id=novel_id)
    if not graph_data or not graph_data['nodes']:
        logger.info(f"小说ID {novel_id} 没有可供显示的角色关系图数据。")
        # 即使没有数据，也返回一个空的图结构，而不是404
    
    return schemas.GraphData(**graph_data)


@router.get(
    "/{novel_id}/event-relationship-graph",
    response_model=schemas.GraphData,
    summary="获取事件关系图数据"
)
async def get_event_relationship_graph_data(
    novel_id: int = Path(..., gt=0, description="小说ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取用于可视化展示的事件关系网络图数据。
    """
    # 验证小说是否存在
    if not await crud.get_novel(db, novel_id=novel_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"小说ID {novel_id} 未找到。")

    graph_data = await crud.get_event_relationship_graph(db, novel_id=novel_id)
    if not graph_data or not graph_data['nodes']:
        logger.info(f"小说ID {novel_id} 没有可供显示的事件关系图数据。")
        # 返回空图结构
    
    return schemas.GraphData(**graph_data)