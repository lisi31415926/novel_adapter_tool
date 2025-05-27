# backend/app/routers/chapters.py
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Path, Query, Body # BackgroundTasks 未在此文件使用
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas # crud, schemas 的导入路径正确
from ..database import get_db # 移除了 AsyncSessionLocal 的导入，因为 get_db 提供了会话
from ..dependencies import get_llm_orchestrator # get_llm_orchestrator 导入路径正确
from ..llm_orchestrator import LLMOrchestrator # LLMOrchestrator 导入路径正确
from ..services import rule_application_service # rule_application_service 导入路径正确
# VectorStoreService 和 get_vector_store_service 的导入路径也正确
from ..services.vector_store_service import VectorStoreService, get_vector_store_service


logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/v1/novels/{novel_id}/chapters", # 路由前缀修改，以 novel_id 为上下文
    tags=["Chapters - (小说下)章节管理"], # 标签名修改，更清晰
)

# 注意：根据您提供的 crud.py，并没有 get_chapters_by_novel_id 或 get_chapter_with_analysis
# 而是有 get_chapters_by_novel_and_count 和 get_chapter。
# 我将假设 crud.py 中的函数签名是正确的，并据此调整路由函数。

@router.get(
    "/", # 路径改为相对 novel_id 的根
    response_model=schemas.PaginatedResponse[schemas.ChapterRead], # 使用分页响应模型和ChapterRead
    summary="获取指定小说的所有章节 (分页)"
)
async def read_chapters_for_novel_paginated( # 函数名修改以反映分页
    novel_id: int = Path(..., description="所属小说的ID"),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="页码"), # 添加分页参数
    page_size: int = Query(100, ge=1, le=200, description="每页数量") # 添加分页参数
):
    """
    获取指定ID小说下的所有章节列表，支持分页。
    """
    # 验证小说是否存在
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")

    skip = (page - 1) * page_size
    chapters, total_count = await crud.get_chapters_by_novel_and_count( # 使用 and_count 版本
        db, novel_id=novel_id, skip=skip, limit=page_size
    )
    
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
    
    return schemas.PaginatedResponse(
        total_count=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=chapters # crud 函数返回的应该是 SQLModel 实例，Pydantic 会自动转换
    )


