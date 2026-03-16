"""
SKU Marketing Costs CRUD endpoints.
Manage per-product marketing spend entries.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.sku_marketing_cost import SkuMarketingCost

router = APIRouter()


class SkuMarketingCostCreate(BaseModel):
    sku: str
    label: str
    amount: float
    month: str  # YYYY-MM


class SkuMarketingCostUpdate(BaseModel):
    label: Optional[str] = None
    amount: Optional[float] = None
    month: Optional[str] = None


@router.get("/sku-marketing-costs")
async def list_sku_marketing_costs(
    sku: Optional[str] = None,
    month: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List all SKU marketing costs, optionally filtered by SKU and/or month."""
    conditions = []
    if sku:
        conditions.append(SkuMarketingCost.sku == sku)
    if month:
        conditions.append(SkuMarketingCost.month == month)

    query = select(SkuMarketingCost)
    if conditions:
        query = query.where(and_(*conditions))
    query = query.order_by(SkuMarketingCost.month.desc(), SkuMarketingCost.sku)

    result = await db.execute(query)
    costs = result.scalars().all()

    return [
        {
            "id": c.id,
            "sku": c.sku,
            "label": c.label,
            "amount": c.amount,
            "month": c.month,
        }
        for c in costs
    ]


@router.post("/sku-marketing-costs")
async def create_sku_marketing_cost(
    data: SkuMarketingCostCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new SKU marketing cost entry."""
    entry = SkuMarketingCost(
        sku=data.sku,
        label=data.label,
        amount=data.amount,
        month=data.month,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return {
        "id": entry.id,
        "sku": entry.sku,
        "label": entry.label,
        "amount": entry.amount,
        "month": entry.month,
    }


@router.put("/sku-marketing-costs/{cost_id}")
async def update_sku_marketing_cost(
    cost_id: int,
    data: SkuMarketingCostUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing SKU marketing cost entry."""
    result = await db.execute(
        select(SkuMarketingCost).where(SkuMarketingCost.id == cost_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Marketing cost entry not found")

    if data.label is not None:
        entry.label = data.label
    if data.amount is not None:
        entry.amount = data.amount
    if data.month is not None:
        entry.month = data.month

    await db.commit()
    await db.refresh(entry)
    return {
        "id": entry.id,
        "sku": entry.sku,
        "label": entry.label,
        "amount": entry.amount,
        "month": entry.month,
    }


@router.delete("/sku-marketing-costs/{cost_id}")
async def delete_sku_marketing_cost(
    cost_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a SKU marketing cost entry."""
    result = await db.execute(
        select(SkuMarketingCost).where(SkuMarketingCost.id == cost_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Marketing cost entry not found")

    await db.delete(entry)
    await db.commit()
    return {"ok": True}
