"""
Purchase Order Import — Fetch procurement data from Google Sheets and create POs.

Reads the "Comenzi Procurement Tom" spreadsheet, detects green-filled cells
(indicating confirmed/ordered items), and creates:
  - One APPROVED PO per sheet for green (confirmed) items
  - One DRAFT PO per sheet for non-green (pending) items

Sheets without a "SKU" column header are skipped.
"""
import logging
import httpx
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import PurchaseOrder, PurchaseOrderItem, PoSyncLog
from app.models.product import Product

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/purchase-orders-mgmt", tags=["purchase-orders-import"])

# ── Google Sheets config ──────────────────────────────────────────────────
SHEETS_API_KEY = "AIzaSyDDvgUOcNVk_ctBxbFhihvRcpyU3IDQzKw"
SPREADSHEET_ID = "10F_H-Qm-o6Vd-Qy2kh-t1LXEFlliKXjSF2O_GbDZigU"
SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

# Sheets to skip (no SKU column or calculation-only)
SKIP_SHEETS = {"26.01.2026 PO3 Etichete", "01.01.2026 PO1", "Calcule"}


def _is_green(bg: Optional[dict]) -> bool:
    """Detect green-filled cell from Google Sheets backgroundColor."""
    if not bg:
        return False
    r = bg.get("red", 0) or 0
    g = bg.get("green", 0) or 0
    g = bg.get("green", 0) or 0
    b = bg.get("blue", 0) or 0
    return g >= 0.8 and r <= 0.3 and b <= 0.3


import re
def _parse_sheet_date(title: str) -> datetime:
    """Extract dd.mm.yyyy from sheet title to use as creation date, fallback to utcnow."""
    match = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", title)
    if match:
        day, month, year = match.groups()
        try:
            return datetime(int(year), int(month), int(day))
        except ValueError:
            pass
    return datetime.utcnow()


def _parse_int(val: Optional[str]) -> int:
    """Parse a string to int, handling None/empty/float strings."""
    if not val:
        return 0
    try:
        return int(float(val.strip().replace(",", "")))
    except (ValueError, TypeError):
        return 0


def _find_col_index(header_values: list, *names: str) -> int:
    """Find column index by header name (case-insensitive). Returns -1 if not found."""
    for i, cell in enumerate(header_values):
        fv = (cell.get("formattedValue") or "").strip().lower()
        if fv in [n.lower() for n in names]:
            return i
    return -1


async def _fetch_sheet_data(sheet_title: str) -> dict:
    """Fetch a single sheet with grid data + cell colors from Google Sheets API."""
    import urllib.parse
    encoded_range = urllib.parse.quote(sheet_title)
    url = (
        f"{SHEETS_BASE}/{SPREADSHEET_ID}"
        f"?key={SHEETS_API_KEY}"
        f"&includeGridData=true"
        f"&ranges={encoded_range}"
        f"&fields=sheets(properties.title,data(rowData(values(formattedValue,effectiveFormat.backgroundColor))))"
    )
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.json()


async def _fetch_all_sheet_titles() -> list[str]:
    """Fetch all sheet tab titles from the spreadsheet."""
    url = (
        f"{SHEETS_BASE}/{SPREADSHEET_ID}"
        f"?key={SHEETS_API_KEY}"
        f"&fields=sheets.properties.title"
    )
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
        return [s["properties"]["title"] for s in data.get("sheets", [])]


