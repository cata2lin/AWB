"""
Daily-Performance brand dashboard — AWB-native port of Scripturi's daily-perf.

The Scripturi original sourced everything from Google Sheets + Facebook +
frankfurter FX. This rebuild sources EVERYTHING from AWB's own Postgres `orders`
(synced from Frisbo) and converts non-RON revenue with the BNR rate cache. There
is no ad-spend data in AWB, so the spend/ROAS/CPA dimensions of the original are
intentionally dropped — this dashboard is purely about *revenue & orders per
brand (= store) per day*.

A "brand" here maps 1:1 to an AWB store (`Order.store_uid`).

Revenue convention (kept deliberately lean — NOT the full P&L engine):
  - "incasari" = GROSS delivered revenue in RON. We take each delivered order's
    `total_price`, convert to RON via the per-order BNR rate, and sum. No VAT
    netting, no COGS, no fees — this is a top-line operational pulse, matching
    the Scripturi sheet's "Vanzari" column which was also gross.
  - "delivered" = classify(aggregated_status) == "delivered".
  - "comenzi" = ALL non-excluded orders created that day (any status), so the
    delivered-rate = livrate / comenzi is meaningful.

Endpoints (mounted under /api):
  GET /analytics/daily-perf?date=&store_uids=
      → per-brand rows for one Bucharest-local day + totals.
  GET /analytics/daily-perf/range?date_from=&date_to=&store_uids=
      → daily series (incasari + comenzi + livrate per day) for sparklines.
  GET /analytics/daily-perf/top-products?date=&store_uid=
      → top-10 delivered products that day for one brand.
"""

from collections import defaultdict
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.analytics_cache import cached_analytics
from app.core.timezone import (
    date_str_to_utc_start,
    date_str_to_utc_end,
    to_bucharest_date,
    romania_today,
)
from app.core.status_classification import classify
from app.core.order_filters import build_tag_exclusion_condition
from app.core.line_items_projection import PROJECTED_LINE_ITEMS
from app.models import Order, Store

router = APIRouter()

# Scalar Order columns this dashboard reads (line_items replaced by the slimmed
# {sku,q,p} projection — see app/core/line_items_projection).
_DP_ORDER_COLS = (
    Order.currency,
    Order.frisbo_created_at,
    Order.store_uid,
    Order.total_price,
    Order.aggregated_status,
)


def _store_uid_list(store_uids: Optional[str]):
    if not store_uids:
        return None
    vals = [s.strip() for s in store_uids.split(",") if s.strip()]
    return vals or None


async def _load_orders(
    db: AsyncSession, date_from: str, date_to: str, store_uids: Optional[str]
):
    """Fetch non-excluded orders whose Bucharest-local creation date falls in
    [date_from, date_to]. Returns (orders, stores_by_uid)."""
    conditions = [await build_tag_exclusion_condition(db)]
    conditions.append(Order.frisbo_created_at >= date_str_to_utc_start(date_from))
    conditions.append(Order.frisbo_created_at <= date_str_to_utc_end(date_to))
    uid_list = _store_uid_list(store_uids)
    if uid_list:
        conditions.append(Order.store_uid.in_(uid_list))

    orders = (
        await db.execute(
            select(*_DP_ORDER_COLS, PROJECTED_LINE_ITEMS).where(*conditions)
        )
    ).all()
    stores = {s.uid: s.name for s in (await db.execute(select(Store))).scalars().all()}
    return orders, stores


async def _build_rate_cache(db: AsyncSession, orders, date_from: str, date_to: str):
    """Preload BNR rates for any non-RON currency present in `orders`."""
    from app.api.exchange_rates import preload_rates

    non_ron = {(o.currency or "RON").upper() for o in orders} - {"RON"}
    if not non_ron:
        return {}
    order_dates = [
        to_bucharest_date(o.frisbo_created_at) for o in orders if o.frisbo_created_at
    ]
    if not order_dates:
        return {}
    return await preload_rates(non_ron, (min(order_dates), max(order_dates)), db)


def _revenue_ron(order, rate_cache):
    """Gross order revenue in RON, or None if a non-RON rate is unavailable
    (so callers can flag the order as unconvertible rather than silently
    booking it as 0)."""
    from app.api.exchange_rates import get_rate_from_cache

    revenue = order.total_price or 0
    currency = (order.currency or "RON").upper()
    if currency == "RON":
        return round(revenue, 2)
    order_date = to_bucharest_date(order.frisbo_created_at) or romania_today()
    fx = get_rate_from_cache(currency, order_date, rate_cache)
    if fx is None:
        return None
    return round(revenue * fx, 2)


