"""Watchlists — snapshot-delta product watchlists (CRUD).

Ported from Scripturi's ``api/product_analytics.py`` watchlist endpoints +
``static/js/watchlists.js``. A watchlist is a named, color-tagged collection of
SKUs; each item pins a ``snapshot_json`` blob captured at add time so the UI can
later compare the live analytics value against the snapshot.

Routes (mounted under ``/api`` → all prefixed ``/analytics``):
  GET    /analytics/watchlists              list watchlists (+ item_count)
  POST   /analytics/watchlists              create
  DELETE /analytics/watchlists/{id}         delete (cascades to items)
  GET    /analytics/watchlists/{id}         items (with snapshot) + watchlist meta
  POST   /analytics/watchlists/{id}/items   bulk-add SKUs with snapshot_json
  DELETE /analytics/watchlists/{id}/items/{item_id}   remove one item

Snapshots are stored opaque (TEXT JSON). The live-vs-snapshot delta join is the
caller's job — see the WatchlistsTab note: snapshot values are returned as-is and
the heavy live analytics join is left as a TODO marker on the frontend.
"""

import json
from datetime import datetime
from typing import Optional, List, Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.watchlist import Watchlist, WatchlistItem

router = APIRouter()

_DEFAULT_COLOR = "#8b5cf6"


# ── Schemas ──────────────────────────────────────────────────────────────────
class WatchlistCreate(BaseModel):
    name: str
    color: str = _DEFAULT_COLOR


class WatchlistItemIn(BaseModel):
    sku: str
    # Captured-at-add-time metric blob. Accepts either a raw JSON string or an
    # object (serialized server-side) so callers can pass whatever the source tab
    # has on hand without a fixed schema.
    snapshot_json: Optional[Any] = None


class WatchlistItemsIn(BaseModel):
    items: List[WatchlistItemIn] = []


