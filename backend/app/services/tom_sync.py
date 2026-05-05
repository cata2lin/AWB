"""
TOM PO Sync — send / refresh / amend / cancel purchase orders against TOM API.

Mirrors the Grandia tom-sync.ts pattern but adapted for Python/SQLAlchemy.

Key behaviours:
- Idempotency key is generated and persisted BEFORE the HTTP call (spec §6).
- On 201 or 409, persist tom_number, tom_po_id, tom_status, tom_sent_at.
- Every attempt (success or failure) writes a PoSyncLog row.
- Only categories with tom_enabled=true (configured in Settings) can be sent to TOM.
"""
import logging
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.purchase_order import PurchaseOrder
from app.models.purchase_order_item import PurchaseOrderItem
from app.models.po_sync_log import PoSyncLog
from app.services.tom_client import tom_fetch, is_tom_configured, _cfg

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────

def _pick(obj: dict, key: str, fallback=None):
    """Safely pick a value from a possibly nested dict."""
    if obj and isinstance(obj, dict):
        return obj.get(key, fallback)
    return fallback


def _extract_tom_ids(body: dict) -> dict:
    """Extract tom_number and tom_po_id from create/409 response."""
    if not body or not isinstance(body, dict):
        return {}
    err = body.get("error", {}) if isinstance(body.get("error"), dict) else {}
    return {
        "tom_number": body.get("tom_number") or err.get("tom_number"),
        "tom_po_id": body.get("tom_po_id") or err.get("tom_po_id"),
        "tom_status": body.get("status"),
    }


def _extract_error(body: dict) -> dict:
    """Extract error code and message from TOM error response."""
    if not body or not isinstance(body, dict):
        return {}
    err = body.get("error", {})
    if isinstance(err, dict):
        return {"code": err.get("code"), "message": err.get("message")}
    return {}


async def _is_tom_enabled_category(category: str, db: AsyncSession) -> bool:
    """Check if a PO category has TOM sync enabled (reads from system_settings)."""
    try:
        from app.api.settings import get_po_categories
        categories = await get_po_categories(db)
        for cat in categories:
            if cat.get("key") == category:
                return cat.get("tom_enabled", False)
        # Category not found in settings — deny by default
        return False
    except Exception:
        # Fallback: if settings aren't available, allow legacy 'packaging' category
        return category == "packaging"


# ── Build Payload ────────────────────────────────────────────────────────

GRANDIA_STORE_UID = "n12w89-yy"

def _enrich_po_item(item, po, products_map, sku_map, catalog_prices, store_map, usd_rate=1.0):
    # Resolve the full Product record
    prod = products_map.get(item.product_uid) or sku_map.get(item.sku)

    # Extract first image URL
    image_url = item.product_image or ""
    if not image_url and prod and prod.images and isinstance(prod.images, list) and len(prod.images) > 0:
        img = prod.images[0]
        image_url = img.get("src", "") if isinstance(img, dict) else ""

    # Build the enriched line item
    line = {
        "source_line_id": item.sku,
        "sku": item.sku,
        "title": item.product_name or (prod.title_1 if prod else item.sku),
        "image_url": image_url,
        "requested_qty": item.quantity,
    }

    # Variant fields - Prioritize persistent DB tom_variants
    variant_1 = getattr(prod, 'tom_variant_1', None) or item.variant_title or getattr(prod, 'title_2', None)
    if variant_1:
        line["variant_1"] = variant_1

    variant_2 = getattr(prod, 'tom_variant_2', None)
    if variant_2:
        line["variant_2"] = variant_2

    # Barcode
    barcode = item.barcode or (prod.barcode if prod else None)
    if barcode:
        line["barcode"] = barcode

    # Catalog price (convert RON to USD if it's in RON; assuming catalog_prices are in RON)
    cat_price = catalog_prices.get(item.sku, 0)
    if cat_price and cat_price > 0:
        line["cogs_usd"] = round(cat_price / usd_rate, 4) if usd_rate else round(cat_price, 4)

    # Unit cost
    if item.unit_cost and item.unit_cost > 0:
        # Convert RON to USD! TOM expects USD
        line["unit_cost"] = round(item.unit_cost / usd_rate, 4) if usd_rate else round(item.unit_cost, 4)

    # HS Code
    if prod and getattr(prod, 'hs_code', None):
        line["hs_code"] = prod.hs_code

    # Weight
    if prod and getattr(prod, 'weight', None):
        line["weight_grams"] = prod.weight

    # Shopify identifiers
    if prod and getattr(prod, 'external_identifier', None):
        line["shopify_product_id"] = prod.external_identifier

    # Product type from store context
    non_grandia_stores = []
    if prod and hasattr(prod, 'store_uids') and isinstance(prod.store_uids, list):
        for uid in prod.store_uids:
            if uid != GRANDIA_STORE_UID and uid in store_map:
                non_grandia_stores.append(store_map[uid].name)
    if non_grandia_stores:
        line["store_names"] = non_grandia_stores

    # Line-level priority and type
    if item.priority:
        line["priority"] = item.priority
    elif po and getattr(po, 'priority', None):
        line["priority"] = po.priority
        
    if item.item_type:
        line["type"] = item.item_type
    if item.notes:
        line["notes"] = item.notes

    return line

