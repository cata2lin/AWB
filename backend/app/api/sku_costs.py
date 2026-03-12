"""
SKU Costs API endpoints.

CRUD operations for managing production/procurement costs per SKU.
"""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func

from app.core.database import AsyncSessionLocal
from app.models import SkuCost, Order

router = APIRouter(prefix="/sku-costs", tags=["sku-costs"])


# Pydantic schemas
class SkuCostBase(BaseModel):
    sku: str
    name: Optional[str] = None
    cost: float = 0.0
    currency: str = "RON"


class SkuCostCreate(SkuCostBase):
    pass


class SkuCostUpdate(BaseModel):
    name: Optional[str] = None
    cost: Optional[float] = None
    currency: Optional[str] = None


class SkuCostResponse(SkuCostBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SkuCostBulkCreate(BaseModel):
    skus: List[SkuCostCreate]


@router.get("", response_model=List[SkuCostResponse])
async def list_sku_costs(
    search: Optional[str] = Query(None, description="Search by SKU or name"),
    has_cost: Optional[bool] = Query(None, description="Filter: true=has cost set, false=no cost set"),
    limit: int = Query(10000, le=10000),
    offset: int = Query(0)
):
    """List all SKU costs with optional search and cost filter."""
    async with AsyncSessionLocal() as db:
        query = select(SkuCost)
        
        if search:
            search_pattern = f"%{search}%"
            query = query.where(
                (SkuCost.sku.ilike(search_pattern)) |
                (SkuCost.name.ilike(search_pattern))
            )
        
        if has_cost is not None:
            if has_cost:
                query = query.where(SkuCost.cost > 0)
            else:
                query = query.where((SkuCost.cost == 0) | (SkuCost.cost.is_(None)))
        
        query = query.order_by(SkuCost.sku).offset(offset).limit(limit)
        result = await db.execute(query)
        return result.scalars().all()


@router.post("", response_model=SkuCostResponse)
async def create_sku_cost(data: SkuCostCreate):
    """Create a new SKU cost entry."""
    async with AsyncSessionLocal() as db:
        # Check if SKU already exists
        existing = await db.execute(
            select(SkuCost).where(SkuCost.sku == data.sku)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"SKU '{data.sku}' already exists")
        
        sku_cost = SkuCost(
            sku=data.sku,
            name=data.name,
            cost=data.cost,
            currency=data.currency
        )
        db.add(sku_cost)
        await db.commit()
        await db.refresh(sku_cost)
        return sku_cost


@router.put("/{sku}", response_model=SkuCostResponse)
async def update_sku_cost(sku: str, data: SkuCostUpdate):
    """Update an existing SKU cost."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(SkuCost).where(SkuCost.sku == sku)
        )
        sku_cost = result.scalar_one_or_none()
        
        if not sku_cost:
            raise HTTPException(status_code=404, detail=f"SKU '{sku}' not found")
        
        if data.name is not None:
            sku_cost.name = data.name
        if data.cost is not None:
            sku_cost.cost = data.cost
        if data.currency is not None:
            sku_cost.currency = data.currency
        
        await db.commit()
        await db.refresh(sku_cost)
        return sku_cost


@router.delete("/{sku}")
async def delete_sku_cost(sku: str):
    """Delete a SKU cost entry."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(SkuCost).where(SkuCost.sku == sku)
        )
        sku_cost = result.scalar_one_or_none()
        
        if not sku_cost:
            raise HTTPException(status_code=404, detail=f"SKU '{sku}' not found")
        
        await db.delete(sku_cost)
        await db.commit()
        return {"message": f"SKU '{sku}' deleted successfully"}


@router.post("/bulk", response_model=dict)
async def bulk_upsert_sku_costs(data: SkuCostBulkCreate):
    """Bulk create or update SKU costs."""
    async with AsyncSessionLocal() as db:
        created = 0
        updated = 0
        
        for item in data.skus:
            result = await db.execute(
                select(SkuCost).where(SkuCost.sku == item.sku)
            )
            existing = result.scalar_one_or_none()
            
            if existing:
                existing.name = item.name or existing.name
                existing.cost = item.cost
                existing.currency = item.currency
                updated += 1
            else:
                sku_cost = SkuCost(
                    sku=item.sku,
                    name=item.name,
                    cost=item.cost,
                    currency=item.currency
                )
                db.add(sku_cost)
                created += 1
        
        await db.commit()
        return {"created": created, "updated": updated}


@router.get("/discover")
async def discover_skus_from_orders():
    """
    Discover all unique SKUs from order line items that don't have costs assigned.
    Returns SKUs found in orders but not in sku_costs table.
    SKU is at item['inventory_item']['sku'], name at item['inventory_item']['title_1']
    """
    async with AsyncSessionLocal() as db:
        # Get all orders with line items
        orders_result = await db.execute(
            select(Order.line_items).where(Order.line_items.isnot(None))
        )
        
        # Extract unique SKUs from all orders with their names
        all_skus = {}  # sku -> name
        for (line_items,) in orders_result.fetchall():
            if isinstance(line_items, list):
                for item in line_items:
                    if isinstance(item, dict):
                        inventory_item = item.get("inventory_item", {})
                        if isinstance(inventory_item, dict):
                            sku = inventory_item.get("sku")
                            name = inventory_item.get("title_1", "")
                            if sku and sku not in all_skus:
                                all_skus[sku] = name
        
        # Get SKUs that already have costs
        existing_result = await db.execute(select(SkuCost.sku))
        existing_skus = {row[0] for row in existing_result.fetchall()}
        
        # Find missing SKUs
        missing_skus = set(all_skus.keys()) - existing_skus
        
        # Get count of orders for each missing SKU
        sku_counts = {}
        orders_result = await db.execute(
            select(Order.line_items).where(Order.line_items.isnot(None))
        )
        for (line_items,) in orders_result.fetchall():
            if isinstance(line_items, list):
                for item in line_items:
                    if isinstance(item, dict):
                        inventory_item = item.get("inventory_item", {})
                        if isinstance(inventory_item, dict):
                            sku = inventory_item.get("sku")
                            if sku and sku in missing_skus:
                                qty = item.get("quantity", 1)
                                sku_counts[sku] = sku_counts.get(sku, 0) + int(qty)
        
        # Sort by count descending
        discovered = [
            {"sku": sku, "order_quantity": count, "name": all_skus.get(sku, ""), "cost": 0.0}
            for sku, count in sorted(sku_counts.items(), key=lambda x: -x[1])
        ]
        
        return {
            "discovered_count": len(discovered),
            "existing_count": len(existing_skus),
            "skus": discovered  # Return all discovered SKUs
        }
