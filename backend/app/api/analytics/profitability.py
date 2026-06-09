"""
Profitability P&L analytics endpoint — the core financial reporting module.

Edit THIS file for P&L formula changes, cost allocation logic, and VAT handling.

Changes from v1:
- Smart transport cost fallback (CSV → same-SKU → brand avg → customer-paid)
- Agency commission REMOVED from per-order calculation (now monthly business cost)
- Multi-AWB support via order_awbs table
"""

from datetime import datetime, timedelta
from typing import Optional
from collections import defaultdict
import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.line_items_projection import PROJECTED_LINE_ITEMS, sku_hash as _sku_hash
from app.core.timezone import (
    date_str_to_utc_start,
    date_str_to_utc_end,
    to_bucharest_date,
    romania_today,
)
from app.core.status_classification import classify
from app.core.vat import resolve_vat_rate, country_for_store
from app.core.analytics_cache import cached_analytics
from app.core.order_filters import (
    load_exclusion_rules,
    tag_condition,
    order_has_excluded_sku,
)
from app.models import Order, Store, SkuCost
from app.models.product import Product
from app.models.business_cost import BusinessCost
from app.api.profitability_config import get_or_create_config

router = APIRouter()
logger = logging.getLogger(__name__)

# The scalar Order columns the P&L loop reads — everything except line_items, which
# is replaced by the shared PROJECTED_LINE_ITEMS column (slimmed {sku,q,p} JSON, see
# app/core/line_items_projection). Selecting these instead of `select(Order)` avoids
# instantiating full ORM rows and streaming ~20 unused keys/item over the wire.
_PNL_ORDER_COLS = (
    Order.currency,
    Order.frisbo_created_at,
    Order.total_price,
    Order.subtotal_price,
    Order.aggregated_status,
    Order.store_uid,
    Order.transport_cost,
    Order.payment_gateway,
)


