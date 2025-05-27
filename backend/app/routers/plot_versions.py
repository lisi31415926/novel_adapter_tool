# backend/app/routers/plot_versions.py
import logging
import asyncio # 移除，因为不再需要 to_thread
import difflib
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Path, Body # 新增 Body
from sqlalchemy.ext.asyncio import AsyncSession # 引入 AsyncSession

from app import crud, schemas, models # models 导入通常不是必须的，除非直接引用
# 修正：从 app.dependencies 导入异步的 get_db
from app.dependencies import get_db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/novels/{novel_id}/plot-branches/{branch_id}/versions", # 保持与大纲一致的路由结构
    tags=["Plot Versions - 剧情版本管理"], # 修正标签名以符合大纲
)

# --- API 端点 ---

@router.post(
    "/",
    response_model=schemas.PlotVersionRead, # 使用 PlotVersionRead 以包含 created_at 等
    status_code=status.HTTP_201_CREATED,
    summary="为指定剧情分支创建新版本"
)
async def create_plot_version_for_branch(
    novel_id: int = Path(..., description="所属小说ID"),
    branch_id: int = Path(..., description="所属剧情分支ID"),
    version_in: schemas.PlotVersionCreate = Body(...), # 使用 Body
    db: AsyncSession = Depends(get_db) # 使用异步 get_db
):
    """
    为指定的剧情分支创建一个新的剧情版本。
    """
    # 校验 novel_id 和 branch_id 是否匹配
    db_branch = await crud.get_plot_branch(db, plot_branch_id=branch_id)
    if not db_branch or db_branch.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID为 {branch_id} 且属于小说ID {novel_id} 的剧情分支未找到。"
        )
    
    # 确保 version_in 中的 plot_branch_id 与路径参数一致 (如果 schema 中有的话)
    if hasattr(version_in, 'plot_branch_id') and version_in.plot_branch_id != branch_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请求体中的 plot_branch_id 与路径参数不匹配。"
        )
    # 如果 schema 中没有 plot_branch_id，则在创建前设置它
    version_create_payload = version_in.model_copy(update={"plot_branch_id": branch_id})

    try:
        # crud.create_plot_version 应该自动处理 version_number
        new_version = await crud.create_plot_version(db=db, plot_version_create=version_create_payload)
        return new_version
    except crud.CRUDError as e: # 假设 crud 层抛出 CRUDError
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e_generic:
        logger.error(f"创建剧情版本时发生未知错误 (分支ID: {branch_id}): {e_generic}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="创建剧情版本时发生内部错误。")


@router.get(
    "/",
    response_model=schemas.PaginatedResponse[schemas.PlotVersionRead], # 修正：使用PlotVersionRead和PaginatedResponse
    summary="获取指定剧情分支的所有版本 (分页)"
)
async def read_plot_versions_for_branch(
    novel_id: int = Path(..., description="所属小说ID"),
    branch_id: int = Path(..., description="所属剧情分支ID"),
    db: AsyncSession = Depends(get_db), # 使用异步 get_db
    page: int = 1,
    page_size: int = 100
):
    """
    获取指定剧情分支下的所有剧情版本，支持分页。
    """
    db_branch = await crud.get_plot_branch(db, plot_branch_id=branch_id)
    if not db_branch or db_branch.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID为 {branch_id} 且属于小说ID {novel_id} 的剧情分支未找到。"
        )
    
    skip = (page - 1) * page_size
    versions, total_count = await crud.get_plot_versions_by_branch_and_count(
        db, plot_branch_id=branch_id, skip=skip, limit=page_size
    )
    
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
    
    return schemas.PaginatedResponse(
        total_count=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=versions
    )


