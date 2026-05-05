"""
Sales Velocity & Product Analytics — FastAPI endpoint.

Computes per-SKU sales velocity, trends, store comparisons, and auto-generated alerts
from order + line_items data.
"""
import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func as sqlfunc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timezone import to_bucharest_iso, to_bucharest_date, to_bucharest, date_str_to_utc_start, date_str_to_utc_end
from app.models import Order, Store, SkuCost
from app.models.product import Product
from app.models.purchase_order import PurchaseOrder
from app.models.purchase_order_item import PurchaseOrderItem
from app.api.sku_risk.computations import compute_final_outcome
from app.api.exchange_rates import preload_rates, get_rate_from_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])

# Outcomes that count as "delivered" for velocity purposes
DELIVERED_OUTCOMES = {"DELIVERED"}

# Outcomes excluded from gross counts — Shopify never includes cancelled orders
# in "Net items sold".  Excluding them aligns our "Brut" with Shopify reporting.
CANCELLED_OUTCOMES = {"CANCELLED"}

# ── Per-store timezone mapping ───────────────────────────────────────────
# Shopify stores use their configured timezone for reporting boundaries.
# When comparing date ranges, we must respect each store's local midnight.
# Stores not listed here default to Europe/Bucharest.
STORE_TIMEZONE_MAP: Dict[str, str] = {
    # Czech stores → Central European Time
    "bonhaus.cz": "Europe/Prague",
    # Polish stores → Central European Time
    "bonhaus.pl": "Europe/Warsaw",
    # Bulgarian stores — same offset as Romania (EET/EEST)
    # "bonhaus.bg": "Europe/Sofia",  # same as Bucharest, no adjustment needed
    # "nocturna.bg": "Europe/Sofia",
}

# Nubra shares SKUs with esteban/GT but sells different products — never merge
NUBRA_UID = "7d1a2e21-7efb-4cd7-b4e7-09ef875430a9-1774614410-JJ99XONT29"


def _safe_div(a, b):
    return a / b if b else 0.0


