"""
Product Deliverability Analytics — per product-group delivery performance.

Uses the EXACT same barcode-based product grouping as sales_velocity/endpoint.py:
  - Products are grouped by barcode first (same barcode = same physical product)
  - Within a barcode group, pick_best_primary() selects the canonical listing
  - Nubra store products are isolated (never merged with other stores)
  - Products without barcode are grouped by SKU

Aggregates delivery status counts per group, using the same status mapping
as the store-level deliverability endpoint.

Edge cases handled:
  - Multiple SKUs per order line (same barcode sold on different stores)
  - Orders with no line_items or malformed JSON
  - SKUs not found in the product catalogue (orphaned/deleted products)
  - Nubra store isolation
  - Products sold exclusively on excluded stores still appear if their
    barcode-group has sales from other stores in the period
  - Store include/exclude filters applied at ORDER level (not product level)
  - min_orders noise filter to exclude long-tail anomalies
"""

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Set
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.analytics_cache import cached_analytics
from app.core.timezone import (
    date_str_to_utc_start,
    date_str_to_utc_end,
)
from app.models import Order, Store
from app.models.product import Product
from app.services.product_grouping import classify_stores, pick_best_primary

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Status groupings (identical to store deliverability endpoint) ──────────
DELIVERED_STATUSES = frozenset({"delivered", "customer_pickup", "in_parcel_locker"})
RETURNED_STATUSES = frozenset(
    {"back_to_sender", "returning_to_sender", "incorrect_address", "lost"}
)
REFUSED_STATUSES = frozenset({"refused", "unsuccessful_delivery"})
IN_TRANSIT_STATUSES = frozenset(
    {"in_transit", "fulfilled", "redirected", "deferred_delivery", "on_hold"}
)
OUT_FOR_DELIVERY_STATUSES = frozenset({"out_for_delivery"})
PROCESSING_STATUSES = frozenset({"processing", "not_fulfilled"})

# Nubra shares barcodes/SKUs with other stores but is a completely separate brand.
# Never merge Nubra orders into the same product group as other stores.
NUBRA_UID = "7d1a2e21-7efb-4cd7-b4e7-09ef875430a9-1774614410-JJ99XONT29"


def _get_status_bucket(status: Optional[str]) -> str:
    """Map aggregated_status → one of: delivered, returned, refused, in_transit, out_for_delivery, processing, cancelled, other."""
    if not status:
        return "processing"
    s = status.lower()
    if s in DELIVERED_STATUSES:
        return "delivered"
    if s in RETURNED_STATUSES:
        return "returned"
    if s in REFUSED_STATUSES:
        return "refused"
    if s in IN_TRANSIT_STATUSES:
        return "in_transit"
    if s in OUT_FOR_DELIVERY_STATUSES:
        return "out_for_delivery"
    if s == "cancelled":
        return "cancelled"
    if s in PROCESSING_STATUSES:
        return "processing"
    return "other"