@router.get(
    "/{version_id}",
    response_model=schemas.PlotVersionReadWithDetails, # 修正：使用 PlotVersionReadWithDetails
    summary="获取单个剧情版本的详细信息"
)
async def read_single_plot_version(
    novel_id: int = Path(..., description="所属小说ID"),
    branch_id: int = Path(..., description="所属剧情分支ID"),
    version_id: int = Path(..., description="要检索的剧情版本ID"),
    db: AsyncSession = Depends(get_db) # 使用异步 get_db
):
    """
    获取单个剧情版本的详细信息，包括其包含的章节和事件。
    """
    # crud.get_plot_version 现在是异步的，并且应该能处理关系预加载
    db_version = await crud.get_plot_version_with_details(db, plot_version_id=version_id) # 假设有此函数
    if not db_version or db_version.plot_branch_id != branch_id or db_version.plot_branch.novel_id != novel_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID为 {version_id} 的剧情版本未找到，或不属于指定的小说/分支。"
        )
    return db_version


@router.put(
    "/{version_id}",
    response_model=schemas.PlotVersionRead, # 修正：使用 PlotVersionRead
    summary="更新一个剧情版本"
)
async def update_single_plot_version( # 函数名保持一致性
    novel_id: int = Path(..., description="所属小说ID"),
    branch_id: int = Path(..., description="所属剧情分支ID"),
    version_id: int = Path(..., description="要更新的剧情版本ID"),
    version_in: schemas.PlotVersionUpdate = Body(...), # 使用 Body
    db: AsyncSession = Depends(get_db) # 使用异步 get_db
):
    """
    更新一个已存在的剧情版本的信息。
    """
    # 校验版本是否存在且属于正确的分支和小说
    db_version_check = await crud.get_plot_version(db, plot_version_id=version_id)
    if not db_version_check or db_version_check.plot_branch_id != branch_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"剧情版本ID {version_id} 未找到或不属于分支ID {branch_id}。")
    
    # 进一步校验分支是否属于小说
    db_branch_check = await crud.get_plot_branch(db, plot_branch_id=branch_id)
    if not db_branch_check or db_branch_check.novel_id != novel_id:
         raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"分支ID {branch_id} 不属于小说ID {novel_id}。")

    updated_version = await crud.update_plot_version(db, plot_version_id=version_id, plot_version_update=version_in)
    if not updated_version: # 理论上前面已检查，但crud层可能再次检查
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"更新剧情版本ID {version_id} 失败，可能已被删除。")
    return updated_version


@router.delete(
    "/{version_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一个剧情版本"
)
async def delete_single_plot_version( # 函数名保持一致性
    novel_id: int = Path(..., description="所属小说ID"),
    branch_id: int = Path(..., description="所属剧情分支ID"),
    version_id: int = Path(..., description="要删除的剧情版本ID"),
    db: AsyncSession = Depends(get_db) # 使用异步 get_db
):
    """
    永久删除一个剧情版本。
    """
    # 校验版本是否存在且属于正确的分支和小说 (与 update 中类似)
    db_version_check = await crud.get_plot_version(db, plot_version_id=version_id)
    if not db_version_check or db_version_check.plot_branch_id != branch_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"剧情版本ID {version_id} 未找到或不属于分支ID {branch_id}。")
    db_branch_check = await crud.get_plot_branch(db, plot_branch_id=branch_id)
    if not db_branch_check or db_branch_check.novel_id != novel_id:
         raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"分支ID {branch_id} 不属于小说ID {novel_id}。")

    success = await crud.delete_plot_version(db, plot_version_id=version_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"删除剧情版本ID {version_id} 失败，可能已被删除或不存在。")
    return None # 204 No Content


# 端点 `compare_plot_versions`
# 这个端点比较的是任意两个版本，不一定属于同一个分支或小说，因此可以放在全局路由或 utils 路由下。
# 如果坚持放在当前路由结构下，则 novel_id 和 branch_id 路径参数的意义不大，除非要限定比较的范围。
# 假设我们允许比较任意两个版本，将其移至全局或 utils 路由更合适。
# 如果要保留在当前结构下，并限定在同一小说内，则需要调整。
# 为保持与 `bug2.txt` 中提到的修改范围一致，这里假设它比较的是同一小说、同一分支下的两个版本。
# 但其原始实现 `compare_plot_versions(version1_id: int, version2_id: int, ...)` 没有 novel_id 和 branch_id 约束。
# 我将修改它，使其接受 novel_id, branch_id, version1_id, version2_id
# 并从路径中移除 version_id。