def _parse_sheet(sheet_data: dict) -> tuple[list[dict], list[dict]]:
    """
    Parse a single sheet into two lists: confirmed (green) items and draft items.
    
    Returns:
        (confirmed_items, draft_items) — each item is a dict with:
            sku, quantity, category, barcode, image_url, product_url
    """
    rows = sheet_data.get("data", [{}])[0].get("rowData", [])
    if not rows:
        return [], []
    
    # Parse header row (row 0)
    header_cells = rows[0].get("values", [])
    
    sku_col = _find_col_index(header_cells, "SKU", "sku")
    if sku_col < 0:
        return [], []  # No SKU column → skip this sheet
    
    qty_col = _find_col_index(header_cells, "Quantity", "Cantitate")
    order_col = _find_col_index(header_cells, "order", "ordered")
    barcode_col = _find_col_index(header_cells, "Barcode")
    image_col = _find_col_index(header_cells, "Image")
    url_col = _find_col_index(header_cells, "URL")
    category_col = _find_col_index(header_cells, "Category")
    
    has_order_col = order_col >= 0
    
    confirmed = []
    drafts = []
    
    # Process data rows (skip header)
    for row in rows[1:]:
        cells = row.get("values", [])
        if not cells:
            continue
        
        # Extract SKU
        sku_cell = cells[sku_col] if sku_col < len(cells) else {}
        sku = (sku_cell.get("formattedValue") or "").strip()
        if not sku:
            continue
        
        # Extract category
        cat_cell = cells[category_col] if category_col >= 0 and category_col < len(cells) else {}
        category = (cat_cell.get("formattedValue") or "").strip()
        
        # Extract barcode
        bc_cell = cells[barcode_col] if barcode_col >= 0 and barcode_col < len(cells) else {}
        barcode = (bc_cell.get("formattedValue") or "").strip()
        
        # Extract image URL
        img_cell = cells[image_col] if image_col >= 0 and image_col < len(cells) else {}
        image_url = (img_cell.get("formattedValue") or "").strip()
        
        # Extract product URL
        url_cell = cells[url_col] if url_col >= 0 and url_col < len(cells) else {}
        product_url = (url_cell.get("formattedValue") or "").strip()
        
        # Determine quantity and green status
        if has_order_col:
            # Sheets with "order" column: green on order col determines confirmed
            order_cell = cells[order_col] if order_col < len(cells) else {}
            order_val = (order_cell.get("formattedValue") or "").strip()
            order_bg = (order_cell.get("effectiveFormat", {}).get("backgroundColor"))
            
            qty_cell = cells[qty_col] if qty_col >= 0 and qty_col < len(cells) else {}
            qty_val = (qty_cell.get("formattedValue") or "").strip()
            
            if order_val:
                quantity = _parse_int(order_val)
                is_confirmed = _is_green(order_bg)
            elif qty_val:
                quantity = _parse_int(qty_val)
                is_confirmed = False  # No order value → draft
            else:
                continue  # No quantity at all → skip
        else:
            # Sheets without "order" column: green on Quantity col
            qty_cell = cells[qty_col] if qty_col >= 0 and qty_col < len(cells) else {}
            qty_val = (qty_cell.get("formattedValue") or "").strip()
            qty_bg = (qty_cell.get("effectiveFormat", {}).get("backgroundColor"))
            
            if not qty_val:
                continue
            
            quantity = _parse_int(qty_val)
            is_confirmed = _is_green(qty_bg)
        
        if quantity <= 0:
            continue
        
        item = {
            "sku": sku,
            "quantity": quantity,
            "category": category,
            "barcode": barcode,
            "image_url": image_url,
            "product_url": product_url,
        }
        
        if is_confirmed:
            confirmed.append(item)
        else:
            drafts.append(item)
    
    return confirmed, drafts


async def _next_po_number(db: AsyncSession) -> str:
    """Generate the next PO number."""
    result = await db.execute(select(func.count(PurchaseOrder.id)))
    count = result.scalar() or 0
    return f"PO-{count + 1:04d}"


