# backend/app/routers/llm_utils.py
import logging
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from typing import List, Optional, Any, Dict

from app import schemas, crud
from app.dependencies import get_db, get_llm_orchestrator
from app.llm_orchestrator import LLMOrchestrator
# 导入新的统一异常
from app.exceptions import LLMAPIError, LLMProviderNotFoundError

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/llm-utils",
    tags=["LLM Utilities"],
)

@router.get("/available-models", response_model=List[schemas.LLMProviderModelInfo])
async def get_available_models(
    provider_tag: Optional[str] = None,
    db: Session = Depends(get_db),
    orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    获取一个或所有LLM提供商的可用模型列表。
    """
    try:
        available_models = await orchestrator.get_available_models_for_provider(provider_tag)
        return available_models
    except LLMProviderNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"获取可用模型列表时发生未知错误: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取可用模型时发生内部错误: {e}")

@router.post("/test-connection", response_model=schemas.LLMConnectionTestResponse)
async def test_llm_connection(
    request: schemas.LLMConnectionTestRequest,
    db: Session = Depends(get_db),
    orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    测试与指定LLM提供商的连接。
    """
    try:
        is_success, message, details = await orchestrator.test_provider_connection(
            request.user_model_id,
            request.model_api_id_override
        )
        return schemas.LLMConnectionTestResponse(
            success=is_success,
            message=message,
            details=details
        )
    except LLMProviderNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"测试LLM连接时发生未知错误 (模型ID: {request.user_model_id}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"测试连接时发生内部错误: {e}")


@router.post("/execute-step", response_model=schemas.RuleStepExecutionResult)
async def execute_chain_step(
    request: schemas.RuleStepExecutionRequest,
    db: Session = Depends(get_db),
    orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    执行单个规则链步骤（例如，用于测试或独立调用）。
    """
    log_prefix = f"[API-ExecuteStep][StepID:{request.step.id}]"
    logger.info(f"{log_prefix} 收到执行请求。模型ID: {request.model_id}, 任务类型: {request.step.task_type}")

    provider = orchestrator.get_llm_provider(request.model_id)
    # --- 【修复】添加空指针检查 ---
    if not provider:
        logger.error(f"{log_prefix} 未能找到模型ID '{request.model_id}' 对应的LLM提供商。")
        raise HTTPException(
            status_code=404,
            detail=f"未能找到模型ID '{request.model_id}' 对应的LLM提供商或提供商未就绪。"
        )

    # 这里的 prompt_engineer 实例化是临时的，因为它需要一个db会话
    # 在完整的服务中，这可能会被更好地管理
    from app.services.prompt_engineering_service import PromptEngineeringService
    prompt_engineer = PromptEngineeringService(db_session=db, llm_orchestrator=orchestrator)

    try:
        # 构建prompt
        novel_obj_for_prompt = None
        if request.novel_id:
            # 在异步函数中，同步的db调用需要通过 to_thread 运行
            # 但 Depends(get_db) 返回的db session不能跨线程，所以这里我们直接调用
            # 这是一个已知的设计权衡，对于FastAPI的依赖注入和asyncio。
            # 理想情况下，应使用异步DB session。
            novel_obj_for_prompt = crud.get_novel(db, novel_id=request.novel_id, with_details=False)

        prompt_data = await prompt_engineer.build_prompt_for_step(
            rule_step_schema=request.step,
            novel_id=request.novel_id,
            novel_obj=novel_obj_for_prompt,
            dynamic_params=request.dynamic_params,
            main_input_text=request.input_text
        )

        # 调用LLM
        logger.debug(f"{log_prefix} System Prompt: {prompt_data.system_prompt[:100]}...")
        logger.debug(f"{log_prefix} User Prompt: {prompt_data.user_prompt[:200]}...")

        # 使用 orchestrator 的 generate_with_provider 方法，因为它处理了异常
        response = await orchestrator.generate_with_provider(
            provider=provider,
            prompt=prompt_data.user_prompt,
            system_prompt=prompt_data.system_prompt,
            is_json_output=prompt_data.is_json_output_hint,
            llm_override_parameters=request.step.parameters or {},
        )

        # 同样，后续处理也应该使用异步方式
        # 这里只是一个示例，完整的实现可能需要一个后处理服务
        processed_output = response.text # 简化处理

        return schemas.RuleStepExecutionResult(
            step_id=request.step.id,
            success=True,
            raw_output=response.text,
            processed_output=processed_output,
            prompt_sent=prompt_data.user_prompt,
            system_prompt_sent=prompt_data.system_prompt,
            model_id_used=response.model_id_used,
            error_message=None,
            usage=schemas.TokenUsage(
                prompt_tokens=response.prompt_tokens,
                completion_tokens=response.completion_tokens,
                total_tokens=response.total_tokens
            )
        )
    
    # 捕获我们在 provider 中定义的统一异常
    except (LLMAPIError, LLMProviderNotFoundError) as e:
        logger.error(f"{log_prefix} 在执行步骤时捕获到LLM错误: {e}", exc_info=False)
        raise HTTPException(status_code=502, detail=f"LLM Provider Error: {str(e)}")
    
    except Exception as e:
        logger.error(f"{log_prefix} 执行规则链步骤时发生未知错误: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))