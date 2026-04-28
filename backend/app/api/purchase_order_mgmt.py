"""
Purchase Order Management — CRUD + TOM API sync endpoints.
Grandia-aligned lifecycle: DRAFT → APPROVED → PARTIALLY_RECEIVED → COMPLETED → CANCELLED
Two categories: packaging (TOM-sync) and oils (internal only).
"""
import logging
import random
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import PurchaseOrder, PurchaseOrderItem, PoSyncLog, GeneratedBarcode, SkuCost
from app.models.product import Product
from app.models.store import Store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/purchase-orders-mgmt", tags=["purchase-orders-management"])

VALID_STATUSES = {"DRAFT", "APPROVED", "PARTIALLY_RECEIVED", "COMPLETED", "CANCELLED"}
VALID_TRANSITIONS = {
    "DRAFT": ["APPROVED", "CANCELLED"],
    "APPROVED": ["PARTIALLY_RECEIVED", "COMPLETED", "CANCELLED"],
    "PARTIALLY_RECEIVED": ["COMPLETED", "CANCELLED"],
    "COMPLETED": [],
    "CANCELLED": ["DRAFT"],
}


# ── Pydantic schemas ──────────────────────────────────────────────────────

class POItemCreate(BaseModel):
    product_uid: Optional[str] = None
    sku: str
    barcode: Optional[str] = None
    product_name: Optional[str] = None
    variant_title: Optional[str] = None
    product_image: Optional[str] = None
    quantity: int = 0
    unit_cost: float = 0.0
    priority: Optional[str] = None
    item_type: Optional[str] = None
    notes: Optional[str] = None

class POCreate(BaseModel):
    title: Optional[str] = None
    po_category: str = "packaging"  # packaging | oils
    po_type: str = "RESTOCK"  # NEW_PRODUCT | RESTOCK
    priority: str = "STANDARD"  # STANDARD | HIGH
    supplier_name: Optional[str] = None
    container_ref: Optional[str] = None
    expected_arrival_date: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None
    items: List[POItemCreate] = []

class POUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    po_type: Optional[str] = None
    priority: Optional[str] = None
    supplier_name: Optional[str] = None
    container_ref: Optional[str] = None
    expected_arrival_date: Optional[str] = None
    actual_arrival_date: Optional[str] = None
    notes: Optional[str] = None

class POItemUpdate(BaseModel):
    id: Optional[int] = None
    product_uid: Optional[str] = None
    sku: str
    barcode: Optional[str] = None
    product_name: Optional[str] = None
    variant_title: Optional[str] = None
    product_image: Optional[str] = None
    quantity: int = 0
    unit_cost: float = 0.0
    received_qty: int = 0
    priority: Optional[str] = None
    item_type: Optional[str] = None
    notes: Optional[str] = None

class ReceiveItem(BaseModel):
    item_id: int
    received_qty: int

class TomCancelRequest(BaseModel):
    reason: str = "Cancelled by user"


# ── Helpers ───────────────────────────────────────────────────────────────

async def _generate_po_number(db: AsyncSession) -> str:
    result = await db.execute(select(func.count(PurchaseOrder.id)))
    count = result.scalar() or 0
    return f"PO-{count + 1:04d}"


def _serialize_item(item: PurchaseOrderItem) -> dict:
    return {
        "id": item.id, "purchase_order_id": item.purchase_order_id,
        "product_uid": item.product_uid, "sku": item.sku, "barcode": item.barcode,
        "product_name": item.product_name, "variant_title": item.variant_title,
        "product_image": item.product_image,
        "quantity": item.quantity, "unit_cost": item.unit_cost,
        "received_qty": item.received_qty,
        "line_cost": round(item.quantity * item.unit_cost, 2),
        "priority": item.priority, "item_type": item.item_type, "notes": item.notes,
        # TOM fields
        "tom_item_id": item.tom_item_id, "tom_status": item.tom_status,
        "tom_ordered_qty": item.tom_ordered_qty, "tom_received_qty": item.tom_received_qty,
        "tom_shipped_qty": item.tom_shipped_qty,
        "tom_unit_cost_usd": float(item.tom_unit_cost_usd) if item.tom_unit_cost_usd else None,
        "tom_extra_cost_usd": float(item.tom_extra_cost_usd) if item.tom_extra_cost_usd else None,
        "tom_matched_by": item.tom_matched_by, "tom_cancel_reason": item.tom_cancel_reason,
    }