@router.post("/import-from-sheets")
async def import_from_sheets(db: AsyncSession = Depends(get_db)):
    """
    Import Purchase Orders from Google Sheets procurement document.
    
    1. Deletes ALL existing POs (they are test data)
    2. Fetches each eligible sheet tab
    3. Creates one APPROVED PO per sheet (green/confirmed items)
    4. Creates one DRAFT PO per sheet (non-green/pending items)
    """
    # ── Phase 1: Delete all existing POs ──
    await db.execute(delete(PurchaseOrderItem))
    await db.execute(delete(PoSyncLog))
    await db.execute(delete(PurchaseOrder))
    await db.flush()
    logger.info("🗑️ Deleted all existing POs")
    
    # ── Phase 2: Fetch sheet titles ──
    all_titles = await _fetch_all_sheet_titles()
    eligible = [t for t in all_titles if t not in SKIP_SHEETS]
    logger.info(f"📋 Found {len(eligible)} eligible sheets: {eligible}")
    
    # ── Phase 2.5: Build Product SKU mapping ──
    result = await db.execute(select(Product))
    products = result.scalars().all()
    product_map = {p.sku: p for p in products if p.sku}
    logger.info(f"🔍 Loaded {len(product_map)} products from DB for SKU matching")
    
    created_pos = []
    total_confirmed = 0
    
    all_drafts = []  # Aggregate all drafts across sheets
    
    # ── Phase 3: Process each sheet ──
    for sheet_title in eligible:
        try:
            raw = await _fetch_sheet_data(sheet_title)
            sheet = raw.get("sheets", [{}])[0]
            confirmed_items, draft_items = _parse_sheet(sheet)
            
            logger.info(
                f"📊 Sheet '{sheet_title}': "
                f"{len(confirmed_items)} confirmed, {len(draft_items)} draft"
            )
            
            # Create APPROVED PO for confirmed items
            if confirmed_items:
                po_date = _parse_sheet_date(sheet_title)
                po_num = await _next_po_number(db)
                po = PurchaseOrder(
                    po_number=po_num,
                    title=f"{sheet_title} — Ordered",
                    po_category="packaging",
                    po_type="RESTOCK",
                    priority="STANDARD",
                    status="APPROVED",
                    created_at=po_date,
                    approved_at=po_date,
                    notes=f"Auto-imported from Google Sheets: {sheet_title} (confirmed/green items)",
                    created_by="sheets-import",
                )
                db.add(po)
                await db.flush()
                
                items = []
                for d in confirmed_items:
                    db_prod = product_map.get(d["sku"])
                    
                    if db_prod:
                        p_uid = db_prod.uid
                        p_name = db_prod.title_1 or d["category"]
                        v_title = db_prod.title_2
                        bcode = db_prod.barcode or d["barcode"]
                        img_url = d["image_url"]
                        if not img_url and db_prod.images and isinstance(db_prod.images, list) and len(db_prod.images) > 0:
                            img_url = db_prod.images[0].get("src")
                        is_new = False
                    else:
                        p_uid = None
                        p_name = d["category"]
                        v_title = None
                        bcode = d["barcode"]
                        img_url = d["image_url"]
                        is_new = True
                
                    item = PurchaseOrderItem(
                        purchase_order_id=po.id,
                        product_uid=p_uid,
                        sku=d["sku"],
                        barcode=bcode or None,
                        product_name=p_name,
                        variant_title=v_title,
                        product_image=img_url or None,
                        quantity=d["quantity"],
                        unit_cost=0.0,
                        is_new_product=is_new,
                        notes=d["product_url"] or None,
                    )
                    db.add(item)
                    items.append(item)
                
                po.total_items = len(items)
                po.total_quantity = sum(i.quantity for i in items)
                po.total_cost = 0.0
                await db.flush()
                
                total_confirmed += len(items)
                created_pos.append({
                    "po_number": po_num,
                    "title": po.title,
                    "status": "APPROVED",
                    "items": len(items),
                    "total_qty": po.total_quantity,
                })
            
            # Aggregate draft items instead of making a PO per sheet
            if draft_items:
                all_drafts.extend(draft_items)
        
        except Exception as e:
            logger.error(f"❌ Failed to process sheet '{sheet_title}': {e}")
            import traceback
            traceback.print_exc()
            created_pos.append({
                "sheet": sheet_title,
                "error": str(e),
            })
    
    # ── Phase 4: Create single Master DRAFT PO ──
    if all_drafts:
        po_num = await _next_po_number(db)
        po = PurchaseOrder(
            po_number=po_num,
            title="Toate Drafturile (Neselctate)",
            po_category="packaging",
            po_type="RESTOCK",
            priority="STANDARD",
            status="DRAFT",
            notes="Auto-imported from Google Sheets: Aggregated pending items across all sheets",
            created_by="sheets-import",
        )
        db.add(po)
        await db.flush()
        
        items = []
        for d in all_drafts:
            db_prod = product_map.get(d["sku"])
            
            if db_prod:
                p_uid = db_prod.uid
                p_name = db_prod.title_1 or d["category"]
                v_title = db_prod.title_2
                bcode = db_prod.barcode or d["barcode"]
                img_url = d["image_url"]
                if not img_url and db_prod.images and isinstance(db_prod.images, list) and len(db_prod.images) > 0:
                    img_url = db_prod.images[0].get("src")
                is_new = False
            else:
                p_uid = None
                p_name = d["category"]
                v_title = None
                bcode = d["barcode"]
                img_url = d["image_url"]
                is_new = True
        
            item = PurchaseOrderItem(
                purchase_order_id=po.id,
                product_uid=p_uid,
                sku=d["sku"],
                barcode=bcode or None,
                product_name=p_name,
                variant_title=v_title,
                product_image=img_url or None,
                quantity=d["quantity"],
                unit_cost=0.0,
                is_new_product=is_new,
                notes=d["product_url"] or None,
            )
            db.add(item)
            items.append(item)
        
        po.total_items = len(items)
        po.total_quantity = sum(i.quantity for i in items)
        po.total_cost = 0.0
        await db.flush()
        
        created_pos.append({
            "po_number": po_num,
            "title": po.title,
            "status": "DRAFT",
            "items": len(items),
            "total_qty": po.total_quantity,
        })
    
    await db.commit()
    
    return {
        "message": f"Import complete. Created {len(created_pos)} POs.",
        "total_confirmed_items": total_confirmed,
        "total_draft_items": len(all_drafts),
        "purchase_orders": created_pos,
    }