async def _get_enrichment_context(items: list, db: AsyncSession):
    from app.models.product import Product
    from app.models.custom_product import CustomProduct
    from app.models.store import Store
    from app.models import SkuCost
    
    product_uids = [i.product_uid for i in items if i.product_uid]
    product_skus = [i.sku for i in items if i.sku]
    products_map = {}
    sku_map = {}

    if product_uids:
        r = await db.execute(select(Product).where(Product.uid.in_(product_uids)))
        for p in r.scalars().all():
            products_map[p.uid] = p
            if p.sku:
                sku_map[p.sku] = p

    missing_skus = [s for s in product_skus if s not in sku_map]
    if missing_skus:
        r = await db.execute(select(Product).where(Product.sku.in_(missing_skus)))
        for p in r.scalars().all():
            sku_map[p.sku] = p
            if p.uid:
                products_map[p.uid] = p
                
    still_missing_skus = [s for s in product_skus if s not in sku_map]
    if still_missing_skus:
        r = await db.execute(select(CustomProduct).where(CustomProduct.sku.in_(still_missing_skus)))
        for cp in r.scalars().all():
            sku_map[cp.sku] = cp

    all_skus = list({i.sku for i in items if i.sku})
    catalog_prices = {}
    if all_skus:
        r = await db.execute(select(SkuCost).where(SkuCost.sku.in_(all_skus)))
        catalog_prices = {c.sku: float(c.cost or 0) for c in r.scalars().all()}

    all_store_uids = set()
    for p in products_map.values():
        if p.store_uids and isinstance(p.store_uids, list):
            all_store_uids.update(uid for uid in p.store_uids if uid != GRANDIA_STORE_UID)
    store_map = {}
    if all_store_uids:
        r = await db.execute(select(Store).where(Store.uid.in_(list(all_store_uids))))
        store_map = {s.uid: s for s in r.scalars().all()}
        
    return products_map, sku_map, catalog_prices, store_map

