"""
Comision Agentie API — Agency commission report per store/brand.

Aggregates order data by store for a given month:
  - Total orders (comenzi)
  - Shipped orders (plecate)
  - Refused/returned orders (refuzate)
  - Revenue (incasari)
  - Transport cost
  - Commission = comision_pct × (incasari - transport)

Config (enabled stores + default %) is stored in system_settings
with key 'comision_agentie.config'.
"""

import csv
import io
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func, and_, case, literal
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timezone import date_str_to_utc_start, date_str_to_utc_end
from app.models import Order, Store
from app.models.system_setting import SystemSetting

router = APIRouter()
logger = logging.getLogger(__name__)

SETTING_KEY = "comision_agentie.config"


async def _get_config(db: AsyncSession) -> dict:
    """Load comision agentie config from system_settings."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == SETTING_KEY)
    )
    setting = result.scalar_one_or_none()
    if setting and setting.value_json:
        return setting.value_json
    # Default: all stores enabled, 2.5% commission
    return {"comision_pct": 2.5, "enabled_store_uids": []}


async def _save_config(db: AsyncSession, config: dict):
    """Save comision agentie config to system_settings."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == SETTING_KEY)
    )
    setting = result.scalar_one_or_none()
    if setting:
        setting.value_json = config
        setting.updated_at = datetime.utcnow()
    else:
        setting = SystemSetting(
            key=SETTING_KEY,
            description="Comision agentie configuration (enabled stores + default %)",
            value_json=config,
            updated_at=datetime.utcnow(),
        )
        db.add(setting)
    await db.commit()


def _month_range(month: str):
    """Parse 'YYYY-MM' into (start_date_str, end_date_str)."""
    parts = month.split("-")
    year, mon = int(parts[0]), int(parts[1])
    start = f"{year}-{mon:02d}-01"
    # Last day of month
    if mon == 12:
        end_year, end_mon = year + 1, 1
    else:
        end_year, end_mon = year, mon + 1
    from datetime import date as dt_date

    last_day = (
        dt_date(end_year, end_mon, 1) - __import__("datetime").timedelta(days=1)
    ).day
    end = f"{year}-{mon:02d}-{last_day:02d}"
    return start, end


# Shipped statuses — orders that left the warehouse
SHIPPED_STATUSES = {
    "shipped",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "customer_pickup",
    "in_parcel_locker",
    "fulfilled",
    "waiting_for_courier",
    "picked_up",
    "redirected",
    "deferred_delivery",
    "returning_to_sender",
    "back_to_sender",
    "returned",
    "unsuccessful_delivery",
    "refused",
    "lost",
}

# Refused / returned statuses
REFUSED_STATUSES = {
    "returning_to_sender",
    "back_to_sender",
    "returned",
    "unsuccessful_delivery",
    "refused",
    "lost",
}


# In-memory cache for agency commission to prevent heavy DB hits
import time

_COMMISSION_CACHE = {}