@router.get(
    "/{chapter_id}",
    response_model=schemas.ChapterReadWithDetails, # 假设 ChapterReadWithDetails 包含分析数据
    summary="获取单个章节的详细信息"
)
async def read_chapter_details( # 函数名修改
    novel_id: int = Path(..., description="所属小说的ID"),
    chapter_id: int = Path(..., description="要检索的章节ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    根据ID获取单个章节的详细信息，包括可能的分析数据。
    并验证章节是否属于指定小说。
    """
    # crud.get_chapter 通常不包含复杂的关联加载，除非在 crud 层特别实现
    # 如果需要分析数据，通常是另一个服务或字段
    # 这里假设 crud.get_chapter 返回基础章节信息，或一个特定的 get_chapter_with_details 函数存在
    db_chapter = await crud.get_chapter(db, chapter_id=chapter_id) # 或 crud.get_chapter_with_analysis
    
    if db_chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到。")
    
    if db_chapter.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, # 使用 403 更合适
            detail=f"章节ID {chapter_id} 不属于小说ID {novel_id}。"
        )
    # 注意：ChapterReadWithDetails 的定义需要确保它能正确映射从 crud.get_chapter 返回的数据
    # 如果 crud.get_chapter 返回的是 models.Chapter, 且 ChapterReadWithDetails 基于此，则通常OK
    return db_chapter


@router.post(
    "/", # 路径改为相对 novel_id 的根
    response_model=schemas.ChapterRead, # 返回 ChapterRead
    status_code=status.HTTP_201_CREATED,
    summary="为指定小说创建新章节"
)
async def create_chapter_for_novel_endpoint( # 函数名修改
    novel_id: int = Path(..., description="所属小说的ID"),
    chapter: schemas.ChapterCreate, # chapter_in.novel_id 将由此处的 novel_id 覆盖
    db: AsyncSession = Depends(get_db)
):
    """
    为指定的小说创建一篇新的章节。
    """
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到，无法创建章节。")
    
    # 确保传入的 chapter schema 中的 novel_id 与路径参数一致
    # 或者，如果 ChapterCreate schema 中没有 novel_id，则在此处填充
    if hasattr(chapter, 'novel_id') and chapter.novel_id != novel_id :
         # 如果 ChapterCreate 包含 novel_id 字段，且与路径不符，则报错
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"请求体中的 novel_id 与路径参数 novel_id 不匹配。")
    
    # 如果 ChapterCreate schema 中没有 novel_id, 我们需要构建一个新的 payload
    # 假设 ChapterCreate 总是包含 novel_id (基于 schemas.py)
    # 如果 ChapterCreate 允许 novel_id 为可选，则：
    # chapter_payload_with_novel_id = chapter.model_copy(update={"novel_id": novel_id})

    # 根据 crud.py, crud.create_chapter 接受 schemas.ChapterCreate
    # 而 schemas.ChapterCreate 包含 novel_id 字段
    # 为确保 novel_id 正确，我们覆盖它
    chapter_create_payload = chapter.model_copy(update={"novel_id": novel_id})

    return await crud.create_chapter(db=db, chapter_create=chapter_create_payload) # 使用 chapter_create


@router.put(
    "/{chapter_id}",
    response_model=schemas.ChapterRead, # 返回 ChapterRead
    summary="更新章节信息"
)
async def update_single_chapter( # 函数名修改
    novel_id: int = Path(..., description="所属小说的ID"),
    chapter_id: int = Path(..., description="要更新的章节ID"), # 从路径获取 chapter_id
    chapter_update_data: schemas.ChapterUpdate = Body(...), # 明确 Body
    db: AsyncSession = Depends(get_db)
):
    """
    更新一篇已存在的章节的内容或标题等信息。
    并验证章节是否属于指定小说。
    """
    # 先获取章节，确保它存在且属于该小说
    db_chapter_to_update = await crud.get_chapter(db, chapter_id=chapter_id)
    if not db_chapter_to_update:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到。")
    if db_chapter_to_update.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"章节ID {chapter_id} 不属于小说ID {novel_id}。"
        )

    # crud.update_chapter 接受 chapter_id 和 chapter_update schema
    updated_chapter = await crud.update_chapter(db, chapter_id=chapter_id, chapter_update=chapter_update_data)
    # crud.update_chapter 内部会处理未找到的情况，但这里双重检查
    if updated_chapter is None: # 这理论上不应发生，因为上面已检查
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"更新章节ID {chapter_id} 失败，可能已被删除。")
    return updated_chapter


@router.post(
    "/reorder", # 通常 reorder 是针对整个小说下的章节，或特定版本下的章节
    status_code=status.HTTP_200_OK, # 返回成功消息或更新后的列表
    response_model=List[schemas.ChapterOrderUpdateResponse], # 假设返回更新后的顺序项
    summary="更新指定小说下多个章节的顺序 (chapter_index)"
)
async def update_chapters_mainline_order( # 函数名更具体
    novel_id: int = Path(..., description="所属小说的ID"),
    orders: List[schemas.ChapterOrderUpdate] = Body(...), # orders 包含 id 和新的 chapter_index
    db: AsyncSession = Depends(get_db)
):
    """
    批量更新小说主线下章节的 `chapter_index` 字段。
    此操作在单个事务中完成，确保原子性。
    注意：此接口应处理章节必须属于该 novel_id 的校验。
    """
    if not orders:
        return [] # 或者返回一个带消息的成功响应

    # 验证小说是否存在
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {novel_id} 的小说未找到。")

    updated_chapters_info: List[schemas.ChapterOrderUpdateResponse] = []
    try:
        async with db.begin(): # 使用事务块
            for order_update in orders:
                # 检查章节是否属于该小说
                chap_to_reorder = await crud.get_chapter(db, chapter_id=order_update.id)
                if not chap_to_reorder:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {order_update.id} 的章节未找到。")
                if chap_to_reorder.novel_id != novel_id:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"章节ID {order_update.id} 不属于小说ID {novel_id}。")

                # 更新 chapter_index (假设crud.update_chapter_order仅更新order字段)
                # 实际应用中，crud.update_chapter 可能更通用，但需要确保只更新目标字段
                # 这里假设有一个专门用于更新顺序的 crud 函数，或直接在事务内更新
                # 为了符合 bug2.txt 的要求，我们调用一个假设存在的 crud.update_chapter_order
                # 如果 crud.py 没有这个函数，需要添加或修改现有 update_chapter
                
                # 假设 crud.update_chapter_order 更新 chapter_index 并返回更新后的章节对象
                # updated_chapter = await crud.update_chapter_order(
                #     db, chapter_id=order_update.id, new_chapter_index=order_update.order 
                # )
                # 如果没有特定的 update_chapter_order，则使用通用的 update_chapter：
                chapter_update_payload = schemas.ChapterUpdate(chapter_index=order_update.order)
                updated_chapter = await crud.update_chapter(db, chapter_id=order_update.id, chapter_update=chapter_update_payload)

                if not updated_chapter:
                    # 如果任一章节未找到，事务将自动回滚
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"更新章节ID {order_update.id} 顺序失败。")
                updated_chapters_info.append(schemas.ChapterOrderUpdateResponse(id=updated_chapter.id, chapter_index=updated_chapter.chapter_index))
        
        # await db.commit() # async with db.begin() 会自动处理提交
        return updated_chapters_info
    except HTTPException as http_exc:
        # await db.rollback() # async with db.begin() 会自动处理回滚
        raise http_exc
    except Exception as e:
        # await db.rollback() # async with db.begin() 会自动处理回滚
        logger.error(f"批量更新小说 {novel_id} 章节顺序时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="更新章节顺序时发生内部错误。")


@router.delete(
    "/{chapter_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一个章节"
)
async def delete_single_chapter( # 函数名修改
    novel_id: int = Path(..., description="所属小说的ID"),
    chapter_id: int = Path(..., description="要删除的章节ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    从数据库中永久删除一篇章节。
    并验证章节是否属于指定小说。
    """
    # 先获取章节，确保它存在且属于该小说
    db_chapter_to_delete = await crud.get_chapter(db, chapter_id=chapter_id)
    if not db_chapter_to_delete:
        # 如果 crud.delete_chapter 内部不检查是否存在，则此处需要检查
        # 但通常 delete 操作会返回 True/False 或 None，可以依赖那个
        pass # 允许 crud.delete_chapter 处理 Not Found
    elif db_chapter_to_delete.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"章节ID {chapter_id} 不属于小说ID {novel_id}。"
        )

    success = await crud.delete_chapter(db, chapter_id=chapter_id)
    if not success: # crud.delete_chapter 返回 False 如果未找到
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到或无法删除。")
    return None # 对于 204 No Content，不返回任何 body


# 规则链处理相关端点保持与原文件逻辑一致，因为它们看起来已经是异步的
# 并且依赖的服务（rule_application_service, vector_store_service）也应该是异步的或在异步上下文中正确调用

@router.post(
    "/{chapter_id}/process",
    response_model=schemas.RuleChainExecuteResponse, # 与 rule_application_service 返回的类型匹配
    summary="使用规则链处理章节内容"
)
async def process_chapter_with_rule_chain_endpoint( # 函数名修改
    novel_id: int = Path(..., description="所属小শনেরID"), # 从路径参数获取 novel_id
    chapter_id: int = Path(..., description="要处理的章节ID"),
    chain_id: int = Body(..., embed=True, description="要使用的规则链ID"), # chain_id 从请求体获取
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    获取章节内容，并使用指定的规则链进行处理，返回处理结果。
    """
    chapter = await crud.get_chapter(db, chapter_id=chapter_id)
    if not chapter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到。")
    if chapter.novel_id != novel_id: # 校验章节是否属于该小说
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"章节ID {chapter_id} 不属于小说ID {novel_id}。")
    if not chapter.content or not chapter.content.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"章节ID {chapter_id} 内容为空，无法处理。")

    # rule_application_service.run_chain_on_text 已经是 async
    result = await rule_application_service.apply_rule_chain_to_text( # 确保方法名与service中一致
        db=db,
        llm_orchestrator=llm_orchestrator,
        chain_id=chain_id,
        source_text=chapter.content, # 原文是 source_text
        novel_id=chapter.novel_id # novel_id 也需要传递
    )
    return result


@router.post(
    "/{chapter_id}/enhance",
    response_model=schemas.ChapterRead, # 返回更新后的章节
    summary="使用规则链处理并更新章节内容"
)
async def enhance_chapter_content_with_chain( # 函数名修改
    novel_id: int = Path(..., description="所属小শনেরID"),
    chapter_id: int = Path(..., description="要增强的章节ID"),
    request: schemas.ChapterEnhanceRequest = Body(...), # 使用 ChapterEnhanceRequest schema
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    使用规则链处理章节内容，并将生成的新内容更新回章节。
    """
    async with db.begin(): # 确保读取和更新在同一事务中
        chapter = await crud.get_chapter(db, chapter_id=chapter_id)
        if not chapter:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到。")
        if chapter.novel_id != novel_id: # 校验
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"章节ID {chapter_id} 不属于小说ID {novel_id}。")
        if not chapter.content or not chapter.content.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"章节ID {chapter_id} 内容为空，无法增强。")

        # 运行规则链
        chain_result = await rule_application_service.apply_rule_chain_to_text(
            db=db,
            llm_orchestrator=llm_orchestrator,
            chain_id=request.chain_id,
            source_text=chapter.content,
            novel_id=chapter.novel_id,
            user_provided_params=request.dynamic_params_override or {} # 添加用户参数
        )

        # 检查规则链执行结果
        if not chain_result.final_output_text or (hasattr(chain_result, 'error_message') and chain_result.error_message): # type: ignore
            detail_msg = f"规则链执行失败或未返回有效文本结果: {getattr(chain_result, 'error_message', '未知错误') or '空输出'}"
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail_msg)

        # 更新章节内容
        chapter_update_schema = schemas.ChapterUpdate(content=chain_result.final_output_text)
        updated_chapter = await crud.update_chapter(db, chapter_id=chapter_id, chapter_update=chapter_update_schema)
        if not updated_chapter:
            # 这个理论上不应发生，因为我们前面已经获取了章节
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="更新章节内容时发生未知错误。")
        
        # await db.commit() # async with db.begin() 自动提交
        return updated_chapter
    # async with db.begin() 自动处理回滚