async def _serialize_po(po: PurchaseOrder, items: list, sync_logs: list = None) -> dict:
    return {
        "id": po.id, "po_number": po.po_number, "title": po.title,
        "po_category": po.po_category, "po_type": po.po_type,
        "priority": po.priority, "status": po.status,
        "supplier_name": po.supplier_name, "container_ref": po.container_ref,
        "expected_arrival_date": po.expected_arrival_date.isoformat() if po.expected_arrival_date else None,
        "actual_arrival_date": po.actual_arrival_date.isoformat() if po.actual_arrival_date else None,
        "notes": po.notes, "created_by": po.created_by,
        "total_items": po.total_items, "total_quantity": po.total_quantity,
        "total_cost": po.total_cost,
        # TOM
        "tom_number": po.tom_number, "tom_po_id": po.tom_po_id,
        "tom_status": po.tom_status,
        "tom_sent_at": po.tom_sent_at.isoformat() if po.tom_sent_at else None,
        "tom_refreshed_at": po.tom_refreshed_at.isoformat() if po.tom_refreshed_at else None,
        "tom_supplier_name": po.tom_supplier_name,
        "tom_shipment_code": po.tom_shipment_code, "tom_shipment_mode": po.tom_shipment_mode,
        "tom_shipment_eta": po.tom_shipment_eta.isoformat() if po.tom_shipment_eta else None,
        # Timestamps
        "approved_at": po.approved_at.isoformat() if po.approved_at else None,
        "completed_at": po.completed_at.isoformat() if po.completed_at else None,
        "cancelled_at": po.cancelled_at.isoformat() if po.cancelled_at else None,
        "created_at": po.created_at.isoformat() if po.created_at else None,
        "updated_at": po.updated_at.isoformat() if po.updated_at else None,
        "items": [_serialize_item(i) for i in items],
        "sync_logs": [
            {"id": l.id, "action": l.action, "status": l.status,
             "items_affected": l.items_affected, "error_message": l.error_message,
             "created_at": l.created_at.isoformat() if l.created_at else None}
            for l in (sync_logs or [])
        ],
    }


def _update_totals(po, items):
    po.total_items = len(items)
    po.total_quantity = sum(i.quantity for i in items)
    po.total_cost = round(sum(i.quantity * i.unit_cost for i in items), 2)


# ── CRUD ──────────────────────────────────────────────────────────────────

