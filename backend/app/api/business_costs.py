"""
Business Costs API — CRUD for fixed and seasonal business costs.

Endpoints:
  GET    /                  — List costs for a month (with optional store/category filter)
  POST   /                  — Create a new cost entry
  PUT    /{id}              — Update a cost entry
  DELETE /{id}              — Delete a cost entry
  POST   /clone-month       — Clone all fixed costs from one month to another
  GET    /categories        — Available cost categories
  GET    /months            — List months that have cost entries
"""
import logging
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.business_cost import BusinessCost

logger = logging.getLogger(__name__)

router = APIRouter()

# Available categories
COST_CATEGORIES = [
    {"key": "salary", "label": "Salarii", "icon": "👤"},
    {"key": "utility", "label": "Utilități", "icon": "⚡"},
    {"key": "subscription", "label": "Subscripții", "icon": "📋"},
    {"key": "marketing", "label": "Marketing", "icon": "📣"},
    {"key": "rent", "label": "Chirie", "icon": "🏠"},
    {"key": "other", "label": "Altele", "icon": "📦"},
]

PNL_SECTIONS = [
    {"key": "cogs", "label": "Costuri Directe (COGS)"},
    {"key": "operational", "label": "Costuri Operaționale"},
    {"key": "marketing", "label": "Costuri Marketing"},
    {"key": "fixed", "label": "Costuri Fixe"},
]


# --- Schemas ---

class BusinessCostCreate(BaseModel):
    category: str
    label: str
    amount: float
    month: str  # "YYYY-MM"
    cost_type: str = "fixed"  # "fixed" | "seasonal"
    scope: str = "all"  # "all" | "stores" | "store"
    store_uids: Optional[List[str]] = None
    notes: Optional[str] = None
    has_tva: bool = True
    pnl_section: str = "fixed"  # "cogs" | "operational" | "marketing" | "fixed"
    display_order: int = 0


class BusinessCostUpdate(BaseModel):
    category: Optional[str] = None
    label: Optional[str] = None
    amount: Optional[float] = None
    month: Optional[str] = None
    cost_type: Optional[str] = None
    scope: Optional[str] = None
    store_uids: Optional[List[str]] = None
    notes: Optional[str] = None
    has_tva: Optional[bool] = None
    pnl_section: Optional[str] = None
    display_order: Optional[int] = None


class CloneMonthRequest(BaseModel):
    from_month: str  # "YYYY-MM"
    to_month: str    # "YYYY-MM"


# --- Helpers ---

def cost_to_dict(cost: BusinessCost) -> dict:
    return {
        "id": cost.id,
        "category": cost.category,
        "label": cost.label,
        "amount": cost.amount,
        "month": cost.month,
        "cost_type": cost.cost_type,
        "scope": cost.scope,
        "store_uids": cost.store_uids,
        "notes": cost.notes,
        "has_tva": cost.has_tva if cost.has_tva is not None else True,
        "pnl_section": cost.pnl_section or "fixed",
        "display_order": cost.display_order or 0,
        "created_at": cost.created_at.isoformat() if cost.created_at else None,
        "updated_at": cost.updated_at.isoformat() if cost.updated_at else None,
    }


# --- Endpoints ---

@router.get("")
async def list_costs(
    month: Optional[str] = Query(None, description="Month filter, e.g. 2026-02"),
    category: Optional[str] = Query(None, description="Category filter"),
    store_uid: Optional[str] = Query(None, description="Filter costs affecting this store"),
    db: AsyncSession = Depends(get_db),
):
    """List business costs, optionally filtered by month, category, or store."""
    conditions = []
    if month:
        conditions.append(BusinessCost.month == month)
    if category:
        conditions.append(BusinessCost.category == category)

    query = select(BusinessCost)
    if conditions:
        query = query.where(and_(*conditions))
    query = query.order_by(BusinessCost.month.desc(), BusinessCost.category, BusinessCost.label)

    result = await db.execute(query)
    costs = result.scalars().all()

    # If store_uid filter is set, further filter in Python (JSON column)
    if store_uid:
        filtered = []
        for c in costs:
            if c.scope == "all":
                filtered.append(c)
            elif c.store_uids and store_uid in c.store_uids:
                filtered.append(c)
        costs = filtered

    return {
        "costs": [cost_to_dict(c) for c in costs],
        "count": len(costs),
    }


