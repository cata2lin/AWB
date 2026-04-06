"""PurchaseOrder model — inventory replenishment orders."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, Boolean, DateTime, Text, Date
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PurchaseOrder(Base):
    """
    A purchase order for restocking inventory.
    
    Lifecycle: draft → confirmed → in_transit → received → cancelled
    """
    __tablename__ = "purchase_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    po_number: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft/confirmed/in_transit/received/cancelled

    supplier_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    container_ref: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # Container/shipment reference
    expected_arrival_date: Mapped[Optional[datetime]] = mapped_column(Date, nullable=True)
    actual_arrival_date: Mapped[Optional[datetime]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    total_items: Mapped[int] = mapped_column(Integer, default=0)
    total_quantity: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[float] = mapped_column(Float, default=0.0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, onupdate=datetime.utcnow)
