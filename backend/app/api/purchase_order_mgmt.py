"""
Purchase Order Management — CRUD endpoints for creating and managing purchase orders.

Also includes barcode generation endpoints for EAN-13 barcodes.
"""
import logging
import random
from collections import defaultdict
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import PurchaseOrder, PurchaseOrderItem, GeneratedBarcode, SkuCost
from app.models.product import Product

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/purchase-orders-mgmt", tags=["purchase-orders-management"])


# ── Pydantic schemas ──────────────────────────────────────────────────────

class POItemCreate(BaseModel):
    sku: str
    barcode: Optional[str] = None
    product_name: Optional[str] = None
    product_image: Optional[str] = None
    quantity: int = 0
    unit_cost: float = 0.0
    is_new_product: bool = False
    notes: Optional[str] = None


class POCreate(BaseModel):
    supplier_name: Optional[str] = None
    container_ref: Optional[str] = None
    expected_arrival_date: Optional[str] = None  # "YYYY-MM-DD"
    notes: Optional[str] = None
    items: List[POItemCreate] = []


class POUpdate(BaseModel):
    status: Optional[str] = None
    supplier_name: Optional[str] = None
    container_ref: Optional[str] = None
    expected_arrival_date: Optional[str] = None
    actual_arrival_date: Optional[str] = None
    notes: Optional[str] = None


class POItemUpdate(BaseModel):
    id: Optional[int] = None  # None = new item
    sku: str
    barcode: Optional[str] = None
    product_name: Optional[str] = None
    product_image: Optional[str] = None
    quantity: int = 0
    unit_cost: float = 0.0
    is_new_product: bool = False
    received_qty: int = 0
    notes: Optional[str] = None


class ReceiveItem(BaseModel):
    item_id: int
    received_qty: int


# ── Helpers ───────────────────────────────────────────────────────────────

async def _generate_po_number(db: AsyncSession) -> str:
    """Generate next PO number: PO-YYYY-NNNN."""
    year = datetime.utcnow().year
    prefix = f"PO-{year}-"
    result = await db.execute(
        select(func.count(PurchaseOrder.id))
        .where(PurchaseOrder.po_number.like(f"{prefix}%"))
    )
    count = result.scalar() or 0
    return f"{prefix}{count + 1:04d}"


def _compute_totals(items: list) -> dict:
    """Compute total_items, total_quantity, total_cost from item list."""
    total_items = len(items)
    total_quantity = sum(i.quantity for i in items)
    total_cost = sum(i.quantity * i.unit_cost for i in items)
    return {
        "total_items": total_items,
        "total_quantity": total_quantity,
        "total_cost": round(total_cost, 2),
    }


async def _serialize_po(po: PurchaseOrder, items: list) -> dict:
    """Serialize PO + items to response dict."""
    return {
        "id": po.id,
        "po_number": po.po_number,
        "status": po.status,
        "supplier_name": po.supplier_name,
        "container_ref": po.container_ref,
        "expected_arrival_date": po.expected_arrival_date.isoformat() if po.expected_arrival_date else None,
        "actual_arrival_date": po.actual_arrival_date.isoformat() if po.actual_arrival_date else None,
        "notes": po.notes,
        "total_items": po.total_items,
        "total_quantity": po.total_quantity,
        "total_cost": po.total_cost,
        "created_at": po.created_at.isoformat() if po.created_at else None,
        "updated_at": po.updated_at.isoformat() if po.updated_at else None,
        "items": [
            {
                "id": item.id,
                "sku": item.sku,
                "barcode": item.barcode,
                "product_name": item.product_name,
                "product_image": item.product_image,
                "quantity": item.quantity,
                "unit_cost": item.unit_cost,
                "received_qty": item.received_qty,
                "is_new_product": item.is_new_product,
                "notes": item.notes,
                "line_cost": round(item.quantity * item.unit_cost, 2),
            }
            for item in items
        ],
    }


# ── CRUD Endpoints ────────────────────────────────────────────────────────

