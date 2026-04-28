"""PurchaseOrderItem model — line items within a purchase order with TOM tracking."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, DateTime, Text, ForeignKey, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class PurchaseOrderItem(Base):
    """
    Individual SKU line item in a purchase order.

    Tracks ordered quantity, received quantity (for partial receives),
    item-level priority and type (overrides PO-level defaults),
    and TOM-side per-line state (display-only; TOM is master after send).
    """
    __tablename__ = "purchase_order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True
    )

    # Product identity
    product_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # Frisbo product UID
    sku: Mapped[str] = mapped_column(String(100), index=True)
    barcode: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    product_name: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    variant_title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    product_image: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    # Quantities & cost (USD)
    quantity: Mapped[int] = mapped_column(Integer, default=0)
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0)
    received_qty: Mapped[int] = mapped_column(Integer, default=0)

    # Line-level overrides (inherit from PO if null)
    priority: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # STANDARD | HIGH
    item_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # NEW_PRODUCT | RESTOCK
    is_new_product: Mapped[bool] = mapped_column(default=False)  # True if product doesn't exist in inventory yet
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── TOM Integration — mirror of TOM-side line state (TOM is master) ───
    tom_item_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    tom_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tom_ordered_qty: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tom_received_qty: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tom_shipped_qty: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tom_unit_cost_usd: Mapped[Optional[float]] = mapped_column(Numeric(12, 4), nullable=True)
    tom_extra_cost_usd: Mapped[Optional[float]] = mapped_column(Numeric(12, 4), nullable=True)
    tom_shipment_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tom_matched_by: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tom_cancel_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, onupdate=datetime.utcnow)

    # Relationships
    purchase_order = relationship("PurchaseOrder", back_populates="items")
