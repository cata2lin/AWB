"""
Customer-Service agent attribution report — ported from Scripturi's
``api/customer_service.py``.

Buckets orders + revenue by the CS agent who handled them, where the agent is
identified by a configurable Shopify tag on the order (default Raluca / Oana /
Daniela). Matches Scripturi: an order belongs to an agent if the agent's tag
appears in the order's tags; revenue is summed in RON; delivered is the
``classify()=='delivered'`` subset.

⚠️ DATA AVAILABILITY: this report only has data when orders actually carry the
agent-name tags AND those tags survive the Shopify→Frisbo hop into
``OrderTags.selling_channel`` (which the sync stores on ``Order.tags``). Verified
against the live Shopify mirror, agent tagging is currently *very* sparse (a few
orders per agent), and merchant-tag delivery through Frisbo is unconfirmed — so
expect near-empty results until agent tagging is used consistently and confirmed
to flow through Frisbo. The endpoint is correct; the upstream data is the gate.
"""

import json
from typing import Optional
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timezone import (
    date_str_to_utc_start,
    date_str_to_utc_end,
    to_bucharest_date,
    romania_today,
    romania_now,
    UTC_TZ,
)
from app.core.status_classification import classify
from app.core.order_filters import build_tag_exclusion_condition
from app.models import Order, Store, SystemSetting

router = APIRouter()

# Matches Scripturi's configured cs_tags (profit_settings) so both reports track the
# same agents out of the box.
DEFAULT_CS_TAGS = ["Raluca", "Oana", "Daniela", "Andra", "Anna", "OanaO"]
CS_TAGS_SETTING_KEY = "cs.agent_tags"

# Mutually-exclusive status buckets, mirroring Scripturi's CS_BUCKETS
# (api/customer_service.py _cs_bucket): livrate / in_curs / neexpediate / refuzate /
# anulate, summing to the agent's total. AWB derives them from the canonical
# classify(): delivered→livrate, returned→refuzate, cancelled→anulate,
# in_transit→in_curs, other (pre-expedition)→neexpediate.
CS_BUCKETS = ["livrate", "in_curs", "neexpediate", "refuzate", "anulate"]
_CAT_TO_BUCKET = {
    "delivered": "livrate",
    "returned": "refuzate",
    "cancelled": "anulate",
    "in_transit": "in_curs",
    "other": "neexpediate",
}


def _empty_buckets():
    return {b: 0 for b in CS_BUCKETS}


def aggregate_cs(records, cs_tags):
    """Pure CS-report aggregation — the single testable core (no DB, no I/O).

    ``records`` is an iterable of dicts, one per order:
      - ``tags``: list[str]            — the order's tags
      - ``status``: str                — Frisbo ``aggregated_status`` (classified here)
      - ``store``: str                 — resolved store name (for the per-store split)
      - ``revenue_ron``: float | None  — already FX-converted; ``None`` => skip (unconvertible)

    ``cs_tags`` is the list of agent tags (original casing kept in the output).

    Matching is EXACT-token and case-insensitive (so "Oana" never catches "OanaO"),
    grand totals are per DISTINCT order, and buckets come from the canonical
    ``classify()`` — all mirroring Scripturi's ``api/customer_service.py``.
    Returns ``{agents, totals, orders_scanned, orders_matched}``; the endpoint adds
    ``cs_tags`` / ``buckets_order`` / ``data_note``.
    """
    cs_tags_lower = {t.lower(): t for t in cs_tags}
    agent_data = {
        tag: {
            "tag": tag,
            "total_orders": 0,
            "total_revenue_ron": 0.0,
            "delivered_orders": 0,
            "delivered_revenue_ron": 0.0,
            "buckets": _empty_buckets(),
            "by_store": {},
        }
        for tag in cs_tags
    }
    grand = {
        "total_orders": 0,
        "total_revenue_ron": 0.0,
        "delivered_orders": 0,
        "delivered_revenue_ron": 0.0,
        "buckets": _empty_buckets(),
    }
    scanned = 0

    for rec in records:
        scanned += 1
        tag_set = {
            str(t).strip().lower() for t in (rec.get("tags") or []) if str(t).strip()
        }
        if not tag_set:
            continue
        matched = [orig for low, orig in cs_tags_lower.items() if low in tag_set]
        if not matched:
            continue
        revenue_ron = rec.get("revenue_ron")
        if revenue_ron is None:
            continue  # unconvertible — skip (consistent with the P&L, Finding Q)

        bucket = _CAT_TO_BUCKET.get(classify(rec.get("status")), "neexpediate")
        is_delivered = bucket == "livrate"
        store_name = rec.get("store") or "?"

        grand["total_orders"] += 1
        grand["total_revenue_ron"] += revenue_ron
        grand["buckets"][bucket] += 1
        if is_delivered:
            grand["delivered_orders"] += 1
            grand["delivered_revenue_ron"] += revenue_ron

        for tag_original in matched:
            ad = agent_data[tag_original]
            ad["total_orders"] += 1
            ad["total_revenue_ron"] += revenue_ron
            ad["buckets"][bucket] += 1
            st = ad["by_store"].setdefault(
                store_name,
                {
                    "orders": 0,
                    "revenue_ron": 0.0,
                    "delivered": 0,
                    "delivered_revenue": 0.0,
                    "buckets": _empty_buckets(),
                },
            )
            st["orders"] += 1
            st["revenue_ron"] += revenue_ron
            st["buckets"][bucket] += 1
            if is_delivered:
                ad["delivered_orders"] += 1
                ad["delivered_revenue_ron"] += revenue_ron
                st["delivered"] += 1
                st["delivered_revenue"] += revenue_ron

    agents = []
    for tag in cs_tags:
        ad = agent_data[tag]
        agents.append(
            {
                "tag": ad["tag"],
                "total_orders": ad["total_orders"],
                "total_revenue_ron": round(ad["total_revenue_ron"], 2),
                "delivered_orders": ad["delivered_orders"],
                "delivered_revenue_ron": round(ad["delivered_revenue_ron"], 2),
                "buckets": ad["buckets"],
                "by_store": [
                    {
                        "store": k,
                        "orders": v["orders"],
                        "revenue_ron": round(v["revenue_ron"], 2),
                        "delivered": v["delivered"],
                        "delivered_revenue": round(v["delivered_revenue"], 2),
                        "buckets": v["buckets"],
                    }
                    for k, v in sorted(ad["by_store"].items())
                ],
            }
        )

    return {
        "agents": agents,
        "totals": {
            "orders": grand["total_orders"],
            "revenue_ron": round(grand["total_revenue_ron"], 2),
            "delivered": grand["delivered_orders"],
            "delivered_revenue_ron": round(grand["delivered_revenue_ron"], 2),
            "buckets": grand["buckets"],
        },
        "orders_scanned": scanned,
        "orders_matched": grand["total_orders"],
    }


