# backend/app/routers/rule_templates.py
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Path, Body
from sqlalchemy.ext.asyncio import AsyncSession

# 修正导入路径
from .. import crud, schemas
from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/rule-templates",
    tags=["Rule Templates - 规则模板管理"],
)


# --- API 端点 ---

@router.post(
    "/",
    response_model=schemas.RuleTemplateRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建一个新的规则模板"
)
async def create_rule_template_endpoint(
    template_in: schemas.RuleTemplateCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    创建一个新的规则模板，包括其名称、描述、所有步骤及其参数。
    此操作是事务性的。
    """
    async with db.begin():
        # crud.create_rule_template 负责在事务中处理所有相关的数据库写入
        new_template = await crud.create_rule_template(db, template_create=template_in)
    
    logger.info(f"成功创建规则模板 '{new_template.name}' (ID: {new_template.id})。")
    return await crud.get_rule_template_with_details(db, template_id=new_template.id)


@router.get(
    "/",
    response_model=list[schemas.RuleTemplateRead],
    summary="获取所有规则模板"
)
async def get_rule_templates_endpoint(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 100
):
    """
    获取所有已创建的规则模板列表。
    """
    return await crud.get_rule_templates(db, skip=skip, limit=limit)


@router.get(
    "/{template_id}",
    response_model=schemas.RuleTemplateReadWithDetails,
    summary="获取单个规则模板及其详情"
)
async def get_rule_template_endpoint(
    template_id: int = Path(..., gt=0, description="要检索的规则模板ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个规则模板的详细信息，包括其包含的所有步骤和参数。
    """
    db_template = await crud.get_rule_template_with_details(db, template_id=template_id)
    if db_template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"规则模板ID {template_id} 未找到。")
    return db_template


@router.put(
    "/{template_id}",
    response_model=schemas.RuleTemplateReadWithDetails,
    summary="更新一个规则模板"
)
async def update_rule_template_endpoint(
    template_id: int = Path(..., gt=0, description="要更新的规则模板ID"),
    template_in: schemas.RuleTemplateUpdate = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个规则模板的元数据及其包含的所有步骤和参数。
    此操作是事务性的：会先删除所有旧的步骤和参数，然后添加所有新的。
    """
    async with db.begin():
        # crud.update_rule_template_with_details 负责在事务中处理所有相关的更新逻辑
        updated_template = await crud.update_rule_template_with_details(db, template_id=template_id, template_update=template_in)
        if not updated_template:
            # crud 层在未找到模板时会返回 None
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"规则模板ID {template_id} 未找到。")
    
    logger.info(f"规则模板ID {template_id} 已成功更新。")
    return await crud.get_rule_template_with_details(db, template_id=template_id)


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一个规则模板"
)
async def delete_rule_template_endpoint(
    template_id: int = Path(..., gt=0, description="要删除的规则模板ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    永久删除一个规则模板及其所有关联的步骤和参数。
    """
    success = await crud.delete_rule_template(db, template_id=template_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"规则模板ID {template_id} 未找到或无法删除。")
    
    logger.info(f"规则模板ID {template_id} 已被删除。")
    return None


@router.post(
    "/{template_id}/create-chain",
    response_model=schemas.RuleChainRead,
    status_code=status.HTTP_201_CREATED,
    summary="从模板创建规则链"
)
async def create_chain_from_template_endpoint(
    template_id: int = Path(..., gt=0, description="源规则模板ID"),
    request: schemas.CreateChainFromTemplateRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    使用一个规则模板作为基础，创建一个新的、具体的规则链。
    需要提供新链的名称，并为模板中定义的参数提供具体的值。
    """
    async with db.begin():
        # crud.create_rule_chain_from_template 负责在事务中处理所有相关的创建逻辑
        new_chain = await crud.create_rule_chain_from_template(db, template_id=template_id, request=request)
        if not new_chain:
            # 如果 crud 层在模板未找到时返回 None
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"源规则模板ID {template_id} 未找到。")

    logger.info(f"已成功从模板ID {template_id} 创建新的规则链 '{new_chain.name}' (ID: {new_chain.id})。")
    return new_chain