"""
SKU Profitability endpoint — line-item-level cost allocation for per-product profitability.

Allocates order-level costs (transport, fees, packaging) to individual line items
by revenue share, then aggregates by SKU across all orders.
"""

from datetime import datetime, timedelta, date
from typing import Optional
from collections import defaultdict
import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.analytics_cache import cached_analytics
from app.core.line_items_projection import PROJECTED_LINE_ITEMS, sku_hash as _sku_hash
from app.core.timezone import (
    date_str_to_utc_start,
    date_str_to_utc_end,
    to_bucharest_date,
    romania_today,
)
from app.core.status_classification import classify
from app.core.order_filters import (
    load_exclusion_rules,
    tag_condition,
    order_has_excluded_sku,
)
from app.core.vat import resolve_vat_rate, country_for_store
from app.models import Order, Store, SkuCost
from app.models.sku_marketing_cost import SkuMarketingCost
from app.api.profitability_config import get_or_create_config

router = APIRouter()
logger = logging.getLogger(__name__)

# Scalar Order columns this endpoint reads — line_items is replaced by the shared
# slimmed PROJECTED_LINE_ITEMS column (see app/core/line_items_projection). `uid` is
# needed for the distinct delivered-order count (Finding AA).
_SKU_ORDER_COLS = (
    Order.currency,
    Order.frisbo_created_at,
    Order.total_price,
    Order.subtotal_price,
    Order.aggregated_status,
    Order.store_uid,
    Order.transport_cost,
    Order.payment_gateway,
    Order.uid,
)


