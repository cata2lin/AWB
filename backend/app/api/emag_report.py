"""
eMAG marketplace report — per-marketplace aggregates over ``marketplace_orders``.

Mirrors the cs_report pattern: ``Depends(get_db)``, date filters via
``app.core.timezone``, ``@cached_analytics``. Plus a sync trigger that calls
``services/emag/sync.sync_emag_orders``.

⚠️ DATA AVAILABILITY (INERT until wired up): this report is empty until ALL of:
  1. eMAG credentials are set via env vars (EMAG_RO_USER/PASS, etc.),
  2. the server's public IP is allow-listed in the eMAG seller account,
  3. a sync has run (POST/GET /analytics/emag-report/sync) to populate the table.
The endpoint is correct; the upstream creds + allow-list + sync are the gate.

CURRENCY NOTE: eMAG RO settles in RON. BG settles in BGN, HU in HUF — GMV is summed
in each marketplace's NATIVE currency and is NOT converted to RON here. The per-card
``currency`` field tells the UI what unit each marketplace's GMV is in.
"""

from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, AsyncSessionLocal
from app.core.timezone import date_str_to_utc_start, date_str_to_utc_end
from app.core.analytics_cache import cached_analytics, cache_clear
from app.models.marketplace_order import MarketplaceOrder
from app.services.emag.client import EmagClient, MARKETPLACES
from app.services.emag.sync import sync_emag_orders

router = APIRouter()

_DATA_NOTE = (
    "Raportul eMAG este gol până când: (1) sunt setate credențialele eMAG prin "
    "variabile de mediu, (2) IP-ul serverului este adăugat în allowlist-ul contului "
    "eMAG, și (3) a rulat o sincronizare. GMV este în moneda nativă a fiecărui "
    "marketplace (RO=RON, BG=BGN, HU=HUF), neconvertit în RON."
)


def _product_qty(products) -> int:
    """Sum quantities across an order's products list (defensive on shape)."""
    if not isinstance(products, list):
        return 0
    total = 0
    for p in products:
        if isinstance(p, dict):
            try:
                total += int(p.get("quantity") or 0)
            except (ValueError, TypeError):
                continue
    return total


@router.get("/analytics/emag-report")
@cached_analytics("emag_report")
async def emag_report(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    marketplaces: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Per-marketplace aggregates over marketplace_orders.

    Filters: date range (Romanian-local → UTC) and a marketplaces=RO,BG list.
    """
    requested = (
        [m.strip().upper() for m in marketplaces.split(",") if m.strip()]
        if marketplaces
        else list(MARKETPLACES.keys())
    )
    requested = [m for m in requested if m in MARKETPLACES] or list(MARKETPLACES.keys())

    conditions = [MarketplaceOrder.marketplace.in_(requested)]
    if date_from and date_to:
        conditions.append(
            MarketplaceOrder.order_date >= date_str_to_utc_start(date_from)
        )
        conditions.append(MarketplaceOrder.order_date <= date_str_to_utc_end(date_to))

    orders = (
        (await db.execute(select(MarketplaceOrder).where(*conditions))).scalars().all()
    )

    # Aggregate per marketplace.
    agg = {
        code: {
            "marketplace": code,
            "name": MARKETPLACES[code]["name"],
            "flag": MARKETPLACES[code]["flag"],
            "currency": MARKETPLACES[code]["currency"],
            "configured": code in EmagClient.configured_marketplaces(),
            "orders": 0,
            "units": 0,
            "gmv": 0.0,
            "total_colete": 0,
            "cancellation_requests": 0,
            "status_breakdown": {},
        }
        for code in requested
    }

    for o in orders:
        a = agg[o.marketplace]
        a["orders"] += 1
        a["units"] += _product_qty(o.products)
        a["gmv"] += (o.sale_price or 0.0) + (o.shipping_tax or 0.0)
        # total_colete: best-effort = unit count (1 colet/unit) when no nr_cutii map.
        a["total_colete"] += _product_qty(o.products)
        if o.cancellation_request:
            a["cancellation_requests"] += 1
        status_key = o.status or "necunoscut"
        a["status_breakdown"][status_key] = a["status_breakdown"].get(status_key, 0) + 1

    marketplaces_out = []
    for code in requested:
        a = agg[code]
        a["gmv"] = round(a["gmv"], 2)
        a["cancellation_rate"] = round(
            (a["cancellation_requests"] / a["orders"] * 100) if a["orders"] else 0.0, 2
        )
        marketplaces_out.append(a)

    totals = {
        "orders": sum(a["orders"] for a in marketplaces_out),
        "units": sum(a["units"] for a in marketplaces_out),
        "cancellation_requests": sum(
            a["cancellation_requests"] for a in marketplaces_out
        ),
    }

    return {
        "marketplaces": marketplaces_out,
        "totals": totals,
        "configured_marketplaces": EmagClient.configured_marketplaces(),
        "orders_scanned": len(orders),
        "data_note": _DATA_NOTE,
    }


async def _run_sync() -> dict:
    """Open a session and run the eMAG sync; clear the analytics cache after."""
    async with AsyncSessionLocal() as db:
        result = await sync_emag_orders(db)
    if result.get("synced"):
        cache_clear()
    return result


@router.get("/analytics/emag-report/sync")
async def emag_report_sync_get():
    """Trigger an eMAG sync (GET). Returns the inert note when no creds are set."""
    return await _run_sync()


@router.post("/analytics/emag-report/sync")
async def emag_report_sync_post():
    """Trigger an eMAG sync (POST). Returns the inert note when no creds are set."""
    return await _run_sync()
