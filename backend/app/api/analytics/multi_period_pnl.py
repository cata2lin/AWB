"""
Multi-period Contribution Margin P&L endpoint.

Calls the existing profitability logic N times (once per month) and
restructures the output into a consolidated + per-subsidiary table
with monthly columns + quarter total.
"""
from datetime import datetime, timedelta, date
from typing import Optional, List, Dict, Any
from calendar import monthrange
import logging

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Division mapping: ARONA Group corporate hierarchy
# Each division contains a list of store-name patterns (case-insensitive).
# Order matters — more-specific patterns MUST come before generic ones
# (e.g. 'nocturna.bg' before 'nocturna', 'bonhaus' before anything else).
# ---------------------------------------------------------------------------
DIVISION_MAP = [
    ("SCENTUM", ["esteban", "georgetalent"]),
    ("DTC Brands", ["rossinails", "belasil", "gento", "apreciat",
                     "nocturnalux", "nocturna.ro"]),
    ("UTILITY eCommerce", ["grandia"]),
    ("TREND eCommerce", ["casaofertelor", "ofertelezilei", "reduceribune",
                          "magdeal", "carpetto", "covoria", "cepatai"]),
    ("EUROPE", ["bonhaus", "nocturna.bg"]),
]

# Legacy alias used by _extract_subsidiary_data for the "all stores" aggregate
SUBSIDIARY_MAP = {div: patterns for div, patterns in DIVISION_MAP}


def _store_to_division(store_name: str) -> str:
    """Map a store name to its ARONA Group division."""
    name_lower = store_name.lower()
    for division, patterns in DIVISION_MAP:
        for pattern in patterns:
            if pattern in name_lower:
                return division
    return "OTHER"


# Backward-compatible alias
def _store_to_subsidiary(store_name: str) -> str:
    return _store_to_division(store_name)


def _month_date_range(month_str: str):
    """Convert 'YYYY-MM' to (date_from, date_to) strings."""
    year, month = int(month_str[:4]), int(month_str[5:7])
    last_day = monthrange(year, month)[1]
    return f"{year}-{month:02d}-01", f"{year}-{month:02d}-{last_day:02d}"


def _quarter_label(months: List[str]) -> str:
    """Generate a quarter label like 'Q1 FY26' from a list of month strings."""
    if not months:
        return ""
    first = months[0]
    year = int(first[:4])
    month = int(first[5:7])
    quarter = (month - 1) // 3 + 1
    fy = year % 100
    return f"Q{quarter} FY{fy}"


def _extract_single_store(store_data: Dict) -> Dict[str, Any]:
    """Extract P&L metrics from a single store's data."""
    inc = store_data.get("income", {})
    cg = store_data.get("cogs", {})
    op = store_data.get("operational", {})
    mkt = store_data.get("marketing", {})
    fc = store_data.get("fixed_costs", {})
    sb = store_data.get("status_breakdown", {})

    rev = (inc.get("sales_delivered", {}).get("fara_tva", 0) or 0)
    cogs_val = (cg.get("total_cogs", {}).get("fara_tva", 0) or 0)
    gross_profit = rev - cogs_val

    ship = (op.get("shipping", {}).get("fara_tva", 0) or 0)
    frisbo = (op.get("frisbo_fee", {}).get("fara_tva", 0) or 0)
    payment = (op.get("payment_fee", {}).get("fara_tva", 0) or 0)
    gt = (op.get("gt_commission", {}).get("fara_tva", 0) or 0)
    wh = (op.get("warehouse_salary", {}).get("fara_tva", 0) or 0)
    ops_total = ship + frisbo + payment + gt + wh
    operating_profit = gross_profit - ops_total

    mkt_total = (mkt.get("total", {}).get("fara_tva", 0) or 0)
    cm3 = operating_profit - mkt_total

    delivered = (inc.get("delivered_count", 0) or 0)
    total = (store_data.get("total_orders", 0) or 0)
    in_transit = (sb.get("in_transit", {}).get("count", 0) or 0)
    returned = (sb.get("returned", {}).get("count", 0) or 0)
    cancelled = (sb.get("cancelled", {}).get("count", 0) or 0)

    return {
        "name": store_data.get("store_name", "Unknown"),
        "store_names": [store_data.get("store_name", "")],
        "revenue_fara_tva": round(rev, 2),
        "revenue_cu_tva": round((inc.get("sales_delivered", {}).get("cu_tva", 0) or 0), 2),
        "gross_sales_fara_tva": round((inc.get("gross_sales", {}).get("fara_tva", 0) or 0), 2),
        "returns_cancelled_fara_tva": round((inc.get("returns_cancelled", {}).get("fara_tva", 0) or 0), 2),
        "cogs_fara_tva": round(cogs_val, 2),
        "shipping_fara_tva": round(ship, 2),
        "frisbo_fara_tva": round(frisbo, 2),
        "payment_fee_fara_tva": round(payment, 2),
        "gt_commission_fara_tva": round(gt, 2),
        "warehouse_salary_fara_tva": round(wh, 2),
        "marketing_fara_tva": round(mkt_total, 2),
        "facebook_fara_tva": round((mkt.get("facebook", {}).get("fara_tva", 0) or 0), 2),
        "tiktok_fara_tva": round((mkt.get("tiktok", {}).get("fara_tva", 0) or 0), 2),
        "google_fara_tva": round((mkt.get("google", {}).get("fara_tva", 0) or 0), 2),
        "fixed_costs_fara_tva": round((fc.get("total", {}).get("fara_tva", 0) or 0), 2),
        "gross_profit": round(gross_profit, 2),
        "operating_profit": round(operating_profit, 2),
        "contribution_margin": round(cm3, 2),
        "ops_total": round(ops_total, 2),
        "gm_pct": round((gross_profit / rev * 100) if rev > 0 else 0, 1),
        "om_pct": round((operating_profit / rev * 100) if rev > 0 else 0, 1),
        "nm_pct": round((cm3 / rev * 100) if rev > 0 else 0, 1),
        "delivered_count": delivered,
        "total_orders": total,
        "in_transit_count": in_transit,
        "returned_count": returned,
        "cancelled_count": cancelled,
        "ff_orders": delivered + in_transit,
        "retention_rate": round((delivered / total * 100) if total > 0 else 0, 1),
    }


