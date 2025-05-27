# backend/app/routers/rule_chains.py
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, Path, Body
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas, models # 添加 models 导入
from ..database import get_db
from ..dependencies import get_llm_orchestrator # 添加 get_llm_orchestrator 依赖
from ..llm_orchestrator import LLMOrchestrator # 添加 LLMOrchestrator 导入
from ..services import rule_application_service # 添加 rule_application_service 导入


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/rule-chains",
    tags=["Rule Chains - 规则链管理"],
)

@router.post(
    "/",
    response_model=schemas.RuleChainWithSteps,
    status_code=status.HTTP_201_CREATED,
    summary="创建一个新的规则链"
)
async def create_rule_chain(
    rule_chain_in: schemas.RuleChainCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    创建一个新的规则链，可以同时包含其初始的规则步骤。
    """
    # 假设 crud.create_rule_chain 内部处理了事务或是一个原子操作
    # 因为它需要创建链本身和其所有步骤
    return await crud.create_rule_chain(db=db, chain_in=rule_chain_in)

@router.get(
    "/",
    response_model=List[schemas.RuleChain],
    summary="获取所有规则链的列表"
)
async def read_rule_chains(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
):
    """
    检索所有规则链的列表（不包含详细步骤）。
    """
    return await crud.get_rule_chains(db=db, skip=skip, limit=limit)

@router.get(
    "/{chain_id}",
    response_model=schemas.RuleChainWithSteps,
    summary="获取单个规则链及其所有步骤"
)
async def read_rule_chain(
    chain_id: int = Path(..., description="要检索的规则链ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    通过ID获取单个规则链的详细信息，包括其包含的所有规则步骤，并按顺序排列。
    """
    db_rule_chain = await crud.get_rule_chain(db=db, chain_id=chain_id)
    if db_rule_chain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chain_id} 的规则链未找到。")
    return db_rule_chain

@router.put(
    "/{chain_id}",
    response_model=schemas.RuleChainWithSteps,
    summary="更新一个规则链"
)
async def update_rule_chain(
    chain_id: int,
    rule_chain_in: schemas.RuleChainUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个已存在的规则链。
    - 可以更新规则链的名称和描述。
    - 可以通过 `steps` 字段完整替换其所有的规则步骤。
    此操作在单个事务中完成，以确保原子性。
    """
    # 您的代码中此处已有事务控制，是正确的
    try:
        async with db.begin():
            updated_chain = await crud.update_rule_chain(db=db, chain_id=chain_id, chain_in=rule_chain_in)
            if updated_chain is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chain_id} 的规则链未找到。")
            
            await db.refresh(updated_chain, attribute_names=['steps'])
        
        return updated_chain
        
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"更新规则链 {chain_id} 时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="更新规则链时发生内部错误。")


@router.delete(
    "/{chain_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一个规则链"
)
async def delete_rule_chain(
    chain_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    永久删除一个规则链及其所有关联的规则步骤。
    """
    success = await crud.delete_rule_chain(db, chain_id=chain_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chain_id} 的规则链未找到。")
    return None

@router.post(
    "/{chain_id}/copy",
    response_model=schemas.RuleChainWithSteps,
    status_code=status.HTTP_201_CREATED,
    summary="复制一个现有的规则链"
)
async def copy_rule_chain(
    chain_id: int,
    new_name: str = Body(..., embed=True, description="新规则链的名称"),
    db: AsyncSession = Depends(get_db)
):
    """
    创建一个现有规则链的完整副本，包括其所有步骤。
    此操作在单个事务中完成，以确保原子性。
    """
    # --- 【修改】添加事务控制 ---
    try:
        async with db.begin():
            copied_chain = await crud.copy_rule_chain(db=db, source_chain_id=chain_id, new_name=new_name)
            if copied_chain is None: # crud.copy_rule_chain 在源链不存在时可能返回None
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {chain_id} 的源规则链未找到，无法复制。")
            
            await db.refresh(copied_chain, attribute_names=['steps'])
        
        return copied_chain
    except HTTPException as http_exc:
        # 重新抛出由 crud.copy_rule_chain 内部或此函数直接抛出的HTTPException
        raise http_exc
    except Exception as e:
        logger.error(f"复制规则链 {chain_id} 时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="复制规则链时发生内部错误。")

@router.post(
    "/{chain_id}/test",
    response_model=schemas.RuleChainExecutionResult,
    summary="测试执行规则链（试运行）"
)
async def test_rule_chain(
    chain_id: int,
    request: schemas.RuleChainTestRequest,
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    对指定的规则链进行试运行。
    使用提供的输入文本和动态参数（如果适用）来执行链中的每个步骤，并返回最终结果和中间步骤的输出。
    此操作不会修改任何数据库状态。
    """
    try:
        result = await rule_application_service.run_chain_on_text(
            db=db,
            llm_orchestrator=llm_orchestrator,
            chain_id=chain_id,
            input_text=request.input_text,
            novel_id=request.novel_id, # 可选，用于上下文
            dynamic_params_override=request.dynamic_params_override
        )
        return result
    except ValueError as ve: # 例如规则链不存在或参数错误
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"测试规则链 {chain_id} 时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"测试规则链时发生内部错误: {str(e)}")


@router.post(
    "/{chain_id}/apply-to-chapter",
    response_model=schemas.Chapter, # 返回更新后的章节对象
    summary="将规则链应用于章节并更新其内容"
)
async def apply_rule_chain_to_chapter(
    chain_id: int,
    request: schemas.ApplyChainToChapterRequest,
    db: AsyncSession = Depends(get_db),
    llm_orchestrator: LLMOrchestrator = Depends(get_llm_orchestrator)
):
    """
    获取指定章节的当前内容，使用规则链处理，然后将处理后的内容更新回该章节。
    此操作涉及数据库写入（更新章节内容），因此包含在事务中。
    """
    # --- 【修改】添加事务控制 ---
    try:
        async with db.begin():
            updated_chapter = await rule_application_service.apply_chain_to_chapter_and_update(
                db=db,
                llm_orchestrator=llm_orchestrator,
                chain_id=chain_id,
                chapter_id=request.chapter_id,
                novel_id=request.novel_id, # 可选，用于上下文
                dynamic_params_override=request.dynamic_params_override
            )
            if updated_chapter is None: # 如果服务层在找不到章节等情况下返回 None
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {request.chapter_id} 的章节未找到或规则链 {chain_id} 应用失败。")
        
        return updated_chapter
    except HTTPException as http_exc:
        # 重新抛出由服务层或此函数直接抛出的HTTPException
        raise http_exc
    except ValueError as ve: # 例如规则链不存在或参数错误
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"将规则链 {chain_id} 应用于章节 {request.chapter_id} 时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="应用规则链到章节时发生内部错误。")