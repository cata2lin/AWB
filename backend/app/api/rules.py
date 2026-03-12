"""
Rules API endpoints.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.database import get_db
from app.models import Rule
from app.schemas import RuleResponse, RuleCreate, RuleUpdate, RulePriorityUpdate

router = APIRouter()


@router.get("", response_model=List[RuleResponse])
async def get_rules(db: AsyncSession = Depends(get_db)):
    """Get all rules ordered by priority."""
    result = await db.execute(select(Rule).order_by(Rule.priority))
    rules = result.scalars().all()
    return rules


@router.get("/{rule_id}", response_model=RuleResponse)
async def get_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """Get a specific rule."""
    result = await db.execute(select(Rule).where(Rule.id == rule_id))
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    return rule


@router.post("", response_model=RuleResponse)
async def create_rule(rule: RuleCreate, db: AsyncSession = Depends(get_db)):
    """Create a new rule."""
    # Get next priority (append to end)
    result = await db.execute(
        select(Rule.priority).order_by(Rule.priority.desc()).limit(1)
    )
    max_priority = result.scalar() or -1
    
    db_rule = Rule(
        name=rule.name,
        priority=max_priority + 1,
        is_active=rule.is_active,
        conditions=rule.conditions,
        group_config=rule.group_config
    )
    db.add(db_rule)
    await db.flush()
    await db.refresh(db_rule)
    
    return db_rule


@router.patch("/{rule_id}", response_model=RuleResponse)
async def update_rule(
    rule_id: int,
    rule_update: RuleUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update a rule."""
    result = await db.execute(select(Rule).where(Rule.id == rule_id))
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    update_data = rule_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(rule, field, value)
    
    await db.flush()
    await db.refresh(rule)
    
    return rule


@router.delete("/{rule_id}")
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a rule."""
    result = await db.execute(select(Rule).where(Rule.id == rule_id))
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    await db.delete(rule)
    
    return {"message": "Rule deleted"}


@router.post("/reorder")
async def reorder_rules(
    priority_update: RulePriorityUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Reorder rules by updating their priorities."""
    for index, rule_id in enumerate(priority_update.rule_ids):
        await db.execute(
            update(Rule).where(Rule.id == rule_id).values(priority=index)
        )
    
    return {"message": "Rules reordered successfully"}


@router.post("/{rule_id}/toggle")
async def toggle_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """Toggle a rule's active status."""
    result = await db.execute(select(Rule).where(Rule.id == rule_id))
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    rule.is_active = not rule.is_active
    await db.flush()
    await db.refresh(rule)
    
    return {"id": rule.id, "is_active": rule.is_active}
