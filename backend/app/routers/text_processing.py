# backend/app/routers/text_processing.py
import logging
import json
from typing import List

from fastapi import APIRouter, HTTPException, Body, Depends, status
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas, crud
from ..dependencies import get_db, get_llm_orchestrator, get_local_nlp_service, get_vector_store_service
from ..llm_orchestrator import LLMOrchestrator, ContentSafetyException
from ..services.prompt_engineering_service import PromptEngineeringService
from ..services.local_nlp_service import LocalNLPService
from ..services.vector_store_service import BaseVectorStoreService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/text-processing",
    tags=["Text Processing Utilities"]
)

@router.post(
    "/process",
    response_class=StreamingResponse,
    summary="通用文本处理 (通过LLM, 流式)",
    description="根据用户提供的指令，使用LLM对文本进行处理，并以SSE流的形式返回结果。"
)
async def process_text_stream(
    request: schemas.TextProcessRequest,
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    prompt_service = PromptEngineeringService(db=db, llm_orchestrator=llm_orchestrator)
    try:
        # 假设 enhance_text_with_llm_stream 是一个异步生成器
        stream_generator = prompt_service.enhance_text_with_llm_stream(
            prompt_data=request.prompt_data,
            use_sse=True  # 明确使用SSE格式
        )
        return EventSourceResponse(stream_generator)
    except ContentSafetyException as cse:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(cse))
    except Exception as e:
        logger.error(f"处理文本流时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="处理文本时发生未知错误。")

@router.post(
    "/analyze",
    response_model=schemas.TextAnalysisResponse,
    summary="本地文本分析"
)
async def analyze_text(
    request: schemas.TextAnalysisRequest,
    local_nlp_service: LocalNLPService = Depends(get_local_nlp_service)
):
    """
    使用本地NLP模型对文本进行分析，提取词频、情感等基本指标。
    """
    # 直接异步调用服务
    analysis_result = await local_nlp_service.analyze_text(request.text)
    return schemas.TextAnalysisResponse(**analysis_result)

@router.post(
    "/summarize",
    response_class=StreamingResponse,
    summary="文本摘要 (流式)"
)
async def summarize_text(
    request: schemas.SummarizeRequest,
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    使用LLM对长文本进行摘要，以SSE流的形式返回结果。
    """
    prompt_service = PromptEngineeringService(db=db, llm_orchestrator=llm_orchestrator)
    try:
        stream_generator = prompt_service.summarize_text_stream(
            text=request.text,
            novel_id=request.novel_id,
            chapter_id=request.chapter_id,
            use_sse=True
        )
        return EventSourceResponse(stream_generator)
    except Exception as e:
        logger.error(f"生成摘要流时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="生成摘要时发生未知错误。")

@router.post(
    "/find-similar",
    response_model=List[schemas.SimilaritySearchResult],
    summary="查找相似文本片段"
)
async def find_similar_documents(
    request: schemas.SimilaritySearchRequest,
    db: AsyncSession = Depends(get_db),
    vector_store_service: BaseVectorStoreService = Depends(get_vector_store_service)
):
    """
    在向量数据库中根据给定的文本查询最相似的文本片段。
    """
    try:
        similar_docs = await vector_store_service.find_similar_documents(
            query_text=request.query_text,
            novel_id=request.novel_id,
            top_k=request.top_k
        )
        return similar_docs
    except Exception as e:
        logger.error(f"查找相似文档时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="查找相似文档时发生未知错误。")


@router.post(
    "/suggest-segments",
    response_model=schemas.ChapterSegmentSuggestionsResponse,
    summary="获取章节片段化建议"
)
async def get_chapter_segment_suggestions(
    request_data: schemas.ChapterSegmentRequest,
    local_nlp_service: LocalNLPService = Depends(get_local_nlp_service),
):
    """
    对章节内容进行分析，并返回推荐的片段（如场景、段落）列表。
    """
    if not request_data.content:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="必须提供章节内容 (content)。")
    try:
        segments = await local_nlp_service.segment_text_to_suggestions(
            text=request_data.content,
            segment_type=request_data.segment_type or "sentence",
            min_length=request_data.min_segment_length or 5
        )
        return schemas.ChapterSegmentSuggestionsResponse(
            chapter_id=request_data.chapter_id,
            suggestions=segments
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(ve))
    except Exception as e:
        logger.error(f"生成章节片段建议时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="生成章节片段建议时发生未知错误。")