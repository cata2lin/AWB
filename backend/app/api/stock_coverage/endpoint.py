"""
Stoc & Viteză — per-store stock coverage report.

Answers "what isn't selling": for every product — per store, or across all stores —
its stock (stock-sync master), units sold in the last N days (AWB orders, cancelled
excluded), days since the last sale, how long the stock lasts and what it's worth.
"""

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.sku_risk.computations import compute_final_outcome
from app.api.stock_coverage.computations import (
    ALL_STORES_NAME,
    ALL_STORES_UID,
    UNALLOCATED_STORE_NAME,
    UNALLOCATED_STORE_UID,
    awb_store_domain,
    build_rows,
)
from app.core.analytics_cache import cache_get, cache_set
from app.core.database import get_db
from app.core.line_items_projection import PROJECTED_LINE_ITEMS_NAMED
from app.core.order_filters import build_tag_exclusion_condition, load_exclusion_rules
from app.models import Order
from app.models.product import Product
from app.models.sku_cost import SkuCost
from app.services.stock_sync_client import StockSyncUnavailable, fetch_snapshot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])

ALLOWED_PERIODS = (30, 60, 90)
CANCELLED_OUTCOMES = {"CANCELLED"}
# Stock only moves at the stock-sync runs (02:00 + manual), so a longer TTL is safe.
REPORT_TTL_SECONDS = 600
LAST_SALE_LOOKBACK_DAYS = 365


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


async def _load_catalog(db: AsyncSession) -> list:
    rows = await db.execute(
        select(Product.store_uids, Product.sku, Product.barcode, Product.title_1).where(
            Product.state == "active",
            Product.sku.isnot(None),
            Product.sku != "",
        )
    )
    catalog = []
    for store_uids, sku, barcode, title in rows.all():
        if isinstance(store_uids, str):
            try:
                store_uids = json.loads(store_uids)
            except json.JSONDecodeError:
                store_uids = []
        for uid in store_uids or []:
            catalog.append((uid, sku, barcode, title))
    return catalog


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
        if outcome in CANCELLED_OUTCOMES:
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

    Aggregated in Postgres: projecting a year of line items into Python is ~10x slower.
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
            "MAX(o.frisbo_created_at) "
            "FROM orders o, jsonb_array_elements(o.line_items::jsonb) e "
            "WHERE o.frisbo_created_at >= :since "
            "AND COALESCE(o.aggregated_status, '') <> 'cancelled'" + tag_sql + " "
            "GROUP BY 1, 2"
        ),
        params,
    )
    return {
        (store_uid or "", sku.strip()): last
        for store_uid, sku, last in rows.all()
        if sku and sku.strip()
    }


async def _load_costs(db: AsyncSession) -> dict:
    rows = await db.execute(select(SkuCost.sku, SkuCost.cost))
    return {sku.strip(): cost for sku, cost in rows.all() if sku and cost}


async def _build_report(db: AsyncSession, days: int) -> dict:
    snapshot = await fetch_snapshot()
    stores = await _load_stores(db, snapshot["stores"])
    catalog = await _load_catalog(db)
    sales, dt_from, dt_to = await _load_sales(db, days)
    last_sales = await _load_last_sales(db)
    costs = await _load_costs(db)
    result = build_rows(stores, snapshot, catalog, sales, days, last_sales, costs)
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
            "last_sale_lookback_days": LAST_SALE_LOOKBACK_DAYS,
            "generated_at": datetime.utcnow().isoformat(),
        },
    }


@router.get("/stock-coverage")
async def get_stock_coverage(
    days: int = Query(30),
    store_uids: Optional[str] = Query(None),
    master_product_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Stock coverage rows for `store_uids` (comma-separated; empty = the all-stores
    view). `master_product_id` returns that product's per-store breakdown instead."""
    if days not in ALLOWED_PERIODS:
        raise HTTPException(
            400, detail=f"Perioada trebuie să fie una din {ALLOWED_PERIODS} zile"
        )

    cache_key = f"stock-coverage|days={days}"
    report = cache_get(cache_key)
    if report is None:
        try:
            report = await _build_report(db, days)
        except StockSyncUnavailable as e:
            logger.error("stock-coverage: %s", e)
            raise HTTPException(503, detail=str(e))
        cache_set(cache_key, report, ttl=REPORT_TTL_SECONDS)

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
