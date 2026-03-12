"""
Profitability Config API endpoints.
GET and PUT for the single-row config table.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, List

from app.core.database import get_db
from app.models.profitability_config import ProfitabilityConfig

router = APIRouter(prefix="/profitability-config", tags=["profitability-config"])


class ProfitabilityConfigSchema(BaseModel):
    """Schema for profitability configuration."""
    packaging_cost_per_order: float = 3.7
    agency_commission_pct: float = 2.5
    agency_commission_excluded_stores: Optional[list] = []
    agency_commission_excluded_tags: Optional[list] = []
    gt_commission_pct: float = 5.0
    gt_commission_store_uid: Optional[str] = None
    payment_processing_pct: float = 1.9
    payment_processing_fixed: float = 1.25
    frisbo_fee_per_order: float = 0.0
    vat_rate: float = 0.21
    subscriptions: Optional[dict] = {}
    marketing_costs: Optional[dict] = {}
    warehouse_salary_per_package: float = 0.0


class ProfitabilityConfigUpdate(BaseModel):
    """Schema for partial update of profitability configuration."""
    packaging_cost_per_order: Optional[float] = None
    agency_commission_pct: Optional[float] = None
    agency_commission_excluded_stores: Optional[list] = None
    agency_commission_excluded_tags: Optional[list] = None
    gt_commission_pct: Optional[float] = None
    gt_commission_store_uid: Optional[str] = None
    payment_processing_pct: Optional[float] = None
    payment_processing_fixed: Optional[float] = None
    frisbo_fee_per_order: Optional[float] = None
    vat_rate: Optional[float] = None
    subscriptions: Optional[dict] = None
    marketing_costs: Optional[dict] = None
    warehouse_salary_per_package: Optional[float] = None


async def get_or_create_config(db: AsyncSession) -> ProfitabilityConfig:
    """Get the single config row, creating it with defaults if it doesn't exist."""
    result = await db.execute(select(ProfitabilityConfig).limit(1))
    config = result.scalar_one_or_none()
    if config is None:
        config = ProfitabilityConfig()
        db.add(config)
        await db.flush()
    return config


@router.get("")
async def get_config(db: AsyncSession = Depends(get_db)):
    """Get current profitability configuration."""
    config = await get_or_create_config(db)
    return {
        "packaging_cost_per_order": config.packaging_cost_per_order,
        "agency_commission_pct": config.agency_commission_pct,
        "agency_commission_excluded_stores": config.agency_commission_excluded_stores or [],
        "agency_commission_excluded_tags": config.agency_commission_excluded_tags or [],
        "gt_commission_pct": config.gt_commission_pct,
        "gt_commission_store_uid": config.gt_commission_store_uid,
        "payment_processing_pct": config.payment_processing_pct,
        "payment_processing_fixed": config.payment_processing_fixed,
        "frisbo_fee_per_order": config.frisbo_fee_per_order,
        "vat_rate": config.vat_rate,
        "subscriptions": config.subscriptions or {},
        "marketing_costs": config.marketing_costs or {},
        "warehouse_salary_per_package": config.warehouse_salary_per_package,
    }


@router.put("")
async def update_config(
    updates: ProfitabilityConfigUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update profitability configuration (partial update)."""
    config = await get_or_create_config(db)

    update_data = updates.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            setattr(config, field, value)

    await db.flush()

    return {
        "status": "updated",
        "config": {
            "packaging_cost_per_order": config.packaging_cost_per_order,
            "agency_commission_pct": config.agency_commission_pct,
            "agency_commission_excluded_stores": config.agency_commission_excluded_stores or [],
            "agency_commission_excluded_tags": config.agency_commission_excluded_tags or [],
            "gt_commission_pct": config.gt_commission_pct,
            "gt_commission_store_uid": config.gt_commission_store_uid,
            "payment_processing_pct": config.payment_processing_pct,
            "payment_processing_fixed": config.payment_processing_fixed,
            "frisbo_fee_per_order": config.frisbo_fee_per_order,
            "vat_rate": config.vat_rate,
            "subscriptions": config.subscriptions or {},
            "marketing_costs": config.marketing_costs or {},
            "warehouse_salary_per_package": config.warehouse_salary_per_package,
        }
    }
