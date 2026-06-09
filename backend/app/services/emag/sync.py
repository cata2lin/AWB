"""
eMAG order sync — pulls recent orders per configured marketplace and UPSERTs them
into ``marketplace_orders``.

INERT BY DESIGN: if NO marketplace has env credentials, this returns immediately
with {"synced": 0, "note": "no eMAG credentials"} and never touches the network.
Once creds (+ eMAG IP allow-listing) are in place, each configured marketplace's
recent orders are fetched (100/page) and upserted on conflict (marketplace, order_id),
refreshing status / awb / payment / etc.

DB stores naive UTC (see app/core/timezone.py). eMAG returns either epoch seconds or
"YYYY-MM-DD HH:MM:SS" strings (server-local); we normalise both to naive UTC.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.marketplace_order import MarketplaceOrder
from app.services.emag.client import EmagClient

logger = logging.getLogger(__name__)

# How far back to pull on each sync (eMAG orders are short-lived operationally).
_LOOKBACK_DAYS = 60


def _to_naive_utc(value: Any) -> Optional[datetime]:
    """Normalise an eMAG date (epoch int/str or 'YYYY-MM-DD HH:MM:SS') to naive UTC."""
    if value is None or value == "":
        return None
    # Epoch seconds (int, float, or numeric string)
    try:
        if isinstance(value, (int, float)) or (
            isinstance(value, str) and value.strip().isdigit()
        ):
            ts = float(value)
            return datetime.fromtimestamp(ts, tz=timezone.utc).replace(tzinfo=None)
    except (ValueError, OverflowError, OSError):
        pass
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(value.strip()[:19], fmt)
            except ValueError:
                continue
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    return None


def _num(value: Any) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except (ValueError, TypeError):
        return None


def _map_order(marketplace: str, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Map a raw eMAG order dict to MarketplaceOrder column values."""
    order_id = raw.get("id") or raw.get("order_id")
    if order_id in (None, ""):
        return None

    shipping = raw.get("shipping_address") or raw.get("delivery_address") or {}
    locality = shipping.get("locality") or shipping.get("city") or None

    products = raw.get("products") or []

    cancel_raw = (
        raw.get("cancellation_request")
        or raw.get("cancellation_request_date")
        or raw.get("reason_cancellation")
    )
    cancellation_request = str(cancel_raw)[:255] if cancel_raw else None

    awb_number = None
    awbs = raw.get("attachments") or raw.get("awb") or []
    if isinstance(awbs, list) and awbs:
        first = awbs[0]
        if isinstance(first, dict):
            awb_number = first.get("awb_number") or first.get("number")

    return {
        "marketplace": marketplace.upper(),
        "order_id": str(order_id),
        "status": str(raw.get("status")) if raw.get("status") is not None else None,
        "order_date": _to_naive_utc(raw.get("date") or raw.get("created")),
        "customer_locality": (str(locality)[:255] if locality else None),
        "products": products,
        "sale_price": _num(raw.get("cashed_co") or raw.get("total")),
        "shipping_tax": _num(raw.get("shipping_tax")),
        "payment_mode": (
            str(raw.get("payment_mode") or raw.get("payment_mode_id"))[:50]
            if raw.get("payment_mode") is not None
            or raw.get("payment_mode_id") is not None
            else None
        ),
        "payment_status": (
            str(raw.get("payment_status"))[:50]
            if raw.get("payment_status") is not None
            else None
        ),
        "delivery_mode": (
            str(raw.get("delivery_mode"))[:50] if raw.get("delivery_mode") else None
        ),
        "awb_number": (str(awb_number)[:100] if awb_number else None),
        "cancellation_request": cancellation_request,
        "synced_at": datetime.utcnow(),
    }


async def sync_emag_orders(db: AsyncSession) -> Dict[str, Any]:
    """Pull recent orders for every configured eMAG marketplace and upsert them.

    Returns a small summary dict. Inert (no network) when no creds are set.
    Never raises — per-marketplace failures are caught, logged and reported.
    """
    configured = EmagClient.configured_marketplaces()
    if not configured:
        logger.info("[eMAG] No marketplace credentials set — sync is inert.")
        return {"synced": 0, "note": "no eMAG credentials", "marketplaces": []}

    created_after = (datetime.utcnow() - timedelta(days=_LOOKBACK_DAYS)).strftime(
        "%Y-%m-%d %H:%M:%S"
    )

    total_upserted = 0
    per_mp: List[Dict[str, Any]] = []
    errors: List[str] = []

    for code in configured:
        client = EmagClient.from_env(code)
        try:
            raw_orders = await client.read_orders_all_pages(
                marketplace=code, created_after=created_after
            )
        except Exception as e:  # never let one marketplace kill the run
            logger.error("[eMAG/%s] Fetch failed: %s", code, e)
            errors.append(f"{code}: {e}")
            per_mp.append(
                {"marketplace": code, "fetched": 0, "upserted": 0, "error": str(e)}
            )
            continue

        rows = [m for m in (_map_order(code, o) for o in raw_orders) if m]
        upserted = 0
        for values in rows:
            stmt = pg_insert(MarketplaceOrder).values(**values)
            update_cols = {
                k: stmt.excluded[k]
                for k in (
                    "status",
                    "order_date",
                    "customer_locality",
                    "products",
                    "sale_price",
                    "shipping_tax",
                    "payment_mode",
                    "payment_status",
                    "delivery_mode",
                    "awb_number",
                    "cancellation_request",
                    "synced_at",
                )
            }
            stmt = stmt.on_conflict_do_update(
                constraint="uq_marketplace_order", set_=update_cols
            )
            await db.execute(stmt)
            upserted += 1

        total_upserted += upserted
        per_mp.append(
            {"marketplace": code, "fetched": len(raw_orders), "upserted": upserted}
        )
        logger.info(
            "[eMAG/%s] Upserted %s of %s fetched orders",
            code,
            upserted,
            len(raw_orders),
        )

    await db.commit()

    return {
        "synced": total_upserted,
        "marketplaces": per_mp,
        "errors": errors,
    }