def _extract_subsidiary_data(pnl_by_store: List[Dict], subsidiary_name: str) -> Dict[str, Any]:
    """Aggregate per-store P&L data for a subsidiary."""
    stores = [s for s in pnl_by_store if _store_to_subsidiary(s.get("store_name", "")) == subsidiary_name]

    agg = {
        "name": subsidiary_name,
        "store_names": [s["store_name"] for s in stores],
        # Income
        "revenue_fara_tva": 0,
        "revenue_cu_tva": 0,
        "gross_sales_fara_tva": 0,
        "returns_cancelled_fara_tva": 0,
        # COGS
        "cogs_fara_tva": 0,
        # Operational
        "shipping_fara_tva": 0,
        "frisbo_fara_tva": 0,
        "payment_fee_fara_tva": 0,
        "gt_commission_fara_tva": 0,
        "warehouse_salary_fara_tva": 0,
        # Marketing
        "marketing_fara_tva": 0,
        "facebook_fara_tva": 0,
        "tiktok_fara_tva": 0,
        "google_fara_tva": 0,
        # Fixed costs
        "fixed_costs_fara_tva": 0,
        # Counts
        "delivered_count": 0,
        "total_orders": 0,
        "in_transit_count": 0,
        "returned_count": 0,
        "cancelled_count": 0,
    }

    for s in stores:
        inc = s.get("income", {})
        cg = s.get("cogs", {})
        op = s.get("operational", {})
        mkt = s.get("marketing", {})
        fc = s.get("fixed_costs", {})
        sb = s.get("status_breakdown", {})

        agg["revenue_fara_tva"] += (inc.get("sales_delivered", {}).get("fara_tva", 0) or 0)
        agg["revenue_cu_tva"] += (inc.get("sales_delivered", {}).get("cu_tva", 0) or 0)
        agg["gross_sales_fara_tva"] += (inc.get("gross_sales", {}).get("fara_tva", 0) or 0)
        agg["returns_cancelled_fara_tva"] += (inc.get("returns_cancelled", {}).get("fara_tva", 0) or 0)

        agg["cogs_fara_tva"] += (cg.get("total_cogs", {}).get("fara_tva", 0) or 0)

        agg["shipping_fara_tva"] += (op.get("shipping", {}).get("fara_tva", 0) or 0)
        agg["frisbo_fara_tva"] += (op.get("frisbo_fee", {}).get("fara_tva", 0) or 0)
        agg["payment_fee_fara_tva"] += (op.get("payment_fee", {}).get("fara_tva", 0) or 0)
        agg["gt_commission_fara_tva"] += (op.get("gt_commission", {}).get("fara_tva", 0) or 0)
        agg["warehouse_salary_fara_tva"] += (op.get("warehouse_salary", {}).get("fara_tva", 0) or 0)

        agg["marketing_fara_tva"] += (mkt.get("total", {}).get("fara_tva", 0) or 0)
        agg["facebook_fara_tva"] += (mkt.get("facebook", {}).get("fara_tva", 0) or 0)
        agg["tiktok_fara_tva"] += (mkt.get("tiktok", {}).get("fara_tva", 0) or 0)
        agg["google_fara_tva"] += (mkt.get("google", {}).get("fara_tva", 0) or 0)

        agg["fixed_costs_fara_tva"] += (fc.get("total", {}).get("fara_tva", 0) or 0)

        agg["delivered_count"] += (inc.get("delivered_count", 0) or 0)
        agg["in_transit_count"] += (sb.get("in_transit", {}).get("count", 0) or 0)
        agg["returned_count"] += (sb.get("returned", {}).get("count", 0) or 0)
        agg["cancelled_count"] += (sb.get("cancelled", {}).get("count", 0) or 0)
        agg["total_orders"] += (s.get("total_orders", 0) or 0)

    # Computed
    rev = agg["revenue_fara_tva"]
    cogs = agg["cogs_fara_tva"]
    gross_profit = rev - cogs

    ops_total = (agg["shipping_fara_tva"] + agg["frisbo_fara_tva"] +
                 agg["payment_fee_fara_tva"] + agg["gt_commission_fara_tva"] +
                 agg["warehouse_salary_fara_tva"])
    operating_profit = gross_profit - ops_total
    contribution_margin = operating_profit - agg["marketing_fara_tva"]

    agg["gross_profit"] = round(gross_profit, 2)
    agg["operating_profit"] = round(operating_profit, 2)
    agg["contribution_margin"] = round(contribution_margin, 2)
    agg["ops_total"] = round(ops_total, 2)

    agg["gm_pct"] = round((gross_profit / rev * 100) if rev > 0 else 0, 1)
    agg["om_pct"] = round((operating_profit / rev * 100) if rev > 0 else 0, 1)
    agg["nm_pct"] = round((contribution_margin / rev * 100) if rev > 0 else 0, 1)

    agg["ff_orders"] = agg["delivered_count"] + agg["in_transit_count"]
    agg["retention_rate"] = round(
        (agg["delivered_count"] / agg["total_orders"] * 100)
        if agg["total_orders"] > 0 else 0, 1
    )

    # Round financial values
    for k in ["revenue_fara_tva", "revenue_cu_tva", "gross_sales_fara_tva",
              "returns_cancelled_fara_tva", "cogs_fara_tva", "shipping_fara_tva",
              "frisbo_fara_tva", "payment_fee_fara_tva", "gt_commission_fara_tva",
              "warehouse_salary_fara_tva", "marketing_fara_tva", "facebook_fara_tva",
              "tiktok_fara_tva", "google_fara_tva", "fixed_costs_fara_tva"]:
        agg[k] = round(agg[k], 2)

    return agg