async def _build_create_payload(po: PurchaseOrder, items: list, db: AsyncSession) -> dict:
    from app.api.exchange_rates import get_rate
    target_date = po.created_at.date() if po.created_at else datetime.utcnow().date()
    usd_rate = await get_rate("USD", target_date, db) or 1.0

    products_map, sku_map, catalog_prices, store_map = await _get_enrichment_context(items, db)

    items_payload = []
    for item in items:
        line = _enrich_po_item(item, po, products_map, sku_map, catalog_prices, store_map, usd_rate)
        items_payload.append(line)

    payload = {
        "source_app": _cfg().tom_source_code or "VIGO",
        "source_po_id": po.po_number,
        "number": po.po_number,
        "date": datetime.utcnow().strftime("%Y-%m-%d"),
        "priority": po.priority or "STANDARD",
        "type": po.po_type or "RESTOCK",
        "items": items_payload,
    }
    if po.title:
        payload["title"] = po.title
    if po.notes:
        payload["notes"] = po.notes
    if po.created_by:
        payload["requester_user_name"] = po.created_by

    return payload


# ── Send to TOM (POST /api/v1/po) ───────────────────────────────────────

async def send_po_to_tom(po_id: int, db: AsyncSession) -> dict:
    """
    Send a PO to TOM. Only works for Packaging POs in APPROVED status.

    Returns: {"ok": bool, "status": int, "tom_number": str, ...} or error dict.
    """
    if not is_tom_configured():
        return {"ok": False, "status": 0, "error": "TOM is not configured on this server."}

    # Load PO with items
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po_id)
    )
    po = result.scalar_one_or_none()
    if not po:
        return {"ok": False, "status": 0, "error": "PO not found."}

    # Load items into a local list — do NOT assign to po.items (SQLAlchemy relationship)
    items_result = await db.execute(
        select(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id)
    )
    po_items = items_result.scalars().all()

    # Check if category allows TOM sync (dynamic from settings)
    tom_allowed = await _is_tom_enabled_category(po.po_category, db)
    if not tom_allowed:
        return {"ok": False, "status": 0, "error": f"Category '{po.po_category}' does not have TOM sync enabled. Enable it in Settings → PO Categories."}
    if not po_items:
        return {"ok": False, "status": 0, "error": "PO has no items."}

    # Note: image_url is optional per TOM spec — sent as null if missing.
    missing_images = [i.product_name or i.sku for i in po_items if not (i.product_image or "").strip()]
    if missing_images:
        logger.warning(f"PO {po.po_number}: {len(missing_images)} item(s) missing images — will send null to TOM")

    # Persist idempotency key BEFORE the HTTP call (spec §6)
    if not po.tom_send_idempotency_key:
        po.tom_send_idempotency_key = str(uuid.uuid4())
        await db.flush()

    payload = await _build_create_payload(po, po_items, db)
    path = "/api/v1/po"
    source_code = _cfg().tom_source_code or "VIGO"

    http_status = 0
    response_body = {}
    network_error = None

    try:
        res = await tom_fetch("POST", path, payload, po.tom_send_idempotency_key)
        http_status = res["status"]
        response_body = res["body"]
    except Exception as e:
        network_error = str(e)

    created = http_status == 201
    already_existed = http_status == 409
    success = created or already_existed

    ids = _extract_tom_ids(response_body)
    err = _extract_error(response_body)

    if success and ids.get("tom_number") and ids.get("tom_po_id"):
        po.tom_number = ids["tom_number"]
        po.tom_po_id = ids["tom_po_id"]
        po.tom_status = ids.get("tom_status")
        po.tom_sent_at = datetime.utcnow()

        # Update per-line tom_item_id / matched_by
        response_items = response_body.get("items", []) if isinstance(response_body, dict) else []
        for ri in response_items:
            source_line_id = ri.get("source_line_id")
            if not source_line_id:
                continue
            for item in po_items:
                if item.sku == source_line_id:
                    item.tom_item_id = ri.get("tom_item_id")
                    item.tom_status = ri.get("status")
                    item.tom_matched_by = ri.get("matched_by")
                    break

        await db.flush()

    await _log_sync(
        db, po.id, "TOM_PO_CREATE",
        "SUCCESS" if success else "FAILED",
        len(po_items),
        None if success else (network_error or err.get("message") or f"HTTP {http_status}"),
        {
            "direction": "OUT", "endpoint": path, "method": "POST",
            "httpStatus": http_status, "idempotencyKey": po.tom_send_idempotency_key,
            "alreadyExisted": already_existed, "errorCode": err.get("code"),
            "request": payload, "response": response_body, "networkError": network_error,
        }
    )

    if success and ids.get("tom_number"):
        return {
            "ok": True, "status": http_status,
            "tom_number": ids["tom_number"], "tom_po_id": ids["tom_po_id"],
            "tom_status": ids.get("tom_status", "NEW"), "already_existed": already_existed,
        }

    return {
        "ok": False, "status": http_status,
        "error": network_error or err.get("message") or f"Unexpected response from TOM (HTTP {http_status})",
    }