async def _load_marketing(db: AsyncSession, date_from: str, date_to: str):
    """{store_name: {fb, tk, google}} ad spend (RON) over [date_from, date_to] from
    AWB's own `marketing_daily_costs` (synced from the operation's CPA sheet). This is
    AWB's authoritative ad spend — NOT Scripturi's; the two sources differ ~5-10%."""
    from app.models.marketing_daily_cost import MarketingDailyCost
    from datetime import datetime as _dt

    try:
        d1 = _dt.strptime(date_from, "%Y-%m-%d").date()
        d2 = _dt.strptime(date_to, "%Y-%m-%d").date()
    except ValueError:
        return {}
    rows = (
        await db.execute(
            select(
                MarketingDailyCost.store_name,
                func.sum(MarketingDailyCost.facebook),
                func.sum(MarketingDailyCost.tiktok),
                func.sum(MarketingDailyCost.google),
            )
            .where(
                and_(
                    MarketingDailyCost.cost_date >= d1,
                    MarketingDailyCost.cost_date <= d2,
                )
            )
            .group_by(MarketingDailyCost.store_name)
        )
    ).all()
    return {
        name: {"fb": float(fb or 0), "tk": float(tk or 0), "google": float(g or 0)}
        for name, fb, tk, g in rows
    }