@router.get( # 修改路由，不再使用 /compare ，而是 /compare/{version1_id}/with/{version2_id} 或通过查询参数
    "/compare", # 使用查询参数更灵活
    response_model=schemas.PlotVersionComparison,
    summary="比较指定分支内两个剧情版本的内容差异"
)
async def compare_plot_versions_within_branch(
    novel_id: int = Path(..., description="所属小说ID"),
    branch_id: int = Path(..., description="所属剧情分支ID"),
    version1_id: int = Body(..., embed=True, description="第一个剧情版本的ID"), # 从请求体获取
    version2_id: int = Body(..., embed=True, description="第二个剧情版本的ID"), # 从请求体获取
    db: AsyncSession = Depends(get_db) # 使用异步 get_db
):
    """
    比较指定剧情分支内两个剧情版本内容的差异。
    """
    if version1_id == version2_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能比较同一个版本。")

    # 并发获取两个版本的信息 (现在使用 await)
    v1_task = crud.get_plot_version(db, plot_version_id=version1_id)
    v2_task = crud.get_plot_version(db, plot_version_id=version2_id)
    
    version1_obj, version2_obj = await asyncio.gather(v1_task, v2_task)

    if not version1_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {version1_id} 的剧情版本未找到。")
    if not version2_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {version2_id} 的剧情版本未找到。")
    
    # 校验版本是否属于当前分支和小说
    if version1_obj.plot_branch_id != branch_id or version2_obj.plot_branch_id != branch_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="要比较的版本必须属于同一个剧情分支。")
    
    # 进一步校验分支是否属于该小说（可选，但推荐）
    db_branch_check = await crud.get_plot_branch(db, plot_branch_id=branch_id)
    if not db_branch_check or db_branch_check.novel_id != novel_id:
         raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"分支ID {branch_id} 不属于小说ID {novel_id} 或分支不存在。")


    content1 = version1_obj.content or ""
    content2 = version2_obj.content or ""
    
    # difflib 操作是CPU密集型，可以考虑 to_thread，但对于一般长度的文本差异，直接执行也可能接受
    diff_lines = list(difflib.unified_diff(
        content1.splitlines(keepends=True),
        content2.splitlines(keepends=True),
        fromfile=f"版本 {version1_obj.version_number}: {version1_obj.version_name}", # 使用版本号和名称
        tofile=f"版本 {version2_obj.version_number}: {version2_obj.version_name}",
        n=3 # 上下文行数
    ))

    return schemas.PlotVersionComparison(
        version1_id=version1_obj.id,
        version1_name=version1_obj.version_name,
        version2_id=version2_obj.id,
        version2_name=version2_obj.version_name,
        diff_output=diff_lines
    )


