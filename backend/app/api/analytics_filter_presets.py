"""
Analytics Filter Presets API.

Shared (not per-user) saved filter sets for analytics reports.
report_key identifies which report the preset belongs to so e.g.
the Livrabilitate Produse drawer only sees its own presets.

Endpoints:
  GET    /api/analytics-filter-presets?report_key=livrabilitate_produse
  POST   /api/analytics-filter-presets
  PUT    /api/analytics-filter-presets/{id}
  DELETE /api/analytics-filter-presets/{id}
  POST   /api/analytics-filter-presets/{id}/set-default
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import AnalyticsFilterPreset

router = APIRouter()


class PresetCreate(BaseModel):
    report_key: str = Field(..., max_length=80)
    name: str = Field(..., max_length=120)
    description: Optional[str] = Field(None, max_length=500)
    filters: dict = Field(default_factory=dict)
    is_default: bool = False
    created_by: Optional[str] = None


class PresetUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = Field(None, max_length=500)
    filters: Optional[dict] = None
    is_default: Optional[bool] = None


class PresetResponse(BaseModel):
    id: int
    report_key: str
    name: str
    description: Optional[str] = None
    filters: dict
    is_default: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None

    class Config:
        from_attributes = True


@router.get("", response_model=List[PresetResponse])
async def list_presets(
    report_key: str,
    db: AsyncSession = Depends(get_db),
):
    """List all presets for a given report_key."""
    result = await db.execute(
        select(AnalyticsFilterPreset)
        .where(AnalyticsFilterPreset.report_key == report_key)
        .order_by(
            AnalyticsFilterPreset.is_default.desc(),
            AnalyticsFilterPreset.name.asc(),
        )
    )
    return result.scalars().all()


@router.post("", response_model=PresetResponse)
async def create_preset(body: PresetCreate, db: AsyncSession = Depends(get_db)):
    # Names are unique within a report_key — give a clearer error than the raw
    # IntegrityError the DB would throw if we tried to add a no-op unique index.
    existing = await db.execute(
        select(AnalyticsFilterPreset).where(
            AnalyticsFilterPreset.report_key == body.report_key,
            AnalyticsFilterPreset.name == body.name,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail=f"Un preset cu numele '{body.name}' există deja pentru acest raport",
        )

    if body.is_default:
        await db.execute(
            update(AnalyticsFilterPreset)
            .where(AnalyticsFilterPreset.report_key == body.report_key)
            .values(is_default=False)
        )

    preset = AnalyticsFilterPreset(
        report_key=body.report_key,
        name=body.name,
        description=body.description,
        filters=body.filters or {},
        is_default=body.is_default,
        created_by=body.created_by,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return preset


@router.put("/{preset_id}", response_model=PresetResponse)
async def update_preset(
    preset_id: int,
    body: PresetUpdate,
    db: AsyncSession = Depends(get_db),
):
    preset = await db.get(AnalyticsFilterPreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")

    if body.is_default is True:
        await db.execute(
            update(AnalyticsFilterPreset)
            .where(
                AnalyticsFilterPreset.report_key == preset.report_key,
                AnalyticsFilterPreset.id != preset.id,
            )
            .values(is_default=False)
        )

    if body.name is not None:
        # Same uniqueness check as create — skip if the new name matches the
        # preset's existing name (renaming-to-self is fine).
        if body.name != preset.name:
            existing = await db.execute(
                select(AnalyticsFilterPreset).where(
                    AnalyticsFilterPreset.report_key == preset.report_key,
                    AnalyticsFilterPreset.name == body.name,
                    AnalyticsFilterPreset.id != preset.id,
                )
            )
            if existing.scalar_one_or_none():
                raise HTTPException(
                    status_code=400,
                    detail=f"Un preset cu numele '{body.name}' există deja",
                )
        preset.name = body.name
    if body.description is not None:
        preset.description = body.description
    if body.filters is not None:
        preset.filters = body.filters
    if body.is_default is not None:
        preset.is_default = body.is_default

    await db.commit()
    await db.refresh(preset)
    return preset


@router.delete("/{preset_id}")
async def delete_preset(preset_id: int, db: AsyncSession = Depends(get_db)):
    preset = await db.get(AnalyticsFilterPreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    await db.delete(preset)
    await db.commit()
    return {"message": f"Deleted preset '{preset.name}'"}


@router.post("/{preset_id}/set-default", response_model=PresetResponse)
async def set_default(preset_id: int, db: AsyncSession = Depends(get_db)):
    preset = await db.get(AnalyticsFilterPreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")

    await db.execute(
        update(AnalyticsFilterPreset)
        .where(AnalyticsFilterPreset.report_key == preset.report_key)
        .values(is_default=False)
    )
    preset.is_default = True
    await db.commit()
    await db.refresh(preset)
    return preset
