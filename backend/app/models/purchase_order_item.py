"""PurchaseOrderItem model — line items within a purchase order."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PurchaseOrderItem(Base):
    """
    Individual SKU line item in a purchase order.
    
    Tracks ordered quantity, received quantity (for partial receives),
    and whether the item is a restock or a new product introduction.
    """
    __tablename__ = "purchase_order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True)

    sku: Mapped[str] = mapped_column(String(100), index=True)
    barcode: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    product_name: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    product_image: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)  # Image URL snapshot

    quantity: Mapped[int] = mapped_column(Integer, default=0)  # Units ordered
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0)
    received_qty: Mapped[int] = mapped_column(Integer, default=0)  # Units actually received

    is_new_product: Mapped[bool] = mapped_column(Boolean, default=False)  # False=restock, True=new product
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
