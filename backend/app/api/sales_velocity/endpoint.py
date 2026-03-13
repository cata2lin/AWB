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

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import Order, Store, SkuCost
from app.api.sku_risk.computations import compute_final_outcome

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])

# Outcomes that count as "delivered" for velocity purposes
DELIVERED_OUTCOMES = {"DELIVERED"}


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
    if date_from and date_to:
        try:
            dt_from = datetime.fromisoformat(date_from)
            dt_to = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59)
        except ValueError:
            dt_from = datetime.utcnow() - timedelta(days=days)
            dt_to = datetime.utcnow()
    else:
        dt_to = datetime.utcnow()
        dt_from = dt_to - timedelta(days=days)

    period_days = max((dt_to - dt_from).days, 1)

    # Previous period of same length (for trend comparison)
    prev_from = dt_from - timedelta(days=period_days)
    prev_to = dt_from - timedelta(seconds=1)

    # ── 2. Query current + previous period orders ─────────────────────────
    query = select(Order).where(
        Order.frisbo_created_at >= prev_from,  # Get both periods in one query
        Order.frisbo_created_at <= dt_to,
    )

    if store_uids:
        uid_list = [u.strip() for u in store_uids.split(",") if u.strip()]
        if uid_list:
            query = query.where(Order.store_uid.in_(uid_list))

    result = await db.execute(query)
    all_orders = result.scalars().all()

    # ── 3. Load stores + SKU costs ────────────────────────────────────────
    stores_result = await db.execute(select(Store))
    stores_map: Dict[str, str] = {s.uid: s.name for s in stores_result.scalars().all()}

    sku_costs_result = await db.execute(select(SkuCost))
    sku_cost_map: Dict[str, float] = {sc.sku: sc.cost for sc in sku_costs_result.scalars().all()}

    # ── 4. Process orders into current vs previous period ─────────────────
    # Per-SKU aggregation structures
    sku_current: Dict[str, dict] = defaultdict(lambda: {
        "sku": "", "product_name": "", "stores": set(),
        "units_sold": 0, "revenue": 0.0, "orders": 0,
        "delivered_units": 0, "total_units": 0,
        "last_sale_date": None, "daily_units": defaultdict(float),
        "by_store": defaultdict(lambda: {"store_name": "", "units": 0, "revenue": 0.0, "orders": 0}),
        "by_country": defaultdict(lambda: {"units": 0, "revenue": 0.0}),
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

        # Country
        addr = order.shipping_address or {}
        order_country = (addr.get("country_code", "") or "").upper()
        if country_code and order_country != country_code.upper():
            continue

        order_date = order.frisbo_created_at
        is_current = order_date and order_date >= dt_from
        is_prev = order_date and order_date < dt_from

        # Parse items
        for item in items_raw:
            inv = item.get("inventory_item", {}) or {}
            sku = inv.get("sku", "") or ""
            if not sku:
                continue

            qty = float(item.get("quantity", 1) or 1)
            price = float(item.get("price", 0) or 0)
            line_rev = price * qty
            product_name = inv.get("title_1", "") or ""

            if is_current:
                agg = sku_current[sku]
                agg["sku"] = sku
                if not agg["product_name"] and product_name:
                    agg["product_name"] = product_name

                agg["total_units"] += qty
                agg["orders"] += 1
                agg["stores"].add(order.store_uid)

                if is_delivered:
                    agg["units_sold"] += qty
                    agg["revenue"] += line_rev
                    agg["delivered_units"] += qty

                    # Track last sale date
                    if order_date and (agg["last_sale_date"] is None or order_date > agg["last_sale_date"]):
                        agg["last_sale_date"] = order_date

                    # Daily series
                    day_key = order_date.strftime("%Y-%m-%d") if order_date else "unknown"
                    agg["daily_units"][day_key] += qty

                    # By store
                    sb = agg["by_store"][order.store_uid]
                    sb["store_name"] = stores_map.get(order.store_uid, order.store_uid)
                    sb["units"] += qty
                    sb["revenue"] += line_rev
                    sb["orders"] += 1

                    # By country
                    if order_country:
                        agg["by_country"][order_country]["units"] += qty
                        agg["by_country"][order_country]["revenue"] += line_rev

                    # Daily totals trend
                    daily_totals[day_key]["units"] += qty
                    daily_totals[day_key]["revenue"] += line_rev

                    # Store-level
                    sa = store_agg[order.store_uid]
                    sa["store_name"] = stores_map.get(order.store_uid, order.store_uid)
                    sa["units"] += qty
                    sa["revenue"] += line_rev
                    sa["active_skus"].add(sku)

                if is_delivered:
                    daily_totals[order_date.strftime("%Y-%m-%d") if order_date else "unknown"]["orders"] += 0  # counted once below

            elif is_prev and is_delivered:
                prev = sku_previous[sku]
                prev["units_sold"] += qty
                prev["revenue"] += line_rev
                prev["orders"] += 1

        # Count orders for current period
        if is_current:
            total_orders_current += 1
            if is_delivered:
                day_key = order_date.strftime("%Y-%m-%d") if order_date else "unknown"
                daily_totals[day_key]["orders"] = daily_totals[day_key].get("orders", 0)
                # orders counted at order level, not line-item; handle dedup below

    # Dedup order counting in daily totals: re-count at order level
    daily_order_count: Dict[str, int] = defaultdict(int)
    for order in all_orders:
        if order.frisbo_created_at and order.frisbo_created_at >= dt_from:
            final_outcome = compute_final_outcome(
                order.aggregated_status, order.shipment_status, order.fulfillment_status,
            )
            if final_outcome in DELIVERED_OUTCOMES:
                dk = order.frisbo_created_at.strftime("%Y-%m-%d")
                daily_order_count[dk] += 1
    for dk, cnt in daily_order_count.items():
        daily_totals[dk]["orders"] = cnt

    # Store order counting
    for order in all_orders:
        if order.frisbo_created_at and order.frisbo_created_at >= dt_from:
            final_outcome = compute_final_outcome(
                order.aggregated_status, order.shipment_status, order.fulfillment_status,
            )
            if final_outcome in DELIVERED_OUTCOMES:
                store_agg[order.store_uid]["orders"] += 1

    # Fix double-counting: store orders were counted per line item, reset and recount
    for sa in store_agg.values():
        sa["orders"] = 0
    for order in all_orders:
        if order.frisbo_created_at and order.frisbo_created_at >= dt_from:
            final_outcome = compute_final_outcome(
                order.aggregated_status, order.shipment_status, order.fulfillment_status,
            )
            if final_outcome in DELIVERED_OUTCOMES:
                addr = order.shipping_address or {}
                oc = (addr.get("country_code", "") or "").upper()
                if country_code and oc != country_code.upper():
                    continue
                store_agg[order.store_uid]["orders"] += 1

    # ── 5. Build product performance list ─────────────────────────────────
    now = datetime.utcnow()
    total_revenue = sum(a["revenue"] for a in sku_current.values())
    total_units = sum(a["units_sold"] for a in sku_current.values())

    products = []
    for sku, agg in sku_current.items():
        units = agg["units_sold"]
        if units < min_units:
            continue

        revenue = agg["revenue"]
        unit_cost = sku_cost_map.get(sku, 0)
        cogs = unit_cost * units
        margin = revenue - cogs
        margin_pct = _safe_div(margin, revenue) * 100
        velocity = _safe_div(units, period_days)

        # Previous period comparison
        prev = sku_previous.get(sku, {"units_sold": 0})
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

        # Daily series for sparkline (last N days, fill gaps with 0)
        daily_series = []
        for i in range(period_days):
            d = (dt_from + timedelta(days=i)).strftime("%Y-%m-%d")
            daily_series.append({"date": d, "units": agg["daily_units"].get(d, 0)})

        # By store
        by_store = [
            {"store_uid": uid, "store_name": sb["store_name"], "units": int(sb["units"]),
             "revenue": round(sb["revenue"], 2), "orders": sb["orders"]}
            for uid, sb in agg["by_store"].items()
        ]
        by_store.sort(key=lambda x: x["units"], reverse=True)

        # By country
        by_country = [
            {"country": cc, "units": int(cd["units"]), "revenue": round(cd["revenue"], 2)}
            for cc, cd in agg["by_country"].items()
        ]
        by_country.sort(key=lambda x: x["units"], reverse=True)

        products.append({
            "sku": sku,
            "product_name": agg["product_name"],
            "stores_count": len(agg["stores"]),
            "units_sold": int(units),
            "revenue": round(revenue, 2),
            "cogs": round(cogs, 2),
            "margin": round(margin, 2),
            "margin_pct": round(margin_pct, 1),
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
            "by_store": by_store,
            "by_country": by_country[:10],
        })

    products.sort(key=lambda p: p["velocity"], reverse=True)

    # ── 6. Global KPIs ───────────────────────────────────────────────────
    unique_skus = len([p for p in products if p["units_sold"] > 0])
    delivered_orders = sum(daily_order_count.values())
    top_sku = products[0]["sku"] if products else None

    kpis = {
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
        d = (dt_from + timedelta(days=i)).strftime("%Y-%m-%d")
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
        store_skus = [p for p in products if any(bs["store_uid"] == store_uid for bs in p["by_store"])]
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
            "date_from": dt_from.isoformat(),
            "date_to": dt_to.isoformat(),
            "period_days": period_days,
            "total_orders": total_orders_all,
            "filters": {
                "store_uids": store_uids,
                "country_code": country_code,
                "min_units": min_units,
            },
        },
    }
