# backend/app/routers/rule_templates.py
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas
from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/rule-templates",
    tags=["Rule Templates Management"]
)

@router.post(
    "/",
    response_model=schemas.RuleTemplateRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建新的规则模板"
)
async def create_rule_template(
    template: schemas.RuleTemplateCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    创建一个新的规则模板。
    """
    # 检查是否存在同名模板
    existing_template = await crud.get_rule_template_by_name(db, name=template.name)
    if existing_template:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"名为 '{template.name}' 的规则模板已存在。"
        )
    return await crud.create_rule_template(db=db, template=template)

@router.get(
    "/{template_id}",
    response_model=schemas.RuleTemplateRead,
    summary="根据ID获取规则模板详情"
)
async def read_rule_template(
    template_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    获取单个规则模板的详细信息。
    """
    db_template = await crud.get_rule_template(db=db, template_id=template_id)
    if db_template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="规则模板未找到。")
    return db_template

# 修改后的代码片段
@router.get(
    "/",
    response_model=schemas.PaginatedResponse[schemas.RuleTemplateRead],
    summary="获取所有规则模板（分页）"
)
async def read_rule_templates(
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100)
):
    """获取规则模板列表，可按类别筛选。"""
    skip = (page - 1) * page_size
    items_list, total_count = await crud.get_rule_templates_and_count(
        db, category=category, skip=skip, limit=page_size
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
    "/{template_id}",
    response_model=schemas.RuleTemplateRead,
    summary="更新规则模板"
)
async def update_rule_template(
    template_id: int,
    template: schemas.RuleTemplateUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    更新一个已存在的规则模板。
    """
    db_template = await crud.get_rule_template(db=db, template_id=template_id)
    if db_template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="规则模板未找到。")
    
    # 如果要修改名称，检查新名称是否与另一个模板冲突
    if template.name and template.name != db_template.name:
        existing_template = await crud.get_rule_template_by_name(db, name=template.name)
        if existing_template and existing_template.id != template_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"名为 '{template.name}' 的规则模板已存在。"
            )

    return await crud.update_rule_template(db=db, template_id=template_id, template_update=template)

@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除规则模板"
)
async def delete_rule_template(
    template_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    根据ID删除一个规则模板。
    如果模板正被任何规则链使用，则无法删除。
    """
    db_template = await crud.get_rule_template(db=db, template_id=template_id)
    if not db_template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="规则模板未找到。")

    try:
        await crud.delete_rule_template(db=db, template_id=template_id)
    except ValueError as e:
        # 假设crud层在模板被引用时会抛出ValueError
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e) # 将crud层传来的具体错误信息返回给前端
        )
        
    return None