def _build_period_data(full_response: Dict, subsidiary_names: List[str]) -> Dict:
    """Build per-subsidiary data from a single-period profitability response."""
    pnl = full_response.get("pnl", {})
    pnl_by_store = full_response.get("pnl_by_store", [])

    # Build consolidated (all stores)
    consolidated = _extract_subsidiary_data(pnl_by_store, "__ALL__")
    # Override: use the total pnl data directly for consolidated accuracy
    inc = pnl.get("income", {})
    cg = pnl.get("cogs", {})
    op = pnl.get("operational", {})
    mkt = pnl.get("marketing", {})
    fc = pnl.get("fixed_costs", {})

    consolidated["revenue_fara_tva"] = inc.get("sales_delivered", {}).get("fara_tva", 0) or 0
    consolidated["cogs_fara_tva"] = cg.get("total_cogs", {}).get("fara_tva", 0) or 0
    consolidated["gross_profit"] = pnl.get("gross_profit", {}).get("fara_tva", 0) or 0
    consolidated["gm_pct"] = pnl.get("gross_margin_pct", 0) or 0
    consolidated["operating_profit"] = pnl.get("operating_profit", {}).get("fara_tva", 0) or 0
    consolidated["om_pct"] = pnl.get("operating_margin_pct", 0) or 0

    consolidated["shipping_fara_tva"] = op.get("shipping", {}).get("fara_tva", 0) or 0
    consolidated["frisbo_fara_tva"] = op.get("frisbo_fee", {}).get("fara_tva", 0) or 0
    consolidated["payment_fee_fara_tva"] = op.get("payment_fee", {}).get("fara_tva", 0) or 0
    consolidated["gt_commission_fara_tva"] = op.get("gt_commission", {}).get("fara_tva", 0) or 0
    consolidated["warehouse_salary_fara_tva"] = op.get("warehouse_salary", {}).get("fara_tva", 0) or 0

    consolidated["marketing_fara_tva"] = mkt.get("total", {}).get("fara_tva", 0) or 0
    consolidated["facebook_fara_tva"] = mkt.get("facebook", {}).get("fara_tva", 0) or 0
    consolidated["tiktok_fara_tva"] = mkt.get("tiktok", {}).get("fara_tva", 0) or 0
    consolidated["google_fara_tva"] = mkt.get("google", {}).get("fara_tva", 0) or 0

    consolidated["fixed_costs_fara_tva"] = fc.get("total", {}).get("fara_tva", 0) or 0

    consolidated["delivered_count"] = inc.get("delivered_count", 0) or 0
    total_all = sum(s.get("total_orders", 0) or 0 for s in pnl_by_store)
    consolidated["total_orders"] = total_all
    in_transit_all = sum(
        s.get("status_breakdown", {}).get("in_transit", {}).get("count", 0) or 0
        for s in pnl_by_store
    )
    consolidated["in_transit_count"] = in_transit_all
    consolidated["ff_orders"] = consolidated["delivered_count"] + in_transit_all

    # Returned and cancelled counts from top-level pnl
    consolidated["returned_count"] = pnl.get("returned_count", 0) or 0
    consolidated["cancelled_count"] = pnl.get("cancelled_count", 0) or 0

    # Packaging cost from operational breakdown
    consolidated["packaging_fara_tva"] = op.get("packaging", {}).get("fara_tva", 0) or 0

    consolidated["retention_rate"] = round(
        (consolidated["delivered_count"] / total_all * 100)
        if total_all > 0 else 0, 1
    )
    # Recalculate CM3
    ops_total = (consolidated["shipping_fara_tva"] + consolidated["frisbo_fara_tva"] +
                 consolidated["payment_fee_fara_tva"] + consolidated["gt_commission_fara_tva"] +
                 consolidated["warehouse_salary_fara_tva"])
    consolidated["ops_total"] = round(ops_total, 2)
    cm3 = consolidated["operating_profit"] - consolidated["marketing_fara_tva"]
    consolidated["contribution_margin"] = round(cm3, 2)
    rev = consolidated["revenue_fara_tva"]
    consolidated["nm_pct"] = round((cm3 / rev * 100) if rev > 0 else 0, 1)

    # Build per-subsidiary
    subsidiaries = {}
    for name in subsidiary_names:
        subsidiaries[name] = _extract_subsidiary_data(pnl_by_store, name)

    # Build per-individual-store data
    individual_stores = {}
    for store in pnl_by_store:
        store_name = store.get("store_name", "")
        if store_name:
            individual_stores[store_name] = _extract_single_store(store)

    return {
        "consolidated": consolidated,
        "subsidiaries": subsidiaries,
        "individual_stores": individual_stores,
    }