@router.get("/list")
async def list_purchase_orders(
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    query = select(PurchaseOrder).order_by(PurchaseOrder.created_at.desc())
    if status:
        query = query.where(PurchaseOrder.status == status)
    if category:
        query = query.where(PurchaseOrder.po_category == category)

    result = await db.execute(query)
    orders = result.scalars().all()

    items_result = await db.execute(
        select(
            PurchaseOrderItem.purchase_order_id,
            func.count(PurchaseOrderItem.id),
            func.sum(PurchaseOrderItem.quantity),
            func.sum(PurchaseOrderItem.received_qty),
        ).group_by(PurchaseOrderItem.purchase_order_id)
    )
    items_map = {r[0]: {"count": r[1], "qty": int(r[2] or 0), "recv": int(r[3] or 0)} for r in items_result.all()}

    po_list = []
    for po in orders:
        if search:
            sl = search.lower()
            if not (sl in (po.po_number or "").lower() or sl in (po.title or "").lower()
                    or sl in (po.supplier_name or "").lower() or sl in (po.tom_number or "").lower()):
                continue
        info = items_map.get(po.id, {"count": 0, "qty": 0, "recv": 0})
        po_list.append({
            "id": po.id, "po_number": po.po_number, "title": po.title,
            "po_category": po.po_category, "po_type": po.po_type,
            "priority": po.priority, "status": po.status,
            "supplier_name": po.supplier_name,
            "expected_arrival_date": po.expected_arrival_date.isoformat() if po.expected_arrival_date else None,
            "total_items": info["count"], "total_quantity": info["qty"],
            "received_quantity": info["recv"], "total_cost": po.total_cost,
            "tom_number": po.tom_number, "tom_status": po.tom_status,
            "tom_sent_at": po.tom_sent_at.isoformat() if po.tom_sent_at else None,
            "created_by": po.created_by,
            "created_at": po.created_at.isoformat() if po.created_at else None,
        })

    return {"orders": po_list, "total": len(po_list)}


@router.get("/{po_id}")
async def get_purchase_order(po_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    items_r = await db.execute(select(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id).order_by(PurchaseOrderItem.id))
    items = items_r.scalars().all()
    logs_r = await db.execute(select(PoSyncLog).where(PoSyncLog.purchase_order_id == po_id).order_by(PoSyncLog.created_at.desc()))
    logs = logs_r.scalars().all()
    return await _serialize_po(po, items, logs)


@router.post("/create")
async def create_purchase_order(body: POCreate, db: AsyncSession = Depends(get_db)):
    po_number = await _generate_po_number(db)
    expected_date = None
    if body.expected_arrival_date:
        try:
            expected_date = datetime.strptime(body.expected_arrival_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    po = PurchaseOrder(
        po_number=po_number, title=body.title,
        po_category=body.po_category, po_type=body.po_type,
        priority=body.priority, status="DRAFT",
        supplier_name=body.supplier_name, container_ref=body.container_ref,
        expected_arrival_date=expected_date, notes=body.notes,
        created_by=body.created_by,
    )
    db.add(po)
    await db.flush()

    items = []
    for d in body.items:
        item = PurchaseOrderItem(
            purchase_order_id=po.id, product_uid=d.product_uid,
            sku=d.sku, barcode=d.barcode, product_name=d.product_name,
            variant_title=d.variant_title, product_image=d.product_image,
            quantity=d.quantity, unit_cost=d.unit_cost,
            priority=d.priority, item_type=d.item_type, notes=d.notes,
        )
        db.add(item)
        items.append(item)

    _update_totals(po, items)
    await db.flush()
    return await _serialize_po(po, items)


@router.put("/{po_id}")
async def update_purchase_order(po_id: int, body: POUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")

    if body.status is not None:
        allowed = VALID_TRANSITIONS.get(po.status, [])
        if body.status not in allowed:
            raise HTTPException(status_code=400, detail=f"Cannot transition from '{po.status}' to '{body.status}'")
        po.status = body.status
        if body.status == "APPROVED":
            po.approved_at = datetime.utcnow()
        elif body.status == "COMPLETED":
            po.completed_at = datetime.utcnow()
        elif body.status == "CANCELLED":
            po.cancelled_at = datetime.utcnow()

    for field in ["title", "po_type", "priority", "supplier_name", "container_ref", "notes"]:
        val = getattr(body, field, None)
        if val is not None:
            setattr(po, field, val)
    if body.expected_arrival_date is not None:
        try:
            po.expected_arrival_date = datetime.strptime(body.expected_arrival_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date")
    if body.actual_arrival_date is not None:
        try:
            po.actual_arrival_date = datetime.strptime(body.actual_arrival_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date")

    po.updated_at = datetime.utcnow()
    items_r = await db.execute(select(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id))
    items = items_r.scalars().all()
    return await _serialize_po(po, items)


@router.put("/{po_id}/items")
async def update_po_items(po_id: int, items: List[POItemUpdate], db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po.status not in ("DRAFT", "APPROVED"):
        raise HTTPException(status_code=400, detail="Cannot modify items on this PO status")

    await db.execute(delete(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id))
    new_items = []
    for d in items:
        item = PurchaseOrderItem(
            purchase_order_id=po_id, product_uid=d.product_uid,
            sku=d.sku, barcode=d.barcode, product_name=d.product_name,
            variant_title=d.variant_title, product_image=d.product_image,
            quantity=d.quantity, unit_cost=d.unit_cost, received_qty=d.received_qty,
            priority=d.priority, item_type=d.item_type, notes=d.notes,
        )
        db.add(item)
        new_items.append(item)

    _update_totals(po, new_items)
    po.updated_at = datetime.utcnow()
    await db.flush()
    return await _serialize_po(po, new_items)


@router.put("/{po_id}/receive")
async def receive_po(po_id: int, items: List[ReceiveItem], db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po.status not in ("APPROVED", "PARTIALLY_RECEIVED"):
        raise HTTPException(status_code=400, detail="PO must be APPROVED or PARTIALLY_RECEIVED")

    for recv in items:
        await db.execute(
            update(PurchaseOrderItem)
            .where(PurchaseOrderItem.id == recv.item_id, PurchaseOrderItem.purchase_order_id == po_id)
            .values(received_qty=recv.received_qty)
        )

    # Check if all items fully received
    items_r = await db.execute(select(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id))
    all_items = items_r.scalars().all()
    all_received = all(i.received_qty >= i.quantity for i in all_items)
    any_received = any(i.received_qty > 0 for i in all_items)

    if all_received:
        po.status = "COMPLETED"
        po.completed_at = datetime.utcnow()
        po.actual_arrival_date = datetime.utcnow().date()
    elif any_received:
        po.status = "PARTIALLY_RECEIVED"

    po.updated_at = datetime.utcnow()
    return await _serialize_po(po, all_items)


@router.delete("/{po_id}")
async def delete_po(po_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po.status != "DRAFT":
        raise HTTPException(status_code=400, detail="Only DRAFT POs can be deleted")
    await db.execute(delete(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id))
    await db.execute(delete(PoSyncLog).where(PoSyncLog.purchase_order_id == po_id))
    await db.delete(po)
    return {"ok": True}


# ── Product Picker ────────────────────────────────────────────────────────

@router.get("/products/picker")
async def product_picker(
    search: Optional[str] = Query(None),
    limit: int = Query(100, le=300),
    db: AsyncSession = Depends(get_db),
):
    """Return active products for adding to a PO line item.
    Excludes Grandia store products (has its own PO engine).
    Exact SKU/barcode matches are prioritized first.
    """
    GRANDIA_STORE_UID = "n12w89-yy"

    query = select(Product).where(Product.state.in_(["active", None]))
    exact_match_uid = None

    if search:
        search_clean = search.strip()
        sl = f"%{search_clean.lower()}%"

        # Check for exact SKU or barcode match first
        exact_q = select(Product).where(
            Product.state.in_(["active", None]),
            (func.lower(Product.sku) == search_clean.lower()) |
            (Product.barcode == search_clean)
        )
        exact_r = await db.execute(exact_q)
        exact_product = exact_r.scalar_one_or_none()
        if exact_product:
            exact_match_uid = exact_product.uid

        query = query.where(
            (func.lower(Product.sku).like(sl)) |
            (func.lower(Product.title_1).like(sl)) |
            (func.lower(Product.barcode).like(sl))
        )

    query = query.order_by(Product.title_1).limit(limit + 50)
    result = await db.execute(query)
    products = result.scalars().all()

    # Filter out products that are ONLY on Grandia
    filtered = []
    for p in products:
        stores = p.store_uids or []
        if isinstance(stores, list) and len(stores) == 1 and GRANDIA_STORE_UID in stores:
            continue
        filtered.append(p)

    # Sort: exact match first, then alphabetical
    if exact_match_uid:
        filtered.sort(key=lambda p: (0 if p.uid == exact_match_uid else 1, p.title_1 or ""))

    products = filtered[:limit]

    # Load SKU costs
    skus = [p.sku for p in products if p.sku]
    costs_map = {}
    if skus:
        costs_r = await db.execute(select(SkuCost).where(SkuCost.sku.in_(skus)))
        costs_map = {c.sku: float(c.cost or 0) for c in costs_r.scalars().all()}

    # Load store names for display
    all_store_uids = set()
    for p in products:
        if p.store_uids and isinstance(p.store_uids, list):
            all_store_uids.update(uid for uid in p.store_uids if uid != GRANDIA_STORE_UID)
    store_names = {}
    if all_store_uids:
        stores_r = await db.execute(select(Store).where(Store.uid.in_(list(all_store_uids))))
        store_names = {s.uid: s.name for s in stores_r.scalars().all()}

    def _first_image(p):
        if p.images and isinstance(p.images, list) and len(p.images) > 0:
            img = p.images[0]
            return img.get("src") if isinstance(img, dict) else None
        return None

    return {
        "products": [{
            "uid": p.uid, "sku": p.sku or "", "barcode": p.barcode or "",
            "product_name": p.title_1 or "", "variant_title": p.title_2 or "",
            "image": _first_image(p),
            "stock_available": p.stock_available or 0,
            "unit_cost": costs_map.get(p.sku, 0.0),
            "hs_code": p.hs_code,
            "weight": p.weight,
            "external_identifier": p.external_identifier,
            "store_uids": [uid for uid in (p.store_uids or []) if uid != GRANDIA_STORE_UID],
            "store_names": [store_names.get(uid, uid) for uid in (p.store_uids or []) if uid != GRANDIA_STORE_UID and uid in store_names],
            "is_exact_match": p.uid == exact_match_uid if exact_match_uid else False,
        } for p in products],
        "exact_match_uid": exact_match_uid,
    }


# ── TOM Integration Endpoints ────────────────────────────────────────────

@router.post("/{po_id}/tom/send")
async def send_to_tom(po_id: int, db: AsyncSession = Depends(get_db)):
    """Send a Packaging PO to TOM API."""
    from app.services.tom_sync import send_po_to_tom
    result = await send_po_to_tom(po_id, db)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))
    return result


@router.post("/{po_id}/tom/refresh")
async def refresh_from_tom(po_id: int, db: AsyncSession = Depends(get_db)):
    """Poll TOM for status updates on a PO."""
    from app.services.tom_sync import refresh_po_from_tom
    result = await refresh_po_from_tom(po_id, db)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))
    return result


@router.post("/{po_id}/tom/amend")
async def amend_in_tom(po_id: int, db: AsyncSession = Depends(get_db)):
    """Send amendments to TOM for lines still in NEW status."""
    from app.services.tom_sync import amend_po_in_tom
    result = await amend_po_in_tom(po_id, db)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))
    return result


@router.post("/{po_id}/tom/cancel")
async def cancel_in_tom(po_id: int, body: TomCancelRequest, db: AsyncSession = Depends(get_db)):
    """Cancel a PO in TOM."""
    from app.services.tom_sync import cancel_po_in_tom
    result = await cancel_po_in_tom(po_id, body.reason, db)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))
    return result


# ── Incoming Stock Aggregation ────────────────────────────────────────────

@router.get("/incoming-stock")
async def get_incoming_stock(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PurchaseOrderItem.sku, func.sum(PurchaseOrderItem.quantity - PurchaseOrderItem.received_qty))
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
        .where(PurchaseOrder.status.in_(["APPROVED", "PARTIALLY_RECEIVED"]))
        .group_by(PurchaseOrderItem.sku)
    )
    incoming = {row[0]: max(0, int(row[1] or 0)) for row in result.all()}
    return {"incoming_stock": incoming}