@router.get("/analytics/daily-perf")
@cached_analytics("daily-perf")
async def daily_perf(
    date: Optional[str] = None,
    store_uids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Per-brand (store) revenue & orders for a single Bucharest-local day."""
    target = date or romania_today().strftime("%Y-%m-%d")

    orders, stores = await _load_orders(db, target, target, store_uids)
    rate_cache = await _build_rate_cache(db, orders, target, target)
    marketing = await _load_marketing(db, target, target)

    brand_data = defaultdict(
        lambda: {
            "incasari": 0.0,  # delivered gross revenue RON
            "comenzi": 0,  # all orders that day
            "livrate": 0,  # delivered orders
            "revenue_all": 0.0,  # all-status gross revenue RON (context)
        }
    )
    unconvertible = set()

    for o in orders:
        bd = brand_data[o.store_uid]
        bd["comenzi"] += 1

        rev = _revenue_ron(o, rate_cache)
        if rev is None:
            unconvertible.add((o.currency or "").upper())
            rev = 0.0
        bd["revenue_all"] += rev

        if classify(o.aggregated_status) == "delivered":
            bd["livrate"] += 1
            bd["incasari"] += rev

    brands = []
    for uid, bd in brand_data.items():
        aov = round(bd["incasari"] / bd["livrate"], 2) if bd["livrate"] > 0 else 0.0
        delivered_rate = (
            round(bd["livrate"] / bd["comenzi"] * 100, 1) if bd["comenzi"] > 0 else 0.0
        )
        # Ad spend (AWB's own marketing_daily_costs, RON) + derived ROAS/CPA.
        mk = marketing.get(stores.get(uid, uid), {})
        fb = mk.get("fb", 0.0)
        tk = mk.get("tk", 0.0)
        ggl = mk.get("google", 0.0)
        spend = fb + tk + ggl
        brands.append(
            {
                "store_uid": uid,
                "brand": stores.get(uid, uid),
                "incasari": round(bd["incasari"], 2),
                "comenzi": bd["comenzi"],
                "livrate": bd["livrate"],
                "aov": aov,
                "delivered_rate": delivered_rate,
                "revenue_all": round(bd["revenue_all"], 2),
                "fb_spend": round(fb, 2),
                "tk_spend": round(tk, 2),
                "google_spend": round(ggl, 2),
                "total_spend": round(spend, 2),
                "roas": round(bd["incasari"] / spend, 2) if spend > 0 else None,
                "cpa": round(spend / bd["livrate"], 2)
                if (spend > 0 and bd["livrate"] > 0)
                else None,
            }
        )

    brands.sort(key=lambda x: x["incasari"], reverse=True)

    tot_incasari = round(sum(b["incasari"] for b in brands), 2)
    tot_comenzi = sum(b["comenzi"] for b in brands)
    tot_livrate = sum(b["livrate"] for b in brands)
    tot_spend = round(sum(b["total_spend"] for b in brands), 2)
    totals = {
        "incasari": tot_incasari,
        "comenzi": tot_comenzi,
        "livrate": tot_livrate,
        "aov": round(tot_incasari / tot_livrate, 2) if tot_livrate > 0 else 0.0,
        "delivered_rate": round(tot_livrate / tot_comenzi * 100, 1)
        if tot_comenzi > 0
        else 0.0,
        "brands": len(brands),
        "fb_spend": round(sum(b["fb_spend"] for b in brands), 2),
        "tk_spend": round(sum(b["tk_spend"] for b in brands), 2),
        "total_spend": tot_spend,
        "roas": round(tot_incasari / tot_spend, 2) if tot_spend > 0 else None,
        "cpa": round(tot_spend / tot_livrate, 2)
        if (tot_spend > 0 and tot_livrate > 0)
        else None,
    }

    return {
        "date": target,
        "brands": brands,
        "totals": totals,
        "orders_scanned": len(orders),
        "unconvertible_currencies": sorted(c for c in unconvertible if c),
    }


@router.get("/analytics/daily-perf/range")
@cached_analytics("daily-perf-range")
async def daily_perf_range(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    store_uids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Daily series of incasari + comenzi + livrate (for KPI sparklines)."""
    if not date_to:
        date_to = romania_today().strftime("%Y-%m-%d")
    if not date_from:
        # default: 7-day window ending date_to
        end_d = to_bucharest_date(date_str_to_utc_end(date_to)) or romania_today()
        date_from = (end_d - timedelta(days=6)).strftime("%Y-%m-%d")

    orders, _ = await _load_orders(db, date_from, date_to, store_uids)
    rate_cache = await _build_rate_cache(db, orders, date_from, date_to)

    by_day = defaultdict(lambda: {"incasari": 0.0, "comenzi": 0, "livrate": 0})
    for o in orders:
        d = to_bucharest_date(o.frisbo_created_at)
        if not d:
            continue
        key = d.strftime("%Y-%m-%d")
        bucket = by_day[key]
        bucket["comenzi"] += 1
        if classify(o.aggregated_status) == "delivered":
            rev = _revenue_ron(o, rate_cache) or 0.0
            bucket["livrate"] += 1
            bucket["incasari"] += rev

    # Emit a dense series (one entry per calendar day, zero-filled) so the
    # sparkline x-axis has no gaps.
    series = []
    try:
        from datetime import datetime as _dt

        cur = _dt.strptime(date_from, "%Y-%m-%d").date()
        end = _dt.strptime(date_to, "%Y-%m-%d").date()
    except ValueError:
        cur = end = None

    if cur and end and cur <= end:
        while cur <= end:
            key = cur.strftime("%Y-%m-%d")
            b = by_day.get(key, {"incasari": 0.0, "comenzi": 0, "livrate": 0})
            series.append(
                {
                    "date": key,
                    "incasari": round(b["incasari"], 2),
                    "comenzi": b["comenzi"],
                    "livrate": b["livrate"],
                }
            )
            cur += timedelta(days=1)
    else:
        for key in sorted(by_day):
            b = by_day[key]
            series.append(
                {
                    "date": key,
                    "incasari": round(b["incasari"], 2),
                    "comenzi": b["comenzi"],
                    "livrate": b["livrate"],
                }
            )

    return {"date_from": date_from, "date_to": date_to, "series": series}


@router.get("/analytics/daily-perf/top-products")
@cached_analytics("daily-perf-top-products")
async def daily_perf_top_products(
    date: Optional[str] = None,
    store_uid: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Top-10 delivered products for one brand on one day (units + RON revenue)."""
    target = date or romania_today().strftime("%Y-%m-%d")

    orders, stores = await _load_orders(db, target, target, store_uid)
    rate_cache = await _build_rate_cache(db, orders, target, target)

    prod = defaultdict(lambda: {"sku": None, "name": "", "units": 0, "revenue": 0.0})

    for o in orders:
        if classify(o.aggregated_status) != "delivered":
            continue
        # Per-order FX factor (line prices are in the order's currency).
        from app.api.exchange_rates import get_rate_from_cache

        currency = (o.currency or "RON").upper()
        if currency == "RON":
            fx = 1.0
        else:
            order_date = to_bucharest_date(o.frisbo_created_at) or romania_today()
            fx = get_rate_from_cache(currency, order_date, rate_cache)
            if fx is None:
                continue  # unconvertible — skip this order's lines

        line_items = o.li or []  # projected {sku,q,p} items
        if not isinstance(line_items, list):
            continue
        for item in line_items:
            if not isinstance(item, dict):
                continue
            sku = item.get("sku")
            if not sku:
                continue
            qty = item.get("q", 1) or 1
            price = item.get("p", 0) or 0
            # name is not part of the slim projection (and the legacy keys this
            # checked never existed in Frisbo line items, so it was always "")
            name = item.get("name") or item.get("title") or ""
            p = prod[sku]
            p["sku"] = sku
            if name and not p["name"]:
                p["name"] = name
            p["units"] += qty
            p["revenue"] += round(price * qty * fx, 2)

    products = sorted(prod.values(), key=lambda x: x["units"], reverse=True)[:10]
    for p in products:
        p["revenue"] = round(p["revenue"], 2)

    return {
        "date": target,
        "store_uid": store_uid,
        "brand": stores.get(store_uid, store_uid) if store_uid else None,
        "products": products,
    }
