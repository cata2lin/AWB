"""
Purchase Orders — inventory replenishment analytics endpoint.

Combines current stock levels (from Frisbo product sync) with sales velocity
(from delivered orders) to compute days-of-stock, reorder points, and
suggested reorder quantities per SKU.

Products are grouped by barcode/SKU just like the Produse tab — multi-store
listings appear as a single unique product using the _build_groups logic.

Lead time rules:
- Esteban / GT (georgetalent): 0 days (self-produced)
- All others: 90 days (average supplier lead time)
"""
import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import Order, Store, SkuCost
from app.models.product import Product
from app.api.sku_risk.computations import compute_final_outcome

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])

# Outcomes that count as "sold" for velocity
DELIVERED_OUTCOMES = {"DELIVERED"}

# Self-produced brands have no supplier lead time
SELF_PRODUCED_STORES = {"esteban.ro", "georgetalent.ro"}

DEFAULT_LEAD_TIME = 90  # days
BUFFER_DAYS = 30  # extra coverage beyond lead time for reorder qty


def _safe_div(a, b):
    return a / b if b else 0.0


def _classify_urgency(days_of_stock, lead_time, velocity):
    """Classify SKU urgency based on days of stock vs lead time."""
    if velocity < 0.05:
        return "slow"
    if days_of_stock is None or days_of_stock == float('inf'):
        return "overstock"
    if lead_time == 0:
        # Self-produced: only flag if stock is very low
        if days_of_stock < 14:
            return "urgent"
        if days_of_stock < 30:
            return "warning"
        if days_of_stock > 180:
            return "overstock"
        return "ok"
    # Standard: compare against lead time
    if days_of_stock < lead_time:
        return "urgent"
    if days_of_stock < lead_time * 1.5:
        return "warning"
    if days_of_stock > 180:
        return "overstock"
    return "ok"


def _build_product_groups(all_products):
    """
    Group products by barcode OR SKU — same logic as products.py _build_groups.
    Returns list of groups, each group is a list of Product objects.
    """
    barcode_groups = {}
    sku_to_barcode = {}
    remaining = []

    for p in all_products:
        bc = (p.barcode or "").strip()
        sku = (p.sku or "").strip()
        if bc:
            barcode_groups.setdefault(bc, []).append(p)
            if sku:
                sku_to_barcode[sku] = bc
        else:
            remaining.append(p)

    sku_only_groups = {}
    ungrouped = []

    for p in remaining:
        sku = (p.sku or "").strip()
        if sku and sku in sku_to_barcode:
            bc = sku_to_barcode[sku]
            barcode_groups[bc].append(p)
        elif sku:
            sku_only_groups.setdefault(sku, []).append(p)
        else:
            ungrouped.append(p)

    groups = []
    for bc, prods in barcode_groups.items():
        groups.append(prods)
    for sku, prods in sku_only_groups.items():
        groups.append(prods)
    for p in ungrouped:
        groups.append([p])

    return groups


def _merge_product_group(group, store_name_map, self_produced_uids):
    """
    Merge a list of product listings into a single product dict.
    Uses primary_listing_uid if set, otherwise picks the first product.
    Stock comes from the primary listing (not summed across duplicates).
    """
    group.sort(
        key=lambda p: p.synced_at or p.frisbo_updated_at or p.frisbo_created_at or datetime.min,
        reverse=True,
    )

    primary = group[0]
    for p in group:
        if p.primary_listing_uid:
            match = next((x for x in group if x.uid == p.primary_listing_uid), None)
            if match:
                primary = match
            break

    # Merge stores from all listings
    all_store_uids = []
    seen = set()
    for p in group:
        for uid in (p.store_uids or []):
            if uid not in seen:
                all_store_uids.append(uid)
                seen.add(uid)

    # Best title
    title_1 = primary.title_1
    for p in group:
        if p.title_1:
            title_1 = p.title_1
            break

    # Self-produced check
    is_self_produced = bool(set(all_store_uids) & self_produced_uids)

    store_names = [store_name_map.get(uid, uid) for uid in all_store_uids]

    # Best image
    images = []
    for p in group:
        if p.images:
            images = p.images
            break

    return {
        "uid": primary.uid,
        "sku": primary.sku or "",
        "barcode": primary.barcode or "",
        "product_name": title_1 or "",
        "images": images,
        "stock_available": primary.stock_available or 0,
        "stock_committed": primary.stock_committed or 0,
        "stock_incoming": primary.stock_incoming or 0,
        "exclude_from_stock": primary.exclude_from_stock,
        "store_uids": all_store_uids,
        "stores": store_names,
        "is_self_produced": is_self_produced,
        "grouped_count": len(group),
    }


