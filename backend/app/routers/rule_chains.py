# backend/app/routers/rule_chains.py
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Path, Body
from sqlalchemy.ext.asyncio import AsyncSession

# 修正导入路径
from .. import crud, schemas
from ..database import get_db
from ..dependencies import get_llm_orchestrator
from ..llm_orchestrator import LLMOrchestrator
from ..services import rule_application_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/rule-chains",
    tags=["Rule Chains - 规则链管理"],
)


# --- API 端点 ---

@router.post(
    "/",
    response_model=schemas.RuleChainRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建一个新的规则链"
)
async def create_rule_chain_endpoint(
    rule_chain_in: schemas.RuleChainCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    创建一个新的规则链（不包含具体的规则步骤）。
    """
    # crud.create_rule_chain 内部是事务性的
    return await crud.create_rule_chain(db=db, rule_chain_create=rule_chain_in)


@router.get(
    "/",
    response_model=list[schemas.RuleChainRead],
    summary="获取所有规则链"
)
async def read_rule_chains_endpoint(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 100
):
    """
    获取所有已创建的规则链列表。
    """
    return await crud.get_rule_chains(db, skip=skip, limit=limit)


@router.get(
    "/{chain_id}",
    response_model=schemas.RuleChainReadWithSteps, # 返回包含步骤详情的模型
    summary="获取单个规则链及其所有步骤"
)
async def read_rule_chain_with_steps_endpoint(
    chain_id: int = Path(..., gt=0, description="要检索的规则链ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个规则链的详细信息，包括其包含的所有规则步骤，并按顺序排列。
    """
    db_rule_chain = await crud.get_rule_chain_with_steps(db, chain_id=chain_id)
    if db_rule_chain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"规则链ID {chain_id} 未找到。")
    return db_rule_chain


@router.put(
    "/{chain_id}",
    response_model=schemas.RuleChainReadWithSteps,
    summary="更新一个规则链（包括其步骤）"
)
async def update_rule_chain_endpoint(
    chain_id: int = Path(..., gt=0, description="要更新的规则链ID"),
    rule_chain_in: schemas.RuleChainUpdate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个规则链的元数据（如名称、描述）及其包含的规则步骤。
    此操作是事务性的：会先删除所有旧步骤，然后添加所有新步骤。
    """
    async with db.begin():
        db_rule_chain = await crud.get_rule_chain(db, chain_id=chain_id)
        if not db_rule_chain:
            # 事务会自动回滚
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"规则链ID {chain_id} 未找到。")
        
        # crud.update_rule_chain_with_steps 应该处理事务内的更新逻辑
        updated_chain = await crud.update_rule_chain_with_steps(db, chain_id=chain_id, rule_chain_update=rule_chain_in)
    
    logger.info(f"规则链ID {chain_id} 已成功更新。")
    # 在事务提交后，重新获取包含步骤的完整对象以返回
    return await crud.get_rule_chain_with_steps(db, chain_id=chain_id)


@router.delete(
    "/{chain_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一个规则链"
)
async def delete_rule_chain_endpoint(
    chain_id: int = Path(..., gt=0, description="要删除的规则链ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    永久删除一个规则链及其所有关联的规则步骤。
    """
    success = await crud.delete_rule_chain(db, chain_id=chain_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"规则链ID {chain_id} 未找到或无法删除。")
    
    logger.info(f"规则链ID {chain_id} 已被删除。")
    return None


@router.post(
    "/{chain_id}/copy",
    response_model=schemas.RuleChainRead,
    status_code=status.HTTP_201_CREATED,
    summary="复制一个规则链"
)
async def copy_rule_chain_endpoint(
    chain_id: int = Path(..., gt=0, description="要复制的源规则链ID"),
    copy_request: schemas.RuleChainCopyRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    完整复制一个已存在的规则链（包括其所有步骤），并为其指定一个新的名称。
    """
    async with db.begin():
        # crud.copy_rule_chain 处理事务内的复制逻辑
        new_chain = await crud.copy_rule_chain(
            db,
            source_chain_id=chain_id,
            new_name=copy_request.new_name,
            new_description=copy_request.new_description
        )
        if not new_chain:
            # 源规则链未找到，事务回滚
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"源规则链ID {chain_id} 未找到。")
    
    logger.info(f"已成功将规则链ID {chain_id} 复制为新的规则链 '{new_chain.name}' (ID: {new_chain.id})。")
    return new_chain


@router.post(
    "/{chain_id}/apply-to-chapter",
    response_model=schemas.ChapterRead,
    summary="将规则链应用于指定章节并更新内容"
)
async def apply_rule_chain_to_chapter_endpoint(
    chain_id: int = Path(..., gt=0, description="要应用的规则链ID"),
    request: schemas.ApplyRuleChainToChapterRequest = Body(...),
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    对指定的章节内容运行一个规则链，并将生成的结果更新回该章节。
    这是一个原子操作。
    """
    async with db.begin():
        chapter = await crud.get_chapter(db, chapter_id=request.chapter_id)
        if not chapter:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"章节ID {request.chapter_id} 未找到。")

        if not chapter.content or not chapter.content.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="章节内容为空，无法应用规则链。")

        # 调用服务层执行规则链
        try:
            result = await rule_application_service.apply_rule_chain_to_text(
                db=db,
                llm_orchestrator=llm_orchestrator,
                chain_id=chain_id,
                source_text=chapter.content,
                novel_id=chapter.novel_id
            )
        except Exception as e:
             logger.error(f"应用规则链 {chain_id} 到章节 {request.chapter_id} 时出错: {e}", exc_info=True)
             raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"应用规则链时出错: {e}")

        if not result.final_output_text:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="规则链执行完毕，但未生成任何内容。")

        # 更新章节内容
        chapter_update_data = schemas.ChapterUpdate(content=result.final_output_text)
        updated_chapter = await crud.update_chapter(db, chapter_id=request.chapter_id, chapter_update=chapter_update_data)
        if not updated_chapter:
             # 理论上不应发生，因为前面已获取章节
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="更新章节时发生未知错误。")

    logger.info(f"规则链ID {chain_id} 已成功应用于章节ID {request.chapter_id}。")
    return updated_chapter