@router.post("")
async def create_cost(
    data: BusinessCostCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new business cost entry."""
    # Validate category
    valid_categories = [c["key"] for c in COST_CATEGORIES]
    if data.category not in valid_categories:
        raise HTTPException(400, f"Invalid category '{data.category}'. Valid: {valid_categories}")

    # Validate cost_type
    if data.cost_type not in ("fixed", "seasonal"):
        raise HTTPException(400, "cost_type must be 'fixed' or 'seasonal'")

    # Validate scope
    if data.scope not in ("all", "stores", "store"):
        raise HTTPException(400, "scope must be 'all', 'stores', or 'store'")

    # Validate store_uids for non-all scopes
    if data.scope in ("stores", "store") and not data.store_uids:
        raise HTTPException(400, f"store_uids required when scope is '{data.scope}'")

    # Validate month format
    try:
        datetime.strptime(data.month, "%Y-%m")
    except ValueError:
        raise HTTPException(400, "month must be in YYYY-MM format")

    # Validate pnl_section
    valid_sections = [s["key"] for s in PNL_SECTIONS]
    if data.pnl_section not in valid_sections:
        raise HTTPException(400, f"Invalid pnl_section '{data.pnl_section}'. Valid: {valid_sections}")

    cost = BusinessCost(
        category=data.category,
        label=data.label,
        amount=data.amount,
        month=data.month,
        cost_type=data.cost_type,
        scope=data.scope,
        store_uids=data.store_uids,
        notes=data.notes,
        has_tva=data.has_tva,
        pnl_section=data.pnl_section,
        display_order=data.display_order,
    )
    db.add(cost)
    await db.flush()
    await db.commit()
    await db.refresh(cost)

    return cost_to_dict(cost)


@router.put("/{cost_id}")
async def update_cost(
    cost_id: int,
    data: BusinessCostUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing business cost entry (partial update)."""
    result = await db.execute(select(BusinessCost).where(BusinessCost.id == cost_id))
    cost = result.scalar_one_or_none()
    if not cost:
        raise HTTPException(404, "Cost entry not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(cost, field, value)

    await db.flush()
    await db.commit()
    await db.refresh(cost)

    return cost_to_dict(cost)


@router.delete("/{cost_id}")
async def delete_cost(
    cost_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a business cost entry."""
    result = await db.execute(select(BusinessCost).where(BusinessCost.id == cost_id))
    cost = result.scalar_one_or_none()
    if not cost:
        raise HTTPException(404, "Cost entry not found")

    await db.delete(cost)
    await db.commit()

    return {"status": "deleted", "id": cost_id}


@router.post("/clone-month")
async def clone_month(
    data: CloneMonthRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Clone all FIXED costs from one month to another.
    Seasonal costs are NOT cloned (they are one-time by definition).
    Already-existing entries in the target month are not duplicated.
    """
    # Validate month formats
    for m in (data.from_month, data.to_month):
        try:
            datetime.strptime(m, "%Y-%m")
        except ValueError:
            raise HTTPException(400, f"Invalid month format: {m}. Expected YYYY-MM")

    if data.from_month == data.to_month:
        raise HTTPException(400, "Source and target months must be different")

    # Get fixed costs from source month
    result = await db.execute(
        select(BusinessCost).where(
            and_(
                BusinessCost.month == data.from_month,
                BusinessCost.cost_type == "fixed",
            )
        )
    )
    source_costs = result.scalars().all()

    if not source_costs:
        return {"cloned": 0, "message": f"No fixed costs found in {data.from_month}"}

    # Check existing entries in target month to avoid duplicates
    existing_result = await db.execute(
        select(BusinessCost).where(BusinessCost.month == data.to_month)
    )
    existing_costs = existing_result.scalars().all()
    existing_keys = {(c.category, c.label, c.scope) for c in existing_costs}

    cloned = 0
    for src in source_costs:
        key = (src.category, src.label, src.scope)
        if key in existing_keys:
            continue  # Skip duplicates

        new_cost = BusinessCost(
            category=src.category,
            label=src.label,
            amount=src.amount,
            month=data.to_month,
            cost_type="fixed",
            scope=src.scope,
            store_uids=src.store_uids,
            notes=src.notes,
            has_tva=src.has_tva if src.has_tva is not None else True,
            pnl_section=src.pnl_section or "fixed",
            display_order=src.display_order or 0,
        )
        db.add(new_cost)
        cloned += 1

    if cloned > 0:
        await db.commit()

    return {
        "cloned": cloned,
        "source_month": data.from_month,
        "target_month": data.to_month,
        "skipped_duplicates": len(source_costs) - cloned,
    }


@router.get("/categories")
async def get_categories():
    """Return available cost categories."""
    return {"categories": COST_CATEGORIES}


@router.get("/months")
async def get_months(db: AsyncSession = Depends(get_db)):
    """Return list of months that have cost entries, sorted descending."""
    result = await db.execute(
        select(distinct(BusinessCost.month)).order_by(BusinessCost.month.desc())
    )
    months = [row[0] for row in result.all()]
    return {"months": months}


class ReorderItem(BaseModel):
    id: int
    display_order: int
    pnl_section: Optional[str] = None  # optionally move to new section


@router.patch("/reorder")
async def reorder_costs(
    items: List[ReorderItem],
    db: AsyncSession = Depends(get_db),
):
    """Batch update display order and optionally pnl_section for multiple cost items."""
    valid_sections = [s["key"] for s in PNL_SECTIONS]
    updated = 0
    for item in items:
        result = await db.execute(select(BusinessCost).where(BusinessCost.id == item.id))
        cost = result.scalar_one_or_none()
        if not cost:
            continue
        cost.display_order = item.display_order
        if item.pnl_section and item.pnl_section in valid_sections:
            cost.pnl_section = item.pnl_section
        updated += 1
    
    if updated > 0:
        await db.commit()
    
    return {"updated": updated}


@router.get("/pnl-sections")
async def get_pnl_sections():
    """Return available P&L sections for the dropdown picker."""
    return {"sections": PNL_SECTIONS}