@router.get("/profitability")
@cached_analytics("profitability")
async def get_overall_profitability(
    db: AsyncSession = Depends(get_db),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    days: Optional[int] = 30,
    store_uids: Optional[str] = None,
):
    """
    Returns total aggregated profitability and per-store profitability.
    """

    # Determine the reference date for VAT rate (August 1, 2025 cutoff)
    # Default is utcnow if neither date_to nor days implies a historical period,
    # but since days defaults to 30, we'll anchor to date_to or now.
    ref_date = datetime.utcnow()
    if date_to:
        # e.g. "2025-07-31" parses to a date that is < Aug 1
        try:
            ref_date = datetime.strptime(date_to, "%Y-%m-%d")
        except ValueError:
            pass

    cutoff_date = datetime(2025, 8, 1)
    # Load profitability config
    config = await get_or_create_config(db)
    db.expunge(config)
    dynamic_vat_rate = 0.19 if ref_date < cutoff_date else (config.vat_rate or 0.21)
    """
    Calculate profitability based on order prices, SKU costs, and operational costs.
    
    Enhanced profitability logic includes:
    - SKU costs (from sku_costs table)
    - Shipping cost (from CSV import, with smart fallback chain)
    - Packaging cost (configurable per order)
    - GT commission (configurable %, GT store only)
    - Payment processing fee (configurable % + fixed)
    - Frisbo fulfillment fee (configurable per order)
    - VAT calculation (gross vs net profit)
    
    Transport cost fallback chain:
    1. order.transport_cost (from CSV import, summed across all AWBs)
    2. Most recent delivered order with same SKU set that has mapped cost
    3. Average transport cost per store in last 30 days
    4. revenue - subtotal (customer-paid shipping, last resort)
    """
    from app.api.exchange_rates import (
        preload_rates,
        get_rate_from_cache,
    )

    # Parse store_uids if provided
    store_uid_list = None
    if store_uids:
        store_uid_list = [s.strip() for s in store_uids.split(",")]

    # Build conditions — configurable exclusion: built-in test/sample tags + user
    # tag rules in SQL; user SKU rules applied in the per-order loop below.
    excluded_tags, excluded_skus = await load_exclusion_rules(db)
    conditions = [tag_condition(excluded_tags)]
    if store_uid_list:
        conditions.append(Order.store_uid.in_(store_uid_list))
    if date_from and date_to:
        conditions.append(Order.frisbo_created_at >= date_str_to_utc_start(date_from))
        conditions.append(Order.frisbo_created_at <= date_str_to_utc_end(date_to))
    elif days:
        from app.core.timezone import romania_now, UTC_TZ

        now_buc = romania_now()
        start_buc = (now_buc - timedelta(days=max(0, days - 1))).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        cutoff = start_buc.astimezone(UTC_TZ).replace(tzinfo=None)
        conditions.append(Order.frisbo_created_at >= cutoff)

    # Build query for all orders matching conditions. Select only the scalar
    # columns the loop needs + the projected (slimmed) line_items — NOT full ORM
    # rows. Returns Row objects whose attributes (order.currency, order.li, …) the
    # loop reads exactly like the old ORM objects.
    query = select(*_PNL_ORDER_COLS, PROJECTED_LINE_ITEMS)
    if conditions:
        query = query.where(and_(*conditions))

    result = await db.execute(query)
    orders = result.all()

    # Get all SKU costs as a lookup
    sku_costs_result = await db.execute(select(SkuCost))
    sku_costs_map = {sc.sku: sc.cost for sc in sku_costs_result.scalars().all()}

    # Exclude products marked as "do not take into account to stock" from COGS ONLY
    # (drop them from the cost map so they contribute no COGS). This is a SEPARATE
    # concept from the configurable SKU *exclusion rules* (`excluded_skus`, line 120)
    # which drop a WHOLE order. Keep the two in distinct variables — a prior bug reused
    # `excluded_skus` here, so the whole-order skip below silently dropped every order
    # containing a gift/bundle SKU (e.g. `surpriza-EST 41`) = 1,696 delivered orders /
    # ~219K RON vanished from the P&L.
    cogs_excluded_result = await db.execute(
        select(Product.sku).where(
            Product.exclude_from_stock == True, Product.sku.isnot(None)
        )
    )
    cogs_excluded_skus = {row[0] for row in cogs_excluded_result.all()}
    if cogs_excluded_skus:
        for esku in cogs_excluded_skus:
            sku_costs_map.pop(esku, None)
        logger.info(
            f"P&L: excluded {len(cogs_excluded_skus)} SKUs from COGS (exclude_from_stock=True)"
        )

    # Get store names + derive each store's country for per-country VAT.
    stores_result = await db.execute(select(Store))
    _stores = stores_result.scalars().all()
    store_names = {s.uid: s.name for s in _stores}
    store_country = {
        s.uid: country_for_store(s.name, s.shopify_domain) for s in _stores
    }

    # --- Preload exchange rates for non-RON orders ---
    non_ron_currencies = {
        (o.currency or "RON").upper()
        for o in orders
        if (o.currency or "RON").upper() != "RON"
    }
    rate_cache = {}
    if non_ron_currencies:
        order_dates = [
            to_bucharest_date(o.frisbo_created_at) or romania_today() for o in orders
        ]
        min_date = min(order_dates)
        max_date = max(order_dates)
        rate_cache = await preload_rates(non_ron_currencies, (min_date, max_date), db)

    # --- Build transport cost fallback caches ---
    # Cache 1: SKU hash → most recent delivered order's transport_cost
    sku_hash_cost_cache = {}
    # Cache 2: store_uid → average transport cost (last 30 days, delivered)
    store_avg_transport = {}

    # Build SKU hash fallback: query delivered orders with transport_cost set
    from app.core.timezone import romania_now, UTC_TZ

    now_buc = romania_now()
    start_buc_30d = (now_buc - timedelta(days=max(0, 30 - 1))).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    cutoff_30d = start_buc_30d.astimezone(UTC_TZ).replace(tzinfo=None)
    # Same projection trick as the main query: pull only store_uid, transport_cost
    # and the slimmed line_items (for the SKU-hash) instead of full ORM rows —
    # ~12s -> ~2s on the ~35k delivered orders this scans.
    fallback_result = await db.execute(
        select(
            Order.store_uid,
            Order.transport_cost,
            Order.frisbo_created_at,
            PROJECTED_LINE_ITEMS,
        )
        .where(
            and_(
                Order.aggregated_status == "delivered",
                Order.transport_cost.isnot(None),
                Order.transport_cost > 0,
                Order.frisbo_created_at >= cutoff_30d,
            )
        )
        .order_by(Order.frisbo_created_at.desc())
    )
    fallback_orders = fallback_result.all()

    # Build per-store average and per-SKU-hash cache
    store_transport_sums = defaultdict(lambda: {"total": 0, "count": 0})
    for fo in fallback_orders:
        # Per-store average
        store_transport_sums[fo.store_uid]["total"] += fo.transport_cost
        store_transport_sums[fo.store_uid]["count"] += 1

        # SKU hash cache (first match = most recent due to DESC ordering)
        sh = _sku_hash(fo.li)
        if sh and sh not in sku_hash_cost_cache:
            sku_hash_cost_cache[sh] = fo.transport_cost

    for sid, data in store_transport_sums.items():
        if data["count"] > 0:
            store_avg_transport[sid] = round(data["total"] / data["count"], 2)

    # Track fallback usage for diagnostics
    fallback_stats = {
        "csv_import": 0,
        "same_sku": 0,
        "brand_avg": 0,
        "customer_paid": 0,
        "zero": 0,
    }

    # Initialize aggregation structures
    # `*_fara` keys hold the net-of-VAT sum accumulated PER ORDER using each
    # order's own country/date VAT rate (per-country VAT — Finding H). The plain
    # keys hold the cu_tva (gross) sum. The P&L reads fara directly from these
    # accumulators instead of dividing a mixed-country aggregate by one rate.
    _metric_keys = (
        "count",
        "revenue",
        "revenue_fara",
        "sku_costs",
        "sku_costs_fara",
        "shipping",
        "shipping_fara",
        "packaging",
        "gt_commission",
        "gt_commission_fara",
        "payment_fee",
        "payment_fee_fara",
        "frisbo_fee",
        "frisbo_fee_fara",
        "total_costs",
        "profit_gross",
        "profit_net",
    )
    stats = {
        cat: {k: 0 for k in _metric_keys}
        for cat in ("delivered", "returned", "cancelled", "in_transit", "other")
    }

    per_store = {}
    sku_profit_map = {}
    missing_sku_costs = set()
    unconvertible_currencies = set()
    unconvertible_count = 0

    for order in orders:
        order_currency = (order.currency or "RON").upper()
        order_date = to_bucharest_date(order.frisbo_created_at) or romania_today()

        # Configurable SKU exclusion: drop the whole order if it contains an
        # excluded SKU (Scripturi rule_type='sku' parity).
        if excluded_skus and order_has_excluded_sku(order.li, excluded_skus):
            continue

        # Revenue in original currency
        revenue_orig = order.total_price or 0
        subtotal_orig = order.subtotal_price or 0

        # Convert to RON if needed
        if order_currency != "RON":
            fx_rate = get_rate_from_cache(order_currency, order_date, rate_cache)
            if fx_rate is not None:
                revenue = round(revenue_orig * fx_rate, 2)
                subtotal = round(subtotal_orig * fx_rate, 2)
            else:
                # No BNR rate within the fallback window — this order cannot be
                # expressed in RON. EXCLUDE it from the P&L entirely: summing the
                # raw foreign amount 1:1 as RON (the old behaviour) corrupted every
                # total it touched (Finding Q). Surfaced — not silently dropped —
                # via unconvertible_currencies + unconvertible_count below.
                unconvertible_currencies.add(order_currency)
                unconvertible_count += 1
                continue
        else:
            revenue = revenue_orig
            subtotal = subtotal_orig

        status = order.aggregated_status or "other"
        store_uid = order.store_uid

        # --- Smart transport cost fallback chain ---
        if order.transport_cost is not None and order.transport_cost > 0:
            # Priority 1: Real CSV-imported cost (summed across all AWBs)
            shipping_cost = order.transport_cost
            fallback_stats["csv_import"] += 1
        else:
            # Priority 2: Same-SKU delivered order cost
            sh = _sku_hash(order.li)
            if sh and sh in sku_hash_cost_cache:
                shipping_cost = sku_hash_cost_cache[sh]
                fallback_stats["same_sku"] += 1
            elif store_uid in store_avg_transport:
                # Priority 3: Brand/store average (last 30 days)
                shipping_cost = store_avg_transport[store_uid]
                fallback_stats["brand_avg"] += 1
            else:
                # Priority 4: Customer-paid shipping (last resort)
                customer_shipping = max(0, revenue - subtotal)
                if customer_shipping > 0:
                    shipping_cost = customer_shipping
                    fallback_stats["customer_paid"] += 1
                else:
                    shipping_cost = 0
                    fallback_stats["zero"] += 1

        # Calculate SKU costs from line items. `order.li` is the projected shape:
        # a list of {"sku": str|None, "q": number, "p": number}. quantity is always
        # whole here, so coerce to int to preserve the legacy response shape.
        order_sku_cost = 0
        line_items = order.li or []
        if isinstance(line_items, list):
            for item in line_items:
                if isinstance(item, dict):
                    sku = item.get("sku")
                    qty = int(item.get("q") or 1)
                    price = item.get("p") or 0
                    if sku and sku in sku_costs_map:
                        item_cost = sku_costs_map[sku] * qty
                        order_sku_cost += item_cost

                        # Track per-SKU profit
                        if sku not in sku_profit_map:
                            sku_profit_map[sku] = {
                                "sku": sku,
                                "revenue": 0,
                                "cost": 0,
                                "profit": 0,
                                "qty": 0,
                            }
                        # For SKU revenue, use the RON-converted price
                        if order_currency != "RON":
                            fx_rate = get_rate_from_cache(
                                order_currency, order_date, rate_cache
                            )
                            item_revenue_ron = (
                                round(price * qty * fx_rate, 2)
                                if fx_rate
                                else price * qty
                            )
                        else:
                            item_revenue_ron = price * qty
                        sku_profit_map[sku]["revenue"] += item_revenue_ron
                        sku_profit_map[sku]["cost"] += item_cost
                        sku_profit_map[sku]["profit"] += item_revenue_ron - item_cost
                        sku_profit_map[sku]["qty"] += qty
                    elif sku:
                        missing_sku_costs.add(sku)

        # --- Determine category first (affects which costs apply) ---
        # Single source of truth: app/core/status_classification.classify().
        # refused/unsuccessful_delivery are folded into 'returned' (the parcel
        # physically came back = a transport loss), consistent with the
        # deliverability tab. See Finding B in docs/REPORTS_AUDIT.
        cat = classify(status)

        # --- For returned/cancelled orders: COGS = 0 (products come back) ---
        if cat in ("returned", "cancelled"):
            order_sku_cost = 0

        # --- Operational costs (only for orders that were actually processed) ---
        if cat == "cancelled":
            # Cancelled orders were never shipped/packed — no operational costs
            packaging_cost = 0
            gt_commission = 0
            payment_fee = 0
            frisbo_fee = 0
            total_costs = 0
            profit_gross = 0
        else:
            packaging_cost = config.packaging_cost_per_order

            # GT commission: % of revenue, GT store only
            gt_commission = 0.0
            if (
                config.gt_commission_store_uid
                and store_uid == config.gt_commission_store_uid
            ):
                gt_commission = revenue * config.gt_commission_pct / 100.0

            # COD orders (gateway = "Plată ramburs") have no card processing fee
            is_card_payment = (
                not (order.payment_gateway or "").lower().startswith("plat")
            )
            if is_card_payment:
                payment_fee = (
                    revenue * config.payment_processing_pct / 100.0
                    + config.payment_processing_fixed
                )
            else:
                payment_fee = 0.0

            # Frisbo fee
            frisbo_fee = config.frisbo_fee_per_order

            # Total costs (agency commission REMOVED — now handled as monthly business cost)
            total_costs = (
                order_sku_cost
                + shipping_cost
                + gt_commission
                + payment_fee
                + frisbo_fee
            )

            # Profit based on category
            if cat == "delivered":
                profit_gross = revenue - total_costs
            elif cat == "returned":
                profit_gross = -(
                    shipping_cost
                )  # Loss: only shipping (products can be resold)
            elif cat == "in_transit":
                profit_gross = revenue - total_costs  # Expected
            else:
                profit_gross = 0

        # Per-country, time-aware VAT for THIS order (Finding H). RO carries the
        # 19%->21% (2025-08-01) time-split; PL/BG/CZ use their own standard rate.
        order_vat = resolve_vat_rate(store_country.get(store_uid), order_date)
        _vd = (1 + order_vat) if order_vat > 0 else 1.0

        # Net profit after VAT (this order's own rate)
        profit_net = profit_gross / _vd if profit_gross != 0 else profit_gross

        # Aggregate into stats — plain keys are cu_tva (gross); *_fara keys are the
        # net-of-VAT sum using each order's own rate, summed for the P&L below.
        stats[cat]["count"] += 1
        stats[cat]["revenue"] += revenue
        stats[cat]["revenue_fara"] += revenue / _vd
        stats[cat]["sku_costs"] += order_sku_cost
        stats[cat]["sku_costs_fara"] += order_sku_cost / _vd
        stats[cat]["shipping"] += shipping_cost
        stats[cat]["shipping_fara"] += shipping_cost / _vd
        stats[cat]["packaging"] += packaging_cost
        stats[cat]["gt_commission"] += gt_commission
        stats[cat]["gt_commission_fara"] += gt_commission / _vd
        stats[cat]["payment_fee"] += payment_fee
        stats[cat]["payment_fee_fara"] += payment_fee / _vd
        stats[cat]["frisbo_fee"] += frisbo_fee
        stats[cat]["frisbo_fee_fara"] += frisbo_fee / _vd
        stats[cat]["total_costs"] += total_costs
        stats[cat]["profit_gross"] += profit_gross
        stats[cat]["profit_net"] += profit_net

        # Per-store aggregation
        store_name = store_names.get(store_uid, "Unknown")
        if store_uid not in per_store:
            per_store[store_uid] = {
                "store_uid": store_uid,
                "store_name": store_name,
                "count": 0,
                "revenue": 0,
                "sku_costs": 0,
                "shipping": 0,
                "packaging": 0,
                "gt_commission": 0,
                "payment_fee": 0,
                "frisbo_fee": 0,
                "total_costs": 0,
                "profit_gross": 0,
                "profit_net": 0,
                "gross_sales": 0,
                "returns_cancelled_revenue": 0,
                "returns_cancelled_count": 0,
                # Per-status breakdown for unrealized gains
                "status_breakdown": {
                    "in_transit": {"count": 0, "revenue": 0},
                    "returned": {"count": 0, "revenue": 0},
                    "cancelled": {"count": 0, "revenue": 0},
                    "other": {"count": 0, "revenue": 0},
                },
            }

        # Track gross sales (all orders) and returns/cancelled
        per_store[store_uid]["gross_sales"] += revenue
        if cat in ("returned", "cancelled"):
            per_store[store_uid]["returns_cancelled_revenue"] += revenue
            per_store[store_uid]["returns_cancelled_count"] += 1

        # Track per-status breakdown (all non-delivered statuses)
        if cat != "delivered":
            sb = per_store[store_uid]["status_breakdown"]
            status_key = cat if cat in sb else "other"
            sb[status_key]["count"] += 1
            sb[status_key]["revenue"] += revenue

        # Delivered orders: detailed cost tracking
        if cat == "delivered":
            per_store[store_uid]["count"] += 1
            per_store[store_uid]["revenue"] += revenue
            per_store[store_uid]["sku_costs"] += order_sku_cost
            per_store[store_uid]["shipping"] += shipping_cost
            per_store[store_uid]["packaging"] += packaging_cost
            per_store[store_uid]["gt_commission"] += gt_commission
            per_store[store_uid]["payment_fee"] += payment_fee
            per_store[store_uid]["frisbo_fee"] += frisbo_fee
            per_store[store_uid]["total_costs"] += total_costs
            per_store[store_uid]["profit_gross"] += profit_gross
            per_store[store_uid]["profit_net"] += profit_net

    # Round per-store values
    # Convert per_store dict to sorted list (by revenue desc)
    store_list = list(per_store.values())
    for s in store_list:
        for key in [
            "revenue",
            "sku_costs",
            "shipping",
            "packaging",
            "gt_commission",
            "payment_fee",
            "frisbo_fee",
            "total_costs",
            "profit_gross",
            "profit_net",
        ]:
            s[key] = round(s[key], 2)
        s["margin_pct"] = round(
            (s["profit_gross"] / s["revenue"] * 100) if s["revenue"] > 0 else 0, 1
        )
    store_list.sort(key=lambda x: x["revenue"], reverse=True)

    # Top profitable SKUs
    top_skus = sorted(sku_profit_map.values(), key=lambda x: x["profit"], reverse=True)[
        :20
    ]
    for sku_data in top_skus:
        for key in ["revenue", "cost", "profit"]:
            sku_data[key] = round(sku_data[key], 2)

    # Summary totals (delivered only for realized, in_transit for expected)
    realized_revenue = stats["delivered"]["revenue"]
    realized_costs = stats["delivered"]["total_costs"]
    realized_profit_gross = stats["delivered"]["profit_gross"]
    realized_profit_net = stats["delivered"]["profit_net"]

    pending_revenue = stats["in_transit"]["revenue"]
    pending_costs = stats["in_transit"]["total_costs"]
    pending_profit_gross = stats["in_transit"]["profit_gross"]
    pending_profit_net = stats["in_transit"]["profit_net"]

    return_loss = abs(stats["returned"]["profit_gross"])

    total_revenue = realized_revenue + pending_revenue
    margin_pct = (
        (realized_profit_gross / realized_revenue * 100) if realized_revenue > 0 else 0
    )

    net_margin_pct = (
        (realized_profit_net / realized_revenue * 100) if realized_revenue > 0 else 0
    )

    # --- Helper: split a value into cu_tva / fara_tva ---
    def tva_split(val):
        return {
            "cu_tva": round(val, 2),
            "fara_tva": round(val / (1 + dynamic_vat_rate), 2)
            if dynamic_vat_rate > 0
            else round(val, 2),
        }

    def no_tva_split(val):
        """For costs without Romanian TVA (e.g. foreign ad platforms)."""
        return {"cu_tva": round(val, 2), "fara_tva": round(val, 2)}

    def cf(cu, fara):
        """Build a cu_tva/fara_tva split from explicitly-accumulated gross + net
        values (used for order-derived lines whose net was summed per order with
        each order's own country VAT rate)."""
        return {"cu_tva": round(cu, 2), "fara_tva": round(fara, 2)}

    # --- P&L structure matching Apps Script ---
    # Gross Sales = revenue from ALL orders (including returned/cancelled)
    d = stats["delivered"]
    gross_sales = sum(stats[s]["revenue"] for s in stats)
    returns_cancelled_revenue = (
        stats["returned"]["revenue"] + stats["cancelled"]["revenue"]
    )
    net_revenue = d["revenue"]  # Only delivered orders (cu_tva)
    net_revenue_fara = d["revenue_fara"]  # net of each order's own (per-country) VAT

    # COGS = only delivered orders SKU costs (returned/cancelled have 0 COGS)
    total_cogs = d["sku_costs"]
    total_cogs_fara = d["sku_costs_fara"]

    # Warehouse salary: cost per shipped package (No TVA)
    shipped_count = (
        d["count"] + stats["in_transit"]["count"]
    )  # delivered + in_transit = total shipped
    warehouse_salary_total = shipped_count * config.warehouse_salary_per_package

    # Operational = Shipping + Frisbo + GT + Payment + Warehouse Salary (Packaging excluded)
    total_operational_val = (
        d["shipping"] + d["frisbo_fee"] + d["gt_commission"] + d["payment_fee"]
    )
    total_operational_fara_val = (
        d["shipping_fara"]
        + d["frisbo_fee_fara"]
        + d["gt_commission_fara"]
        + d["payment_fee_fara"]
    )
    total_operational_cu = round(total_operational_val + warehouse_salary_total, 2)
    # Warehouse salary has no TVA, so it is added to the fara side as-is.
    total_operational_fara = round(
        total_operational_fara_val + warehouse_salary_total, 2
    )

    # Gross Profit Dict (per-country fara)
    gross_profit_dict = {
        "cu_tva": round(net_revenue - total_cogs, 2),
        "fara_tva": round(net_revenue_fara - total_cogs_fara, 2),
    }

    # Operating Profit Dict
    operating_profit_dict = {
        "cu_tva": round(gross_profit_dict["cu_tva"] - total_operational_cu, 2),
        "fara_tva": round(gross_profit_dict["fara_tva"] - total_operational_fara, 2),
    }

    # --- Fetch marketing costs from Google Sheets ---
    marketing_costs = {}
    marketing_total = {"facebook": 0, "tiktok": 0, "google": 0, "total": 0}
    try:
        from app.services.google_sheets import get_marketing_costs

        # Determine date range for marketing costs query
        if date_from and date_to:
            mkt_date_from = datetime.strptime(date_from, "%Y-%m-%d").date()
            mkt_date_to = datetime.strptime(date_to, "%Y-%m-%d").date()
        elif days:
            mkt_date_to = romania_today()
            mkt_date_from = mkt_date_to - timedelta(days=max(0, days - 1))
        else:
            mkt_date_to = romania_today()
            mkt_date_from = mkt_date_to - timedelta(days=max(0, 30 - 1))

        marketing_costs = await get_marketing_costs(mkt_date_from, mkt_date_to, db=db)
        marketing_total = marketing_costs.get(
            "__total__", {"facebook": 0, "tiktok": 0, "google": 0, "total": 0}
        )
        logger.info(
            f"📊 Marketing costs loaded: FB={marketing_total['facebook']}, TT={marketing_total['tiktok']}, G={marketing_total['google']}"
        )
    except Exception as e:
        logger.error(f"Failed to fetch marketing costs: {e}")
        import traceback

        traceback.print_exc()

    # --- Load business costs from DB for the relevant period ---
    if date_from:
        dt = datetime.strptime(date_from, "%Y-%m-%d")
        month_key = f"{dt.year}-{dt.month:02d}"
    else:
        today_ro = romania_today()
        month_key = f"{today_ro.year}-{today_ro.month:02d}"

    biz_costs_result = await db.execute(
        select(BusinessCost).where(BusinessCost.month == month_key)
    )
    biz_costs_all = biz_costs_result.scalars().all()

    # Aggregate business costs by category for the TOTAL P&L (scope="all" costs)
    # Aggregate business costs by category AND by P&L section
    biz_cost_categories = [
        "salary",
        "utility",
        "subscription",
        "marketing",
        "rent",
        "other",
    ]
    total_fixed_costs = {cat: 0.0 for cat in biz_cost_categories}
    total_fixed_costs_total = 0.0

    # TVA-aware split helper for business costs
    def biz_tva_split(val, has_tva_flag):
        """Use tva_split or no_tva_split based on per-item TVA flag."""
        if has_tva_flag:
            return tva_split(val)
        return no_tva_split(val)

    # Also build per-store cost maps: { store_uid: { category: amount } }
    store_fixed_costs = {}  # store_uid -> { category: amount }

    # Build business costs grouped by P&L section for the response
    # { section: [ { label, amount, has_tva, cu_tva, fara_tva, display_order, ... } ] }
    biz_costs_by_section = {"cogs": [], "operational": [], "marketing": [], "fixed": []}
    biz_costs_section_totals = {
        "cogs": 0.0,
        "operational": 0.0,
        "marketing": 0.0,
        "fixed": 0.0,
    }

    # Collect all store UIDs we know about
    all_store_uids = [s["store_uid"] for s in store_list]

    for bc in biz_costs_all:
        cat = bc.category if bc.category in biz_cost_categories else "other"
        amount = bc.amount or 0
        has_tva_flag = bc.has_tva if bc.has_tva is not None else True
        section = bc.pnl_section or "fixed"
        if section not in biz_costs_by_section:
            section = "fixed"

        # Build the per-item entry for the response
        split = biz_tva_split(amount, has_tva_flag)
        biz_costs_by_section[section].append(
            {
                "id": bc.id,
                "label": bc.label,
                "category": cat,
                "amount": amount,
                "has_tva": has_tva_flag,
                "cu_tva": split["cu_tva"],
                "fara_tva": split["fara_tva"],
                "display_order": bc.display_order or 0,
                "scope": bc.scope,
                "store_uids": bc.store_uids,
            }
        )

        if bc.scope == "all":
            # Business-wide cost → add to total P&L
            total_fixed_costs[cat] += amount
            total_fixed_costs_total += amount
            biz_costs_section_totals[section] += amount
        elif bc.scope in ("store", "stores") and bc.store_uids:
            # Store-specific cost → add to each affected store
            affected_uids = bc.store_uids if isinstance(bc.store_uids, list) else []
            for uid in affected_uids:
                if uid not in store_fixed_costs:
                    store_fixed_costs[uid] = {c: 0.0 for c in biz_cost_categories}
                store_fixed_costs[uid][cat] += amount
                # Also add to total P&L aggregate
                total_fixed_costs[cat] += amount
                total_fixed_costs_total += amount
                biz_costs_section_totals[section] += amount

    # Sort items within each section by display_order
    for section in biz_costs_by_section:
        biz_costs_by_section[section].sort(key=lambda x: x["display_order"])

    # Build the fixed_costs breakdown for total P&L (handling has_tva property correctly)
    fixed_costs_dict_total = {"cu_tva": 0.0, "fara_tva": 0.0}
    for bc in biz_costs_all:
        amt = bc.amount if bc.cost_type != "credit" else -bc.amount
        spl = tva_split(amt) if (bc.has_tva is not False) else no_tva_split(amt)
        fixed_costs_dict_total["cu_tva"] += spl["cu_tva"]
        fixed_costs_dict_total["fara_tva"] += spl["fara_tva"]

    total_fixed_costs_total = fixed_costs_dict_total["cu_tva"]

    # Net profit Dict
    mkt_total_val = marketing_total.get("total", 0)
    net_profit_dict = {
        "cu_tva": round(
            operating_profit_dict["cu_tva"]
            - mkt_total_val
            - fixed_costs_dict_total["cu_tva"],
            2,
        ),
        "fara_tva": round(
            operating_profit_dict["fara_tva"]
            - mkt_total_val
            - fixed_costs_dict_total["fara_tva"],
            2,
        ),
    }

    # Margins — all on the per-country net (fara) revenue
    gross_margin = (
        (gross_profit_dict["fara_tva"] / net_revenue_fara * 100)
        if net_revenue_fara > 0
        else 0
    )
    operating_margin = (
        (operating_profit_dict["fara_tva"] / net_revenue_fara * 100)
        if net_revenue_fara > 0
        else 0
    )
    net_margin_final = (
        (net_profit_dict["fara_tva"] / net_revenue_fara * 100)
        if net_revenue_fara > 0
        else 0
    )

    # Build the fixed_costs detail list (individual entries for the frontend)
    fixed_costs_entries = []
    for bc in biz_costs_all:
        fixed_costs_entries.append(
            {
                "id": bc.id,
                "category": bc.category,
                "label": bc.label,
                "amount": bc.amount,
                "cost_type": bc.cost_type,
                "scope": bc.scope,
                "store_uids": bc.store_uids,
                "has_tva": bc.has_tva if bc.has_tva is not None else True,
                "pnl_section": bc.pnl_section or "fixed",
                "display_order": bc.display_order or 0,
            }
        )

    # Per-country net (fara) totals for the income lines.
    gross_sales_fara = sum(stats[s]["revenue_fara"] for s in stats)
    returns_cancelled_fara = (
        stats["returned"]["revenue_fara"] + stats["cancelled"]["revenue_fara"]
    )

    pnl = {
        "income": {
            "gross_sales": cf(gross_sales, gross_sales_fara),
            "returns_cancelled": cf(returns_cancelled_revenue, returns_cancelled_fara),
            "returns_cancelled_count": stats["returned"]["count"]
            + stats["cancelled"]["count"],
            "sales_delivered": cf(net_revenue, net_revenue_fara),
            "total_realized": cf(net_revenue, net_revenue_fara),
            "delivered_count": d["count"],
        },
        "cogs": {
            "sku_costs": cf(d["sku_costs"], d["sku_costs_fara"]),
            "total_cogs": cf(total_cogs, total_cogs_fara),
        },
        "gross_profit": gross_profit_dict,
        "gross_margin_pct": round(gross_margin, 1),
        "operational": {
            "shipping": cf(d["shipping"], d["shipping_fara"]),
            "packaging": {"cu_tva": 0.0, "fara_tva": 0.0},
            "frisbo_fee": cf(d["frisbo_fee"], d["frisbo_fee_fara"]),
            "gt_commission": cf(d["gt_commission"], d["gt_commission_fara"]),
            "payment_fee": cf(d["payment_fee"], d["payment_fee_fara"]),
            "warehouse_salary": no_tva_split(warehouse_salary_total),
            "warehouse_salary_per_package": config.warehouse_salary_per_package,
            "shipped_count": shipped_count,
            "total_operational": {
                "cu_tva": total_operational_cu,
                "fara_tva": total_operational_fara,
            },
        },
        "operating_profit": operating_profit_dict,
        "operating_margin_pct": round(operating_margin, 1),
        "marketing": {
            "facebook": no_tva_split(marketing_total.get("facebook", 0)),
            "tiktok": no_tva_split(marketing_total.get("tiktok", 0)),
            "google": no_tva_split(marketing_total.get("google", 0)),
            "total": no_tva_split(marketing_total.get("total", 0)),
        },
        "fixed_costs": {"total": fixed_costs_dict_total},
        "fixed_costs_entries": fixed_costs_entries,
        "fixed_costs_month": month_key,
        "business_costs_by_section": biz_costs_by_section,
        "net_profit": net_profit_dict,
        "net_margin_pct": round(net_margin_final, 1),
        "cancelled_count": stats["cancelled"]["count"],
        "returned_count": stats["returned"]["count"],
        "status_breakdown": {
            k: {
                "count": stats[k]["count"],
                "revenue": cf(stats[k]["revenue"], stats[k]["revenue_fara"]),
            }
            for k in ["in_transit", "returned", "cancelled", "other"]
            if stats[k]["count"] > 0
        },
    }

    # --- Enhance per-store data with P&L breakdown ---
    for s in store_list:
        # This store's own country VAT rate (order-derived lines). Allocated
        # business/fixed costs stay on the RO rate (`tva_split`) since they are
        # Romanian company costs regardless of which store they're attributed to.
        store_vat = resolve_vat_rate(store_country.get(s["store_uid"]), ref_date.date())

        def s_split(v, _vat=store_vat):
            return {
                "cu_tva": round(v, 2),
                "fara_tva": round(v / (1 + _vat), 2) if _vat > 0 else round(v, 2),
            }

        # COGS Dict
        s_cogs_val = s["sku_costs"]
        s_cogs = s_split(s_cogs_val)

        # Gross Profit Dict
        s_rev_val = s["revenue"]
        s_rev = s_split(s_rev_val)
        s_gross = {
            "cu_tva": round(s_rev["cu_tva"] - s_cogs["cu_tva"], 2),
            "fara_tva": round(s_rev["fara_tva"] - s_cogs["fara_tva"], 2),
        }

        # Operational Dict
        s_warehouse = s["count"] * config.warehouse_salary_per_package
        s_oper_val_no_salary = (
            s["shipping"]
            + s.get("frisbo_fee", 0)
            + s["gt_commission"]
            + s["payment_fee"]
        )
        s_oper = {
            "cu_tva": round(s_oper_val_no_salary + s_warehouse, 2),
            "fara_tva": round(
                s_split(s_oper_val_no_salary)["fara_tva"] + s_warehouse, 2
            ),
        }

        # Operating Profit Dict
        s_operating_profit = {
            "cu_tva": round(s_gross["cu_tva"] - s_oper["cu_tva"], 2),
            "fara_tva": round(s_gross["fara_tva"] - s_oper["fara_tva"], 2),
        }

        # Store-specific fixed costs
        s_uid = s["store_uid"]
        s_fc = store_fixed_costs.get(s_uid, {c: 0.0 for c in biz_cost_categories})
        s_fc_dict = {"cu_tva": 0.0, "fara_tva": 0.0}
        for c_cat, c_val in s_fc.items():
            spl = tva_split(c_val)
            s_fc_dict["cu_tva"] += spl["cu_tva"]
            s_fc_dict["fara_tva"] += spl["fara_tva"]

        # Store-specific marketing costs
        s_mkt_pre = marketing_costs.get(
            s["store_name"], {"facebook": 0, "tiktok": 0, "google": 0, "total": 0}
        )
        s_mkt_total_pre = s_mkt_pre.get("total", 0)

        # Net profit Dict
        s_net_profit = {
            "cu_tva": round(
                s_operating_profit["cu_tva"] - s_mkt_total_pre - s_fc_dict["cu_tva"], 2
            ),
            "fara_tva": round(
                s_operating_profit["fara_tva"]
                - s_mkt_total_pre
                - s_fc_dict["fara_tva"],
                2,
            ),
        }

        s["cogs_total"] = round(s_cogs_val, 2)
        s["gross_profit"] = s_gross["cu_tva"]
        s["operational_total"] = s_oper["cu_tva"]
        s["operating_profit"] = s_operating_profit["cu_tva"]
        s["warehouse_salary"] = round(s_warehouse, 2)
        s["fixed_costs_total"] = s_fc_dict["cu_tva"]
        s["net_profit"] = s_net_profit["cu_tva"]

        # Margins are strictly based on fara_tva ratios
        rev_fara = s_rev["fara_tva"]
        s["gross_margin_pct"] = round(
            (s_gross["fara_tva"] / rev_fara * 100) if rev_fara > 0 else 0, 1
        )
        s["operating_margin_pct"] = round(
            (s_operating_profit["fara_tva"] / rev_fara * 100) if rev_fara > 0 else 0, 1
        )
        s["net_margin_pct"] = round(
            (s_net_profit["fara_tva"] / rev_fara * 100) if rev_fara > 0 else 0, 1
        )

        # Store the dict objects to avoid recomputation in the build phase below
        s["_gross_dict"] = s_gross
        s["_oper_dict"] = s_oper
        s["_op_profit_dict"] = s_operating_profit
        s["_net_profit_dict"] = s_net_profit
        s["_fc_dict"] = s_fc_dict

    # --- Build full P&L per store (with TVA splits) ---
    pnl_by_store = []
    for s in store_list:
        s_rev = s["revenue"]
        s_cogs_val = s["cogs_total"]
        s_uid = s["store_uid"]

        # This store's own country VAT rate for order-derived display lines.
        store_vat = resolve_vat_rate(store_country.get(s_uid), ref_date.date())

        def s_split(v, _vat=store_vat):
            return {
                "cu_tva": round(v, 2),
                "fara_tva": round(v / (1 + _vat), 2) if _vat > 0 else round(v, 2),
            }

        # Build per-store fixed costs breakdown
        s_fc = store_fixed_costs.get(s_uid, {c: 0.0 for c in biz_cost_categories})
        s_fc_breakdown = {}
        for cat in biz_cost_categories:
            s_fc_breakdown[cat] = tva_split(s_fc.get(cat, 0))
        s_fc_breakdown["total"] = tva_split(sum(s_fc.values()))

        # Store-specific marketing costs from Google Sheets
        s_mkt = marketing_costs.get(
            s["store_name"], {"facebook": 0, "tiktok": 0, "google": 0, "total": 0}
        )
        s_mkt_total = s_mkt.get("total", 0)

        pnl_by_store.append(
            {
                "store_uid": s["store_uid"],
                "store_name": s["store_name"],
                "income": {
                    "gross_sales": s_split(s.get("gross_sales", s_rev)),
                    "returns_cancelled": s_split(s.get("returns_cancelled_revenue", 0)),
                    "returns_cancelled_count": s.get("returns_cancelled_count", 0),
                    "sales_delivered": s_split(s_rev),
                    "delivered_count": s["count"],
                },
                "cogs": {
                    "sku_costs": s_split(s["sku_costs"]),
                    "total_cogs": s_split(s_cogs_val),
                },
                "gross_profit": s["_gross_dict"],
                "gross_margin_pct": s["gross_margin_pct"],
                "operational": {
                    "shipping": s_split(s["shipping"]),
                    "packaging": {"cu_tva": 0.0, "fara_tva": 0.0},
                    "frisbo_fee": s_split(s.get("frisbo_fee", 0)),
                    "gt_commission": s_split(s["gt_commission"]),
                    "payment_fee": s_split(s["payment_fee"]),
                    "warehouse_salary": no_tva_split(s.get("warehouse_salary", 0)),
                    "total_operational": s["_oper_dict"],
                },
                "operating_profit": s["_op_profit_dict"],
                "operating_margin_pct": s["operating_margin_pct"],
                "marketing": {
                    "facebook": no_tva_split(s_mkt.get("facebook", 0)),
                    "tiktok": no_tva_split(s_mkt.get("tiktok", 0)),
                    "google": no_tva_split(s_mkt.get("google", 0)),
                    "total": no_tva_split(s_mkt_total),
                },
                "fixed_costs": s_fc_breakdown,
                "business_costs_by_section": {
                    section: [
                        entry
                        for entry in entries
                        if entry.get("scope") == "all"
                        or (
                            entry.get("scope") in ("store", "stores")
                            and isinstance(entry.get("store_uids"), list)
                            and s_uid in entry["store_uids"]
                        )
                    ]
                    for section, entries in biz_costs_by_section.items()
                },
                "net_profit": s["_net_profit_dict"],
                "net_margin_pct": s["net_margin_pct"],
                "status_breakdown": {
                    k: {"count": v["count"], "revenue": tva_split(v["revenue"])}
                    for k, v in s.get("status_breakdown", {}).items()
                    if v["count"] > 0
                },
                "shipped_count": s["count"]
                + s.get("status_breakdown", {}).get("in_transit", {}).get("count", 0),
                "total_orders": s.get(
                    "gross_sales_count",
                    s["count"]
                    + s.get("returns_cancelled_count", 0)
                    + s.get("status_breakdown", {})
                    .get("in_transit", {})
                    .get("count", 0)
                    + s.get("status_breakdown", {}).get("other", {}).get("count", 0),
                ),
            }
        )

    return {
        "pnl": pnl,
        "pnl_by_store": pnl_by_store,
        # Keep backward-compatible summary
        "summary": {
            "total_revenue": round(total_revenue, 2),
            "realized_revenue": round(realized_revenue, 2),
            "total_costs": round(realized_costs, 2),
            "gross_profit": round(realized_profit_gross, 2),
            "net_profit": round(realized_profit_net, 2),
            "realized_profit": round(realized_profit_gross, 2),
            "pending_profit": round(pending_profit_gross, 2),
            "pending_profit_net": round(pending_profit_net, 2),
            "return_loss": round(return_loss, 2),
            "delivered_orders": d["count"],
            "in_transit_orders": stats["in_transit"]["count"],
            "returned_orders": stats["returned"]["count"],
            "gross_margin_pct": round(margin_pct, 1),
            "margin_pct": round(margin_pct, 1),
            "net_margin_pct": round(net_margin_pct, 1),
            "cost_breakdown": {
                "sku_costs": round(d["sku_costs"], 2),
                "shipping_costs": round(d["shipping"], 2),
                "packaging_costs": round(d["packaging"], 2),
                "gt_commissions": round(d["gt_commission"], 2),
                "payment_processing": round(d["payment_fee"], 2),
                "frisbo_fees": round(d["frisbo_fee"], 2),
            },
        },
        "by_status": {
            "delivered": {
                "count": d["count"],
                "revenue": round(d["revenue"], 2),
                "costs": round(d["total_costs"], 2),
                "profit_gross": round(d["profit_gross"], 2),
                "profit_net": round(d["profit_net"], 2),
            },
            "returned": {
                "count": stats["returned"]["count"],
                "costs": round(stats["returned"]["total_costs"], 2),
                "loss": round(return_loss, 2),
            },
            "in_transit": {
                "count": stats["in_transit"]["count"],
                "potential_revenue": round(pending_revenue, 2),
                "potential_costs": round(pending_costs, 2),
                "potential_profit_gross": round(pending_profit_gross, 2),
                "potential_profit_net": round(pending_profit_net, 2),
            },
            "cancelled": {
                "count": stats["cancelled"]["count"],
            },
        },
        "by_store": store_list,
        "top_skus": top_skus,
        "missing_sku_costs": list(missing_sku_costs)[:50],
        "missing_sku_count": len(missing_sku_costs),
        "unconvertible_currencies": list(unconvertible_currencies),
        "unconvertible_count": unconvertible_count,  # orders excluded from P&L (no BNR rate)
        "transport_fallback_stats": fallback_stats,  # NEW: diagnostics for transport cost source
        "config": {
            "packaging_cost_per_order": config.packaging_cost_per_order,
            "gt_commission_pct": config.gt_commission_pct,
            "payment_processing_pct": config.payment_processing_pct,
            "payment_processing_fixed": config.payment_processing_fixed,
            "vat_rate": dynamic_vat_rate,
        },
    }
