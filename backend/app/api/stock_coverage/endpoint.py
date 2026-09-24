"""
Stoc & Viteză — per-store stock coverage report.

Answers "what isn't selling": for every product — per store, or across all stores —
its stock (stock-sync master), units sold in the last N days (AWB orders, cancelled
excluded), days since the last sale, how long the stock lasts and what it's worth.
"""

import asyncio
import json
import logging
import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.sku_risk.computations import compute_final_outcome
from app.api.stock_coverage.computations import (
    ALL_STORES_NAME,
    ALL_STORES_UID,
    UNALLOCATED_STORE_NAME,
    UNALLOCATED_STORE_UID,
    DEAD_DAYS,
    awb_store_domain,
    build_rows,
    stock_arrivals,
)
from app.core.database import AsyncSessionLocal
from app.core.line_items_projection import PROJECTED_LINE_ITEMS_NAMED
from app.core.order_filters import build_tag_exclusion_condition, load_exclusion_rules
from app.models import Order
from app.models.product import Product
from app.models.profitability_config import ProfitabilityConfig
from app.models.sku_cost import SkuCost
from app.services.stock_sync_client import (
    StockSyncUnavailable,
    fetch_ledger,
    fetch_snapshot,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])

ALLOWED_PERIODS = (30, 60, 90)
# Goods that came back or never left are not sold: cancelled, refused, returned.
NOT_SOLD_OUTCOMES = {"CANCELLED", "REFUSED", "BACK_TO_SENDER"}
# Stock only moves at the stock-sync runs (02:00 + manual), so a longer TTL is safe.
# Own cache, not app.core.analytics_cache: that one is wiped by every order sync
# (~10 min), which made store-filter changes and row details rebuild everything.
REPORT_TTL_SECONDS = 600
SNAPSHOT_TTL_SECONDS = 600
LAST_SALES_TTL_SECONDS = 1800
LEDGER_TTL_SECONDS = 1800
LAST_SALE_LOOKBACK_DAYS = 365

_CACHE: dict = {}
_LOCKS: dict = {}
_REFRESHING: set = set()


async def _refresh(key: str, ttl: int, loader):
    lock = _LOCKS.setdefault(key, asyncio.Lock())
    async with lock:
        entry = _CACHE.get(key)
        if entry and entry[0] > time.monotonic():
            return entry[1]
        value = await loader()
        _CACHE[key] = (time.monotonic() + ttl, value)
        return value


async def _refresh_in_background(key: str, ttl: int, loader):
    try:
        await _refresh(key, ttl, loader)
    except Exception:
        logger.exception("stock-coverage: background refresh of %s failed", key)
    finally:
        _REFRESHING.discard(key)


async def _cached(key: str, ttl: int, loader):
    """Per-process cache that never makes a user wait twice: once a value exists, an
    expired one is served immediately while a single background task rebuilds it.
    The lock stops concurrent requests from rebuilding in parallel."""
    entry = _CACHE.get(key)
    if entry:
        if entry[0] <= time.monotonic() and key not in _REFRESHING:
            _REFRESHING.add(key)
            asyncio.create_task(_refresh_in_background(key, ttl, loader))
        return entry[1]
    return await _refresh(key, ttl, loader)


