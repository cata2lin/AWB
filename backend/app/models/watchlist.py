"""Watchlist models — snapshot-delta product watchlists for analytics.

Ported from Scripturi's ``analytics_watchlists`` / ``analytics_watchlist_items``
(static/js/watchlists.js + api/product_analytics.py). A ``Watchlist`` is a named,
color-tagged collection. Each ``WatchlistItem`` pins a SKU together with a
``snapshot_json`` blob captured at add time, so the UI can later compare the live
analytics value against the snapshot (delta-vs-snapshot).

Both models live here (one file, two tables). Snapshots are stored as opaque TEXT
JSON so the watchlist stays decoupled from whatever metrics a given source tab
captures (sales vs profitability).
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Watchlist(Base):
    """A named, color-tagged collection of watched SKUs."""

    __tablename__ = "watchlists"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    color: Mapped[str] = mapped_column(String(20), default="#8b5cf6")
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=True
    )

    items: Mapped[list["WatchlistItem"]] = relationship(
        back_populates="watchlist",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class WatchlistItem(Base):
    """A single watched SKU within a watchlist.

    snapshot_json: opaque JSON blob of the metric values at add time (e.g.
    ``{"qty_sold": 12, "revenue": 3400, "marja": 18.5}``). The live analytics
    value is joined in the UI/endpoint for delta comparison.
    """

    __tablename__ = "watchlist_items"
    __table_args__ = (
        UniqueConstraint("watchlist_id", "sku", name="uq_watchlist_item_sku"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    watchlist_id: Mapped[int] = mapped_column(
        ForeignKey("watchlists.id", ondelete="CASCADE"), index=True
    )
    sku: Mapped[str] = mapped_column(String(255), index=True)
    snapshot_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    added_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=True
    )

    watchlist: Mapped["Watchlist"] = relationship(back_populates="items")