# 新增：根据大纲，PlotVersionListPage.tsx 中有 reorderChaptersInVersion，应在此处有对应API
@router.put(
    "/{version_id}/reorder-chapters",
    response_model=List[schemas.ChapterRead], # 返回重排后的章节列表
    summary="为指定剧情版本内的章节重新排序"
)
async def reorder_chapters_in_plot_version(
    novel_id: int = Path(..., description="所属小说ID"),
    branch_id: int = Path(..., description="所属剧情分支ID"),
    version_id: int = Path(..., description="要重排章节的剧情版本ID"),
    reorder_request: schemas.ChapterReorderRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    更新指定剧情版本内部章节的 `version_order`。
    输入一个包含章节ID的有序列表。
    """
    # 校验版本是否存在且属于正确的分支和小说
    db_version = await crud.get_plot_version(db, plot_version_id=version_id)
    if not db_version or db_version.plot_branch_id != branch_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"剧情版本ID {version_id} 未找到或不属于分支ID {branch_id}。")
    
    db_branch = await crud.get_plot_branch(db, plot_branch_id=branch_id)
    if not db_branch or db_branch.novel_id != novel_id:
         raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"分支ID {branch_id} 不属于小说ID {novel_id}。")

    try:
        # crud.reorder_chapters_in_version 应该在事务中处理所有章节的 version_order 更新
        updated_chapters = await crud.reorder_chapters_in_version(
            db,
            version_id=version_id,
            ordered_chapter_ids=reorder_request.ordered_chapter_ids
        )
        return updated_chapters
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except crud.NotFoundError as nfe: # 假设 CRUDError 有子类 NotFoundError
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except Exception as e:
        logger.error(f"重排版本 {version_id} 章节时发生错误: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="重排章节顺序时发生内部错误。")

# 新增：根据大纲，PlotVersionListPage.tsx 中有 generateAISuggestedPlotVersion，应在此处有对应API
# AISuggestionRequest 定义在 schemas.py
@router.post(
    "/{branch_id_for_suggestion}/ai-suggestion", # 路径参数使用 branch_id_for_suggestion 避免与上面的 branch_id 混淆
    response_model=schemas.PlotVersionRead, # AI建议的结果是一个新的版本
    status_code=status.HTTP_201_CREATED,
    summary="AI为指定剧情分支建议一个新的剧情版本"
)
async def ai_suggest_new_plot_version_for_branch(
    novel_id: int = Path(..., description="所属小说ID"),
    branch_id_for_suggestion: int = Path(..., alias="branch_id", description="为其建议新版本的剧情分支ID"), # alias确保路径参数名仍为branch_id
    ai_request: schemas.AISuggestionRequest = Body(...),
    db: AsyncSession = Depends(get_db),
    # llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator) # planning_service 会用到
):
    """
    使用AI为指定的剧情分支生成一个新的剧情版本建议。
    可以基于一个父版本进行推演。
    """
    # 校验分支是否存在且属于该小说
    db_branch_for_suggestion = await crud.get_plot_branch(db, plot_branch_id=branch_id_for_suggestion)
    if not db_branch_for_suggestion or db_branch_for_suggestion.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"剧情分支ID {branch_id_for_suggestion} 未找到或不属于小说ID {novel_id}。")

    # 校验父版本（如果提供）是否存在且属于该分支
    if ai_request.parent_version_id:
        parent_version = await crud.get_plot_version(db, plot_version_id=ai_request.parent_version_id)
        if not parent_version or parent_version.plot_branch_id != branch_id_for_suggestion:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"提供的父版本ID {ai_request.parent_version_id} 无效或不属于分支ID {branch_id_for_suggestion}。")

    try:
        # 此逻辑应在 planning_service.py 中实现
        from app.services.planning_service import generate_ai_suggested_plot_version as service_generate_ai_version
        # 注意：generate_ai_suggested_plot_version 可能需要 LLMOrchestrator，如果直接调用，确保传递
        # 但更好的做法是 PlanningService 自身管理其依赖
        
        # planning_service 函数是异步的
        new_suggested_version = await service_generate_ai_version(
            db=db,
            plot_branch_id=branch_id_for_suggestion, # 传递分支ID
            # plot_branch=db_branch_for_suggestion, # 传递分支对象
            user_prompt=ai_request.user_prompt,
            parent_version_id=ai_request.parent_version_id,
            # llm_params_override=ai_request.llm_parameters, # 确保 service 函数接受这些
            # requested_model_user_id=ai_request.model_id
        )
        if not new_suggested_version:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="AI未能成功生成剧情版本建议。")
        return new_suggested_version
    except ValueError as ve: # 来自 service 层的校验错误
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"AI建议新剧情版本时出错 (分支ID: {branch_id_for_suggestion}): {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="AI建议新剧情版本时发生内部错误。")