# ── Refresh from TOM (GET /api/v1/po/{SOURCE}/{source_po_id}) ───────────

async def refresh_po_from_tom(po_id: int, db: AsyncSession) -> dict:
    """Poll TOM for updated status on a PO and its line items."""
    if not is_tom_configured():
        return {"ok": False, "status": 0, "error": "TOM is not configured."}

    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po_id)
    )
    po = result.scalar_one_or_none()
    if not po:
        return {"ok": False, "status": 0, "error": "PO not found."}
    if not po.tom_po_id:
        return {"ok": False, "status": 0, "error": "PO has not been sent to TOM yet."}

    source_code = _cfg().tom_source_code or "VIGO"
    path = f"/api/v1/po/{source_code}/{po.po_number}"
    idempotency_key = str(uuid.uuid4())

    http_status = 0
    response_body = {}
    network_error = None

    try:
        res = await tom_fetch("GET", path, None, idempotency_key)
        if res["status"] == 404:
            # Fallback for old POs that were sent using po.id
            fallback_path = f"/api/v1/po/{source_code}/{po.id}"
            res = await tom_fetch("GET", fallback_path, None, idempotency_key + "-fb")
            
        http_status = res["status"]
        response_body = res["body"]
    except Exception as e:
        network_error = str(e)

    success = http_status == 200
    err = _extract_error(response_body)
    items_updated = 0
    tom_status = None

    if success and isinstance(response_body, dict):
        tom_status = response_body.get("status")
        po.tom_status = tom_status
        po.tom_refreshed_at = datetime.utcnow()

        # Supplier info
        supplier = response_body.get("supplier") if isinstance(response_body.get("supplier"), dict) else None
        if supplier:
            po.tom_supplier_name = supplier.get("name")
            po.tom_supplier_url = supplier.get("url")

        # Shipment info
        shipment = response_body.get("shipment") if isinstance(response_body.get("shipment"), dict) else None
        if shipment:
            po.tom_shipment_code = shipment.get("code")
            po.tom_shipment_mode = shipment.get("mode")
            eta_str = shipment.get("eta")
            if eta_str:
                try:
                    po.tom_shipment_eta = datetime.fromisoformat(eta_str.replace("Z", "+00:00"))
                except (ValueError, AttributeError):
                    pass

        # Update line items
        items_result = await db.execute(
            select(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id)
        )
        local_items = items_result.scalars().all()
        items_map = {i.sku: i for i in local_items}

        for ri in response_body.get("items", []):
            sku = ri.get("source_line_id")
            if not sku or sku not in items_map:
                continue
            item = items_map[sku]
            item.tom_item_id = ri.get("tom_item_id") or item.tom_item_id
            item.tom_status = ri.get("status")
            item.tom_ordered_qty = ri.get("ordered_qty")
            item.tom_received_qty = ri.get("received_qty")
            item.tom_shipped_qty = ri.get("shipped_qty")
            if ri.get("tom_unit_cost_usd") is not None:
                item.tom_unit_cost_usd = ri["tom_unit_cost_usd"]
            if ri.get("extra_cost_usd") is not None:
                item.tom_extra_cost_usd = ri["extra_cost_usd"]
            item.tom_shipment_code = ri.get("shipment_code")
            item.tom_cancel_reason = ri.get("cancel_reason")
            items_updated += 1

        await db.flush()

    await _log_sync(
        db, po.id, "TOM_PO_REFRESH",
        "SUCCESS" if success else "FAILED",
        items_updated,
        None if success else (network_error or err.get("message") or f"HTTP {http_status}"),
        {
            "direction": "IN", "endpoint": path, "method": "GET",
            "httpStatus": http_status, "idempotencyKey": idempotency_key,
            "errorCode": err.get("code"), "response": response_body, "networkError": network_error,
        }
    )

    if success:
        return {"ok": True, "status": http_status, "tom_status": tom_status, "items_updated": items_updated}
    return {
        "ok": False, "status": http_status,
        "error": network_error or err.get("message") or f"HTTP {http_status}",
    }


