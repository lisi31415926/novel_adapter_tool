import asyncio
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Body
from sse_starlette import EventSourceResponse

from app import crud, schemas
from app.dependencies import DBSession
from app.exceptions import LLMAPIError, ContentSafetyException
from app.llm_orchestrator import LLMOrchestrator
from app.services.rule_application_service import RuleApplicationService
from app.services.vector_store_service import VectorStoreService

router = APIRouter()
orchestrator = LLMOrchestrator()


@router.get("/llm-providers", response_model=List[schemas.LLMProviderInfo])
async def get_llm_providers_info():
    """
    获取所有可用的大语言模型（LLM）提供商及其模型列表。
    """
    providers_info = orchestrator.get_all_providers_info()
    return providers_info


@router.post("/test-llm-connection", response_model=schemas.LLMConnectionTestResponse)
async def test_llm_connection(
        request: schemas.LLMConnectionTestRequest
):
    """
    测试与指定LLM提供商的连接。
    """
    response = await orchestrator.test_provider_connection(request.model_id)
    return response


@router.post("/generate", response_model=schemas.LLMResponse)
async def generate_text(
        request: schemas.LLMRequest
):
    """
    使用指定的LLM模型生成文本。
    """
    provider = orchestrator.get_llm_provider(request.model_id)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider for model '{request.model_id}' not found.")

    response = await orchestrator.generate_with_provider(provider, request.params)
    return response


@router.post("/generate-stream")
async def generate_text_stream(
        request: schemas.LLMRequest
):
    """
    使用指定的LLM模型以流式方式生成文本。
    """
    provider = orchestrator.get_llm_provider(request.model_id)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider for model '{request.model_id}' not found.")

    async def event_generator():
        try:
            async for chunk in provider.invoke_stream(request.params):
                yield {"event": "message", "data": chunk.content}
        except (LLMAPIError, ContentSafetyException) as e:
            yield {"event": "error", "data": str(e)}
        except Exception as e:
            # Catch any other unexpected errors
            yield {"event": "error", "data": f"An unexpected error occurred: {str(e)}"}
        finally:
            yield {"event": "end", "data": ""}

    return EventSourceResponse(event_generator())


@router.post("/get-materials-for-step", response_model=List[schemas.MaterialSnippet])
async def get_materials_for_step(
        request: schemas.MaterialSearchRequest,
        db: DBSession  # <- 修正点
):
    """
    为规则链的特定步骤检索相关的素材片段。
    """
    novel = await crud.get_novel(db, novel_id=request.novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="Novel not found")

    vector_store_service = VectorStoreService.get_instance()
    if not vector_store_service:
        raise HTTPException(status_code=503, detail="Vector store service is not available.")

    try:
        results = await vector_store_service.search_materials(
            novel_id=request.novel_id,
            query=request.query,
            k=request.k
        )
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to search materials: {str(e)}")


@router.post("/execute-chain-step", response_model=schemas.RuleChainExecutionResult)
async def execute_chain_step(
        request: schemas.RuleChainExecutionRequest,
        db: DBSession,  # <- 修正点
):
    """
    执行规则链中的单个步骤。
    """
    provider = orchestrator.get_llm_provider(request.model_id)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider for model '{request.model_id}' not found or configured.")

    novel = await crud.get_novel(db, request.novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail=f"Novel with id {request.novel_id} not found.")

    service = RuleApplicationService(
        db_session=db,
        llm_provider=provider,
        novel=novel
    )

    try:
        result = await service.apply_step(
            step_id=request.step_id,
            global_context=request.global_context,
            step_context=request.step_context,
            dry_run=request.dry_run
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute-chain-step-stream")
async def execute_chain_step_stream(
        request: schemas.RuleChainExecutionRequest,
        db: DBSession,  # <- 修正点
):
    """
    以流式方式执行规则链的单个步骤。
    """
    provider = orchestrator.get_llm_provider(request.model_id)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider for model '{request.model_id}' not found or configured.")

    novel = await crud.get_novel(db, request.novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail=f"Novel with id {request.novel_id} not found.")

    service = RuleApplicationService(
        db_session=db,
        llm_provider=provider,
        novel=novel
    )

    async def event_generator():
        try:
            # 流式执行的核心逻辑在RuleApplicationService中实现
            async for chunk in service.apply_step_stream(
                    step_id=request.step_id,
                    global_context=request.global_context,
                    step_context=request.step_context,
                    dry_run=request.dry_run
            ):
                yield {"event": "message", "data": chunk.model_dump_json()}

        except (LLMAPIError, ContentSafetyException) as e:
            yield {"event": "error", "data": str(e)}
        except Exception as e:
            yield {"event": "error", "data": f"An unexpected error occurred: {str(e)}"}
        finally:
            yield {"event": "end", "data": ""}

    return EventSourceResponse(event_generator())