@router.get("/sales-velocity")
async def get_sales_velocity(
    days: int = Query(30, ge=1, le=365),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    store_uids: Optional[str] = Query(None),
    country_code: Optional[str] = Query(None),
    min_units: int = Query(1, ge=0),
    min_stock: Optional[int] = Query(None, ge=0),
    max_stock: Optional[int] = Query(None, ge=0),
    min_days_left: Optional[int] = Query(None, ge=0),
    max_days_left: Optional[int] = Query(None, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """
    Compute sales velocity & product analytics.

    Returns:
    - kpis:             Global summary KPIs
    - products:         Per-SKU performance table
    - trends:           Daily/weekly unit + revenue series
    - store_comparison: Per-store velocity KPIs
    - alerts:           Auto-generated insights
    - meta:             Filter info
    """
    # ── 1. Date range ─────────────────────────────────────────────────────
    # We compute a "widened" UTC window that covers ALL possible store
    # timezones (UTC+1 through UTC+3).  Per-store filtering in the
    # aggregation loop then applies the exact local-midnight boundaries.
    explicit_dates = bool(date_from and date_to)
    if explicit_dates:
        try:
            dt_from = date_str_to_utc_start(date_from)
            dt_to = date_str_to_utc_end(date_to)
        except ValueError:
            dt_from = datetime.utcnow() - timedelta(days=max(0, days - 1))
            dt_to = datetime.utcnow()
    else:
        # Use Bucharest midnight boundaries so date range matches Shopify/RO
        now_buc = datetime.now(ZoneInfo("Europe/Bucharest"))
        end_of_today_buc = now_buc.replace(hour=23, minute=59, second=59, microsecond=0)
        start_buc = (now_buc - timedelta(days=max(0, days - 1))).replace(hour=0, minute=0, second=0, microsecond=0)
        dt_from = start_buc.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
        dt_to = end_of_today_buc.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)

    period_days = max((dt_to - dt_from).days, 1)

    # ── Per-store UTC boundaries (for timezone-aware filtering) ──────────
    # Pre-compute the UTC start/end for each store timezone so we can
    # accurately decide whether an order falls inside the user's chosen
    # date range relative to that store's local clock.
    _store_utc_bounds: Dict[str, tuple] = {}  # store_name → (utc_start, utc_end)

    def _get_store_bounds(store_name: str) -> tuple:
        """Return (utc_start, utc_end) for a store, using its local timezone."""
        if store_name in _store_utc_bounds:
            return _store_utc_bounds[store_name]
        tz_name = STORE_TIMEZONE_MAP.get(store_name)
        if tz_name and explicit_dates:
            tz = ZoneInfo(tz_name)
            local_start = datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=tz)
            local_end = datetime.strptime(date_to, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, tzinfo=tz
            )
            bounds = (
                local_start.astimezone(ZoneInfo("UTC")).replace(tzinfo=None),
                local_end.astimezone(ZoneInfo("UTC")).replace(tzinfo=None),
            )
        else:
            bounds = (dt_from, dt_to)
        _store_utc_bounds[store_name] = bounds
        return bounds

    # Previous period of same length (for trend comparison)
    prev_from = dt_from - timedelta(days=period_days)
    prev_to = dt_from - timedelta(seconds=1)

    # ── 2. Query current + previous period orders ─────────────────────────
    # Widen the query window by 2 hours to capture orders that might fall
    # inside a store's local date range but outside Bucharest boundaries.
    query_margin = timedelta(hours=2)
    query = select(Order).where(
        Order.frisbo_created_at >= prev_from - query_margin,
        Order.frisbo_created_at <= dt_to + query_margin,
    )

    if store_uids:
        uid_list = [u.strip() for u in store_uids.split(",") if u.strip()]
        if uid_list:
            query = query.where(Order.store_uid.in_(uid_list))

    result = await db.execute(query)
    all_orders = result.scalars().all()

    # ── FX rate preload for non-RON currencies ───────────────────────────
    from app.core.timezone import romania_today
    non_ron_currencies = {(o.currency or 'RON').upper() for o in all_orders if (o.currency or 'RON').upper() != 'RON'}
    rate_cache = {}
    if non_ron_currencies:
        order_dates = [to_bucharest_date(o.frisbo_created_at) or romania_today() for o in all_orders]
        if order_dates:
            min_date = min(order_dates)
            max_date = max(order_dates)
            rate_cache = await preload_rates(non_ron_currencies, (min_date, max_date), db)

    # ── 3. Load stores + SKU costs + stock ──────────────────────────────────
    stores_result = await db.execute(select(Store))
    stores_map: Dict[str, str] = {s.uid: s.name for s in stores_result.scalars().all()}

    sku_costs_result = await db.execute(select(SkuCost))
    sku_cost_map: Dict[str, float] = {sc.sku: sc.cost for sc in sku_costs_result.scalars().all()}

    # ── Build store groups based on shared product listings ──────────────
    # ── Build SKU-level groups (merge across stores, except nubra) ──────
    # Group key = just SKU for most stores, "sku::nubra" for nubra
    stock_query = await db.execute(
        select(Product)
        .where(Product.sku.isnot(None), Product.sku != '')
    )
    all_products = stock_query.scalars().all()
    
    # Sort products by synced_at DESC so the most recently synced product comes first
    # This aligns with the 'Produse' tab logic and ignores stale stock values
    all_products.sort(
        key=lambda p: p.synced_at or p.frisbo_updated_at or p.frisbo_created_at or p.synced_at or datetime.min,
        reverse=True
    )

    # Maps
    sku_stock_map: Dict[str, int] = {}          # group_key → total stock
    sku_group_stores: Dict[str, set] = {}       # group_key → set of store_uids
    sku_product_name: Dict[str, str] = {}       # group_key → best product name
    
    # We need a quick lookup to resolve primary_listing_uid
    uid_to_product = {p.uid: p for p in all_products}

    # Group products first, exactly like the 'Produse' tab
    barcode_groups = defaultdict(list)
    sku_to_barcode = {}
    remaining = []

    for p in all_products:
        bc = (p.barcode or "").strip()
        sku = (p.sku or "").strip()
        if bc:
            barcode_groups[bc].append(p)
            if sku:
                sku_to_barcode[sku] = bc
        else:
            remaining.append(p)

    sku_only_groups = defaultdict(list)
    ungrouped = []

    for p in remaining:
        sku = (p.sku or "").strip()
        if sku and sku in sku_to_barcode:
            bc = sku_to_barcode[sku]
            barcode_groups[bc].append(p)
        elif sku:
            sku_only_groups[sku].append(p)
        else:
            ungrouped.append(p)

    # Master SKU map for orders: maps any raw SKU -> master SKU (from the primary listing)
    master_sku_map = {}

    # Initialize Maps
    sku_stock_map: Dict[str, int] = {}          # group_key → total stock
    sku_group_stores: Dict[str, set] = {}       # group_key → set of store_uids
    sku_product_name: Dict[str, str] = {}       # group_key → best product name
    sku_image_map: Dict[str, str] = {}          # group_key → image URL

    def process_product_group(group, fallback_key):
        if not group: return
        best_product = group[0]
        
        # Check if user explicitly set a primary listing
        stored_primary_uid = None
        for p in group:
            if p.primary_listing_uid:
                stored_primary_uid = p.primary_listing_uid
                break
                
        if stored_primary_uid and stored_primary_uid in uid_to_product:
            best_product = uid_to_product[stored_primary_uid]
            
        master_sku = (best_product.sku or fallback_key).strip()
        if not master_sku: return

        # Map all SKUs in this group to the master_sku
        for p in group:
            if p.sku:
                master_sku_map[p.sku.strip()] = master_sku
                
        # Sum stock across ALL listings in the group (not just primary)
        group_stock = sum(p.stock_available or 0 for p in group)
        sku_stock_map[master_sku] = group_stock
        if best_product.title_1:
            sku_product_name[master_sku] = best_product.title_1

        # Extract image URL from best product's images JSON
        if master_sku not in sku_image_map:
            imgs = best_product.images
            if imgs and isinstance(imgs, list) and len(imgs) > 0:
                sku_image_map[master_sku] = imgs[0].get('src', '') if isinstance(imgs[0], dict) else str(imgs[0])
            elif imgs and isinstance(imgs, str):
                try:
                    parsed = json.loads(imgs)
                    if parsed and isinstance(parsed, list) and len(parsed) > 0:
                        sku_image_map[master_sku] = parsed[0].get('src', '') if isinstance(parsed[0], dict) else str(parsed[0])
                except Exception:
                    pass
            
        if master_sku not in sku_group_stores:
            sku_group_stores[master_sku] = set()
            
        for p in group:
            s_uids = p.store_uids or []
            if isinstance(s_uids, str):
                try:
                    import json
                    s_uids = json.loads(s_uids)
                except Exception:
                    s_uids = []
            sku_group_stores[master_sku].update(s_uids)

    for bc, group in barcode_groups.items():
        process_product_group(group, bc)

    for sku, group in sku_only_groups.items():
        process_product_group(group, sku)

    for p in ungrouped:
        process_product_group([p], p.sku)

    def _group_key_for(sku: str, store_uid: str) -> str:
        """Compute the merge-group key."""
        if store_uid == NUBRA_UID:
            return f"{sku}::nubra"
        # Map any variant SKU to its group's master SKU
        return master_sku_map.get(sku.strip(), sku.strip())

    # ── 4. Process orders into current vs previous period ─────────────────
    # Per-SKU-group aggregation
    sku_current: Dict[str, dict] = defaultdict(lambda: {
        "sku": "", "group_key": "", "product_name": "",
        "store_uids_in_group": set(),
        "units_sold": 0, "revenue": 0.0, "orders": 0,
        "delivered_units": 0, "total_units": 0, "gross_revenue": 0.0,
        "last_sale_date": None, "daily_units": defaultdict(float),
        "by_country": defaultdict(lambda: {"units": 0, "revenue": 0.0}),
        "by_store": defaultdict(lambda: {
            "store_name": "", "store_uid": "",
            "gross_units": 0, "units_sold": 0, "gross_revenue": 0.0, "revenue": 0.0,
            "orders": 0, "daily_units": defaultdict(float),
        }),
    })
    sku_previous: Dict[str, dict] = defaultdict(lambda: {"units_sold": 0, "revenue": 0.0, "orders": 0})

    # Daily totals for trend chart
    daily_totals: Dict[str, dict] = defaultdict(lambda: {"units": 0, "revenue": 0.0, "orders": 0})

    # Store-level aggregation
    store_agg: Dict[str, dict] = defaultdict(lambda: {
        "store_name": "", "units": 0, "revenue": 0.0, "orders": 0,
        "active_skus": set(),
    })

    total_orders_current = 0
    total_orders_all = len(all_orders)

    for order in all_orders:
        # Parse line items
        items_raw = order.line_items or []
        if isinstance(items_raw, str):
            try:
                items_raw = json.loads(items_raw)
            except (json.JSONDecodeError, TypeError):
                items_raw = []

        if not items_raw:
            continue

        # Determine outcome
        final_outcome = compute_final_outcome(
            order.aggregated_status,
            order.shipment_status,
            order.fulfillment_status,
        )
        is_delivered = final_outcome in DELIVERED_OUTCOMES
        is_cancelled = final_outcome in CANCELLED_OUTCOMES

        # Country
        addr = order.shipping_address or {}
        order_country = (addr.get("country_code", "") or "").upper()
        if country_code and order_country != country_code.upper():
            continue

        order_date = order.frisbo_created_at

        # Per-store timezone-aware period classification
        store_name_for_tz = stores_map.get(order.store_uid, "")
        s_start, s_end = _get_store_bounds(store_name_for_tz)
        is_current = order_date and order_date >= s_start and order_date <= s_end
        is_prev = order_date and order_date < s_start and order_date >= (s_start - timedelta(days=period_days))

        # Parse items
        for item in items_raw:
            inv = item.get("inventory_item", {}) or {}
            sku = inv.get("sku", "") or ""
            if not sku:
                continue

            qty = float(item.get("quantity", 1) or 1)
            price = float(item.get("price", 0) or 0)
            # Convert price to RON using per-order date BNR rate
            order_currency = (order.currency or 'RON').upper()
            if order_currency != 'RON':
                fx = get_rate_from_cache(order_currency, to_bucharest_date(order.frisbo_created_at) or romania_today(), rate_cache)
                if fx is not None:
                    price = price * fx
            line_rev = price * qty
            product_name = inv.get("title_1", "") or ""

            if is_current:
                # Look up merged group for this SKU (nubra gets isolated)
                composite_key = _group_key_for(sku, order.store_uid or "")
                agg = sku_current[composite_key]
                if not agg["sku"]:
                    # Ensure the group's SKU is the master SKU, not the variant
                    agg["sku"] = composite_key.split("::")[0]
                agg["group_key"] = composite_key
                agg["store_uids_in_group"].add(order.store_uid or "")
                if not agg["product_name"]:
                    agg["product_name"] = sku_product_name.get(composite_key, "") or product_name

                # Cancelled orders are excluded from gross counts to align
                # with Shopify's "Net items sold" (which never includes
                # cancelled orders).  They are still queryable via status
                # breakdowns elsewhere.
                if not is_cancelled:
                    agg["total_units"] += qty
                    agg["gross_revenue"] += line_rev
                    agg["orders"] += 1

                    # Per-variant sub-aggregation (instead of just store)
                    # We want to show the exact variant SKU and store name in the expanded view
                    variant_key = f"{sku}::{order.store_uid or ''}"
                    if "by_variant" not in agg:
                        agg["by_variant"] = defaultdict(lambda: {
                            "sku": "", "store_uid": "", "store_name": "", "product_name": "",
                            "gross_units": 0, "units_sold": 0, "gross_revenue": 0.0, "revenue": 0.0,
                            "orders": 0, "velocity": 0.0, "daily_series": [], "daily_units": defaultdict(int),
                            "orders_list": []
                        })
                    
                    st = agg["by_variant"][variant_key]
                    st["sku"] = sku
                    st["store_uid"] = order.store_uid or ""
                    st["store_name"] = stores_map.get(order.store_uid, order.store_uid or "")
                    st["product_name"] = product_name
                    st["gross_units"] += qty
                    st["gross_revenue"] += line_rev
                    st["orders"] += 1
                    
                    # Store order details for the popup
                    st["orders_list"].append({
                        "order_number": order.order_number,
                        "date": to_bucharest_iso(order.frisbo_created_at),
                        "store_name": st["store_name"],
                        "status": order.aggregated_status or order.fulfillment_status,
                        "item_name": product_name,
                        "qty": int(qty),
                        "price": round(price, 2)
                    })

                if is_delivered:
                    agg["units_sold"] += qty
                    agg["revenue"] += line_rev
                    agg["delivered_units"] += qty
                    
                    if is_current:
                        st["units_sold"] += qty
                        st["revenue"] += line_rev

                    # Track last sale date
                    if order_date and (agg["last_sale_date"] is None or order_date > agg["last_sale_date"]):
                        agg["last_sale_date"] = order_date

                    # Daily series (global for this SKU group)
                    day_key = str(to_bucharest_date(order_date)) if order_date else "unknown"
                    agg["daily_units"][day_key] += qty
                    
                    if is_current:
                        # Daily series per variant
                        st["daily_units"][day_key] += qty

                    # By country
                    if order_country:
                        agg["by_country"][order_country]["units"] += qty
                        agg["by_country"][order_country]["revenue"] += line_rev

                    # Daily totals trend
                    daily_totals[day_key]["units"] += qty
                    daily_totals[day_key]["revenue"] += line_rev

                    # Store-level global
                    sa = store_agg[order.store_uid]
                    sa["store_name"] = stores_map.get(order.store_uid, order.store_uid)
                    sa["units"] += qty
                    sa["revenue"] += line_rev
                    sa["active_skus"].add(sku)

                if is_delivered:
                    daily_totals[str(to_bucharest_date(order_date)) if order_date else "unknown"]["orders"] += 0

            elif is_prev and is_delivered:
                prev_key = _group_key_for(sku, order.store_uid or "")
                prev = sku_previous[prev_key]
                prev["units_sold"] += qty
                prev["revenue"] += line_rev
                prev["orders"] += 1

        # Count orders for current period
        if is_current:
            total_orders_current += 1
            if is_delivered:
                day_key = str(to_bucharest_date(order_date)) if order_date else "unknown"
                daily_totals[day_key]["orders"] = daily_totals[day_key].get("orders", 0)
                # orders counted at order level, not line-item; handle dedup below

    # Dedup order counting in daily totals: re-count at order level
    daily_order_count: Dict[str, int] = defaultdict(int)
    for order in all_orders:
        if order.frisbo_created_at:
            s_name = stores_map.get(order.store_uid, "")
            s_s, s_e = _get_store_bounds(s_name)
            if order.frisbo_created_at >= s_s and order.frisbo_created_at <= s_e:
                final_outcome = compute_final_outcome(
                    order.aggregated_status, order.shipment_status, order.fulfillment_status,
                )
                if final_outcome in DELIVERED_OUTCOMES:
                    dk = str(to_bucharest_date(order.frisbo_created_at))
                    daily_order_count[dk] += 1
    for dk, cnt in daily_order_count.items():
        daily_totals[dk]["orders"] = cnt

    # Fix double-counting: store orders were counted per line item, reset and recount
    for sa in store_agg.values():
        sa["orders"] = 0
    for order in all_orders:
        if order.frisbo_created_at:
            s_name = stores_map.get(order.store_uid, "")
            s_s, s_e = _get_store_bounds(s_name)
            if order.frisbo_created_at >= s_s and order.frisbo_created_at <= s_e:
                final_outcome = compute_final_outcome(
                    order.aggregated_status, order.shipment_status, order.fulfillment_status,
                )
                if final_outcome in DELIVERED_OUTCOMES:
                    addr = order.shipping_address or {}
                    oc = (addr.get("country_code", "") or "").upper()
                    if country_code and oc != country_code.upper():
                        continue
                    store_agg[order.store_uid]["orders"] += 1

    # ── 4c. Load incoming PO stock (from active purchase orders) ──────────
    po_incoming_result = await db.execute(
        select(
            PurchaseOrderItem.sku,
            sqlfunc.sum(PurchaseOrderItem.quantity - PurchaseOrderItem.received_qty),
        )
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
        .where(PurchaseOrder.status.in_(["APPROVED", "PARTIALLY_RECEIVED"]))
        .group_by(PurchaseOrderItem.sku)
    )
    po_incoming_raw = {row[0]: max(0, int(row[1] or 0)) for row in po_incoming_result.all()}

    # Map PO incoming SKUs to their master group keys
    po_incoming_map: Dict[str, int] = {}
    for raw_sku, qty in po_incoming_raw.items():
        gk = master_sku_map.get(raw_sku.strip(), raw_sku.strip())
        po_incoming_map[gk] = po_incoming_map.get(gk, 0) + qty

    # ── 5. Build product performance list ─────────────────────────────────
    now = datetime.utcnow()
    total_revenue = sum(a["revenue"] for a in sku_current.values())
    total_units = sum(a["units_sold"] for a in sku_current.values())
    total_gross_units = sum(a["total_units"] for a in sku_current.values())
    total_gross_revenue = sum(a["gross_revenue"] for a in sku_current.values())

    products = []
    for comp_key, agg in sku_current.items():
        sku = agg["sku"]
        store_uids_in_group = agg.get("store_uids_in_group", set())
        # Build store display name from all stores in this group
        store_names = " + ".join(sorted(
            stores_map.get(u, u) for u in store_uids_in_group if u
        ))
        units = agg["units_sold"]
        gross_units = agg["total_units"]
        gross_rev = agg["gross_revenue"]
        if gross_units < min_units:
            continue

        revenue = agg["revenue"]
        unit_cost = sku_cost_map.get(sku, 0)
        velocity = _safe_div(units, period_days)

        # Previous period comparison
        prev = sku_previous.get(comp_key, {"units_sold": 0})
        prev_units = prev["units_sold"]
        prev_velocity = _safe_div(prev_units, period_days)
        velocity_change = _safe_div(velocity - prev_velocity, prev_velocity) * 100 if prev_velocity > 0 else (100.0 if velocity > 0 else 0.0)
        if velocity > prev_velocity:
            velocity_trend = "up"
        elif velocity < prev_velocity:
            velocity_trend = "down"
        else:
            velocity_trend = "stable"

        # Days since last sale
        days_since_last = None
        if agg["last_sale_date"]:
            days_since_last = (now - agg["last_sale_date"]).days

        delivery_rate = _safe_div(agg["delivered_units"], agg["total_units"]) * 100
        revenue_share = _safe_div(revenue, total_revenue) * 100

        # Daily series for sparkline — use Romanian dates for labels
        daily_series = []
        for i in range(period_days):
            d = str(to_bucharest(dt_from + timedelta(days=i)).date())
            daily_series.append({"date": d, "units": agg["daily_units"].get(d, 0)})

        # By country
        by_country = [
            {"country": cc, "units": int(cd["units"]), "revenue": round(cd["revenue"], 2)}
            for cc, cd in agg["by_country"].items()
        ]
        by_country.sort(key=lambda x: x["units"], reverse=True)

        stock = sku_stock_map.get(comp_key, 0)
        po_incoming = po_incoming_map.get(comp_key, 0)
        effective_stock = stock + po_incoming
        inv_value = round(unit_cost * stock, 2)
        image_url = sku_image_map.get(comp_key, '')

        gross_velocity = _safe_div(gross_units, period_days)
        # Use gross velocity (all orders placed) for stock coverage estimate;
        # net velocity may be 0 for short windows where deliveries haven't happened yet
        effective_velocity = gross_velocity if gross_velocity > 0 else velocity
        # Days of stock uses effective_stock (current + PO incoming)
        days_left_of_stock = round(effective_stock / effective_velocity, 1) if effective_velocity > 0 else 9999.0
        if min_days_left is not None and days_left_of_stock < min_days_left:
            continue
        if max_days_left is not None and days_left_of_stock > max_days_left:
            continue

        # Build per-variant breakdown
        by_variant_list = []
        for var_key, var_data in agg.get("by_variant", {}).items():
            var_velocity = _safe_div(var_data["units_sold"], period_days)
            var_daily = []
            for i in range(period_days):
                d = str(to_bucharest(dt_from + timedelta(days=i)).date())
                var_daily.append({"date": d, "units": var_data["daily_units"].get(d, 0)})
            by_variant_list.append({
                "variant_key": var_key,
                "sku": var_data["sku"],
                "store_uid": var_data["store_uid"],
                "store_name": var_data["store_name"],
                "product_name": var_data["product_name"],
                "gross_units": int(var_data["gross_units"]),
                "units_sold": int(var_data["units_sold"]),
                "gross_revenue": round(var_data["gross_revenue"], 2),
                "revenue": round(var_data["revenue"], 2),
                "orders": var_data["orders"],
                "velocity": round(var_velocity, 2),
                "daily_series": var_daily,
                "orders_list": var_data.get("orders_list", []),
            })
        by_variant_list.sort(key=lambda x: x["units_sold"], reverse=True)

        products.append({
            "sku": sku,
            "store_uid": "|".join(sorted(store_uids_in_group)),
            "store_name": store_names,
            "product_name": agg["product_name"],
            "stores_count": len(store_uids_in_group),
            "gross_units": int(gross_units),
            "gross_revenue": round(gross_rev, 2),
            "gross_velocity": round(gross_velocity, 2),
            "units_sold": int(units),
            "revenue": round(revenue, 2),
            "orders": agg["orders"],
            "avg_qty_per_order": round(_safe_div(units, agg["orders"]), 2),
            "velocity": round(velocity, 2),
            "prev_velocity": round(prev_velocity, 2),
            "velocity_change_pct": round(velocity_change, 1),
            "velocity_trend": velocity_trend,
            "days_since_last_sale": days_since_last,
            "delivery_rate": round(delivery_rate, 1),
            "revenue_share": round(revenue_share, 2),
            "daily_series": daily_series,
            "by_country": by_country[:10],
            "by_variant": by_variant_list,
            "stock_available": stock,
            "po_incoming": po_incoming,
            "effective_stock": effective_stock,
            "days_left_of_stock": days_left_of_stock,
            "unit_cost": round(unit_cost, 2),
            "inventory_value": inv_value,
            "image_url": image_url,
        })

    products.sort(key=lambda p: p["velocity"], reverse=True)

    # ── 6. Global KPIs ───────────────────────────────────────────────────
    unique_skus = len([p for p in products if p["units_sold"] > 0])
    delivered_orders = sum(daily_order_count.values())
    top_sku = products[0]["sku"] if products else None

    kpis = {
        "total_gross_units": int(total_gross_units),
        "total_gross_revenue": round(total_gross_revenue, 2),
        "total_units": int(total_units),
        "total_revenue": round(total_revenue, 2),
        "unique_skus": unique_skus,
        "avg_units_per_day": round(_safe_div(total_units, period_days), 1),
        "avg_order_value": round(_safe_div(total_revenue, delivered_orders), 2) if delivered_orders else 0,
        "top_sku": top_sku,
        "delivered_orders": delivered_orders,
    }

    # ── 7. Daily trends (sorted) ──────────────────────────────────────────
    trends_list = []
    for i in range(period_days):
        d = str(to_bucharest(dt_from + timedelta(days=i)).date())
        dt = daily_totals.get(d, {"units": 0, "revenue": 0.0, "orders": 0})
        trends_list.append({
            "date": d,
            "units": int(dt["units"]),
            "revenue": round(dt["revenue"], 2),
            "orders": dt.get("orders", 0),
        })

    # ── 8. Store comparison ───────────────────────────────────────────────
    store_comparison = []
    for store_uid, sa in store_agg.items():
        # Products now have store_uid as pipe-separated UIDs (e.g. "uid1|uid2")
        store_skus = [p for p in products if store_uid in (p.get("store_uid") or "").split("|")]
        store_skus.sort(key=lambda x: x["velocity"], reverse=True)
        top5 = [{"sku": s["sku"], "velocity": s["velocity"], "units_sold": s["units_sold"]} for s in store_skus[:5]]

        store_comparison.append({
            "store_uid": store_uid,
            "store_name": sa["store_name"],
            "units": int(sa["units"]),
            "revenue": round(sa["revenue"], 2),
            "orders": sa["orders"],
            "velocity": round(_safe_div(sa["units"], period_days), 2),
            "active_skus": len(sa["active_skus"]),
            "top5": top5,
        })
    store_comparison.sort(key=lambda x: x["velocity"], reverse=True)

    # ── 9. Alerts & insights ──────────────────────────────────────────────
    alerts = []

    for p in products:
        # 🔥 Hot Products: velocity up >50%
        if p["velocity_change_pct"] > 50 and p["prev_velocity"] > 0 and p["units_sold"] >= 10:
            alerts.append({
                "type": "hot",
                "sku": p["sku"],
                "product_name": p["product_name"],
                "message": f"Viteză crescută +{p['velocity_change_pct']:.0f}% ({p['prev_velocity']} → {p['velocity']} u/zi)",
                "metric": p["velocity_change_pct"],
            })

        # ⚠️ Declining Fast: velocity down >40%
        if p["velocity_change_pct"] < -40 and p["prev_velocity"] > 0.5:
            alerts.append({
                "type": "declining",
                "sku": p["sku"],
                "product_name": p["product_name"],
                "message": f"Viteză scăzută {p['velocity_change_pct']:.0f}% ({p['prev_velocity']} → {p['velocity']} u/zi)",
                "metric": p["velocity_change_pct"],
            })

        # ❄️ Cold Products: no sales in last 14 days but had sales before
        if p["days_since_last_sale"] is not None and p["days_since_last_sale"] >= 14 and p["units_sold"] >= 5:
            alerts.append({
                "type": "cold",
                "sku": p["sku"],
                "product_name": p["product_name"],
                "message": f"Fără vânzări de {p['days_since_last_sale']} zile (avea {p['units_sold']} unități în perioadă)",
                "metric": p["days_since_last_sale"],
            })

        # 🌟 New Stars: appear only in current period with good volume
        if p["prev_velocity"] == 0 and p["velocity"] > 0 and p["units_sold"] >= 20:
            alerts.append({
                "type": "new_star",
                "sku": p["sku"],
                "product_name": p["product_name"],
                "message": f"Produs nou cu {p['units_sold']} unități vândute ({p['velocity']} u/zi)",
                "metric": p["units_sold"],
            })

    # 💀 Dead Stock: COGS > 0 but zero sales
    for sku, cost in sku_cost_map.items():
        if cost > 0 and sku not in sku_current:
            alerts.append({
                "type": "dead_stock",
                "sku": sku,
                "product_name": "",
                "message": f"Cost produs {cost:.2f} RON dar 0 vânzări în perioadă",
                "metric": cost,
            })

    # Sort: hot first, declining, cold, dead, new_star
    alert_order = {"hot": 0, "declining": 1, "cold": 2, "dead_stock": 3, "new_star": 4}
    alerts.sort(key=lambda a: (alert_order.get(a["type"], 99), -abs(a["metric"])))

    # ── 10. Response ──────────────────────────────────────────────────────
    return {
        "kpis": kpis,
        "products": products,
        "trends": trends_list,
        "store_comparison": store_comparison,
        "alerts": alerts,
        "meta": {
            "date_from": to_bucharest_iso(dt_from),
            "date_to": to_bucharest_iso(dt_to),
            "period_days": period_days,
            "total_orders": total_orders_all,
            "filters": {
                "store_uids": store_uids,
                "country_code": country_code,
                "min_units": min_units,
            },
        },
    }