# ── Barcode Endpoints (kept from original) ────────────────────────────────

def _ean13_check_digit(digits_12: str) -> str:
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(digits_12))
    return str((10 - (total % 10)) % 10)

def _generate_ean13(existing: set) -> str:
    for _ in range(1000):
        body = "200" + "".join(str(random.randint(0, 9)) for _ in range(9))
        barcode = body + _ean13_check_digit(body)
        if barcode not in existing:
            return barcode
    raise ValueError("Could not generate unique barcode")

@router.get("/barcodes/missing")
async def get_products_missing_barcodes(search: Optional[str] = Query(None), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Product).where(Product.state.in_(["active", None]), Product.exclude_from_stock == False))
    products = result.scalars().all()
    missing = []
    for p in products:
        if (p.barcode or "").strip():
            continue
        if search and search.lower() not in (p.sku or "").lower() and search.lower() not in (p.title_1 or "").lower():
            continue
        img = p.images[0].get("src") if p.images and isinstance(p.images, list) and p.images and isinstance(p.images[0], dict) else None
        missing.append({"uid": p.uid, "sku": p.sku or "", "product_name": p.title_1 or "", "image": img, "stock_available": p.stock_available or 0})
    return {"products": missing, "count": len(missing)}

class BarcodeGenerateRequest(BaseModel):
    skus: List[dict]