@router.get("/purchase-orders")
async def get_purchase_orders(
    days: int = Query(30, ge=7, le=365, description="Days for velocity calculation"),
    store_uids: Optional[str] = Query(None, description="Comma-separated store UIDs"),
    category: Optional[str] = Query(None, description="Filter: urgent, warning, ok, overstock, slow"),
    search: Optional[str] = Query(None, description="Search by SKU or product name"),
    sort_by: str = Query("days_of_stock", description="Sort field"),
    sort_dir: str = Query("asc", description="Sort direction"),
    db: AsyncSession = Depends(get_db),
):
    """
    Compute purchase order / restocking analytics.

    Products are grouped by barcode/SKU (same as Produse tab).
    For each grouped product: stock, velocity, days-of-stock, reorder point,
    suggested reorder quantity, urgency classification.
    """
    dt_to = datetime.utcnow()
    dt_from = dt_to - timedelta(days=days)

    # ── 1. Load stores ────────────────────────────────────────────────────
    stores_result = await db.execute(select(Store))
    stores_all = stores_result.scalars().all()
    store_name_map = {s.uid: s.name for s in stores_all}

    self_produced_uids = set()
    for s in stores_all:
        if s.name and s.name.lower() in SELF_PRODUCED_STORES:
            self_produced_uids.add(s.uid)

    # ── 2. Load all active products and group ─────────────────────────────
    product_query = select(Product).where(
        Product.state.in_(["active", None]),
        Product.exclude_from_stock == False,
    )
    products_result = await db.execute(product_query)
    all_products = products_result.scalars().all()

    groups = _build_product_groups(all_products)

    # ── 3. Load SKU costs ─────────────────────────────────────────────────
    sku_costs_result = await db.execute(select(SkuCost))
    sku_cost_map = {sc.sku: sc.cost for sc in sku_costs_result.scalars().all()}

    # ── 4. Compute velocity from delivered orders ─────────────────────────
    order_query = select(Order).where(
        Order.frisbo_created_at >= dt_from,
        Order.frisbo_created_at <= dt_to,
    )
    if store_uids:
        uid_list = [u.strip() for u in store_uids.split(",") if u.strip()]
        if uid_list:
            order_query = order_query.where(Order.store_uid.in_(uid_list))

    orders_result = await db.execute(order_query)
    orders = orders_result.scalars().all()

    # Per-SKU sales aggregation
    sku_sales = defaultdict(lambda: {"units": 0, "revenue": 0.0, "orders": 0})

    for order in orders:
        final_outcome = compute_final_outcome(
            order.aggregated_status,
            order.shipment_status,
            order.fulfillment_status,
        )
        if final_outcome not in DELIVERED_OUTCOMES:
            continue

        items_raw = order.line_items or []
        if isinstance(items_raw, str):
            try:
                items_raw = json.loads(items_raw)
            except (json.JSONDecodeError, TypeError):
                items_raw = []

        for item in items_raw:
            inv = item.get("inventory_item", {}) or {}
            sku = inv.get("sku", "") or ""
            if not sku:
                continue
            qty = float(item.get("quantity", 1) or 1)
            price = float(item.get("price", 0) or 0)
            sku_sales[sku]["units"] += qty
            sku_sales[sku]["revenue"] += price * qty
            sku_sales[sku]["orders"] += 1

    period_days = max((dt_to - dt_from).days, 1)

    # ── 5. Build product rows from grouped products ───────────────────────
    products_out = []

    for group in groups:
        merged = _merge_product_group(group, store_name_map, self_produced_uids)

        if merged["exclude_from_stock"]:
            continue

        sku = merged["sku"]
        sales = sku_sales.get(sku, {"units": 0, "revenue": 0.0, "orders": 0})

        units_sold = sales["units"]
        velocity = _safe_div(units_sold, period_days)

        lead_time = 0 if merged["is_self_produced"] else DEFAULT_LEAD_TIME

        # Days of stock calculation
        if velocity > 0:
            days_of_stock = round(merged["stock_available"] / velocity, 1)
        else:
            days_of_stock = 9999 if merged["stock_available"] > 0 else 0

        reorder_point = round(velocity * lead_time, 0)
        suggested_qty = max(0, round(velocity * (lead_time + BUFFER_DAYS) - merged["stock_available"], 0))

        urgency = _classify_urgency(days_of_stock, lead_time, velocity)

        unit_cost = float(sku_cost_map.get(sku, 0) or 0)
        stock_value = merged["stock_available"] * unit_cost

        row = {
            "uid": merged["uid"],
            "sku": sku,
            "barcode": merged["barcode"],
            "product_name": merged["product_name"],
            "images": merged["images"],
            "stock_available": merged["stock_available"],
            "stock_committed": merged["stock_committed"],
            "stock_incoming": merged["stock_incoming"],
            "units_sold": int(units_sold),
            "velocity": round(velocity, 2),
            "days_of_stock": days_of_stock if days_of_stock != 9999 else None,
            "lead_time": lead_time,
            "reorder_point": int(reorder_point),
            "suggested_qty": int(suggested_qty),
            "urgency": urgency,
            "unit_cost": round(unit_cost, 2),
            "stock_value": round(stock_value, 2),
            "revenue": round(sales["revenue"], 2),
            "orders": sales["orders"],
            "stores": merged["stores"],
            "is_self_produced": merged["is_self_produced"],
            "grouped_count": merged["grouped_count"],
        }
        products_out.append(row)

    # ── 6. Apply filters ──────────────────────────────────────────────────
    if category:
        products_out = [p for p in products_out if p["urgency"] == category]

    if search:
        search_lower = search.lower()
        products_out = [
            p for p in products_out
            if search_lower in (p["sku"] or "").lower()
            or search_lower in (p["product_name"] or "").lower()
            or search_lower in (p["barcode"] or "").lower()
        ]

    # ── 7. Sort ───────────────────────────────────────────────────────────
    def sort_key(row):
        val = row.get(sort_by, 0)
        if val is None:
            return float('inf') if sort_dir == "asc" else float('-inf')
        if isinstance(val, str):
            return val.lower()
        return val

    reverse = sort_dir == "desc"
    products_out.sort(key=sort_key, reverse=reverse)

    # ── 8. KPIs ───────────────────────────────────────────────────────────
    urgent_count = sum(1 for p in products_out if p["urgency"] == "urgent")
    warning_count = sum(1 for p in products_out if p["urgency"] == "warning")
    overstock_count = sum(1 for p in products_out if p["urgency"] == "overstock")
    slow_count = sum(1 for p in products_out if p["urgency"] == "slow")
    total_stock_value = sum(p["stock_value"] for p in products_out)
    total_skus = len(products_out)
    items_with_dos = [p for p in products_out if p["days_of_stock"] is not None]
    avg_days = round(
        sum(p["days_of_stock"] for p in items_with_dos) / max(len(items_with_dos), 1), 1
    )

    return {
        "kpis": {
            "total_skus": total_skus,
            "urgent_reorders": urgent_count,
            "warning_reorders": warning_count,
            "overstock": overstock_count,
            "slow_moving": slow_count,
            "total_stock_value": round(total_stock_value, 2),
            "avg_days_of_stock": avg_days,
        },
        "products": products_out,
        "meta": {
            "period_days": period_days,
            "date_from": dt_from.isoformat(),
            "date_to": dt_to.isoformat(),
            "default_lead_time": DEFAULT_LEAD_TIME,
            "self_produced_stores": list(SELF_PRODUCED_STORES),
        },
    }