def _normalize_snapshot(raw: Any) -> Optional[str]:
    """Coerce an inbound snapshot (str | dict | None) to a stored JSON string."""
    if raw is None:
        return None
    if isinstance(raw, str):
        s = raw.strip()
        return s or None
    try:
        return json.dumps(raw, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return None


def _serialize_item(it: WatchlistItem) -> Dict[str, Any]:
    snap: Any = None
    if it.snapshot_json:
        try:
            snap = json.loads(it.snapshot_json)
        except (TypeError, ValueError, json.JSONDecodeError):
            snap = None
    return {
        "id": it.id,
        "watchlist_id": it.watchlist_id,
        "sku": it.sku,
        "snapshot": snap,
        "snapshot_json": it.snapshot_json,
        "added_at": it.added_at.isoformat() if it.added_at else None,
    }


# ── List ─────────────────────────────────────────────────────────────────────
@router.get("/analytics/watchlists")
async def list_watchlists(db: AsyncSession = Depends(get_db)):
    """All watchlists, newest first, each with its item_count."""
    counts_subq = (
        select(
            WatchlistItem.watchlist_id,
            func.count(WatchlistItem.id).label("item_count"),
        )
        .group_by(WatchlistItem.watchlist_id)
        .subquery()
    )
    rows = (
        await db.execute(
            select(Watchlist, counts_subq.c.item_count)
            .outerjoin(counts_subq, Watchlist.id == counts_subq.c.watchlist_id)
            .order_by(Watchlist.created_at.desc(), Watchlist.id.desc())
        )
    ).all()
    return {
        "watchlists": [
            {
                "id": w.id,
                "name": w.name,
                "color": w.color or _DEFAULT_COLOR,
                "created_at": w.created_at.isoformat() if w.created_at else None,
                "item_count": int(item_count or 0),
            }
            for (w, item_count) in rows
        ]
    }


# ── Create ───────────────────────────────────────────────────────────────────
@router.post("/analytics/watchlists")
async def create_watchlist(
    payload: WatchlistCreate, db: AsyncSession = Depends(get_db)
):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(400, detail="name is required")
    color = (payload.color or "").strip() or _DEFAULT_COLOR

    wl = Watchlist(name=name, color=color, created_at=datetime.utcnow())
    db.add(wl)
    await db.commit()
    await db.refresh(wl)
    return {
        "id": wl.id,
        "name": wl.name,
        "color": wl.color,
        "created_at": wl.created_at.isoformat() if wl.created_at else None,
        "item_count": 0,
    }


# ── Delete watchlist ─────────────────────────────────────────────────────────
@router.delete("/analytics/watchlists/{watchlist_id}")
async def delete_watchlist(watchlist_id: int, db: AsyncSession = Depends(get_db)):
    wl = await db.get(Watchlist, watchlist_id)
    if not wl:
        raise HTTPException(404, detail="Watchlist not found")
    await db.delete(wl)  # cascades to items via relationship + ON DELETE CASCADE
    await db.commit()
    return {"deleted": watchlist_id}


# ── Detail (items + snapshot) ────────────────────────────────────────────────
@router.get("/analytics/watchlists/{watchlist_id}")
async def get_watchlist(watchlist_id: int, db: AsyncSession = Depends(get_db)):
    wl = await db.get(Watchlist, watchlist_id)
    if not wl:
        raise HTTPException(404, detail="Watchlist not found")
    items = (
        (
            await db.execute(
                select(WatchlistItem)
                .where(WatchlistItem.watchlist_id == watchlist_id)
                .order_by(WatchlistItem.added_at.desc(), WatchlistItem.id.desc())
            )
        )
        .scalars()
        .all()
    )
    return {
        "watchlist": {
            "id": wl.id,
            "name": wl.name,
            "color": wl.color or _DEFAULT_COLOR,
            "created_at": wl.created_at.isoformat() if wl.created_at else None,
        },
        "items": [_serialize_item(it) for it in items],
    }


# ── Bulk add items ───────────────────────────────────────────────────────────
@router.post("/analytics/watchlists/{watchlist_id}/items")
async def add_watchlist_items(
    watchlist_id: int, payload: WatchlistItemsIn, db: AsyncSession = Depends(get_db)
):
    """Bulk-add SKUs. Each item carries a snapshot_json captured at add time.

    SKUs already present in the watchlist are skipped (idempotent re-add); the
    response reports how many were newly added vs skipped.
    """
    wl = await db.get(Watchlist, watchlist_id)
    if not wl:
        raise HTTPException(404, detail="Watchlist not found")

    existing = set(
        (
            await db.execute(
                select(WatchlistItem.sku).where(
                    WatchlistItem.watchlist_id == watchlist_id
                )
            )
        )
        .scalars()
        .all()
    )

    added = 0
    skipped = 0
    seen_in_payload: set = set()
    now = datetime.utcnow()
    for raw in payload.items:
        sku = (raw.sku or "").strip()
        if not sku:
            skipped += 1
            continue
        if sku in existing or sku in seen_in_payload:
            skipped += 1
            continue
        seen_in_payload.add(sku)
        db.add(
            WatchlistItem(
                watchlist_id=watchlist_id,
                sku=sku,
                snapshot_json=_normalize_snapshot(raw.snapshot_json),
                added_at=now,
            )
        )
        added += 1

    if added:
        await db.commit()
    return {"added": added, "skipped": skipped, "watchlist_id": watchlist_id}


# ── Delete one item ──────────────────────────────────────────────────────────
@router.delete("/analytics/watchlists/{watchlist_id}/items/{item_id}")
async def delete_watchlist_item(
    watchlist_id: int, item_id: int, db: AsyncSession = Depends(get_db)
):
    item = await db.get(WatchlistItem, item_id)
    if not item or item.watchlist_id != watchlist_id:
        raise HTTPException(404, detail="Item not found")
    await db.delete(item)
    await db.commit()
    return {"deleted": item_id}