@router.post("/barcodes/generate")
async def generate_barcodes(body: BarcodeGenerateRequest, db: AsyncSession = Depends(get_db)):
    existing_p = await db.execute(select(Product.barcode).where(Product.barcode.isnot(None)))
    existing_g = await db.execute(select(GeneratedBarcode.barcode))
    existing_set = {r[0].strip() for r in existing_p.all() if r[0]} | {r[0].strip() for r in existing_g.all() if r[0]}
    results = []
    for entry in body.skus:
        sku = entry.get("sku", "")
        product_uid = entry.get("product_uid")
        barcode = _generate_ean13(existing_set)
        existing_set.add(barcode)
        db.add(GeneratedBarcode(barcode=barcode, sku=sku, product_uid=product_uid, assigned_at=datetime.utcnow()))
        if product_uid:
            await db.execute(update(Product).where(Product.uid == product_uid).values(barcode=barcode))
        results.append({"sku": sku, "product_uid": product_uid, "barcode": barcode})
    await db.flush()
    return {"generated": results, "count": len(results)}

@router.get("/barcodes/registry")
async def get_barcode_registry(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(GeneratedBarcode).order_by(GeneratedBarcode.created_at.desc()))
    return {"barcodes": [{"id": b.id, "barcode": b.barcode, "sku": b.sku, "product_uid": b.product_uid,
                          "assigned_at": b.assigned_at.isoformat() if b.assigned_at else None,
                          "created_at": b.created_at.isoformat() if b.created_at else None} for b in result.scalars().all()]}