@router.get("/product-deliverability")
@cached_analytics("product-deliverability")
async def get_product_deliverability(
    store_uids: Optional[str] = Query(
        None, description="Include only these store UIDs (comma-separated)"
    ),
    exclude_store_uids: Optional[str] = Query(
        None, description="Exclude these store UIDs (comma-separated)"
    ),
    date_from: Optional[str] = Query(
        None, description="Start date YYYY-MM-DD (order created_at)"
    ),
    date_to: Optional[str] = Query(
        None, description="End date YYYY-MM-DD (order created_at)"
    ),
    days: Optional[int] = Query(
        None, ge=1, le=730, description="Last N days (alternative to date_from/date_to)"
    ),
    min_orders: int = Query(
        5,
        ge=1,
        le=500,
        description="Minimum order appearances to include a product (noise filter)",
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Per-product-group delivery performance report.

    Products are grouped by barcode (exactly as in Viteza Vânzări), so a product
    sold under different SKUs across stores is counted as a single entry.
    Returns delivery_rate, return_rate, refusal_rate, cancellation_rate per group.
    """
    # ── 1. Resolve date window ─────────────────────────────────────────────
    if date_from and date_to:
        dt_from = date_str_to_utc_start(date_from)
        dt_to = date_str_to_utc_end(date_to)
    elif days:
        tz = ZoneInfo("Europe/Bucharest")
        now_buc = datetime.now(tz)
        start_buc = (now_buc - timedelta(days=max(0, days - 1))).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        dt_from = start_buc.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
        dt_to = (
            now_buc.replace(hour=23, minute=59, second=59)
            .astimezone(ZoneInfo("UTC"))
            .replace(tzinfo=None)
        )
    else:
        # Default: last 30 days
        tz = ZoneInfo("Europe/Bucharest")
        now_buc = datetime.now(tz)
        start_buc = (now_buc - timedelta(days=29)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        dt_from = start_buc.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
        dt_to = (
            now_buc.replace(hour=23, minute=59, second=59)
            .astimezone(ZoneInfo("UTC"))
            .replace(tzinfo=None)
        )

    # ── 2. Parse store filters ─────────────────────────────────────────────
    include_uids: Optional[Set[str]] = None
    if store_uids:
        include_uids = {u.strip() for u in store_uids.split(",") if u.strip()}

    exclude_uids: Set[str] = set()
    if exclude_store_uids:
        exclude_uids = {u.strip() for u in exclude_store_uids.split(",") if u.strip()}

    # ── 3. Query orders, stores, and products SEQUENTIALLY ─────────────────
    # NOTE: asyncio.gather on the same SQLAlchemy AsyncSession is NOT safe —
    # async sessions use a single underlying connection and cannot handle
    # concurrent awaits. All queries must be sequential.
    from app.core.order_filters import build_tag_exclusion_condition
    from app.core.line_items_projection import PROJECTED_LINE_ITEMS

    _excl = await build_tag_exclusion_condition(db)
    # Slim column-select + projected line_items (not full ORM) — see
    # app/core/line_items_projection. Only aggregated_status + store_uid + the
    # slimmed {sku,q,p} items are read below.
    order_query = select(
        Order.aggregated_status, Order.store_uid, PROJECTED_LINE_ITEMS
    ).where(
        Order.frisbo_created_at >= dt_from,
        Order.frisbo_created_at <= dt_to,
        _excl,  # drop excluded-tag orders (built-in test/sample + configured rules)
    )
    if include_uids:
        order_query = order_query.where(Order.store_uid.in_(list(include_uids)))
    if exclude_uids:
        order_query = order_query.where(Order.store_uid.notin_(list(exclude_uids)))

    orders_res = await db.execute(order_query)
    all_orders = orders_res.all()

    stores_res = await db.execute(select(Store))
    all_stores = stores_res.scalars().all()
    stores_map: Dict[str, str] = {s.uid: s.name for s in all_stores}

    products_res = await db.execute(
        select(Product)
        .where(Product.sku.isnot(None), Product.sku != "")
        .where(Product.state == "active")
    )
    all_products = list(products_res.scalars().all())

    # Sort by synced_at DESC so the most recently synced product is picked first
    all_products.sort(key=lambda p: p.synced_at or datetime.min, reverse=True)

    # ── 4. Build product groups (same logic as sales_velocity/endpoint.py) ─
    ro_store_uids, intl_store_uids = classify_stores(
        [(s.uid, s.name) for s in all_stores]
    )
    uid_to_product: Dict[str, Product] = {p.uid: p for p in all_products}

    barcode_groups: Dict[str, List] = defaultdict(list)
    sku_to_barcode: Dict[str, str] = {}
    remaining: List = []

    for p in all_products:
        bc = (p.barcode or "").strip()
        sku = (p.sku or "").strip()
        if bc:
            barcode_groups[bc].append(p)
            if sku:
                sku_to_barcode[sku] = bc
        else:
            remaining.append(p)

    sku_only_groups: Dict[str, List] = defaultdict(list)
    ungrouped: List = []
    for p in remaining:
        sku = (p.sku or "").strip()
        if sku and sku in sku_to_barcode:
            barcode_groups[sku_to_barcode[sku]].append(p)
        elif sku:
            sku_only_groups[sku].append(p)
        else:
            ungrouped.append(p)

    # group_key → metadata
    master_sku_map: Dict[str, str] = {}  # any variant SKU → group_key
    store_sku_map: Dict[tuple, str] = {}  # (store_uid, sku) → group_key
    group_meta: Dict[
        str, dict
    ] = {}  # group_key → {display_sku, name, stock, image, store_uids}

    def _extract_store_uids(p) -> list:
        uids = p.store_uids or []
        if isinstance(uids, str):
            try:
                return json.loads(uids)
            except Exception:
                return []
        return uids if isinstance(uids, list) else []

    def _first_image(p) -> Optional[str]:
        imgs = p.images
        if not imgs:
            return None
        if isinstance(imgs, str):
            try:
                imgs = json.loads(imgs)
            except Exception:
                return None
        if isinstance(imgs, list) and imgs:
            img = imgs[0]
            return img.get("src") if isinstance(img, dict) else str(img)
        return None

    def process_group(group: list, fallback_key: str):
        if not group:
            return
        key = fallback_key.strip()
        if not key:
            return

        best, has_explicit = pick_best_primary(
            group, ro_store_uids, intl_store_uids, uid_to_product
        )

        # Stock: prefer the barcode-bearing product
        stock_product = best
        if not has_explicit:
            for p in group:
                if (p.barcode or "").strip():
                    stock_product = p
                    break
        stock = stock_product.stock_available or 0

        # Image: from best product
        image = _first_image(best)

        # All store UIDs in this group
        all_store_uids_in_group: set = set()
        for p in group:
            all_store_uids_in_group.update(_extract_store_uids(p))

        group_meta[key] = {
            "display_sku": (best.sku or fallback_key).strip(),
            "name": best.title_1 or fallback_key,
            "stock": stock,
            "image": image,
            "store_uids": all_store_uids_in_group,
            "barcode": (best.barcode or "").strip() or fallback_key,
        }

        for p in group:
            if p.sku:
                master_sku_map[p.sku.strip()] = key
                for uid in _extract_store_uids(p):
                    store_sku_map[(uid, p.sku.strip())] = key

    for bc, group in barcode_groups.items():
        process_group(group, bc)
    for sku, group in sku_only_groups.items():
        process_group(group, sku)
    for p in ungrouped:
        process_group([p], p.sku or "")

    def _group_key(sku: str, store_uid: str) -> str:
        """Resolve a raw line-item SKU to its canonical group key."""
        if store_uid == NUBRA_UID:
            return f"{sku}::nubra"
        if (store_uid, sku.strip()) in store_sku_map:
            return store_sku_map[(store_uid, sku.strip())]
        return master_sku_map.get(sku.strip(), sku.strip())

    # ── 5. Aggregate orders per group_key ─────────────────────────────────
    ZERO = lambda: {
        "total_orders": 0,
        "total_units": 0,
        "delivered": 0,
        "delivered_units": 0,
        "returned": 0,
        "returned_units": 0,
        "refused": 0,
        "refused_units": 0,
        "cancelled": 0,
        "in_transit": 0,
        "out_for_delivery": 0,
        "processing": 0,
        "other": 0,
        # Store breakdown: store_uid → counts
        "by_store": defaultdict(
            lambda: {
                "orders": 0,
                "delivered": 0,
                "returned": 0,
                "refused": 0,
                "cancelled": 0,
                "in_transit": 0,
                "out_for_delivery": 0,
            }
        ),
    }

    agg: Dict[str, dict] = defaultdict(ZERO)

    for order in all_orders:
        items_raw = order.li or []  # projected {sku,q,p} items
        if not items_raw:
            continue

        bucket = _get_status_bucket(order.aggregated_status)
        store_uid = order.store_uid or ""

        # Resolve every line item to its product group_key first, summing units.
        # An order then counts ONCE per DISTINCT group_key (Finding O) — so a SKU
        # repeated on two lines, or two sibling variants that collapse into one
        # barcode group, no longer inflate that group's order count.
        units_by_gk: Dict[str, int] = defaultdict(int)
        for item in items_raw:
            sku = (item.get("sku", "") or "").strip()
            if not sku:
                continue
            qty = int(float(item.get("q", 1) or 1))
            units_by_gk[_group_key(sku, store_uid)] += qty

        for gk, qty in units_by_gk.items():
            g = agg[gk]
            g["total_orders"] += 1
            g["total_units"] += qty

            g[bucket] = g.get(bucket, 0) + 1
            if bucket == "delivered":
                g["delivered_units"] += qty
            elif bucket == "returned":
                g["returned_units"] += qty
            elif bucket == "refused":
                g["refused_units"] += qty

            # Per-store breakdown
            bs = g["by_store"][store_uid]
            bs["orders"] += 1
            if bucket in (
                "delivered",
                "returned",
                "refused",
                "cancelled",
                "in_transit",
                "out_for_delivery",
            ):
                bs[bucket] = bs.get(bucket, 0) + 1

    # ── 6. Build response ─────────────────────────────────────────────────
    products_out = []
    totals = {
        "total_orders": 0,
        "total_units": 0,
        "delivered": 0,
        "delivered_units": 0,
        "returned": 0,
        "returned_units": 0,
        "refused": 0,
        "refused_units": 0,
        "cancelled": 0,
        "in_transit": 0,
        "out_for_delivery": 0,
        "processing": 0,
    }

    for gk, g in agg.items():
        if g["total_orders"] < min_orders:
            continue

        meta = group_meta.get(
            gk,
            {
                "display_sku": gk.split("::")[0],
                "name": gk.split("::")[0],
                "stock": None,
                "image": None,
                "store_uids": set(),
                "barcode": "",
            },
        )

        # Shipped = everything that physically left the warehouse
        shipped = (
            g["delivered"]
            + g["in_transit"]
            + g["out_for_delivery"]
            + g["returned"]
            + g["refused"]
        )
        total = g["total_orders"]

        delivery_rate = round(g["delivered"] / shipped * 100, 2) if shipped else 0.0
        return_rate = (
            round((g["returned"] + g["refused"]) / shipped * 100, 2) if shipped else 0.0
        )
        refusal_rate = round(g["refused"] / shipped * 100, 2) if shipped else 0.0
        cancellation_rate = round(g["cancelled"] / total * 100, 2) if total else 0.0
        expedition_rate = round(shipped / total * 100, 2) if total else 0.0

        # Store breakdown list
        by_store = []
        for s_uid, s_data in g["by_store"].items():
            # Same "shipped" definition as the group/store-level report:
            # delivered + in_transit + out_for_delivery + returned + refused (Finding N).
            s_shipped = (
                s_data["delivered"]
                + s_data.get("in_transit", 0)
                + s_data.get("out_for_delivery", 0)
                + s_data.get("returned", 0)
                + s_data.get("refused", 0)
            )
            by_store.append(
                {
                    "store_uid": s_uid,
                    "store_name": stores_map.get(s_uid, s_uid),
                    "orders": s_data["orders"],
                    "delivered": s_data["delivered"],
                    "returned": s_data.get("returned", 0),
                    "refused": s_data.get("refused", 0),
                    "cancelled": s_data.get("cancelled", 0),
                    "delivery_rate": round(s_data["delivered"] / s_shipped * 100, 2)
                    if s_shipped
                    else 0.0,
                }
            )
        by_store.sort(key=lambda x: x["orders"], reverse=True)

        row = {
            "group_key": gk,
            "sku": meta["display_sku"],
            "product_name": meta["name"],
            "barcode": meta["barcode"],
            "image": meta["image"],
            "stock_available": meta["stock"],
            "store_uids": list(meta["store_uids"]),
            "store_names": [
                stores_map.get(u, u) for u in meta["store_uids"] if u in stores_map
            ],
            # Counts
            "total_orders": total,
            "total_units": g["total_units"],
            "delivered": g["delivered"],
            "delivered_units": g["delivered_units"],
            "returned": g["returned"],
            "returned_units": g["returned_units"],
            "refused": g["refused"],
            "refused_units": g["refused_units"],
            "cancelled": g["cancelled"],
            "in_transit": g["in_transit"] + g["out_for_delivery"],
            "processing": g["processing"],
            "shipped": shipped,
            # Rates
            "delivery_rate": delivery_rate,
            "return_rate": return_rate,
            "refusal_rate": refusal_rate,
            "cancellation_rate": cancellation_rate,
            "expedition_rate": expedition_rate,
            # Store breakdown
            "by_store": by_store,
        }
        products_out.append(row)

        # Accumulate totals
        for k in (
            "total_orders",
            "total_units",
            "delivered",
            "delivered_units",
            "returned",
            "returned_units",
            "refused",
            "refused_units",
            "cancelled",
            "in_transit",
            "processing",
        ):
            totals[k] = totals.get(k, 0) + g.get(k, 0)
        totals["in_transit"] += g.get("out_for_delivery", 0)

    # Sort by total_orders descending by default
    products_out.sort(key=lambda x: x["total_orders"], reverse=True)

    # Compute aggregate rates for totals row
    shipped_t = (
        totals["delivered"]
        + totals["in_transit"]
        + totals["returned"]
        + totals["refused"]
    )
    total_t = totals["total_orders"]
    totals["shipped"] = shipped_t
    totals["delivery_rate"] = (
        round(totals["delivered"] / shipped_t * 100, 2) if shipped_t else 0.0
    )
    totals["return_rate"] = (
        round((totals["returned"] + totals["refused"]) / shipped_t * 100, 2)
        if shipped_t
        else 0.0
    )
    totals["refusal_rate"] = (
        round(totals["refused"] / shipped_t * 100, 2) if shipped_t else 0.0
    )
    totals["cancellation_rate"] = (
        round(totals["cancelled"] / total_t * 100, 2) if total_t else 0.0
    )
    totals["expedition_rate"] = round(shipped_t / total_t * 100, 2) if total_t else 0.0

    return {
        "products": products_out,
        "totals": totals,
        "count": len(products_out),
        "meta": {
            "date_from": str(dt_from.date()),
            "date_to": str(dt_to.date()),
            "total_orders_in_window": len(all_orders),
            "min_orders_filter": min_orders,
        },
    }
