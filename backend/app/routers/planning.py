# backend/app/routers/planning.py
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Body, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas
from ..dependencies import get_db, get_llm_orchestrator
from ..llm_orchestrator import LLMOrchestrator
from ..services.planning_service import PlanningService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/planning",
    tags=["AI Planning Service"]
)

@router.post(
    "/analyze-goal",
    response_model=schemas.AdaptationPlanResponse,
    summary="解析用户改编目标并推荐或生成规则链"
)
async def analyze_user_adaptation_goal(
    request_payload: schemas.AdaptationGoalRequest,
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    根据用户提供的改编目标，AI将尝试解析目标，并根据情况：
    1. 推荐匹配的现有规则链。
    2. 如果没有匹配项，则生成一个新的规则链草稿。
    """
    planner_log = []
    log_prefix = f"[Router-AnalyzeGoal NovelID:{request_payload.novel_id}]"

    try:
        planning_service = PlanningService(db, llm_orchestrator)

        # 1. 解析目标
        planner_log.append("开始解析用户目标...")
        parsed_goal = await planning_service.parse_user_goal(request_payload.goal_description)
        planner_log.append(f"目标解析完成: {parsed_goal.model_dump_json(indent=2)}")

        # 2. 查找匹配的规则链
        planner_log.append("正在查找匹配的现有规则链...")
        matching_chains = await planning_service.find_matching_rule_chains(
            novel_id=request_payload.novel_id,
            parsed_goal=parsed_goal
        )
        
        if matching_chains:
            planner_log.append(f"找到 {len(matching_chains)} 个推荐的规则链。")
            return schemas.AdaptationPlanResponse(
                original_goal=request_payload.goal_description,
                parsed_goal=parsed_goal,
                recommended_chains=matching_chains,
                generated_chain_draft=None,
                planner_log=planner_log
            )

        # 3. 如果没有匹配项，生成新草稿
        planner_log.append("未找到匹配的规则链，开始生成新的规则链草稿...")
        draft_chain_model = await planning_service.draft_new_rule_chain_from_goal(
            novel_id=request_payload.novel_id,
            parsed_goal=parsed_goal,
            user_context=request_payload.user_context
        )
        planner_log.append(f"成功生成规则链草稿: '{draft_chain_model.name}'。")

        return schemas.AdaptationPlanResponse(
            original_goal=request_payload.goal_description,
            parsed_goal=parsed_goal,
            recommended_chains=[],
            generated_chain_draft=draft_chain_model,
            planner_log=planner_log
        )

    except ValueError as ve:
        logger.warning(f"{log_prefix} 处理改编目标时发生值错误: {ve}", exc_info=False)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.critical(f"{log_prefix} 处理改编目标时发生未知错误: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="分析改编目标时发生未知错误。")