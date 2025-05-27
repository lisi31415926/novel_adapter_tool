# backend/app/routers/llm_utils.py
import logging
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Body, Depends, status
from pydantic import BaseModel

from .. import schemas
from ..dependencies import get_llm_orchestrator, get_config_service
from ..llm_orchestrator import LLMOrchestrator, ContentSafetyException
from ..services.config_service import ConfigService
from ..services.tokenizer_service import TokenizerService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/llm-utils",
    tags=["LLM Utilities"]
)

# --- 更优的依赖注入模式 ---
# 注意：这个函数最好放在 dependencies.py 中，这里为清晰起见放在此处。
async def get_tokenizer_service(
    config_service: ConfigService = Depends(get_config_service),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
) -> TokenizerService:
    """
    FastAPI 依赖项，用于创建和提供 TokenizerService 实例。
    """
    config = await config_service.get_config()
    # 假设 schemas.py 中的 ConfigSchema 包含 tokenizer_options
    # 如果没有，需要适配
    tokenizer_options = getattr(config, 'tokenizer_options', {})
    return TokenizerService(tokenizer_options, llm_orchestrator)


@router.get(
    "/capabilities",
    response_model=List[schemas.ModelCapabilitySchema],
    summary="获取所有已配置模型的性能和价格信息"
)
async def get_model_capabilities(
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    返回系统中所有已配置的LLM模型的能力、定价等元数据。
    """
    return await llm_orchestrator.get_all_model_capabilities()

@router.post(
    "/completion",
    response_model=schemas.LLMResponse,
    summary="直接调用LLM生成文本"
)
async def direct_completion(
    request: schemas.LLMRequest,
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    提供一个通用的、直接调用LLM的端点，用于快速测试或执行简单任务。
    """
    try:
        response_text = await llm_orchestrator.generate_completion(
            prompt=request.prompt,
            system_prompt=getattr(request, 'system_prompt', None),
            model_id=request.model_id,
            llm_parameters=request.llm_parameters
        )
        return schemas.LLMResponse(response=response_text)
    except ContentSafetyException as cse:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(cse))
    except Exception as e:
        logger.error(f"直接调用LLM时出错: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"LLM调用失败: {e}"
        )

@router.post(
    "/tokenize",
    response_model=schemas.TokenizeResponse,
    summary="对文本进行分词"
)
async def tokenize_text(
    request: schemas.TokenizeRequest,
    tokenizer_service: TokenizerService = Depends(get_tokenizer_service)
):
    """
    对提供的文本进行分词，并返回Token列表和总数。
    """
    try:
        tokens, model_used = await tokenizer_service.tokenize_text_with_model_fallback(
            text=request.text,
            model_id=request.model_id
        )
        return schemas.TokenizeResponse(
            tokens=tokens,
            count=len(tokens),
            model_used_for_tokenization=model_used
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"文本分词时出错: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"文本分词失败: {e}"
        )