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

DEFAULT_CS_TAGS = ["Raluca", "Oana", "Daniela"]
CS_TAGS_SETTING_KEY = "cs.agent_tags"


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
    cs_tags_lower = {t.lower(): t for t in cs_tags}

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

    agent_data = {
        tag: {
            "tag": tag,
            "total_orders": 0,
            "total_revenue_ron": 0.0,
            "delivered_orders": 0,
            "delivered_revenue_ron": 0.0,
            "by_store": {},
        }
        for tag in cs_tags
    }

    for order in orders:
        tags = order.tags or []
        if not tags:
            continue
        order_tag_set = " ".join(str(t).lower() for t in tags)
        currency = (order.currency or "RON").upper()
        order_date = to_bucharest_date(order.frisbo_created_at) or romania_today()
        revenue = order.total_price or 0
        if currency != "RON":
            fx = get_rate_from_cache(currency, order_date, rate_cache)
            revenue_ron = round(revenue * fx, 2) if fx else None
        else:
            revenue_ron = revenue
        if revenue_ron is None:
            continue  # unconvertible — skip (consistent with the P&L, Finding Q)

        is_delivered = classify(order.aggregated_status) == "delivered"
        store_name = stores.get(order.store_uid, order.store_uid)

        for tag_lower, tag_original in cs_tags_lower.items():
            if tag_lower in order_tag_set:
                ad = agent_data[tag_original]
                ad["total_orders"] += 1
                ad["total_revenue_ron"] += revenue_ron
                st = ad["by_store"].setdefault(
                    store_name,
                    {"orders": 0, "revenue_ron": 0.0, "delivered": 0},
                )
                st["orders"] += 1
                st["revenue_ron"] += revenue_ron
                if is_delivered:
                    ad["delivered_orders"] += 1
                    ad["delivered_revenue_ron"] += revenue_ron
                    st["delivered"] += 1

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
                "by_store": [
                    {
                        "store": k,
                        "orders": v["orders"],
                        "revenue_ron": round(v["revenue_ron"], 2),
                        "delivered": v["delivered"],
                    }
                    for k, v in sorted(ad["by_store"].items())
                ],
            }
        )

    tagged = sum(a["total_orders"] for a in agents)
    return {
        "agents": agents,
        "totals": {
            "orders": tagged,
            "revenue_ron": round(sum(a["total_revenue_ron"] for a in agents), 2),
            "delivered": sum(a["delivered_orders"] for a in agents),
            "delivered_revenue_ron": round(
                sum(a["delivered_revenue_ron"] for a in agents), 2
            ),
        },
        "orders_scanned": len(orders),
        "orders_matched": tagged,
        "cs_tags": cs_tags,
        # Surfaced so the UI can explain a near-empty result rather than look broken.
        "data_note": (
            "Only orders carrying an agent tag (via Frisbo OrderTags) are counted. "
            "Agent tagging is currently sparse upstream; results may be near-empty "
            "until tags are backfilled and confirmed to flow through Frisbo."
        ),
    }