async def _get_cs_tags(db: AsyncSession) -> list:
    row = (
        await db.execute(
            select(SystemSetting).where(SystemSetting.key == CS_TAGS_SETTING_KEY)
        )
    ).scalar_one_or_none()
    if row and row.value_json:
        tags = row.value_json if isinstance(row.value_json, list) else []
        return [str(t).strip() for t in tags if str(t).strip()] or DEFAULT_CS_TAGS
    if row and row.value:
        try:
            tags = json.loads(row.value)
            return [str(t).strip() for t in tags if str(t).strip()] or DEFAULT_CS_TAGS
        except Exception:
            pass
    return list(DEFAULT_CS_TAGS)


@router.get("/analytics/cs-tags")
async def get_cs_tags(db: AsyncSession = Depends(get_db)):
    return {"tags": await _get_cs_tags(db)}


@router.put("/analytics/cs-tags")
async def set_cs_tags(payload: dict, db: AsyncSession = Depends(get_db)):
    tags = payload.get("tags") or []
    tags = [str(t).strip() for t in tags if str(t).strip()]
    row = (
        await db.execute(
            select(SystemSetting).where(SystemSetting.key == CS_TAGS_SETTING_KEY)
        )
    ).scalar_one_or_none()
    if row:
        row.value_json = tags
    else:
        db.add(SystemSetting(key=CS_TAGS_SETTING_KEY, value_json=tags))
    await db.commit()
    return {"tags": tags}


@router.get("/analytics/cs-report")
async def cs_report(
    store_uids: Optional[str] = None,
    days: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Per CS-agent: total/delivered orders and RON revenue, with a per-store split."""
    from app.api.exchange_rates import preload_rates, get_rate_from_cache

    cs_tags = await _get_cs_tags(db)

    conditions = [await build_tag_exclusion_condition(db)]
    if store_uids:
        conditions.append(
            Order.store_uid.in_([s.strip() for s in store_uids.split(",")])
        )
    if date_from and date_to:
        conditions.append(Order.frisbo_created_at >= date_str_to_utc_start(date_from))
        conditions.append(Order.frisbo_created_at <= date_str_to_utc_end(date_to))
    elif days:
        start_buc = (romania_now() - timedelta(days=max(0, days - 1))).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        conditions.append(
            Order.frisbo_created_at >= start_buc.astimezone(UTC_TZ).replace(tzinfo=None)
        )

    orders = (await db.execute(select(Order).where(*conditions))).scalars().all()
    stores = {s.uid: s.name for s in (await db.execute(select(Store))).scalars().all()}

    # Preload BNR rates so non-RON revenue converts to RON.
    non_ron = {(o.currency or "RON").upper() for o in orders} - {"RON"}
    order_dates = [
        to_bucharest_date(o.frisbo_created_at) for o in orders if o.frisbo_created_at
    ]
    if non_ron and order_dates:
        rate_cache = await preload_rates(
            non_ron, (min(order_dates), max(order_dates)), db
        )
    else:
        rate_cache = {}

    # Build plain records (FX done here) and hand off to the pure, testable core.
    records = []
    for order in orders:
        currency = (order.currency or "RON").upper()
        order_date = to_bucharest_date(order.frisbo_created_at) or romania_today()
        revenue = order.total_price or 0
        if currency != "RON":
            fx = get_rate_from_cache(currency, order_date, rate_cache)
            revenue_ron = round(revenue * fx, 2) if fx else None
        else:
            revenue_ron = revenue
        records.append(
            {
                "tags": order.tags or [],
                "status": order.aggregated_status,
                "store": stores.get(order.store_uid, order.store_uid),
                "revenue_ron": revenue_ron,
            }
        )

    result = aggregate_cs(records, cs_tags)
    return {
        **result,
        "cs_tags": cs_tags,
        "buckets_order": CS_BUCKETS,
        # Frisbo only STARTED carrying Shopify tags ~mid-May 2026 and did NOT backfill
        # older orders. Verified across 2 orgs (magdeal, belasil): 0% tag coverage before
        # May, ~15-17% in May as the field went live mid-month, ~99% from June. So a CS
        # report for a HISTORIC month is near-empty; the current/future months come through
        # essentially complete straight from Frisbo — NOT a permanent limitation.
        "data_note": (
            "Frisbo a început să transmită etichetele Shopify abia de la mijlocul lui "
            "mai 2026 și nu a completat retroactiv comenzile mai vechi (0% înainte de mai, "
            "~15% în mai, ~99% din iunie). Pentru luni istorice raportul apare gol; pentru "
            "luna curentă acoperirea vine aproape completă direct din Frisbo."
        ),
    }