async def _calculate_comision(
    db: AsyncSession,
    month: str,
    comision_pct: float,
    store_uids: Optional[list] = None,
    store_comision_pct: Optional[dict] = None,
):
    """
    Calculate commission data per store for a given month using Profitability logic.
    Supports custom commission percentage per store.
    """
    # Define cache key
    store_uids_key = ",".join(sorted(store_uids)) if store_uids else "all"
    pct_overrides = ""
    if store_comision_pct:
        pct_overrides = ",".join(
            f"{k}:{v}" for k, v in sorted(store_comision_pct.items())
        )
    # v4 bump: commission base switched from sales_delivered → gross_sales,
    # response shape gained `livrate` + `incasari_livrate` per store. The
    # previous v3 cache rows are no longer comparable.
    cache_key = f"{month}_{comision_pct}_{store_uids_key}_{pct_overrides}_v4"

    now_ts = time.time()
    if cache_key in _COMMISSION_CACHE:
        entry = _COMMISSION_CACHE[cache_key]
        if now_ts < entry["expires_at"]:
            return entry["data"]

    date_from, date_to = _month_range(month)

    # NOTE: previously passed `skip_line_items=True` here, but
    # `get_overall_profitability` does not accept that kwarg — it silently
    # raised TypeError and the comision endpoint returned HTTP 500. Removed.
    from app.api.analytics.profitability import get_overall_profitability

    prof_data = await get_overall_profitability(
        db=db,
        date_from=date_from,
        date_to=date_to,
        store_uids=",".join(store_uids) if store_uids else None,
    )

    store_rows = []
    total_comenzi = 0
    total_plecate = 0
    total_refuzate = 0
    total_incasari = 0.0
    total_incasari_livrate = 0.0
    total_transport = 0.0
    total_comision = 0.0

    from datetime import date as dt_date

    parts = month.split("-")
    d_from = dt_date(int(parts[0]), int(parts[1]), 1)
    if int(parts[1]) == 12:
        d_to = dt_date(int(parts[0]) + 1, 1, 1)
    else:
        d_to = dt_date(int(parts[0]), int(parts[1]) + 1, 1)
    days_in_month = (d_to - d_from).days

    month_label_ro = d_from.strftime("%B %Y").capitalize()
    ro_months = {
        "January": "Ianuarie",
        "February": "Februarie",
        "March": "Martie",
        "April": "Aprilie",
        "May": "Mai",
        "June": "Iunie",
        "July": "Iulie",
        "August": "August",
        "September": "Septembrie",
        "October": "Octombrie",
        "November": "Noiembrie",
        "December": "Decembrie",
    }
    for en, ro in ro_months.items():
        month_label_ro = month_label_ro.replace(en, ro)

    for s_pnl in prof_data.get("pnl_by_store", []):
        s_uid = s_pnl["store_uid"]
        # Determine effective commission pct for this store
        effective_pct = comision_pct
        if store_comision_pct and s_uid in store_comision_pct:
            effective_pct = float(store_comision_pct[s_uid])

        # Commission base = revenue from ALL orders in the period (gross_sales),
        # NOT just delivered. The agency generated the order volume regardless
        # of final delivery outcome. Per user request 2026-05-19.
        # Transport stays as the actual cost we paid (delivered-only shipping
        # cost from the profitability calculation).
        incasari = s_pnl["income"]["gross_sales"]["cu_tva"]
        incasari_delivered = s_pnl["income"]["sales_delivered"]["cu_tva"]
        transport = s_pnl["operational"]["shipping"]["cu_tva"]
        comision_val = round(effective_pct / 100.0 * (incasari - transport), 2)

        comenzi = s_pnl.get("total_orders", 0)
        plecate = s_pnl.get("shipped_count", 0)
        livrate = s_pnl["income"].get("delivered_count", 0)
        refuzate = s_pnl["income"].get("returns_cancelled_count", 0)

        store_rows.append(
            {
                "luna": month_label_ro,
                "brand": s_pnl["store_name"],
                "store_uid": s_pnl["store_uid"],
                "cost": days_in_month,
                "comenzi": comenzi,
                "plecate": plecate,
                "livrate": livrate,
                "refuzate": refuzate,
                "incasari": round(incasari, 2),
                "incasari_livrate": round(incasari_delivered, 2),
                "comision_pct": effective_pct,
                "transport": round(transport, 2),
                "total_comision": comision_val,
            }
        )

        total_comenzi += comenzi
        total_plecate += plecate
        total_refuzate += refuzate
        total_incasari += incasari
        total_incasari_livrate += incasari_delivered
        total_transport += transport
        total_comision += comision_val

    has_overrides = bool(store_comision_pct)
    formula_str = (
        f"Procent Variabil × (Încasări Totale - Transport)"
        if has_overrides
        else f"{comision_pct}% × (Încasări Totale - Transport)"
    )

    result_data = {
        "month": month,
        "month_label": month_label_ro,
        "comision_pct": comision_pct,
        "summary": {
            "total_comision": round(total_comision, 2),
            "total_incasari": round(total_incasari, 2),
            "total_incasari_livrate": round(total_incasari_livrate, 2),
            "total_transport": round(total_transport, 2),
            "total_comenzi": total_comenzi,
            "total_plecate": total_plecate,
            "total_livrate": sum(s["livrate"] for s in store_rows),
            "total_refuzate": total_refuzate,
            "formula": formula_str,
        },
        "stores": store_rows,
    }

    current_month_str = datetime.utcnow().strftime("%Y-%m")
    ttl = 600 if month == current_month_str else 86400 * 30
    _COMMISSION_CACHE[cache_key] = {
        "data": result_data,
        "expires_at": time.time() + ttl,
    }

    return result_data


