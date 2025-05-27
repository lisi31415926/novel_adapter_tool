# backend/app/routers/chapters.py
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Path, Query, BackgroundTasks, Body
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas
from ..database import get_db, AsyncSessionLocal
from ..dependencies import get_llm_orchestrator
from ..llm_orchestrator import LLMOrchestrator
from ..services import background_analysis_service, rule_application_service
from ..services.vector_store_service import VectorStoreService, get_vector_store_service


logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/v1/chapters",
    tags=["Chapters - 章节管理"],
)


@router.get(
    "/novel/{novel_id}",
    response_model=List[schemas.Chapter],
    summary="获取指定小说的所有章节"
)
async def read_chapters_for_novel(
    novel_id: int = Path(..., description="所属小说的ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取指定ID小说下的所有章节列表。
    """
    chapters = await crud.get_chapters_by_novel_id(db, novel_id=novel_id)
    if not chapters:
        logger.info(f"小说 ID {novel_id} 没有找到任何章节。")
    return chapters


@router.get(
    "/{chapter_id}",
    response_model=schemas.Chapter,
    summary="获取单个章节的详细信息"
)
async def read_chapter(
    chapter_id: int = Path(..., description="要检索的章节ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    根据ID获取单个章节的详细信息，包括分析数据。
    """
    db_chapter = await crud.get_chapter_with_analysis(db, chapter_id=chapter_id)
    if db_chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到。")
    return db_chapter


@router.post(
    "/",
    response_model=schemas.Chapter,
    status_code=status.HTTP_201_CREATED,
    summary="创建新章节"
)
async def create_chapter(
    chapter: schemas.ChapterCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    为指定的小说创建一篇新的章节。
    """
    db_novel = await crud.get_novel(db, novel_id=chapter.novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter.novel_id} 的小说未找到，无法创建章节。")
    
    return await crud.create_chapter(db=db, chapter=chapter)


@router.put(
    "/{chapter_id}",
    response_model=schemas.Chapter,
    summary="更新章节信息"
)
async def update_chapter(
    chapter_id: int,
    chapter: schemas.ChapterUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新一篇已存在的章节的内容或标题等信息。
    """
    db_chapter = await crud.update_chapter(db, chapter_id=chapter_id, chapter_update=chapter)
    if db_chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到。")
    return db_chapter


@router.post(
    "/reorder",
    status_code=status.HTTP_200_OK,
    summary="更新多个章节的顺序"
)
async def update_chapters_order(
    orders: List[schemas.ChapterOrderUpdate],
    db: AsyncSession = Depends(get_db)
):
    """
    批量更新章节的 `order` 字段。
    此操作在单个事务中完成，确保原子性。
    """
    if not orders:
        return {"message": "No chapter orders to update."}

    try:
        # --- 【修改】添加事务控制 ---
        async with db.begin():
            for order_update in orders:
                # 在循环中，我们逐个更新。crud.update_chapter_order 应被设计为仅更新 order 字段。
                # 如果 crud 函数不存在，可以直接更新模型字段。
                # 假设 crud.update_chapter_order 存在且是异步的
                updated_chapter = await crud.update_chapter_order(
                    db, chapter_id=order_update.id, order=order_update.order
                )
                if not updated_chapter:
                    # 如果任一章节未找到，事务将自动回滚
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"ID为 {order_update.id} 的章节未找到。"
                    )
        # --- 事务结束，成功则提交，失败则回滚 ---
        
        return {"message": "章节顺序已成功更新。"}
    except HTTPException as http_exc:
        # 重新抛出 HTTP 异常，以便 FastAPI 处理
        raise http_exc
    except Exception as e:
        logger.error(f"批量更新章节顺序时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="更新章节顺序时发生内部错误。")


@router.delete(
    "/{chapter_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一个章节"
)
async def delete_chapter(
    chapter_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    从数据库中永久删除一篇章节。
    """
    success = await crud.delete_chapter(db, chapter_id=chapter_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到。")
    return None


@router.post(
    "/{chapter_id}/process",
    response_model=schemas.RuleChainExecutionResult,
    summary="使用规则链处理章节内容"
)
async def process_chapter_with_rule_chain(
    chapter_id: int,
    chain_id: int = Body(..., embed=True, description="要使用的规则链ID"),
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    获取章节内容，并使用指定的规则链进行处理，返回处理结果。
    """
    chapter = await crud.get_chapter(db, chapter_id)
    if not chapter or not chapter.content:
        raise HTTPException(status_code=404, detail=f"ID为 {chapter_id} 的章节未找到或内容为空。")

    result = await rule_application_service.run_chain_on_text(
        db=db,
        llm_orchestrator=llm_orchestrator,
        chain_id=chain_id,
        input_text=chapter.content,
        novel_id=chapter.novel_id
    )
    return result


@router.post(
    "/{chapter_id}/enhance",
    response_model=schemas.Chapter,
    summary="使用规则链处理并更新章节内容"
)
async def enhance_chapter_content(
    chapter_id: int,
    request: schemas.ChapterEnhanceRequest,
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    使用规则链处理章节内容，并将生成的新内容更新回章节。
    """
    chapter = await crud.get_chapter(db, chapter_id)
    if not chapter or not chapter.content:
        raise HTTPException(status_code=404, detail=f"ID为 {chapter_id} 的章节未找到或内容为空。")

    result = await rule_application_service.run_chain_on_text(
        db=db,
        llm_orchestrator=llm_orchestrator,
        chain_id=request.chain_id,
        input_text=chapter.content,
        novel_id=chapter.novel_id
    )

    if not result.success or not isinstance(result.final_output, str):
        raise HTTPException(status_code=400, detail=f"规则链执行失败或未返回文本结果: {result.error_message}")

    # 更新章节内容
    chapter_update_schema = schemas.ChapterUpdate(content=result.final_output)
    updated_chapter = await crud.update_chapter(db, chapter_id=chapter_id, chapter_update=chapter_update_schema)
    if not updated_chapter:
        # 这个理论上不应发生，因为我们前面已经获取了章节
        raise HTTPException(status_code=500, detail="更新章节内容时发生未知错误。")

    return updated_chapter


@router.post(
    "/{chapter_id}/vector-search",
    response_model=List[schemas.SimilaritySearchResult],
    summary="在章节的上下文中进行向量相似度搜索"
)
async def search_in_chapter_context(
    chapter_id: int,
    search_query: str = Body(..., embed=True, description="要搜索的文本查询"),
    limit: int = Body(5, embed=True, ge=1, le=100, description="返回结果的最大数量"),
    vector_store_service: VectorStoreService = Depends(get_vector_store_service),
    db: AsyncSession = Depends(get_db)
):
    """
    在一个章节的向量化上下文中执行相似度搜索。
    这需要该章节所属的小说已经被成功向量化。
    """
    chapter = await crud.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail=f"ID为 {chapter_id} 的章节未找到。")

    try:
        search_results = await vector_store_service.similarity_search(
            novel_id=chapter.novel_id,
            query=search_query,
            k=limit,
            filter_metadata={"chapter_id": chapter.id} # 仅在该章节的块中搜索
        )
        return search_results
    except ValueError as e:
        # 通常由 novel_id 未向量化或集合不存在引起
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.error(f"在章节 {chapter_id} 中进行向量搜索时出错: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="向量搜索时发生内部错误。")