@router.post(
    "/{chapter_id}/vector-search",
    response_model=schemas.SimilaritySearchResponse, # 与 vector_store_service 返回的类型匹配
    summary="在章节的上下文中进行向量相似度搜索"
)
async def search_in_chapter_context_endpoint( # 函数名修改
    novel_id: int = Path(..., description="所属小说的ID"),
    chapter_id: int = Path(..., description="章节ID"),
    search_query_payload: schemas.SimilaritySearchQuery = Body(..., description="搜索查询和参数"), # 使用 Pydantic 模型
    vector_store_service: VectorStoreService = Depends(get_vector_store_service), # VectorStoreService 已是异步
    db: AsyncSession = Depends(get_db)
):
    """
    在一个章节的向量化上下文中执行相似度搜索。
    这需要该章节所属的小说已经被成功向量化。
    """
    chapter = await crud.get_chapter(db, chapter_id=chapter_id)
    if not chapter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chapter_id} 的章节未找到。")
    if chapter.novel_id != novel_id: # 校验
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"章节ID {chapter_id} 不属于小说ID {novel_id}。")

    try:
        # vector_store_service.similarity_search 应该是异步的
        search_results_items = await vector_store_service.search_similar_documents( # 确保方法名和参数与service一致
            novel_id=chapter.novel_id,
            query_text=search_query_payload.query_text,
            top_k=search_query_payload.top_n,
            # filter_metadata={"chapter_id": chapter.id} # 如果需要章节内过滤，确保service支持
            score_threshold=search_query_payload.score_threshold
        )
        return schemas.SimilaritySearchResponse(
            query_text=search_query_payload.query_text,
            results=search_results_items
            # search_time 字段可以由 service 层填充或在此计算（如果需要）
        )
    except ValueError as e: # 例如，小说未向量化
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except Exception as e:
        logger.error(f"在小说 {novel_id} 章节 {chapter_id} 中进行向量搜索时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="向量搜索时发生内部错误。")