@router.get("/comision-agentie")
async def get_comision_agentie(
    db: AsyncSession = Depends(get_db),
    month: Optional[str] = None,
    comision_pct: Optional[float] = None,
):
    """
    Get agency commission report for a given month.

    Query params:
      - month: YYYY-MM (defaults to current month)
      - comision_pct: override commission % (defaults to saved config)
    """
    config = await _get_config(db)

    if not month:
        now = datetime.utcnow()
        month = f"{now.year}-{now.month:02d}"

    pct = comision_pct if comision_pct is not None else config.get("comision_pct", 2.5)
    enabled_uids = config.get("enabled_store_uids", [])
    store_comision_pct = config.get("store_comision_pct", {})

    # If no stores configured, use all stores
    store_uids = enabled_uids if enabled_uids else None

    data = await _calculate_comision(db, month, pct, store_uids, store_comision_pct)
    data["config"] = config
    return data


@router.get("/comision-agentie/config")
async def get_comision_config(db: AsyncSession = Depends(get_db)):
    """Get saved commission configuration."""
    config = await _get_config(db)

    # Also fetch all stores for the UI toggles
    stores_result = await db.execute(select(Store.uid, Store.name).order_by(Store.name))
    all_stores = [{"uid": r.uid, "name": r.name} for r in stores_result.all()]

    return {
        "config": config,
        "all_stores": all_stores,
    }


@router.put("/comision-agentie/config")
async def update_comision_config(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Update commission configuration.

    Body: { comision_pct: float, enabled_store_uids: string[], store_comision_pct: dict }
    """
    config = await _get_config(db)
    if "comision_pct" in body:
        config["comision_pct"] = float(body["comision_pct"])
    if "enabled_store_uids" in body:
        config["enabled_store_uids"] = body["enabled_store_uids"]
    if "store_comision_pct" in body:
        config["store_comision_pct"] = body["store_comision_pct"]

    await _save_config(db, config)

    # Clear cache so new configs take effect immediately
    _COMMISSION_CACHE.clear()

    return {"ok": True, "config": config}


@router.get("/comision-agentie/export")
async def export_comision_csv(
    db: AsyncSession = Depends(get_db),
    month: Optional[str] = None,
    comision_pct: Optional[float] = None,
):
    """Export commission report as CSV."""
    config = await _get_config(db)

    if not month:
        now = datetime.utcnow()
        month = f"{now.year}-{now.month:02d}"

    pct = comision_pct if comision_pct is not None else config.get("comision_pct", 2.5)
    enabled_uids = config.get("enabled_store_uids", [])
    store_uids = enabled_uids if enabled_uids else None

    data = await _calculate_comision(db, month, pct, store_uids)

    # Build CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "LUNA",
            "BRAND",
            "COST",
            "COMENZI",
            "PLECATE",
            "REFUZATE",
            "ÎNCASĂRI",
            "COMISION %",
            "TRANSPORT",
            "TOTAL COMISION",
        ]
    )
    for row in data["stores"]:
        writer.writerow(
            [
                row["luna"],
                row["brand"],
                row["cost"],
                row["comenzi"],
                row["plecate"],
                row["refuzate"],
                row["incasari"],
                row["comision_pct"],
                row["transport"],
                row["total_comision"],
            ]
        )

    output.seek(0)
    filename = f"comision_agentie_{month}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
