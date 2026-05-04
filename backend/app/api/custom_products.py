from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from pydantic import BaseModel

from app.core.database import get_db
from app.models.custom_product import CustomProduct

router = APIRouter(prefix="/custom-products", tags=["Custom Products"])

# ── Pydantic Schemas ───────────────────────────────────────────────────────

class CustomProductBase(BaseModel):
    sku: str
    product_name: str
    barcode: Optional[str] = None
    image_url: Optional[str] = None
    default_unit_cost: float = 0.0
    hs_code: Optional[str] = None
    weight_grams: Optional[int] = None

class CustomProductCreate(CustomProductBase):
    pass

class CustomProductUpdate(CustomProductBase):
    pass

class CustomProductResponse(CustomProductBase):
    id: int
    uid: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True

# ── Helpers ───────────────────────────────────────────────────────────────

async def _generate_custom_uid(db: AsyncSession) -> str:
    result = await db.execute(select(func.count(CustomProduct.id)))
    count = result.scalar() or 0
    return f"CUST-{(count + 1):04d}"

def _serialize(cp: CustomProduct) -> dict:
    return {
        "id": cp.id,
        "uid": cp.uid,
        "sku": cp.sku,
        "product_name": cp.product_name,
        "barcode": cp.barcode,
        "image_url": cp.image_url,
        "default_unit_cost": cp.default_unit_cost,
        "hs_code": cp.hs_code,
        "weight_grams": cp.weight_grams,
        "created_at": cp.created_at.isoformat() if cp.created_at else None,
        "updated_at": cp.updated_at.isoformat() if cp.updated_at else None,
    }

# ── Routes ────────────────────────────────────────────────────────────────

@router.get("", response_model=dict)
async def list_custom_products(
    search: Optional[str] = Query(None),
    limit: int = Query(50, le=100),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db)
):
    query = select(CustomProduct).order_by(CustomProduct.created_at.desc())
    if search:
        sl = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(CustomProduct.sku).like(sl),
                func.lower(CustomProduct.product_name).like(sl),
                func.lower(CustomProduct.barcode).like(sl)
            )
        )
    
    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Get items
    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "items": [_serialize(cp) for cp in items],
        "total": total
    }

@router.post("", response_model=dict)
async def create_custom_product(body: CustomProductCreate, db: AsyncSession = Depends(get_db)):
    # Check duplicate SKU
    exists = await db.execute(select(CustomProduct).where(CustomProduct.sku == body.sku))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A custom product with this SKU already exists.")
    
    uid = await _generate_custom_uid(db)
    cp = CustomProduct(
        uid=uid,
        sku=body.sku,
        product_name=body.product_name,
        barcode=body.barcode,
        image_url=body.image_url,
        default_unit_cost=body.default_unit_cost,
        hs_code=body.hs_code,
        weight_grams=body.weight_grams
    )
    db.add(cp)
    await db.commit()
    await db.refresh(cp)
    return _serialize(cp)

@router.put("/{cp_id}", response_model=dict)
async def update_custom_product(cp_id: int, body: CustomProductUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CustomProduct).where(CustomProduct.id == cp_id))
    cp = result.scalar_one_or_none()
    if not cp:
        raise HTTPException(status_code=404, detail="Custom product not found.")
    
    # Check duplicate SKU
    if body.sku != cp.sku:
        exists = await db.execute(select(CustomProduct).where(CustomProduct.sku == body.sku))
        if exists.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="A custom product with this SKU already exists.")
    
    cp.sku = body.sku
    cp.product_name = body.product_name
    cp.barcode = body.barcode
    cp.image_url = body.image_url
    cp.default_unit_cost = body.default_unit_cost
    cp.hs_code = body.hs_code
    cp.weight_grams = body.weight_grams
    
    await db.commit()
    await db.refresh(cp)
    return _serialize(cp)

@router.delete("/{cp_id}")
async def delete_custom_product(cp_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CustomProduct).where(CustomProduct.id == cp_id))
    cp = result.scalar_one_or_none()
    if not cp:
        raise HTTPException(status_code=404, detail="Custom product not found.")
    
    await db.delete(cp)
    await db.commit()
    return {"ok": True}
