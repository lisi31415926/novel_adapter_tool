# backend/app/routers/planning.py
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Path, Body
from sqlalchemy.ext.asyncio import AsyncSession

# 修正导入路径
from .. import crud, schemas
from ..database import get_db
from ..services import planning_service
from ..services.planning_service import PlanningError # 导入自定义服务层异常

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/planning",
    tags=["Planning - AI 剧情规划"],
)


# --- API 端点 ---

@router.post(
    "/generate-outline",
    response_model=schemas.PlotOutline, # 响应模型为剧情大纲
    summary="为一个主题生成剧情大纲"
)
async def generate_plot_outline_endpoint(
    request: schemas.PlotOutlineRequest = Body(...),
    db: AsyncSession = Depends(get_db),
    # planning_service 依赖项可以被注入，或者直接调用模块函数
    # 这里我们直接调用模块函数，因为它需要 db 和 novel_id 等上下文
):
    """
    接收一个主题或点子，使用AI生成一个结构化的剧情大纲。
    """
    # 验证请求中关联的小说是否存在
    novel_id = request.novel_id
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID为 {novel_id} 的小说未找到。"
        )
    
    try:
        # 调用异步的 planning_service 函数
        outline = await planning_service.generate_plot_outline(
            db=db,
            request=request
        )
        return outline
    except PlanningError as e:
        logger.error(f"生成剧情大纲时发生错误 (小说ID: {novel_id}): {e}", exc_info=True)
        # 将服务层的特定错误转换为HTTP错误
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"生成剧情大纲失败: {e}"
        )
    except Exception as e:
        logger.exception(f"生成剧情大纲时发生未知错误 (小说ID: {novel_id})")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="生成剧情大纲时发生未知内部错误。"
        )

@router.post(
    "/generate-branch-from-outline",
    response_model=schemas.PlotBranchRead, # 成功后返回新创建的剧情分支
    status_code=status.HTTP_201_CREATED,
    summary="从剧情大纲生成一个新的剧情分支"
)
async def generate_plot_branch_from_outline_endpoint(
    request: schemas.GenerateBranchFromOutlineRequest = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """
    接收一个剧情大纲，使用AI为其生成详细的剧情内容，
    并创建一个新的剧情分支和初始版本来存储这些内容。
    """
    # 验证小说是否存在
    novel_id = request.novel_id
    db_novel = await crud.get_novel(db, novel_id=novel_id)
    if not db_novel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID为 {novel_id} 的小说未找到。"
        )
        
    try:
        # 调用异步的 planning_service 函数
        # 这个服务函数内部应该处理创建 PlotBranch 和 PlotVersion 的事务
        new_branch = await planning_service.generate_branch_from_outline(
            db=db,
            request=request
        )
        logger.info(f"成功从大纲为小说ID {novel_id} 创建了新的剧情分支ID {new_branch.id}。")
        return new_branch
    except PlanningError as e:
        logger.error(f"从大纲生成剧情分支时发生错误 (小说ID: {novel_id}): {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"从大纲生成剧情分支失败: {e}"
        )
    except Exception as e:
        logger.exception(f"从大纲生成剧情分支时发生未知错误 (小说ID: {novel_id})")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="从大纲生成剧情分支时发生未知内部错误。"
        )