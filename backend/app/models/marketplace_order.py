"""MarketplaceOrder model — cached orders from marketplace channels (eMAG, …).

A channel-agnostic table: the ``marketplace`` column (RO/BG/HU for eMAG, and any
future channel) lets one table back the eMAG report and future marketplaces. The
``(marketplace, order_id)`` pair is unique — that's the upsert key in
``services/emag/sync.py``.

INERT until eMAG credentials are supplied via env vars (see services/emag/client.py).
DB stores naive UTC like every other table; convert for the UI via app/core/timezone.py.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, Float, DateTime, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MarketplaceOrder(Base):
    """A single marketplace order (eMAG today; channel-agnostic by design)."""

    __tablename__ = "marketplace_orders"
    __table_args__ = (
        UniqueConstraint("marketplace", "order_id", name="uq_marketplace_order"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    # Channel + native order id (eMAG order id as string). Unique together.
    marketplace: Mapped[str] = mapped_column(String(10), index=True)
    order_id: Mapped[str] = mapped_column(String(64))

    status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    order_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True, index=True
    )  # naive UTC
    customer_locality: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Full eMAG products array (qty, sale_price, part_number, …), stored raw.
    products: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)

    sale_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    shipping_tax: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    payment_mode: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    payment_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    delivery_mode: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    awb_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    cancellation_request: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )

    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