def _period_bounds(days: int):
    """Last `days` calendar days in Bucharest time (today included), as naive UTC."""
    now_buc = datetime.now(ZoneInfo("Europe/Bucharest"))
    start_buc = (now_buc - timedelta(days=days - 1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    to_utc = lambda d: d.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)  # noqa: E731
    return to_utc(start_buc), to_utc(now_buc)


async def _load_stores(db: AsyncSession, stock_sync_stores: list) -> list:
    ss_names = {
        (s.get("shopDomain") or "").lower(): s.get("name") for s in stock_sync_stores
    }
    # xconnector_domain exists in the prod table but not on the Store model.
    rows = await db.execute(
        text(
            "SELECT uid, name, shopify_domain, frisbo_store_slug, xconnector_domain "
            "FROM stores WHERE is_active"
        )
    )
    stores = []
    for uid, name, shopify_domain, slug, xconnector_domain in rows.all():
        domain = awb_store_domain(uid, xconnector_domain, shopify_domain, slug)
        # A few stores were created without a name — their uid shows instead.
        if not name or name == uid:
            name = ss_names.get(domain) or uid
        stores.append({"uid": uid, "name": name, "domain": domain})
    return stores


async def _load_catalog(db: AsyncSession):
    """Active AWB products per store, plus when each SKU first appeared in AWB."""
    rows = await db.execute(
        select(
            Product.store_uids,
            Product.sku,
            Product.barcode,
            Product.title_1,
            Product.frisbo_created_at,
        ).where(
            Product.state == "active",
            Product.sku.isnot(None),
            Product.sku != "",
        )
    )
    catalog = []
    first_seen: dict = {}
    for store_uids, sku, barcode, title, created in rows.all():
        key = sku.strip()
        if created and (key not in first_seen or created < first_seen[key]):
            first_seen[key] = created
        if isinstance(store_uids, str):
            try:
                store_uids = json.loads(store_uids)
            except json.JSONDecodeError:
                store_uids = []
        for uid in store_uids or []:
            catalog.append((uid, sku, barcode, title))
    return catalog, first_seen


async def _load_store_activity(db: AsyncSession) -> dict:
    """store → (first order, last order): a young store can't have dead stock yet, a
    store with no recent order has unreliable sales history."""
    rows = await db.execute(
        text(
            "SELECT store_uid, MIN(frisbo_created_at), MAX(frisbo_created_at) "
            "FROM orders GROUP BY store_uid"
        )
    )
    first, last = {}, {}
    for uid, lo, hi in rows.all():
        if uid and lo:
            first[uid], last[uid] = lo, hi
    return {"first": first, "last": last}


async def _load_test_skus(db: AsyncSession) -> set:
    """SKUs still in their test period: only test-tagged orders over the lookback,
    never a real (non-test, non-cancelled) one."""
    rows = await db.execute(
        text(
            "SELECT e->'inventory_item'->>'sku' AS sku, "
            "BOOL_OR(COALESCE(o.tags::text, '') ILIKE '%\"test\"%') AS has_test, "
            "BOOL_OR(COALESCE(o.tags::text, '') NOT ILIKE '%\"test\"%' "
            "AND COALESCE(o.aggregated_status, '') <> 'cancelled') AS has_real "
            "FROM orders o, jsonb_array_elements(o.line_items::jsonb) e "
            "WHERE o.frisbo_created_at >= :since GROUP BY 1"
        ),
        {"since": datetime.utcnow() - timedelta(days=LAST_SALE_LOOKBACK_DAYS)},
    )
    return {
        sku.strip()
        for sku, has_test, has_real in rows.all()
        if sku and has_test and not has_real
    }


async def _load_arrivals() -> dict:
    since = (datetime.utcnow() - timedelta(days=DEAD_DAYS + 5)).strftime("%Y-%m-%d")
    return stock_arrivals(await fetch_ledger(since))


async def _with_session(loader):
    async with AsyncSessionLocal() as db:
        return await loader(db)


async def _load_sales(db: AsyncSession, days: int):
    dt_from, dt_to = _period_bounds(days)
    query = select(
        Order.store_uid,
        Order.aggregated_status,
        Order.shipment_status,
        Order.fulfillment_status,
        PROJECTED_LINE_ITEMS_NAMED,
    ).where(
        Order.frisbo_created_at >= dt_from,
        Order.frisbo_created_at <= dt_to,
        await build_tag_exclusion_condition(db),
    )
    sales = defaultdict(lambda: {"units": 0.0, "name": ""})
    for order in (await db.execute(query)).all():
        outcome = compute_final_outcome(
            order.aggregated_status, order.shipment_status, order.fulfillment_status
        )
        if outcome in NOT_SOLD_OUTCOMES:
            continue
        for item in order.li or []:
            sku = (item.get("sku") or "").strip()
            if not sku:
                continue
            agg = sales[(order.store_uid or "", sku)]
            agg["units"] += float(item.get("q") or 1)
            if not agg["name"]:
                agg["name"] = item.get("name") or ""
    return sales, dt_from, dt_to


async def _load_last_sales(db: AsyncSession) -> dict:
    """(store, SKU) → last non-cancelled order date over the lookback window.

    Aggregated in Postgres (projecting a year of line items into Python is ~10x
    slower), grouped by the three status fields so "cancelled" is decided by the same
    compute_final_outcome rule as the period sales — otherwise a row could show sales
    in the period yet a last sale before it.
    """
    excluded_tags, _ = await load_exclusion_rules(db)
    params = {"since": datetime.utcnow() - timedelta(days=LAST_SALE_LOOKBACK_DAYS)}
    tag_sql = ""
    for i, tag in enumerate(excluded_tags):
        params[f"tag{i}"] = f'%"{tag}"%'
        tag_sql += f" AND (o.tags IS NULL OR o.tags::text NOT ILIKE :tag{i})"
    rows = await db.execute(
        text(
            "SELECT o.store_uid, e->'inventory_item'->>'sku' AS sku, "
            "o.aggregated_status, o.shipment_status, o.fulfillment_status, "
            "MAX(o.frisbo_created_at) "
            "FROM orders o, jsonb_array_elements(o.line_items::jsonb) e "
            "WHERE o.frisbo_created_at >= :since" + tag_sql + " "
            "GROUP BY 1, 2, 3, 4, 5"
        ),
        params,
    )
    last_sales: dict = {}
    for store_uid, sku, workflow, shipment, fulfillment, last in rows.all():
        sku = (sku or "").strip()
        if not sku or not last:
            continue
        if compute_final_outcome(workflow, shipment, fulfillment) in NOT_SOLD_OUTCOMES:
            continue
        key = (store_uid or "", sku)
        if key not in last_sales or last > last_sales[key]:
            last_sales[key] = last
    return last_sales


async def _load_costs(db: AsyncSession) -> dict:
    """SKU → unit cost WITHOUT VAT. sku_costs holds domestic costs with VAT
    (docs/PNL_KNOWLEDGE.md); the P&L works fara_tva, so the stock value does too."""
    config = (
        await db.execute(select(ProfitabilityConfig).limit(1))
    ).scalar_one_or_none()
    vat = (config.vat_rate if config and config.vat_rate else 0.0) or 0.0
    rows = await db.execute(select(SkuCost.sku, SkuCost.cost))
    return {sku.strip(): cost / (1 + vat) for sku, cost in rows.all() if sku and cost}


async def _build_report(days: int) -> dict:
    # Own sessions throughout: this also runs as a background refresh after the
    # request that triggered it is gone.
    snapshot, arrivals = await asyncio.gather(
        _cached("snapshot", SNAPSHOT_TTL_SECONDS, fetch_snapshot),
        _cached("arrivals", LEDGER_TTL_SECONDS, _load_arrivals),
    )
    last_sales = await _cached(
        "last-sales", LAST_SALES_TTL_SECONDS, lambda: _with_session(_load_last_sales)
    )
    test_skus = await _cached(
        "test-skus", LAST_SALES_TTL_SECONDS, lambda: _with_session(_load_test_skus)
    )
    activity = await _cached(
        "store-activity",
        LAST_SALES_TTL_SECONDS,
        lambda: _with_session(_load_store_activity),
    )
    async with AsyncSessionLocal() as db:
        stores = await _load_stores(db, snapshot["stores"])
        catalog, first_seen = await _load_catalog(db)
        sales, dt_from, dt_to = await _load_sales(db, days)
        costs = await _load_costs(db)
    result = build_rows(
        stores,
        snapshot,
        catalog,
        sales,
        days,
        last_sales,
        costs,
        first_seen=first_seen,
        store_first_order=activity["first"],
        arrivals=arrivals,
        test_skus=test_skus,
        store_last_order=activity["last"],
    )
    excluded = set(result["excluded_perfume_stores"])
    stores = [s for s in stores if s["name"] not in excluded]
    store_options = [{"uid": ALL_STORES_UID, "name": ALL_STORES_NAME}]
    store_options += sorted(
        ({"uid": s["uid"], "name": s["name"]} for s in stores),
        key=lambda s: s["name"].lower(),
    )
    store_options.append({"uid": UNALLOCATED_STORE_UID, "name": UNALLOCATED_STORE_NAME})
    return {
        "rows": result["rows"],
        "stores": store_options,
        "meta": {
            "period_days": days,
            "date_from": dt_from.isoformat(),
            "date_to": dt_to.isoformat(),
            "stock_as_of": result["as_of"],
            "stores_without_master": result["stores_without_master"],
            "stale_stores": result["stale_stores"],
            "excluded_perfume_stores": result["excluded_perfume_stores"],
            "test_skus_excluded": len(test_skus),
            "last_sale_lookback_days": LAST_SALE_LOOKBACK_DAYS,
            "generated_at": datetime.utcnow().isoformat(),
        },
    }


@router.get("/stock-coverage")
async def get_stock_coverage(
    days: int = Query(30),
    store_uids: Optional[str] = Query(None),
    master_product_id: Optional[str] = Query(None),
):
    """Stock coverage rows for `store_uids` (comma-separated; empty = the all-stores
    view). `master_product_id` returns that product's per-store breakdown instead."""
    if days not in ALLOWED_PERIODS:
        raise HTTPException(
            400, detail=f"Perioada trebuie să fie una din {ALLOWED_PERIODS} zile"
        )

    try:
        report = await _cached(
            f"report|days={days}", REPORT_TTL_SECONDS, lambda: _build_report(days)
        )
    except StockSyncUnavailable as e:
        logger.error("stock-coverage: %s", e)
        raise HTTPException(503, detail=str(e))

    if master_product_id:
        rows = [
            r
            for r in report["rows"]
            if r["master_product_id"] == master_product_id
            and r["store_uid"] != ALL_STORES_UID
        ]
    else:
        wanted = {u.strip() for u in (store_uids or "").split(",") if u.strip()}
        wanted = wanted or {ALL_STORES_UID}
        rows = [r for r in report["rows"] if r["store_uid"] in wanted]
    return {**report, "rows": rows}