# ── Amend (POST /api/v1/po/{SOURCE}/{source_po_id}/amend) ───────────────

async def amend_po_in_tom(po_id: int, db: AsyncSession) -> dict:
    """Send amendments to TOM for lines still in NEW status, adhering to ADD/UPDATE/REMOVE rules."""
    if not is_tom_configured():
        return {"ok": False, "status": 0, "error": "TOM is not configured."}

    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        return {"ok": False, "status": 0, "error": "PO not found."}
    if not po.tom_number:
        return {"ok": False, "status": 0, "error": "PO has not been sent to TOM yet."}

    # 1. Fetch current TOM state to compute diff
    source_code = _cfg().tom_source_code or "VIGO"
    path_get = f"/api/v1/po/{source_code}/{po.po_number}"
    idem_get = f"refresh-amend-{po.id}-{int(datetime.utcnow().timestamp())}"
    tom_state = {}
    try:
        res_get = await tom_fetch("GET", path_get, None, idem_get)
        if res_get["status"] == 404:
            path_get = f"/api/v1/po/{source_code}/{po.id}"
            res_get = await tom_fetch("GET", path_get, None, idem_get + "-fb")
        if res_get["status"] == 200 and isinstance(res_get.get("body"), dict):
            tom_state = res_get["body"]
    except Exception as e:
        logger.warning(f"Failed to fetch TOM state for amend diff: {e}")

    tom_skus = {ri.get("source_line_id") for ri in tom_state.get("items", []) if ri.get("source_line_id")}

    # 2. Compute Diff and Build Payload
    items_result = await db.execute(select(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id))
    local_items = items_result.scalars().all()
    local_skus = {i.sku for i in local_items if i.sku}

    products_map, sku_map, catalog_prices, store_map = await _get_enrichment_context(local_items, db)
    items_payload = []

    for item in local_items:
        if not item.sku:
            continue
        if item.sku in tom_skus:
            # Item exists in TOM -> UPDATE
            items_payload.append({
                "source_line_id": item.sku,
                "action": "UPDATE",
                "requested_qty": item.quantity,
                "priority": item.priority or po.priority,
                "title": item.product_name or item.sku,
            })
        else:
            # Item does NOT exist in TOM -> ADD (needs full enrichment)
            enriched_line = _enrich_po_item(item, po, products_map, sku_map, catalog_prices, store_map)
            enriched_line["action"] = "ADD"
            items_payload.append(enriched_line)

    # For items in TOM but missing locally -> REMOVE
    for sku in tom_skus:
        if sku not in local_skus:
            items_payload.append({
                "source_line_id": sku,
                "action": "REMOVE"
            })

    payload = {"items": items_payload}
    source_code = _cfg().tom_source_code or "VIGO"
    path = f"/api/v1/po/{source_code}/{po.po_number}/amend"
    idempotency_key = f"amend-{po.id}-{int(datetime.utcnow().timestamp())}"

    http_status = 0
    response_body = {}
    network_error = None

    try:
        res = await tom_fetch("POST", path, payload, idempotency_key)
        if res["status"] == 404:
            # Fallback for old POs that were sent using po.id
            fallback_path = f"/api/v1/po/{source_code}/{po.id}/amend"
            res = await tom_fetch("POST", fallback_path, payload, idempotency_key + "-fb")
            
        http_status = res["status"]
        response_body = res["body"]
    except Exception as e:
        network_error = str(e)

    success = http_status == 200
    applied = response_body.get("applied", []) if isinstance(response_body, dict) else []
    skipped = response_body.get("skipped", []) if isinstance(response_body, dict) else []
    err = _extract_error(response_body)

    logger.info(f"TOM amend result: status={http_status} applied={len(applied) if isinstance(applied, list) else 0} skipped={len(skipped) if isinstance(skipped, list) else 0} err={err}")

    await _log_sync(
        db, po.id, "TOM_PO_AMEND",
        "SUCCESS" if success else "FAILED",
        len(applied) if isinstance(applied, list) else 0,
        None if success else (network_error or err.get("message") or f"HTTP {http_status}"),
        {
            "direction": "OUT", "endpoint": path, "method": "POST",
            "httpStatus": http_status, "idempotencyKey": idempotency_key,
            "request": payload, "response": response_body, "networkError": network_error,
            "applied": applied, "skipped": skipped,
        }
    )

    if success:
        return {"ok": True, "status": http_status, "applied": applied, "skipped": skipped}
    return {"ok": False, "status": http_status, "error": network_error or err.get("message") or f"TOM amend failed (HTTP {http_status}). Response: {response_body}"}