@router.get("/analytics/sku-profitability")
@cached_analytics("sku-profitability")
async def get_sku_profitability(
    db: AsyncSession = Depends(get_db),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    days: Optional[int] = 30,
    store_uids: Optional[str] = None,
):
    """
    Per-SKU profitability with line-item cost allocation.

    For each order, costs are allocated to individual line items by revenue share:
      allocated_cost = order_cost × (line_revenue / order_total_revenue)

    Then aggregated by SKU across all orders.
    """
    from app.api.exchange_rates import preload_rates, get_rate_from_cache

    # --- Parse filters ---
    store_uid_list = None
    if store_uids:
        store_uid_list = [s.strip() for s in store_uids.split(",")]

    # Configurable exclusion: built-in test/sample tags + user rules (tag & sku).
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

    # Determine the explicit Bucharest-local date window (inclusive). Used both
    # for the marketing month range AND to pro-rate monthly SKU marketing by the
    # fraction of each month that actually falls inside the window (Finding M).
    if date_from and date_to:
        try:
            window_start_d = datetime.strptime(date_from, "%Y-%m-%d").date()
            window_end_d = datetime.strptime(date_to, "%Y-%m-%d").date()
        except ValueError:
            window_end_d = romania_today()
            window_start_d = window_end_d - timedelta(days=29)
    else:
        window_end_d = romania_today()
        window_start_d = window_end_d - timedelta(days=max(0, (days or 30) - 1))
    mkt_date_from = window_start_d.strftime("%Y-%m")
    mkt_date_to = window_end_d.strftime("%Y-%m")

    def _month_window_fraction(month_str: str) -> float:
        """Fraction of `month_str` (YYYY-MM) covered by [window_start_d, window_end_d]."""
        try:
            y, m = int(month_str[:4]), int(month_str[5:7])
        except (ValueError, IndexError):
            return 1.0
        month_start = date(y, m, 1)
        month_end = date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)
        ov_start = max(window_start_d, month_start)
        ov_end = min(window_end_d, month_end)
        overlap_days = (ov_end - ov_start).days + 1
        if overlap_days <= 0:
            return 0.0
        days_in_month = (month_end - month_start).days + 1
        return min(1.0, overlap_days / days_in_month)

    # --- Fetch data --- (slim column-select + projected line_items, not full ORM)
    query = select(*_SKU_ORDER_COLS, PROJECTED_LINE_ITEMS)
    if conditions:
        query = query.where(and_(*conditions))
    result = await db.execute(query)
    orders = result.all()

    # SKU costs lookup
    sku_costs_result = await db.execute(select(SkuCost))
    sku_costs_all = sku_costs_result.scalars().all()
    sku_costs_map = {sc.sku: sc.cost for sc in sku_costs_all}
    sku_names_map = {sc.sku: sc.name for sc in sku_costs_all}

    # Store names
    stores_result = await db.execute(select(Store))
    _stores = stores_result.scalars().all()
    store_names = {s.uid: s.name for s in _stores}
    # Per-country VAT (Finding U): a SKU sold in PL/CZ/BG must net out at that
    # country's rate, not Romania's. Derive each store's country once.
    store_country = {
        s.uid: country_for_store(s.name, s.shopify_domain) for s in _stores
    }

    # Marketing costs (all months in range)
    mkt_query = select(SkuMarketingCost).where(
        and_(
            SkuMarketingCost.month >= mkt_date_from,
            SkuMarketingCost.month <= mkt_date_to,
        )
    )
    mkt_result = await db.execute(mkt_query)
    mkt_entries = mkt_result.scalars().all()
    # Aggregate marketing costs by SKU, pro-rated by the fraction of each month
    # inside the query window (so a 6-day window doesn't subtract a whole month
    # of SKU marketing, and a window spanning two partial months counts each
    # only by its overlap — Finding M).
    sku_marketing_map = defaultdict(float)
    sku_marketing_entries = defaultdict(list)
    for m in mkt_entries:
        frac = _month_window_fraction(m.month)
        if frac <= 0:
            continue
        weighted = round((m.amount or 0) * frac, 2)
        sku_marketing_map[m.sku] += weighted
        sku_marketing_entries[m.sku].append(
            {
                "id": m.id,
                "label": m.label,
                "amount": m.amount,
                "amount_in_window": weighted,
                "month": m.month,
                "window_fraction": round(frac, 4),
            }
        )

    # --- Per-SKU FB/TikTok ad spend (imported daily from Scripturi, already RON).
    # Summed over the EXACT [window_start_d, window_end_d] window so it matches
    # Scripturi's date-range report (which sums its daily spend tables) rather than a
    # monthly pro-rate. HA-/Hairo SKUs only. ADDED to any manual SkuMarketingCost so
    # AWB's manual-entry feature still works while an all-imported SKU equals
    # Scripturi's marketing line. ---
    from app.models.sku_ad_spend_daily import SkuAdSpendDaily

    adspend_rows = (
        await db.execute(
            select(
                SkuAdSpendDaily.sku,
                func.sum(SkuAdSpendDaily.amount_fb_ron),
                func.sum(SkuAdSpendDaily.amount_tk_ron),
            )
            .where(
                and_(
                    SkuAdSpendDaily.date >= window_start_d,
                    SkuAdSpendDaily.date <= window_end_d,
                )
            )
            .group_by(SkuAdSpendDaily.sku)
        )
    ).all()
    sku_adspend = {
        sku: {"fb": float(fb or 0), "tk": float(tk or 0)}
        for sku, fb, tk in adspend_rows
    }

    # --- FX rate preload ---
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
        if order_dates:
            min_date = min(order_dates)
            max_date = max(order_dates)
            rate_cache = await preload_rates(
                non_ron_currencies, (min_date, max_date), db
            )

    # --- Load profitability config ---
    config = await get_or_create_config(db)

    # --- Transport cost fallback caches ---
    from app.core.timezone import romania_now, UTC_TZ

    now_buc = romania_now()
    start_buc_30d = (now_buc - timedelta(days=max(0, 30 - 1))).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    cutoff_30d = start_buc_30d.astimezone(UTC_TZ).replace(tzinfo=None)
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

    sku_hash_cost_cache = {}
    store_transport_sums = defaultdict(lambda: {"total": 0, "count": 0})
    store_avg_transport = {}

    for fo in fallback_orders:
        store_transport_sums[fo.store_uid]["total"] += fo.transport_cost
        store_transport_sums[fo.store_uid]["count"] += 1
        sh = _sku_hash(fo.li)
        if sh and sh not in sku_hash_cost_cache:
            sku_hash_cost_cache[sh] = fo.transport_cost

    for sid, data in store_transport_sums.items():
        if data["count"] > 0:
            store_avg_transport[sid] = round(data["total"] / data["count"], 2)

    # VAT is now resolved per order (per-country + RO time-split) inside the loop
    # via resolve_vat_rate(store_country[...], order_date) — Finding U. No single
    # blended rate is used any more.

    # --- Per-SKU aggregation ---
    # sku -> { metrics }
    sku_data = defaultdict(
        lambda: {
            "units_sold": 0,
            "units_returned": 0,
            "units_pending": 0,  # in_transit (not yet realized)
            "delivered_order_ids": set(),  # distinct delivered orders (Finding AA)
            "orders_returned": 0,
            "orders_pending": 0,
            # *_fara accumulate net-of-VAT using EACH order's own country/time rate
            # (Finding U) instead of dividing a single blended rate at the end.
            "revenue_fara": 0.0,
            "revenue_pending_fara": 0.0,
            "cogs_fara": 0.0,
            "transport_fara": 0.0,
            "fees_fara": 0.0,
            "per_store": defaultdict(
                lambda: {
                    "units_sold": 0,
                    "units_returned": 0,
                    "revenue_fara": 0.0,
                    "cogs_fara": 0.0,
                    "transport_fara": 0.0,
                    "fees_fara": 0.0,
                }
            ),
        }
    )
    missing_cost_skus = set()
    total_orders_processed = 0

    for order in orders:
        order_currency = (order.currency or "RON").upper()
        order_date = to_bucharest_date(order.frisbo_created_at) or romania_today()

        # Revenue in RON
        revenue_orig = order.total_price or 0
        subtotal_orig = order.subtotal_price or 0
        fx_rate = 1.0
        if order_currency != "RON":
            r = get_rate_from_cache(order_currency, order_date, rate_cache)
            if r is not None:
                fx_rate = r

        revenue = round(revenue_orig * fx_rate, 2)
        subtotal = round(subtotal_orig * fx_rate, 2)

        # Status classification — single source of truth (same as the P&L engine)
        cat = classify(order.aggregated_status)

        # Skip cancelled and not-shipped/unknown ("other") — only delivered,
        # returned and in_transit carry per-SKU economics.
        if cat in ("cancelled", "other"):
            continue

        # Configurable SKU exclusion: drop the whole order if it contains an
        # excluded SKU (Scripturi rule_type='sku' parity).
        if excluded_skus and order_has_excluded_sku(order.li, excluded_skus):
            continue

        store_uid = order.store_uid
        total_orders_processed += 1

        # This order's own VAT rate (per-country, time-aware) — Finding U.
        order_vat = resolve_vat_rate(store_country.get(store_uid), order_date)
        vd = (1 + order_vat) if order_vat > 0 else 1.0

        # --- Order-level costs ---
        # Transport
        if order.transport_cost is not None and order.transport_cost > 0:
            shipping_cost = order.transport_cost
        else:
            sh = _sku_hash(order.li)
            if sh and sh in sku_hash_cost_cache:
                shipping_cost = sku_hash_cost_cache[sh]
            elif store_uid in store_avg_transport:
                shipping_cost = store_avg_transport[store_uid]
            else:
                customer_shipping = max(0, revenue - subtotal)
                shipping_cost = customer_shipping if customer_shipping > 0 else 0

        # Operational costs (packaging is excluded — already captured in
        # transport / monthly business costs, matching the aggregate P&L)
        gt_commission = 0.0
        if (
            config.gt_commission_store_uid
            and store_uid == config.gt_commission_store_uid
        ):
            gt_commission = revenue * config.gt_commission_pct / 100.0

        is_card_payment = not (order.payment_gateway or "").lower().startswith("plat")
        payment_fee = (
            (
                revenue * config.payment_processing_pct / 100.0
                + config.payment_processing_fixed
            )
            if is_card_payment
            else 0.0
        )
        frisbo_fee = config.frisbo_fee_per_order

        # --- Parse line items and allocate --- (projected shape {sku, q, p})
        line_items = order.li or []
        if not isinstance(line_items, list):
            continue

        # First pass: compute order totals for revenue share
        line_data = []
        order_line_revenue_total = 0.0
        for item in line_items:
            if not isinstance(item, dict):
                continue
            sku = item.get("sku")
            if not sku:
                continue
            qty = int(item.get("q") or 1)
            price = item.get("p") or 0
            line_revenue = round(price * qty * fx_rate, 2)
            order_line_revenue_total += line_revenue
            line_data.append((sku, qty, line_revenue))

        if not line_data:
            continue

        # Prevent division by zero
        if order_line_revenue_total <= 0:
            order_line_revenue_total = 1.0

        # Second pass: allocate costs
        for sku, qty, line_revenue in line_data:
            revenue_share = line_revenue / order_line_revenue_total

            # COGS
            unit_cost = sku_costs_map.get(sku)
            if unit_cost is not None:
                line_cogs = round(unit_cost * qty, 2)
            else:
                line_cogs = 0.0
                missing_cost_skus.add(sku)

            # Allocated costs
            alloc_transport = round(shipping_cost * revenue_share, 2)
            alloc_payment = round(payment_fee * revenue_share, 2)
            alloc_gt = round(gt_commission * revenue_share, 2)
            alloc_frisbo = round(frisbo_fee * revenue_share, 2)

            sd = sku_data[sku]

            if cat == "returned":
                sd["units_returned"] += qty
                sd["orders_returned"] += 1
                # Only the sunk shipping cost is allocated (products resold, COGS recovered)
                sd["transport_fara"] += alloc_transport / vd
                # Per-store
                psd = sd["per_store"][store_uid]
                psd["units_returned"] += qty
                psd["transport_fara"] += alloc_transport / vd
            elif cat == "in_transit":
                # Pending — not yet realized. Tracked separately so it never
                # inflates realized contribution/margin (Finding E).
                sd["units_pending"] += qty
                sd["revenue_pending_fara"] += line_revenue / vd
            else:
                # delivered — realized full calc (net of this order's own VAT)
                sd["units_sold"] += qty
                sd["delivered_order_ids"].add(order.uid)  # distinct orders (Finding AA)
                sd["revenue_fara"] += line_revenue / vd
                sd["cogs_fara"] += line_cogs / vd
                sd["transport_fara"] += alloc_transport / vd
                sd["fees_fara"] += (alloc_payment + alloc_gt + alloc_frisbo) / vd
                # Per-store
                psd = sd["per_store"][store_uid]
                psd["units_sold"] += qty
                psd["revenue_fara"] += line_revenue / vd
                psd["cogs_fara"] += line_cogs / vd
                psd["transport_fara"] += alloc_transport / vd
                psd["fees_fara"] += (alloc_payment + alloc_gt + alloc_frisbo) / vd

    # --- Build response ---
    products = []
    total_revenue = 0.0  # all delivered revenue (net of VAT)
    total_revenue_known = 0.0  # revenue of cost-known SKUs — avg-margin denominator
    total_costs = 0.0
    total_contribution = 0.0
    total_marketing = 0.0
    total_marketing_fb = 0.0
    total_marketing_tk = 0.0

    # All monetary values are already NET of TVA — each line was divided by its own
    # order's (1 + per-country/time VAT) when accumulated (Finding U). Marketing
    # (foreign ad spend) carries no Romanian TVA, so it was never divided.
    for sku, sd in sku_data.items():
        has_cost = sku not in missing_cost_skus
        # Marketing = manual SkuMarketingCost entries + imported FB/TikTok ad spend
        # (Scripturi parity; fb/tk surfaced separately). No RO TVA on foreign ad spend.
        ad = sku_adspend.get(sku, {})
        marketing_fb = round(ad.get("fb", 0.0), 2)
        marketing_tk = round(ad.get("tk", 0.0), 2)
        marketing = (
            sku_marketing_map.get(sku, 0.0) + ad.get("fb", 0.0) + ad.get("tk", 0.0)
        )

        revenue_fara = sd["revenue_fara"]
        cogs_fara = sd["cogs_fara"]
        transport_fara = sd["transport_fara"]
        fees_fara = sd["fees_fara"]

        total_units = sd["units_sold"] + sd["units_returned"]
        return_rate = round(
            (sd["units_returned"] / total_units * 100) if total_units > 0 else 0, 1
        )
        avg_price = (
            round(revenue_fara / sd["units_sold"], 2) if sd["units_sold"] > 0 else 0
        )
        orders_count = len(sd["delivered_order_ids"])

        # delivery_rate (display-only, order-based, Scripturi parity): livrata/plecate,
        # plecate = delivered + returned + in_transit orders; min 3 to report.
        plecate = orders_count + sd["orders_returned"] + sd["orders_pending"]
        delivery_rate = round(orders_count / plecate * 100, 1) if plecate >= 3 else None
        # CPA / ROAS from the marketing line (display-only): cost-per-order & return-on-ad-spend.
        cpa = (
            round(marketing / orders_count, 2)
            if (orders_count > 0 and marketing > 0)
            else None
        )
        roas = round(revenue_fara / marketing, 2) if marketing > 0 else None

        # Missing-COGS (Finding T): a SKU with no cost on file would otherwise book
        # COGS=0 and look fully profitable. Null out the cost-dependent figures so
        # the UI shows "—" instead of a fake profit, and exclude it from the margin
        # aggregates (its revenue is still real and still counted in total_revenue).
        if has_cost:
            costs = cogs_fara + transport_fara + fees_fara + marketing
            contribution = revenue_fara - costs
            margin_pct = round(
                (contribution / revenue_fara * 100) if revenue_fara > 0 else 0, 1
            )
            cost_per_unit = (
                round(cogs_fara / sd["units_sold"], 2) if sd["units_sold"] > 0 else 0
            )
        else:
            costs = contribution = margin_pct = cost_per_unit = None

        # Per-store breakdown (already net of VAT)
        per_store_list = []
        for suid, psd in sd["per_store"].items():
            s_rev_fara = psd["revenue_fara"]
            s_cogs_fara = psd["cogs_fara"]
            s_transport_fara = psd["transport_fara"]
            s_fees_fara = psd["fees_fara"]
            if has_cost:
                s_costs = s_cogs_fara + s_transport_fara + s_fees_fara
                s_contribution = s_rev_fara - s_costs
                s_margin = round(
                    (s_contribution / s_rev_fara * 100) if s_rev_fara > 0 else 0, 1
                )
            else:
                s_contribution = s_margin = None
            per_store_list.append(
                {
                    "store_uid": suid,
                    "store_name": store_names.get(suid, "Unknown"),
                    "units_sold": psd["units_sold"],
                    "units_returned": psd["units_returned"],
                    "revenue": round(s_rev_fara, 2),
                    "cogs": round(s_cogs_fara, 2) if has_cost else None,
                    "transport": round(s_transport_fara, 2),
                    "fees": round(s_fees_fara, 2),
                    "contribution": round(s_contribution, 2)
                    if s_contribution is not None
                    else None,
                    "margin_pct": s_margin,
                }
            )
        per_store_list.sort(key=lambda x: x["revenue"], reverse=True)

        product = {
            "sku": sku,
            "name": sku_names_map.get(sku, ""),
            "units_sold": sd["units_sold"],
            "units_returned": sd["units_returned"],
            "units_pending": sd["units_pending"],
            "revenue_pending": round(sd["revenue_pending_fara"], 2),
            "orders_count": orders_count,
            "revenue": round(revenue_fara, 2),
            "cogs": round(cogs_fara, 2) if has_cost else None,
            "transport": round(transport_fara, 2),
            "fees": round(fees_fara, 2),
            "marketing": round(marketing, 2),
            "marketing_fb": marketing_fb,
            "marketing_tk": marketing_tk,
            "cpa": cpa,
            "roas": roas,
            "delivery_rate": delivery_rate,
            "total_costs": round(costs, 2) if costs is not None else None,
            "contribution": round(contribution, 2)
            if contribution is not None
            else None,
            "margin_pct": margin_pct,
            "return_rate": return_rate,
            "avg_selling_price": avg_price,
            "cost_per_unit": cost_per_unit,
            "per_store": per_store_list,
            "marketing_entries": sku_marketing_entries.get(sku, []),
            "has_cost": has_cost,
        }
        products.append(product)

        total_revenue += revenue_fara
        total_marketing += marketing
        total_marketing_fb += marketing_fb
        total_marketing_tk += marketing_tk
        if has_cost:
            total_revenue_known += revenue_fara
            total_costs += costs
            total_contribution += contribution

    # Sort by revenue descending by default
    products.sort(key=lambda x: x["revenue"], reverse=True)

    # avg margin is over cost-known revenue only (missing-cost SKUs have no margin)
    avg_margin = round(
        (total_contribution / total_revenue_known * 100)
        if total_revenue_known > 0
        else 0,
        1,
    )

    return {
        "products": products,
        "summary": {
            "total_products": len(products),
            "total_revenue": round(total_revenue, 2),
            "total_revenue_known": round(total_revenue_known, 2),
            "total_costs": round(total_costs, 2),
            "total_contribution": round(total_contribution, 2),
            "total_marketing": round(total_marketing, 2),
            "total_marketing_fb": round(total_marketing_fb, 2),
            "total_marketing_tk": round(total_marketing_tk, 2),
            "avg_margin": avg_margin,
            "products_without_cost": len(missing_cost_skus),
            "missing_cost_skus": sorted(list(missing_cost_skus)),
            "orders_processed": total_orders_processed,
        },
    }
