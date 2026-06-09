"""
Stuck-order reconciliation.

AWB's only order-status source is Frisbo, which can FREEZE an order in a non-terminal
status (waiting_for_courier / fulfilled) even after the courier delivered/returned it.
Re-pulling from Frisbo can't cure it (verified: search AND single-order GET return the
same frozen status). The sister "Scripturi" app reads the COURIER feed + Shopify directly
and resolves these, so we adopt its resolved status for the orders it has settled.

This module is source-agnostic: callers build `resolved_map = {order_number: terminal_status}`
from whichever Scripturi source is available (local SQLite copy for a one-shot backfill, or
Scripturi's live `Profitabilitate-Livrabilitate` Postgres for a scheduled tier) and pass it in.

The sync's "don't-downgrade-terminal" rule (sync_service) preserves the statuses we set here,
so a later Frisbo payload can't re-freeze them.
"""

import logging
from typing import Dict, List

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Scripturi status_category (RO) → AWB terminal aggregated_status
SC_TO_AWB_TERMINAL = {
    "Livrata": "delivered",
    "Refuzata": "refused",  # classify() folds refused → returned (transport loss)
    "Anulata": "cancelled",
}

# Non-terminal aggregated_status values an order can be stuck in.
NONTERMINAL_STATUSES = (
    "fulfilled",
    "waiting_for_courier",
    "processing",
    "not_fulfilled",
    "ready_for_pickup",
    "new",
    "errors_incorrect_shipping_address",
    "awaiting_shipment_generation_initialization",
    "in_transit",
    "out_for_delivery",
    "on_hold",
    "sending",
    "redirected",
    "deferred_delivery",
)


async def aged_out_stuck_orders(
    db: AsyncSession,
    age_days: int = 90,
    new_status: str = "lost_in_transit",
    apply: bool = False,
) -> dict:
    """Aged-out terminal rule (needs NO external source — pure AWB-internal policy).

    A SHIPPED parcel (has a tracking_number) that has sat in a non-terminal status for
    more than `age_days` will never resolve — the courier never confirmed delivery and
    no source (Frisbo/Shopify/Scripturi) has a terminal status for it. Leaving it as
    `waiting_for_courier` after 90+ days is itself wrong, so we close it terminally as a
    transport loss (`lost_in_transit` → classify() folds to `returned`). This is
    self-correcting: the sync's don't-downgrade rule only blocks terminal→NON-terminal,
    so a genuine later `delivered` (terminal→terminal) would still override it. Runs as a
    scheduled tier so no order can stay stuck past `age_days` going forward.
    """
    where = (
        "aggregated_status = ANY(:st) AND tracking_number IS NOT NULL "
        "AND frisbo_created_at < now() - (:days || ' days')::interval"
    )
    params = {"st": list(NONTERMINAL_STATUSES), "days": str(int(age_days))}
    stats = (
        await db.execute(
            text(
                f"SELECT COUNT(*) n, COALESCE(SUM(total_price),0) rev FROM orders WHERE {where}"
            ),
            params,
        )
    ).first()
    if apply and stats.n:
        await db.execute(
            text(
                f"UPDATE orders SET aggregated_status = :ns, synced_at = now() WHERE {where}"
            ),
            {**params, "ns": new_status},
        )
        await db.commit()
        logger.info(
            f"🔧 Aged-out reconciliation: closed {stats.n} orders stuck >{age_days}d "
            f"to terminal '{new_status}' (transport loss)."
        )
    return {
        "aged_out": stats.n,
        "revenue": round(float(stats.rev or 0), 2),
        "applied": apply,
    }


async def find_stuck_order_numbers(
    db: AsyncSession, min_age_days: int = 14
) -> List[str]:
    """order_numbers of non-terminal + tracked orders older than min_age_days."""
    rows = (
        await db.execute(
            text(
                """
        SELECT order_number FROM orders
        WHERE aggregated_status = ANY(:st) AND tracking_number IS NOT NULL
          AND frisbo_created_at < now() - (:days || ' days')::interval
        """
            ),
            {"st": list(NONTERMINAL_STATUSES), "days": str(int(min_age_days))},
        )
    ).all()
    return [r[0] for r in rows]


async def reconcile_stuck_orders(
    db: AsyncSession,
    resolved_map: Dict[str, str],
    apply: bool = False,
    min_age_days: int = 14,
) -> dict:
    """For each stuck order present in `resolved_map`, set aggregated_status to the
    resolved terminal value (only when it actually changes the status). Returns stats."""
    stuck = set(await find_stuck_order_numbers(db, min_age_days))
    to_fix = {on: st for on, st in resolved_map.items() if on in stuck and st}

    from collections import Counter

    by_status = Counter(to_fix.values())
    applied = 0
    if apply and to_fix:
        # update in chunks to avoid a giant parameter list
        items = list(to_fix.items())
        for i in range(0, len(items), 500):
            chunk = items[i : i + 500]
            # build a VALUES list and update by order_number
            await db.execute(
                text(
                    """
                UPDATE orders SET aggregated_status = v.st, synced_at = now()
                FROM (SELECT unnest(cast(:ons AS text[])) AS on_,
                             unnest(cast(:sts AS text[])) AS st) v
                WHERE orders.order_number = v.on_
                  AND orders.aggregated_status <> v.st
                """
                ),
                {"ons": [c[0] for c in chunk], "sts": [c[1] for c in chunk]},
            )
            applied += len(chunk)
        await db.commit()
        logger.info(
            f"🔧 Stuck reconciliation: resolved {len(to_fix)} stuck orders "
            f"({dict(by_status)}) from the Scripturi courier feed."
        )

    return {
        "stuck_total": len(stuck),
        "resolved": len(to_fix),
        "by_status": dict(by_status),
        "applied": apply,
    }
