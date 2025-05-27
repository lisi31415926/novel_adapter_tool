import logging
from typing import List, Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Body, BackgroundTasks, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas
from ..database import get_db, AsyncSessionLocal # <-- 新增导入
from ..dependencies import get_llm_orchestrator
from ..llm_orchestrator import LLMOrchestrator
from ..services.rule_application_service import RuleApplicationService, ContentSafetyException
from ..services.config_service import ConfigService # <-- 新增导入

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/rule-chains",
    tags=["Rule Chains Management"]
)

# --- API Specific Request/Response Models ---

class ExecuteRequest(BaseModel):
    novel_id: int
    rule_chain_id: int
    source_text: str
    user_provided_params: Dict[str, Any] = {}

class DryRunRequest(BaseModel):
    novel_id: int
    source_text: str
    user_provided_params: Dict[str, Any] = {}
    rule_chain_id: Optional[int] = None
    rule_chain_definition: Optional[schemas.RuleChainCreate] = None
    
    class Config:
        model_config = {
            "extra": "forbid"
        }

class DryRunResponse(BaseModel):
    output_text: str
    intermediate_steps: List[Dict[str, Any]]


# =============================================================================
# --- 独立的后台任务执行函数 ---
# =============================================================================
async def run_rule_chain_background(
    novel_id: int,
    chain_id: int,
    source_text: str,
    user_provided_params: dict
):
    """
    这是一个完全独立的后台任务函数，它创建自己的依赖项。
    """
    log_prefix = f"[BackgroundTask ChainID:{chain_id}]"
    logger.info(f"{log_prefix} 后台任务已启动。")
    
    db_session: AsyncSession = None
    try:
        # 1. 创建独立的数据库会话
        async with AsyncSessionLocal() as db_session:
            # 2. 创建独立的依赖 (LLMOrchestrator, Service)
            # 注意: 这里假设ConfigService可以无参数实例化
            config_service = ConfigService() 
            llm_orchestrator = LLMOrchestrator(config_service=config_service)
            rule_app_service = RuleApplicationService(db=db_session, llm_orchestrator=llm_orchestrator)
            
            logger.info(f"{log_prefix} 正在执行规则链应用服务...")
            # 3. 执行核心业务逻辑
            await rule_app_service.apply_rule_chain_to_text(
                novel_id=novel_id,
                chain_id=chain_id,
                source_text=source_text,
                user_provided_params=user_provided_params
            )
            logger.info(f"{log_prefix} 规则链应用服务执行完毕。")
            
    except Exception as e:
        # 强烈建议在后台任务中捕获所有异常并进行日志记录
        logger.error(f"{log_prefix} 后台任务执行失败: {e}", exc_info=True)
    finally:
        logger.info(f"{log_prefix} 后台任务已结束。")


# =============================================================================
# --- Rule Chains (规则链) CRUD Endpoints ---
# =============================================================================

@router.post(
    "/",
    response_model=schemas.RuleChainRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建新的规则链"
)
async def create_rule_chain(
    rule_chain: schemas.RuleChainCreate,
    db: AsyncSession = Depends(get_db)
):
    return await crud.create_rule_chain(db=db, rule_chain=rule_chain)

@router.get(
    "/{chain_id}",
    response_model=schemas.RuleChainRead,
    summary="根据ID获取规则链详情"
)
async def read_rule_chain(
    chain_id: int,
    db: AsyncSession = Depends(get_db)
):
    db_chain = await crud.get_rule_chain(db=db, chain_id=chain_id)
    if db_chain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="规则链未找到。")
    return db_chain

# 修改后的代码片段
@router.get(
    "/novel/{novel_id}",
    response_model=schemas.PaginatedResponse[schemas.RuleChainRead],
    summary="获取指定小说的所有规则链（分页）"
)
async def read_rule_chains_for_novel(
    novel_id: int,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100)
):
    skip = (page - 1) * page_size
    items_list, total_count = await crud.get_rule_chains_by_novel_and_count(
        db, novel_id=novel_id, skip=skip, limit=page_size
    )
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
    
    return schemas.PaginatedResponse(
        total_count=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        items=items_list
    )

@router.put(
    "/{chain_id}",
    response_model=schemas.RuleChainRead,
    summary="更新规则链"
)
async def update_rule_chain(
    chain_id: int,
    rule_chain: schemas.RuleChainUpdate,
    db: AsyncSession = Depends(get_db)
):
    db_chain = await crud.get_rule_chain(db, chain_id=chain_id)
    if not db_chain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="规则链未找到。")
    return await crud.update_rule_chain(db=db, chain_id=chain_id, rule_chain_update=rule_chain)

@router.delete(
    "/{chain_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除规则链"
)
async def delete_rule_chain(
    chain_id: int,
    db: AsyncSession = Depends(get_db)
):
    db_chain = await crud.delete_rule_chain(db=db, chain_id=chain_id)
    if db_chain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="规则链未找到。")
    return None

# =============================================================================
# --- Rule Chain Execution Endpoints ---
# =============================================================================

@router.post(
    "/execute",
    status_code=status.HTTP_202_ACCEPTED,
    summary="执行规则链（后台任务）"
)
async def execute_rule_chain(
    request: ExecuteRequest,
    background_tasks: BackgroundTasks
    # 注意：这里不再需要 db 和 llm_orchestrator 依赖
):
    """
    以后台任务的形式执行一个规则链。
    此端点会立即返回，并在后台启动一个独立的、拥有自己数据库会话的任务。
    """
    background_tasks.add_task(
        run_rule_chain_background, # <-- 调用我们新的独立任务函数
        novel_id=request.novel_id,
        chain_id=request.rule_chain_id,
        source_text=request.source_text,
        user_provided_params=request.user_provided_params
    )
    
    return {"message": "规则链执行任务已加入后台处理队列。"}


@router.post(
    "/dry-run",
    response_model=DryRunResponse,
    summary="试运行规则链"
)
async def dry_run_rule_chain(
    request: DryRunRequest = Body(...),
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    试运行一个规则链并立即返回结果，不会保存任何数据。
    可以提供一个已保存的规则链ID，或者在请求体中提供一个临时的规则链定义。
    """
    if not request.rule_chain_id and not request.rule_chain_definition:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="必须提供 'rule_chain_id' 或 'rule_chain_definition'。")
    if request.rule_chain_id and request.rule_chain_definition:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="不能同时提供 'rule_chain_id' 和 'rule_chain_definition'。")

    rule_app_service = RuleApplicationService(db=db, llm_orchestrator=llm_orchestrator)
    
    try:
        dry_run_result = await rule_app_service.dry_run_rule_chain(
            novel_id=request.novel_id,
            chain_id=request.rule_chain_id,
            chain_definition=request.rule_chain_definition,
            source_text=request.source_text,
            user_provided_params=request.user_provided_params
        )
        return dry_run_result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except ContentSafetyException as cse:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(cse))
    except Exception as e:
        logger.error(f"规则链试运行失败: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="规则链试运行时发生未知错误。")