# ── Cancel (POST /api/v1/po/{SOURCE}/{source_po_id}/cancel) ─────────────

async def cancel_po_in_tom(po_id: int, reason: str, db: AsyncSession) -> dict:
    """Cancel a PO in TOM."""
    if not is_tom_configured():
        return {"ok": False, "status": 0, "error": "TOM is not configured."}

    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po or not po.tom_po_id:
        return {"ok": False, "status": 0, "error": "PO not found or not sent to TOM."}

    payload = {"scope": "PO", "reason": "REQUESTER_CANCELLED", "note": reason}
    source_code = _cfg().tom_source_code or "VIGO"
    path = f"/api/v1/po/{source_code}/{po.po_number}/cancel"
    idempotency_key = f"cancel-{po.id}-{int(datetime.utcnow().timestamp())}"

    http_status = 0
    response_body = {}
    network_error = None

    try:
        res = await tom_fetch("POST", path, payload, idempotency_key)
        if res["status"] == 404:
            # Fallback for old POs that were sent using po.id
            fallback_path = f"/api/v1/po/{source_code}/{po.id}/cancel"
            res = await tom_fetch("POST", fallback_path, payload, idempotency_key + "-fb")
            
        http_status = res["status"]
        response_body = res["body"]
    except Exception as e:
        network_error = str(e)

    success = http_status == 200

    await _log_sync(
        db, po.id, "TOM_PO_CANCEL",
        "SUCCESS" if success else "FAILED",
        0, None if success else (network_error or f"HTTP {http_status}"),
        {"direction": "OUT", "endpoint": path, "method": "POST",
         "httpStatus": http_status, "request": payload, "response": response_body}
    )

    if success:
        po.tom_status = "CANCELLED"
        await db.flush()
        return {"ok": True, "status": http_status}
    return {"ok": False, "status": http_status, "error": network_error or f"HTTP {http_status}"}


# ── Sync Log helper ─────────────────────────────────────────────────────

async def _log_sync(
    db: AsyncSession, po_id: int, action: str, status: str,
    items_affected: int, error_message: Optional[str], details: dict,
):
    """Write a PoSyncLog row."""
    log = PoSyncLog(
        purchase_order_id=po_id,
        action=action,
        status=status,
        items_affected=items_affected,
        error_message=error_message,
        details=details,
    )
    db.add(log)
    await db.flush()
