# backend/app/routers/rule_templates.py
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, Path, Body
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas # schemas 已包含 BaseModel
from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/rule-templates",
    tags=["Rule Templates - 规则模板管理"],
)


@router.post(
    "/",
    response_model=schemas.RuleTemplateWithFields,
    status_code=status.HTTP_201_CREATED,
    summary="创建一个新的规则模板"
)
async def create_rule_template(
    template_in: schemas.RuleTemplateCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    创建一个新的规则模板，可以同时包含其字段定义。
    此操作在单个事务中完成，以确保模板及其所有字段被原子性创建。
    """
    # --- 【修改】添加事务控制 ---
    try:
        async with db.begin():
            created_template = await crud.create_rule_template(db=db, template_in=template_in)
            # crud.create_rule_template 应该返回包含已创建字段的模板对象
            # 在事务内刷新，以确保返回的对象包含所有关联数据
            await db.refresh(created_template, attribute_names=['fields'])
        return created_template
    except Exception as e:
        # 事务会自动回滚
        logger.error(f"创建规则模板时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="创建规则模板时发生内部错误。")


@router.get(
    "/",
    response_model=List[schemas.RuleTemplate],
    summary="获取所有规则模板的列表"
)
async def read_rule_templates(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
):
    """
    检索所有规则模板的列表（不包含详细字段）。
    """
    return await crud.get_rule_templates(db=db, skip=skip, limit=limit)


@router.get(
    "/{template_id}",
    response_model=schemas.RuleTemplateWithFields,
    summary="获取单个规则模板及其所有字段"
)
async def read_rule_template(
    template_id: int = Path(..., description="要检索的规则模板ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    通过ID获取单个规则模板的详细信息，包括其所有字段定义。
    """
    db_template = await crud.get_rule_template(db=db, template_id=template_id)
    if db_template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {template_id} 的规则模板未找到。")
    return db_template


@router.put(
    "/{template_id}",
    response_model=schemas.RuleTemplateWithFields,
    summary="更新一个规则模板"
)
async def update_rule_template(
    template_id: int,
    template_in: schemas.RuleTemplateUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个已存在的规则模板。
    - 可以更新模板的名称、描述、任务类型和提示。
    - 可以通过 `fields` 字段完整替换其所有的字段定义。
    此操作在单个事务中完成，以确保原子性。
    """
    # 您的代码中此处已有事务控制，是正确的
    try:
        async with db.begin():
            updated_template = await crud.update_rule_template(db=db, template_id=template_id, template_in=template_in)
            if updated_template is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {template_id} 的规则模板未找到。")
            await db.refresh(updated_template, attribute_names=['fields'])
        
        return updated_template
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"更新规则模板 {template_id} 时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="更新规则模板时发生内部错误。")


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一个规则模板"
)
async def delete_rule_template(
    template_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    永久删除一个规则模板及其所有关联的字段定义。
    """
    # 假设 crud.delete_rule_template 内部处理了事务或是一个原子操作
    success = await crud.delete_rule_template(db, template_id=template_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {template_id} 的规则模板未找到。")
    return None


@router.post(
    "/{template_id}/create-chain",
    response_model=schemas.RuleChainWithSteps,
    status_code=status.HTTP_201_CREATED,
    summary="从模板创建规则链"
)
async def create_chain_from_template(
    template_id: int,
    request: schemas.CreateChainFromTemplateRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    根据一个规则模板，自动生成一个新的规则链。
    新规则链将包含模板中定义的所有步骤，并使用提供的参数进行填充。
    此操作在单个事务中完成。
    """
    # --- 【修改】添加事务控制 ---
    try:
        async with db.begin():
            new_chain = await crud.create_rule_chain_from_template(
                db=db,
                template_id=template_id,
                chain_name=request.chain_name,
                parameter_values=request.parameter_values
            )
            if new_chain is None: 
                 raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ID为 {template_id} 的规则模板未找到，或无法基于此模板创建规则链。")
            await db.refresh(new_chain, attribute_names=['steps'])
        return new_chain
    except HTTPException as http_exc:
        raise http_exc
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"从模板 {template_id} 创建规则链时出错: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="从模板创建规则链时发生内部错误。")