def _sum_periods(periods_data: List[Dict], key: str) -> float:
    """Sum a numeric key across all periods."""
    return round(sum(p.get(key, 0) or 0 for p in periods_data), 2)


def _build_quarter(periods_data: List[Dict]) -> Dict:
    """Aggregate multiple periods into a quarter total."""
    q = {}
    numeric_keys = [
        "revenue_fara_tva", "cogs_fara_tva", "gross_profit",
        "shipping_fara_tva", "frisbo_fara_tva", "payment_fee_fara_tva",
        "gt_commission_fara_tva", "warehouse_salary_fara_tva", "ops_total",
        "packaging_fara_tva",
        "operating_profit", "marketing_fara_tva", "facebook_fara_tva",
        "tiktok_fara_tva", "google_fara_tva", "contribution_margin",
        "fixed_costs_fara_tva",
        "delivered_count", "total_orders", "in_transit_count",
        "returned_count", "cancelled_count", "ff_orders",
    ]
    for k in numeric_keys:
        q[k] = _sum_periods(periods_data, k)

    # Recalculate percentages on quarter totals (NOT averaged)
    rev = q["revenue_fara_tva"]
    q["gm_pct"] = round(((rev - q["cogs_fara_tva"]) / rev * 100) if rev > 0 else 0, 1)
    q["om_pct"] = round((q["operating_profit"] / rev * 100) if rev > 0 else 0, 1)
    q["nm_pct"] = round((q["contribution_margin"] / rev * 100) if rev > 0 else 0, 1)
    q["retention_rate"] = round(
        (q["delivered_count"] / q["total_orders"] * 100)
        if q["total_orders"] > 0 else 0, 1
    )

    return q


