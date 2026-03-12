"""
SKU Risk & Shipping Anomalies — the main FastAPI endpoint.

Uses computations from computations.py for outcome mapping
and risk score normalization.
"""
import json
import logging
import math
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional, Dict, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import Order, Store, SkuCost
from app.api.sku_risk.computations import (
    compute_final_outcome, safe_div, normalize_min_max,
    PROBLEM_OUTCOMES, DEFAULT_SHIPPING_COST_PCT_THRESHOLD,
    DEFAULT_Z_SCORE_THRESHOLD, RISK_WEIGHT_PROBLEM_RATE,
    RISK_WEIGHT_CONTAMINATION, RISK_WEIGHT_SHIPPING_ANOMALY,
    RISK_WEIGHT_DELIVERY_PROBLEM,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/sku-risk")
async def get_sku_risk(
    days: int = Query(30, ge=1, le=365),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    store_uids: Optional[str] = Query(None),
    courier_name: Optional[str] = Query(None),
    country_code: Optional[str] = Query(None),
    min_units_sold: int = Query(30, ge=1),
    min_orders_with_sku: int = Query(20, ge=1),
    include_delivery_problems: bool = Query(False),
    shipping_cost_pct_threshold: float = Query(DEFAULT_SHIPPING_COST_PCT_THRESHOLD),
    z_score_threshold: float = Query(DEFAULT_Z_SCORE_THRESHOLD),
    db: AsyncSession = Depends(get_db),
):
    """
    Compute SKU risk metrics and shipping anomalies.

    Returns:
    - worst_skus: SKU-level risk table
    - anomaly_orders: shipping anomaly order list
    - store_summary: per-store KPIs
    - meta: filter info, coverage stats
    """
    # ── 1. Build date filter ──────────────────────────────────────────────
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

    # ── 2. Query orders ───────────────────────────────────────────────────
    query = select(Order).where(
        Order.frisbo_created_at >= dt_from,
        Order.frisbo_created_at <= dt_to,
    )

    if store_uids:
        uid_list = [u.strip() for u in store_uids.split(",") if u.strip()]
        if uid_list:
            query = query.where(Order.store_uid.in_(uid_list))
    if courier_name:
        query = query.where(Order.courier_name == courier_name)

    result = await db.execute(query)
    all_orders = result.scalars().all()

    # ── 3. Load stores + SKU costs ────────────────────────────────────────
    stores_result = await db.execute(select(Store))
    stores_map: Dict[str, str] = {s.uid: s.name for s in stores_result.scalars().all()}

    sku_costs_result = await db.execute(select(SkuCost))
    sku_cost_map: Dict[str, float] = {sc.sku: sc.cost for sc in sku_costs_result.scalars().all()}

    # ── 4. Process orders ─────────────────────────────────────────────────
    order_data_list = []
    orders_with_shipping = 0
    total_orders = len(all_orders)

    for order in all_orders:
        addr = order.shipping_address or {}
        order_country = addr.get("country_code", "") or ""

        if country_code and order_country.upper() != country_code.upper():
            continue

        final_outcome = compute_final_outcome(
            order.aggregated_status,
            order.shipment_status,
            order.fulfillment_status,
        )

        # Parse line items
        items_raw = order.line_items or []
        if isinstance(items_raw, str):
            try:
                items_raw = json.loads(items_raw)
            except (json.JSONDecodeError, TypeError):
                items_raw = []

        # Deduplicate and aggregate line items by SKU within order
        sku_lines: Dict[str, dict] = {}
        for item in items_raw:
            inv = item.get("inventory_item", {}) or {}
            sku = inv.get("sku", "") or ""
            if not sku:
                continue
            qty = float(item.get("quantity", 1) or 1)
            price = float(item.get("price", 0) or 0)
            line_rev = price * qty

            if sku in sku_lines:
                sku_lines[sku]["quantity"] += qty
                sku_lines[sku]["line_revenue"] += line_rev
            else:
                sku_lines[sku] = {
                    "sku": sku,
                    "quantity": qty,
                    "line_revenue": line_rev,
                    "product_name": inv.get("title_1", ""),
                }

        if not sku_lines:
            continue

        # Compute allocation factors
        total_line_revenue = sum(l["line_revenue"] for l in sku_lines.values())
        total_qty = sum(l["quantity"] for l in sku_lines.values())

        for sk_data in sku_lines.values():
            if total_line_revenue > 0:
                sk_data["alloc_factor"] = sk_data["line_revenue"] / total_line_revenue
            elif total_qty > 0:
                sk_data["alloc_factor"] = sk_data["quantity"] / total_qty
            else:
                sk_data["alloc_factor"] = 1.0 / len(sku_lines)

        # Shipping data
        real_shipping = order.transport_cost
        shipping_charged = None
        if order.total_price is not None and order.subtotal_price is not None:
            shipping_charged = order.total_price - order.subtotal_price

        has_shipping = real_shipping is not None
        if has_shipping:
            orders_with_shipping += 1

        order_data_list.append({
            "uid": order.uid,
            "order_number": order.order_number,
            "store_uid": order.store_uid,
            "store_name": stores_map.get(order.store_uid, order.store_uid),
            "date": order.frisbo_created_at.isoformat() if order.frisbo_created_at else None,
            "final_outcome": final_outcome,
            "order_total": order.total_price or 0,
            "shipping_charged": shipping_charged,
            "real_shipping_cost": real_shipping,
            "courier_name": order.courier_name or "",
            "country_code": order_country,
            "city": addr.get("city", ""),
            "payment_gateway": order.payment_gateway or "",
            "package_weight": order.package_weight,
            "item_count": order.item_count or 1,
            "sku_lines": sku_lines,
            "total_line_revenue": total_line_revenue,
        })

    filtered_total = len(order_data_list)

    # ── 5. Compute shipping baselines per segment ─────────────────────────
    segment_costs: Dict[tuple, List[float]] = defaultdict(list)
    for od in order_data_list:
        if od["real_shipping_cost"] is not None:
            key = (od["store_uid"], od["country_code"], od["courier_name"])
            segment_costs[key].append(od["real_shipping_cost"])

    segment_stats: Dict[tuple, dict] = {}
    for key, costs in segment_costs.items():
        avg = sum(costs) / len(costs) if costs else 0
        if len(costs) > 1:
            variance = sum((c - avg) ** 2 for c in costs) / (len(costs) - 1)
            stddev = math.sqrt(variance)
        else:
            stddev = 0
        segment_stats[key] = {"avg": avg, "stddev": stddev, "count": len(costs)}

    # Fallback: (store_uid) only
    store_costs: Dict[str, List[float]] = defaultdict(list)
    for od in order_data_list:
        if od["real_shipping_cost"] is not None:
            store_costs[od["store_uid"]].append(od["real_shipping_cost"])

    store_stats: Dict[str, dict] = {}
    for uid, costs in store_costs.items():
        avg = sum(costs) / len(costs) if costs else 0
        if len(costs) > 1:
            variance = sum((c - avg) ** 2 for c in costs) / (len(costs) - 1)
            stddev = math.sqrt(variance)
        else:
            stddev = 0
        store_stats[uid] = {"avg": avg, "stddev": stddev, "count": len(costs)}

    # ── 6. Detect shipping anomalies ──────────────────────────────────────
    anomaly_orders = []

    for od in order_data_list:
        if od["real_shipping_cost"] is None:
            od["shipping_anomaly"] = False
            od["anomaly_reasons"] = []
            continue

        real_cost = od["real_shipping_cost"]
        charged = od["shipping_charged"] or 0
        margin = charged - real_cost
        cost_pct = safe_div(real_cost, od["order_total"])

        seg_key = (od["store_uid"], od["country_code"], od["courier_name"])
        baseline = segment_stats.get(seg_key)
        if not baseline or baseline["count"] < 5:
            baseline = store_stats.get(od["store_uid"], {"avg": 0, "stddev": 0})

        reasons = []

        if charged > 0 and margin < 0:
            reasons.append(f"Marjă negativă ({margin:.2f})")

        if baseline["stddev"] > 0:
            z = (real_cost - baseline["avg"]) / baseline["stddev"]
            if z > z_score_threshold:
                reasons.append(f"Z-score={z:.1f} (>{z_score_threshold})")

        if od["order_total"] and cost_pct > shipping_cost_pct_threshold:
            reasons.append(f"Cost {cost_pct:.0%} din total (>{shipping_cost_pct_threshold:.0%})")

        is_anomaly = len(reasons) > 0
        od["shipping_anomaly"] = is_anomaly
        od["anomaly_reasons"] = reasons
        od["shipping_margin"] = margin
        od["shipping_cost_pct"] = cost_pct

        if is_anomaly:
            skus_in_order = list(od["sku_lines"].keys())
            anomaly_orders.append({
                "uid": od["uid"],
                "order_number": od["order_number"],
                "store_name": od["store_name"],
                "date": od["date"],
                "courier_name": od["courier_name"],
                "country_code": od["country_code"],
                "order_total": od["order_total"],
                "shipping_charged": od["shipping_charged"],
                "real_shipping_cost": real_cost,
                "shipping_margin": margin,
                "shipping_cost_pct": round(cost_pct * 100, 1),
                "item_count": od["item_count"],
                "final_outcome": od["final_outcome"],
                "anomaly_reasons": reasons,
                "skus": skus_in_order,
            })

    anomaly_orders.sort(key=lambda x: x["shipping_margin"])
    anomaly_orders = anomaly_orders[:200]

    # ── 7. Aggregate to SKU level ─────────────────────────────────────────
    problem_outcomes = set(PROBLEM_OUTCOMES)
    if include_delivery_problems:
        problem_outcomes.add("DELIVERY_PROBLEM")

    sku_agg: Dict[str, dict] = defaultdict(lambda: {
        "sku": "",
        "product_name": "",
        "stores": set(),
        "units_sold_total": 0,
        "orders_with_sku": 0,
        "revenue_total": 0.0,
        "units_back_to_sender": 0,
        "units_cancelled": 0,
        "units_refused": 0,
        "problem_units_total": 0,
        "problem_orders_with_sku": 0,
        "delivery_problem_orders": 0,
        "not_shipped_orders": 0,
        "allocated_shipping_cost_total": 0.0,
        "allocated_shipping_margin_total": 0.0,
        "shipping_anomaly_orders": 0,
        "orders_with_shipping_data": 0,
        "cogs_total": 0.0,
        "by_store": defaultdict(lambda: {
            "store_name": "",
            "units_sold": 0,
            "orders_count": 0,
            "problem_units": 0,
            "problem_orders": 0,
            "revenue": 0.0,
        }),
    })

    for od in order_data_list:
        final = od["final_outcome"]
        is_problem = final in problem_outcomes

        for sku, line in od["sku_lines"].items():
            agg = sku_agg[sku]
            agg["sku"] = sku
            if not agg["product_name"] and line.get("product_name"):
                agg["product_name"] = line["product_name"]

            qty = line["quantity"]
            rev = line["line_revenue"]
            alloc = line["alloc_factor"]

            agg["stores"].add(od["store_uid"])
            agg["units_sold_total"] += qty
            agg["orders_with_sku"] += 1
            agg["revenue_total"] += rev

            unit_cost = sku_cost_map.get(sku, 0)
            agg["cogs_total"] += unit_cost * qty

            if final == "BACK_TO_SENDER":
                agg["units_back_to_sender"] += qty
                agg["problem_units_total"] += qty
                agg["problem_orders_with_sku"] += 1
            elif final == "CANCELLED":
                agg["units_cancelled"] += qty
                agg["problem_units_total"] += qty
                agg["problem_orders_with_sku"] += 1
            elif final == "REFUSED":
                agg["units_refused"] += qty
                agg["problem_units_total"] += qty
                agg["problem_orders_with_sku"] += 1
            elif final == "DELIVERY_PROBLEM":
                agg["delivery_problem_orders"] += 1
                if include_delivery_problems:
                    agg["problem_units_total"] += qty
                    agg["problem_orders_with_sku"] += 1
            elif final == "NOT_SHIPPED_OR_PENDING":
                agg["not_shipped_orders"] += 1

            if od["real_shipping_cost"] is not None:
                agg["orders_with_shipping_data"] += 1
                allocated_cost = od["real_shipping_cost"] * alloc
                agg["allocated_shipping_cost_total"] += allocated_cost

                if od["shipping_charged"] is not None:
                    allocated_margin = (od["shipping_charged"] - od["real_shipping_cost"]) * alloc
                    agg["allocated_shipping_margin_total"] += allocated_margin

            if od.get("shipping_anomaly"):
                agg["shipping_anomaly_orders"] += 1

            store_b = agg["by_store"][od["store_uid"]]
            store_b["store_name"] = od["store_name"]
            store_b["units_sold"] += qty
            store_b["orders_count"] += 1
            store_b["revenue"] += rev
            if is_problem:
                store_b["problem_units"] += qty
                store_b["problem_orders"] += 1

    # ── 8. Compute rates and risk scores ──────────────────────────────────
    sku_results = []
    for sku, agg in sku_agg.items():
        units = agg["units_sold_total"]
        orders = agg["orders_with_sku"]

        problem_rate = safe_div(agg["problem_units_total"], units)
        contamination_rate = safe_div(agg["problem_orders_with_sku"], orders)
        shipping_anomaly_rate = safe_div(agg["shipping_anomaly_orders"], orders)
        delivery_problem_rate = safe_div(agg["delivery_problem_orders"], orders)

        avg_ship_cost_per_unit = safe_div(agg["allocated_shipping_cost_total"], units)
        avg_ship_margin_per_unit = safe_div(agg["allocated_shipping_margin_total"], units)

        passes_volume = units >= min_units_sold and orders >= min_orders_with_sku

        by_store_list = []
        for store_uid, sb in agg["by_store"].items():
            by_store_list.append({
                "store_uid": store_uid,
                "store_name": sb["store_name"],
                "units_sold": sb["units_sold"],
                "orders_count": sb["orders_count"],
                "problem_units": sb["problem_units"],
                "problem_orders": sb["problem_orders"],
                "problem_rate": round(safe_div(sb["problem_units"], sb["units_sold"]) * 100, 1),
                "revenue": round(sb["revenue"], 2),
            })

        sku_results.append({
            "sku": sku,
            "product_name": agg["product_name"],
            "stores_count": len(agg["stores"]),
            "units_sold": int(units),
            "orders_with_sku": orders,
            "revenue_total": round(agg["revenue_total"], 2),
            "units_back_to_sender": int(agg["units_back_to_sender"]),
            "units_cancelled": int(agg["units_cancelled"]),
            "units_refused": int(agg["units_refused"]),
            "problem_units": int(agg["problem_units_total"]),
            "problem_rate": round(problem_rate * 100, 1),
            "problem_orders": agg["problem_orders_with_sku"],
            "contamination_rate": round(contamination_rate * 100, 1),
            "delivery_problem_orders": agg["delivery_problem_orders"],
            "delivery_problem_rate": round(delivery_problem_rate * 100, 1),
            "not_shipped_orders": agg["not_shipped_orders"],
            "avg_ship_cost_per_unit": round(avg_ship_cost_per_unit, 2),
            "avg_ship_margin_per_unit": round(avg_ship_margin_per_unit, 2),
            "shipping_anomaly_orders": agg["shipping_anomaly_orders"],
            "shipping_anomaly_rate": round(shipping_anomaly_rate * 100, 1),
            "cogs_total": round(agg["cogs_total"], 2),
            "passes_volume": passes_volume,
            "_pr": problem_rate,
            "_cr": contamination_rate,
            "_sar": shipping_anomaly_rate,
            "_dpr": delivery_problem_rate,
            "by_store": by_store_list,
        })

    # Normalize and compute risk scores
    scorable = [s for s in sku_results if s["passes_volume"]]
    if scorable:
        pr_norm = normalize_min_max([s["_pr"] for s in scorable])
        cr_norm = normalize_min_max([s["_cr"] for s in scorable])
        sar_norm = normalize_min_max([s["_sar"] for s in scorable])
        dpr_norm = normalize_min_max([s["_dpr"] for s in scorable])

        for i, s in enumerate(scorable):
            score = 100 * (
                RISK_WEIGHT_PROBLEM_RATE * pr_norm[i] +
                RISK_WEIGHT_CONTAMINATION * cr_norm[i] +
                RISK_WEIGHT_SHIPPING_ANOMALY * sar_norm[i] +
                RISK_WEIGHT_DELIVERY_PROBLEM * dpr_norm[i]
            )
            s["risk_score"] = round(score, 1)

    for s in sku_results:
        if not s["passes_volume"]:
            s["risk_score"] = None

    for s in sku_results:
        for k in ("_pr", "_cr", "_sar", "_dpr"):
            s.pop(k, None)

    sku_results.sort(key=lambda s: s["risk_score"] if s["risk_score"] is not None else -1, reverse=True)

    # ── 9. Store summary ──────────────────────────────────────────────────
    store_agg: Dict[str, dict] = defaultdict(lambda: {
        "store_name": "",
        "total_orders": 0,
        "delivered_orders": 0,
        "problem_orders": 0,
        "shipping_cost_sum": 0.0,
        "shipping_cost_count": 0,
        "anomaly_orders": 0,
    })

    for od in order_data_list:
        sa = store_agg[od["store_uid"]]
        sa["store_name"] = od["store_name"]
        sa["total_orders"] += 1
        if od["final_outcome"] == "DELIVERED":
            sa["delivered_orders"] += 1
        if od["final_outcome"] in problem_outcomes:
            sa["problem_orders"] += 1
        if od["real_shipping_cost"] is not None:
            sa["shipping_cost_sum"] += od["real_shipping_cost"]
            sa["shipping_cost_count"] += 1
        if od.get("shipping_anomaly"):
            sa["anomaly_orders"] += 1

    store_summary = []
    for store_uid, sa in store_agg.items():
        store_skus = [
            s for s in sku_results
            if s["risk_score"] is not None
            and any(bs["store_uid"] == store_uid for bs in s["by_store"])
        ]
        store_skus.sort(key=lambda x: x["risk_score"] or 0, reverse=True)
        top5 = [{"sku": s["sku"], "risk_score": s["risk_score"], "problem_rate": s["problem_rate"]}
                for s in store_skus[:5]]

        store_summary.append({
            "store_uid": store_uid,
            "store_name": sa["store_name"],
            "total_orders": sa["total_orders"],
            "delivered_pct": round(safe_div(sa["delivered_orders"], sa["total_orders"]) * 100, 1),
            "problem_pct": round(safe_div(sa["problem_orders"], sa["total_orders"]) * 100, 1),
            "avg_shipping_cost": round(
                safe_div(sa["shipping_cost_sum"], sa["shipping_cost_count"]), 2
            ),
            "anomaly_pct": round(safe_div(sa["anomaly_orders"], sa["total_orders"]) * 100, 1),
            "top5_worst_skus": top5,
        })

    store_summary.sort(key=lambda x: x["problem_pct"], reverse=True)

    # ── 10. Response ──────────────────────────────────────────────────────
    return {
        "worst_skus": sku_results,
        "anomaly_orders": anomaly_orders,
        "store_summary": store_summary,
        "meta": {
            "total_orders_in_range": total_orders,
            "filtered_orders": filtered_total,
            "orders_with_shipping": orders_with_shipping,
            "shipping_coverage_pct": round(safe_div(orders_with_shipping, filtered_total) * 100, 1),
            "unique_skus": len(sku_results),
            "skus_passing_volume": len(scorable),
            "date_from": dt_from.isoformat(),
            "date_to": dt_to.isoformat(),
            "filters": {
                "store_uids": store_uids,
                "courier_name": courier_name,
                "country_code": country_code,
                "min_units_sold": min_units_sold,
                "min_orders_with_sku": min_orders_with_sku,
                "include_delivery_problems": include_delivery_problems,
            },
        },
    }