@router.get("/list")
async def list_purchase_orders(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List all purchase orders with summary info."""
    query = select(PurchaseOrder).order_by(PurchaseOrder.created_at.desc())

    if status:
        query = query.where(PurchaseOrder.status == status)

    result = await db.execute(query)
    orders = result.scalars().all()

    # Load item counts per PO
    items_result = await db.execute(
        select(
            PurchaseOrderItem.purchase_order_id,
            func.count(PurchaseOrderItem.id),
            func.sum(PurchaseOrderItem.quantity),
            func.sum(PurchaseOrderItem.received_qty),
        )
        .group_by(PurchaseOrderItem.purchase_order_id)
    )
    items_map = {}
    for row in items_result.all():
        items_map[row[0]] = {
            "item_count": row[1],
            "total_qty": int(row[2] or 0),
            "received_qty": int(row[3] or 0),
        }

    po_list = []
    for po in orders:
        item_info = items_map.get(po.id, {"item_count": 0, "total_qty": 0, "received_qty": 0})

        if search:
            search_lower = search.lower()
            if not (
                search_lower in (po.po_number or "").lower()
                or search_lower in (po.supplier_name or "").lower()
                or search_lower in (po.container_ref or "").lower()
            ):
                continue

        po_list.append({
            "id": po.id,
            "po_number": po.po_number,
            "status": po.status,
            "supplier_name": po.supplier_name,
            "container_ref": po.container_ref,
            "expected_arrival_date": po.expected_arrival_date.isoformat() if po.expected_arrival_date else None,
            "actual_arrival_date": po.actual_arrival_date.isoformat() if po.actual_arrival_date else None,
            "total_items": item_info["item_count"],
            "total_quantity": item_info["total_qty"],
            "received_quantity": item_info["received_qty"],
            "total_cost": po.total_cost,
            "notes": po.notes,
            "created_at": po.created_at.isoformat() if po.created_at else None,
        })

    return {"orders": po_list, "total": len(po_list)}


@router.get("/{po_id}")
async def get_purchase_order(po_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single purchase order with all items."""
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    items_result = await db.execute(
        select(PurchaseOrderItem)
        .where(PurchaseOrderItem.purchase_order_id == po_id)
        .order_by(PurchaseOrderItem.id)
    )
    items = items_result.scalars().all()

    return await _serialize_po(po, items)


@router.post("/create")
async def create_purchase_order(body: POCreate, db: AsyncSession = Depends(get_db)):
    """Create a new purchase order with items."""
    po_number = await _generate_po_number(db)

    expected_date = None
    if body.expected_arrival_date:
        try:
            expected_date = datetime.strptime(body.expected_arrival_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    po = PurchaseOrder(
        po_number=po_number,
        status="draft",
        supplier_name=body.supplier_name,
        container_ref=body.container_ref,
        expected_arrival_date=expected_date,
        notes=body.notes,
    )
    db.add(po)
    await db.flush()  # Get the ID

    # Create items
    items = []
    for item_data in body.items:
        item = PurchaseOrderItem(
            purchase_order_id=po.id,
            sku=item_data.sku,
            barcode=item_data.barcode,
            product_name=item_data.product_name,
            product_image=item_data.product_image,
            quantity=item_data.quantity,
            unit_cost=item_data.unit_cost,
            is_new_product=item_data.is_new_product,
            notes=item_data.notes,
        )
        db.add(item)
        items.append(item)

    # Compute and set totals
    po.total_items = len(items)
    po.total_quantity = sum(i.quantity for i in items)
    po.total_cost = round(sum(i.quantity * i.unit_cost for i in items), 2)

    await db.flush()
    return await _serialize_po(po, items)


@router.put("/{po_id}")
async def update_purchase_order(po_id: int, body: POUpdate, db: AsyncSession = Depends(get_db)):
    """Update PO metadata (status, dates, notes)."""
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    if body.status is not None:
        valid_transitions = {
            "draft": ["confirmed", "cancelled"],
            "confirmed": ["in_transit", "cancelled"],
            "in_transit": ["received", "cancelled"],
            "received": [],
            "cancelled": ["draft"],
        }
        if body.status not in valid_transitions.get(po.status, []):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition from '{po.status}' to '{body.status}'"
            )
        po.status = body.status

    if body.supplier_name is not None:
        po.supplier_name = body.supplier_name
    if body.container_ref is not None:
        po.container_ref = body.container_ref
    if body.notes is not None:
        po.notes = body.notes
    if body.expected_arrival_date is not None:
        try:
            po.expected_arrival_date = datetime.strptime(body.expected_arrival_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
    if body.actual_arrival_date is not None:
        try:
            po.actual_arrival_date = datetime.strptime(body.actual_arrival_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")

    po.updated_at = datetime.utcnow()

    items_result = await db.execute(
        select(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id)
    )
    items = items_result.scalars().all()
    return await _serialize_po(po, items)


@router.put("/{po_id}/items")
async def update_po_items(po_id: int, items: List[POItemUpdate], db: AsyncSession = Depends(get_db)):
    """Replace all items on a PO. Pass full item list."""
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.status not in ("draft", "confirmed"):
        raise HTTPException(status_code=400, detail="Cannot modify items on a received/cancelled PO")

    # Delete existing items
    await db.execute(delete(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id))

    # Create new items
    new_items = []
    for item_data in items:
        item = PurchaseOrderItem(
            purchase_order_id=po_id,
            sku=item_data.sku,
            barcode=item_data.barcode,
            product_name=item_data.product_name,
            product_image=item_data.product_image,
            quantity=item_data.quantity,
            unit_cost=item_data.unit_cost,
            is_new_product=item_data.is_new_product,
            received_qty=item_data.received_qty,
            notes=item_data.notes,
        )
        db.add(item)
        new_items.append(item)

    # Recalculate totals
    po.total_items = len(new_items)
    po.total_quantity = sum(i.quantity for i in new_items)
    po.total_cost = round(sum(i.quantity * i.unit_cost for i in new_items), 2)
    po.updated_at = datetime.utcnow()

    await db.flush()
    return await _serialize_po(po, new_items)


@router.put("/{po_id}/receive")
async def receive_purchase_order(
    po_id: int,
    items: List[ReceiveItem],
    db: AsyncSession = Depends(get_db),
):
    """Mark PO items as received with actual quantities."""
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.status not in ("confirmed", "in_transit"):
        raise HTTPException(status_code=400, detail="PO must be confirmed or in transit to receive")

    # Update each item's received_qty
    for recv in items:
        await db.execute(
            update(PurchaseOrderItem)
            .where(PurchaseOrderItem.id == recv.item_id, PurchaseOrderItem.purchase_order_id == po_id)
            .values(received_qty=recv.received_qty)
        )

    po.status = "received"
    po.actual_arrival_date = datetime.utcnow().date()
    po.updated_at = datetime.utcnow()

    items_result = await db.execute(
        select(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id)
    )
    all_items = items_result.scalars().all()
    return await _serialize_po(po, all_items)


@router.delete("/{po_id}")
async def delete_purchase_order(po_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a purchase order (only drafts)."""
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft POs can be deleted")

    await db.execute(delete(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id))
    await db.delete(po)
    return {"ok": True}


# ── Incoming Stock Aggregation ────────────────────────────────────────────

@router.get("/incoming-stock")
async def get_incoming_stock(db: AsyncSession = Depends(get_db)):
    """
    Return aggregated incoming quantities per SKU from all active POs.
    Active = confirmed or in_transit.
    """
    result = await db.execute(
        select(
            PurchaseOrderItem.sku,
            func.sum(PurchaseOrderItem.quantity - PurchaseOrderItem.received_qty),
        )
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
        .where(PurchaseOrder.status.in_(["confirmed", "in_transit"]))
        .group_by(PurchaseOrderItem.sku)
    )
    incoming = {row[0]: max(0, int(row[1] or 0)) for row in result.all()}
    return {"incoming_stock": incoming}


# ── Barcode Endpoints ─────────────────────────────────────────────────────

def _ean13_check_digit(digits_12: str) -> str:
    """Calculate EAN-13 check digit for a 12-digit string."""
    total = 0
    for i, d in enumerate(digits_12):
        total += int(d) * (1 if i % 2 == 0 else 3)
    check = (10 - (total % 10)) % 10
    return str(check)


def _generate_ean13(existing: set) -> str:
    """Generate a unique EAN-13 barcode with prefix 200 (internal use)."""
    for _ in range(1000):
        # 200 prefix + 9 random digits + 1 check digit = 13 digits
        body = "200" + "".join(str(random.randint(0, 9)) for _ in range(9))
        check = _ean13_check_digit(body)
        barcode = body + check
        if barcode not in existing:
            return barcode
    raise ValueError("Could not generate unique barcode after 1000 attempts")


@router.get("/barcodes/missing")
async def get_products_missing_barcodes(
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List all active products that don't have a barcode."""
    query = select(Product).where(
        Product.state.in_(["active", None]),
        Product.exclude_from_stock == False,
    )
    result = await db.execute(query)
    products = result.scalars().all()

    missing = []
    for p in products:
        bc = (p.barcode or "").strip()
        if bc:
            continue
        if search:
            search_lower = search.lower()
            if not (
                search_lower in (p.sku or "").lower()
                or search_lower in (p.title_1 or "").lower()
            ):
                continue
        img = None
        if p.images and isinstance(p.images, list) and len(p.images) > 0:
            img = p.images[0].get("src") if isinstance(p.images[0], dict) else None

        missing.append({
            "uid": p.uid,
            "sku": p.sku or "",
            "product_name": p.title_1 or "",
            "image": img,
            "stock_available": p.stock_available or 0,
        })

    return {"products": missing, "count": len(missing)}


class BarcodeGenerateRequest(BaseModel):
    skus: List[dict]  # [{"sku": "...", "product_uid": "..."}]


@router.post("/barcodes/generate")
async def generate_barcodes(body: BarcodeGenerateRequest, db: AsyncSession = Depends(get_db)):
    """Generate unique EAN-13 barcodes for the given SKUs."""
    # Gather all existing barcodes
    existing_products = await db.execute(select(Product.barcode).where(Product.barcode.isnot(None)))
    existing_generated = await db.execute(select(GeneratedBarcode.barcode))
    existing_set = set()
    for row in existing_products.all():
        if row[0]:
            existing_set.add(row[0].strip())
    for row in existing_generated.all():
        if row[0]:
            existing_set.add(row[0].strip())

    results = []
    for entry in body.skus:
        sku = entry.get("sku", "")
        product_uid = entry.get("product_uid")

        barcode = _generate_ean13(existing_set)
        existing_set.add(barcode)

        # Save to registry
        gb = GeneratedBarcode(
            barcode=barcode,
            sku=sku,
            product_uid=product_uid,
            assigned_at=datetime.utcnow(),
        )
        db.add(gb)

        # Update the product record if we have the UID
        if product_uid:
            await db.execute(
                update(Product)
                .where(Product.uid == product_uid)
                .values(barcode=barcode)
            )

        results.append({
            "sku": sku,
            "product_uid": product_uid,
            "barcode": barcode,
        })

    await db.flush()
    return {"generated": results, "count": len(results)}


@router.get("/barcodes/registry")
async def get_barcode_registry(db: AsyncSession = Depends(get_db)):
    """List all generated barcodes."""
    result = await db.execute(select(GeneratedBarcode).order_by(GeneratedBarcode.created_at.desc()))
    barcodes = result.scalars().all()
    return {
        "barcodes": [
            {
                "id": b.id,
                "barcode": b.barcode,
                "sku": b.sku,
                "product_uid": b.product_uid,
                "assigned_at": b.assigned_at.isoformat() if b.assigned_at else None,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in barcodes
        ],
        "total": len(barcodes),
    }
