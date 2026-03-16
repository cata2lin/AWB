"""
Stores API endpoints.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.models import Store, Order
from app.schemas import StoreResponse, StoreCreate, StoreUpdate, StoreStats

router = APIRouter()


@router.get("", response_model=List[StoreResponse])
async def get_stores(db: AsyncSession = Depends(get_db)):
    """Get all stores with order counts (single optimized query)."""
    from sqlalchemy import case, literal

    # Single aggregated query — avoids N+1 pattern that caused timeouts during sync
    counts_query = (
        select(
            Order.store_uid,
            func.count(Order.id).label("total"),
            func.count(case((Order.is_printed == False, Order.id))).label("unprinted"),
            func.count(case(
                (
                    (Order.is_printed == False) & (Order.awb_pdf_url.isnot(None)),
                    Order.id,
                )
            )).label("printable"),
        )
        .group_by(Order.store_uid)
    )
    counts_result = await db.execute(counts_query)
    counts_map = {
        row.store_uid: {
            "total": row.total,
            "unprinted": row.unprinted,
            "printable": row.printable,
        }
        for row in counts_result
    }

    result = await db.execute(select(Store).order_by(Store.name))
    stores = result.scalars().all()

    response = []
    for store in stores:
        c = counts_map.get(store.uid, {"total": 0, "unprinted": 0, "printable": 0})
        response.append(StoreResponse(
            id=store.id,
            uid=store.uid,
            name=store.name,
            color_code=store.color_code,
            shopify_domain=store.shopify_domain,
            is_active=store.is_active,
            created_at=store.created_at,
            order_count=c["total"],
            unprinted_count=c["unprinted"],
            printable_count=c["printable"],
        ))

    return response


@router.get("/stats", response_model=List[StoreStats])
async def get_store_stats(db: AsyncSession = Depends(get_db)):
    """Get statistics for all stores."""
    result = await db.execute(select(Store).where(Store.is_active == True))
    stores = result.scalars().all()
    
    stats = []
    for store in stores:
        total_result = await db.execute(
            select(func.count(Order.id)).where(Order.store_uid == store.uid)
        )
        total = total_result.scalar() or 0
        
        unprinted_result = await db.execute(
            select(func.count(Order.id)).where(
                (Order.store_uid == store.uid) & (Order.is_printed == False)
            )
        )
        unprinted = unprinted_result.scalar() or 0
        
        stats.append(StoreStats(
            uid=store.uid,
            name=store.name,
            color_code=store.color_code,
            total_orders=total,
            unprinted_orders=unprinted,
            printed_orders=total - unprinted
        ))
    
    return stats


@router.post("", response_model=StoreResponse)
async def create_store(store: StoreCreate, db: AsyncSession = Depends(get_db)):
    """Create a new store."""
    # Check if store with UID already exists
    existing = await db.execute(select(Store).where(Store.uid == store.uid))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Store with this UID already exists")
    
    db_store = Store(**store.model_dump())
    db.add(db_store)
    await db.flush()
    await db.refresh(db_store)
    
    return StoreResponse(
        id=db_store.id,
        uid=db_store.uid,
        name=db_store.name,
        color_code=db_store.color_code,
        is_active=db_store.is_active,
        created_at=db_store.created_at,
        order_count=0,
        unprinted_count=0
    )


@router.patch("/{store_uid}", response_model=StoreResponse)
async def update_store(
    store_uid: str,
    update: StoreUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update store configuration."""
    result = await db.execute(select(Store).where(Store.uid == store_uid))
    store = result.scalar_one_or_none()
    
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    
    update_data = update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(store, field, value)
    
    await db.flush()
    await db.refresh(store)
    
    return store