async def get_multi_period_profitability(
    months: str,
    store_uids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Returns contribution margin P&L data across multiple months.

    Parameters:
        months: Comma-separated month strings, e.g. "2026-01,2026-02,2026-03"
        store_uids: Optional comma-separated store UIDs filter

    Returns structured data for: consolidated + per-subsidiary × N months + quarter.
    """
    from app.api.analytics.profitability import get_overall_profitability

    month_list = [m.strip() for m in months.split(",") if m.strip()]
    if not month_list:
        return {"error": "No months specified"}

    division_names = [div for div, _ in DIVISION_MAP]
    subsidiary_names = division_names  # backward compat for _build_period_data

    # Fetch profitability for each month by calling the existing endpoint logic
    monthly_results = []
    for month_str in month_list:
        date_from, date_to = _month_date_range(month_str)
        result = await get_overall_profitability(
            db=db,
            date_from=date_from,
            date_to=date_to,
            days=None,
            store_uids=store_uids,
        )
        monthly_results.append(result)

    # Structure data per period
    periods = []
    for result in monthly_results:
        period_data = _build_period_data(result, subsidiary_names)
        periods.append(period_data)

    # Build consolidated time series
    consolidated_months = [p["consolidated"] for p in periods]
    consolidated_quarter = _build_quarter(consolidated_months)

    # MoM growth for consolidated
    mom_growth = [None]
    for i in range(1, len(consolidated_months)):
        prev_rev = consolidated_months[i - 1].get("revenue_fara_tva", 0)
        curr_rev = consolidated_months[i].get("revenue_fara_tva", 0)
        if prev_rev > 0:
            mom_growth.append(round((curr_rev - prev_rev) / prev_rev * 100, 1))
        else:
            mom_growth.append(None)

    # Build per-subsidiary time series
    subsidiaries_out = []
    for name in subsidiary_names:
        sub_months = [p["subsidiaries"].get(name, {}) for p in periods]
        sub_quarter = _build_quarter(sub_months)

        # MoM growth per subsidiary
        sub_mom = [None]
        for i in range(1, len(sub_months)):
            prev = sub_months[i - 1].get("revenue_fara_tva", 0)
            curr = sub_months[i].get("revenue_fara_tva", 0)
            if prev > 0:
                sub_mom.append(round((curr - prev) / prev * 100, 1))
            else:
                sub_mom.append(None)

        # Collect individual store names for this subsidiary
        store_names_in_sub = set()
        for p in periods:
            for sname in p.get("individual_stores", {}):
                if _store_to_subsidiary(sname) == name:
                    store_names_in_sub.add(sname)

        # Build per-store time series within this subsidiary
        stores_in_sub = []
        for sname in sorted(store_names_in_sub):
            store_months = [p.get("individual_stores", {}).get(sname, {}) for p in periods]
            store_quarter = _build_quarter(store_months)
            store_mom = [None]
            for i in range(1, len(store_months)):
                prev_r = store_months[i - 1].get("revenue_fara_tva", 0)
                curr_r = store_months[i].get("revenue_fara_tva", 0)
                if prev_r > 0:
                    store_mom.append(round((curr_r - prev_r) / prev_r * 100, 1))
                else:
                    store_mom.append(None)
            stores_in_sub.append({
                "name": sname,
                "months": store_months,
                "quarter": store_quarter,
                "mom_growth": store_mom,
            })

        subsidiaries_out.append({
            "name": name,
            "months": sub_months,
            "quarter": sub_quarter,
            "mom_growth": sub_mom,
            "stores": stores_in_sub,
        })

    return {
        "periods": month_list,
        "quarter_label": _quarter_label(month_list),
        "consolidated": {
            "months": consolidated_months,
            "quarter": consolidated_quarter,
            "mom_growth": mom_growth,
        },
        "subsidiaries": subsidiaries_out,
        "config": monthly_results[-1].get("config", {}) if monthly_results else {},
    }
