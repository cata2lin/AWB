"""
Rule Presets API endpoints.

Allows saving and loading rule configurations as reusable presets.
"""
from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.database import get_db
from app.models import Rule, RulePreset
from app.schemas import RulePresetCreate, RulePresetResponse, RulePresetDetailResponse

router = APIRouter()


@router.get("", response_model=List[RulePresetResponse])
async def get_presets(db: AsyncSession = Depends(get_db)):
    """Get all saved presets."""
    result = await db.execute(
        select(RulePreset).order_by(RulePreset.created_at.desc())
    )
    presets = result.scalars().all()
    
    # Add rule_count from snapshot
    response = []
    for preset in presets:
        snapshot = preset.rules_snapshot or []
        response.append(RulePresetResponse(
            id=preset.id,
            name=preset.name,
            description=preset.description,
            rule_count=len(snapshot),
            is_active=preset.is_active,
            created_at=preset.created_at,
            updated_at=preset.updated_at
        ))
    
    return response


@router.get("/active", response_model=RulePresetResponse | None)
async def get_active_preset(db: AsyncSession = Depends(get_db)):
    """Get the currently active preset."""
    result = await db.execute(
        select(RulePreset).where(RulePreset.is_active == True)
    )
    preset = result.scalar_one_or_none()
    
    if not preset:
        return None
    
    snapshot = preset.rules_snapshot or []
    return RulePresetResponse(
        id=preset.id,
        name=preset.name,
        description=preset.description,
        rule_count=len(snapshot),
        is_active=preset.is_active,
        created_at=preset.created_at,
        updated_at=preset.updated_at
    )


@router.get("/{preset_id}", response_model=RulePresetDetailResponse)
async def get_preset(preset_id: int, db: AsyncSession = Depends(get_db)):
    """Get a specific preset with full rules snapshot."""
    result = await db.execute(
        select(RulePreset).where(RulePreset.id == preset_id)
    )
    preset = result.scalar_one_or_none()
    
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    
    snapshot = preset.rules_snapshot or []
    return RulePresetDetailResponse(
        id=preset.id,
        name=preset.name,
        description=preset.description,
        rules_snapshot=snapshot,
        rule_count=len(snapshot),
        is_active=preset.is_active,
        created_at=preset.created_at,
        updated_at=preset.updated_at
    )


@router.post("", response_model=RulePresetResponse)
async def save_preset(
    preset_data: RulePresetCreate,
    db: AsyncSession = Depends(get_db)
):
    """Save current rules as a new preset."""
    # Check if name already exists
    existing = await db.execute(
        select(RulePreset).where(RulePreset.name == preset_data.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Preset name already exists")
    
    # Get all current rules
    rules_result = await db.execute(
        select(Rule).order_by(Rule.priority)
    )
    rules = rules_result.scalars().all()
    
    # Create snapshot
    rules_snapshot = []
    for rule in rules:
        rules_snapshot.append({
            "name": rule.name,
            "priority": rule.priority,
            "is_active": rule.is_active,
            "conditions": rule.conditions,
            "group_config": rule.group_config
        })
    
    # Create preset
    preset = RulePreset(
        name=preset_data.name,
        description=preset_data.description,
        rules_snapshot=rules_snapshot,
        is_active=False
    )
    db.add(preset)
    await db.flush()
    await db.refresh(preset)
    
    return RulePresetResponse(
        id=preset.id,
        name=preset.name,
        description=preset.description,
        rule_count=len(rules_snapshot),
        is_active=preset.is_active,
        created_at=preset.created_at,
        updated_at=preset.updated_at
    )


@router.post("/{preset_id}/load")
async def load_preset(preset_id: int, db: AsyncSession = Depends(get_db)):
    """Load a preset - replaces all current rules with preset rules."""
    # Get preset
    result = await db.execute(
        select(RulePreset).where(RulePreset.id == preset_id)
    )
    preset = result.scalar_one_or_none()
    
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    
    # Delete all current rules
    current_rules = await db.execute(select(Rule))
    for rule in current_rules.scalars().all():
        await db.delete(rule)
    
    # Create new rules from snapshot
    rules_snapshot = preset.rules_snapshot or []
    for rule_data in rules_snapshot:
        new_rule = Rule(
            name=rule_data.get("name", "Unnamed Rule"),
            priority=rule_data.get("priority", 0),
            is_active=rule_data.get("is_active", True),
            conditions=rule_data.get("conditions", {}),
            group_config=rule_data.get("group_config", {})
        )
        db.add(new_rule)
    
    # Mark this preset as active, deactivate others
    await db.execute(
        update(RulePreset).values(is_active=False)
    )
    preset.is_active = True
    
    await db.commit()
    
    return {
        "message": f"Loaded preset '{preset.name}' with {len(rules_snapshot)} rules",
        "preset_id": preset_id,
        "rules_loaded": len(rules_snapshot)
    }


@router.delete("/{preset_id}")
async def delete_preset(preset_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a preset."""
    result = await db.execute(
        select(RulePreset).where(RulePreset.id == preset_id)
    )
    preset = result.scalar_one_or_none()
    
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    
    await db.delete(preset)
    await db.commit()
    
    return {"message": f"Deleted preset '{preset.name}'"}
