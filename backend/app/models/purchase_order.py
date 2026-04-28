"""PurchaseOrder model — inventory replenishment orders with TOM API integration."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, DateTime, Text, Date, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class PurchaseOrder(Base):
    """
    A purchase order for restocking inventory.

    Lifecycle (Grandia-aligned):
        DRAFT → APPROVED → PARTIALLY_RECEIVED → COMPLETED → CANCELLED

    Two categories:
        - packaging: syncs to TOM API (tom.arona.ro)
        - oils: internal tracking only

    Type at PO level (NEW_PRODUCT | RESTOCK) — line items can override.
    Priority at PO level (STANDARD | HIGH) — line items can override.
    """
    __tablename__ = "purchase_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    po_number: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    title: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Category: packaging (TOM-sync) or oils (internal)
    po_category: Mapped[str] = mapped_column(String(20), default="packaging", index=True)
    # Type: NEW_PRODUCT or RESTOCK (required by TOM API)
    po_type: Mapped[str] = mapped_column(String(20), default="RESTOCK")
    # Priority
    priority: Mapped[str] = mapped_column(String(20), default="STANDARD")

    status: Mapped[str] = mapped_column(String(30), default="DRAFT", index=True)

    supplier_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    container_ref: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    expected_arrival_date: Mapped[Optional[datetime]] = mapped_column(Date, nullable=True)
    actual_arrival_date: Mapped[Optional[datetime]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    total_items: Mapped[int] = mapped_column(Integer, default=0)
    total_quantity: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[float] = mapped_column(Float, default=0.0)

    # ── TOM Integration fields ────────────────────────────────────────────
    tom_number: Mapped[Optional[str]] = mapped_column(String(50), unique=True, nullable=True)
    tom_po_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    tom_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tom_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    tom_send_idempotency_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    tom_refreshed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    tom_supplier_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    tom_supplier_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    tom_shipment_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tom_shipment_mode: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tom_shipment_eta: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Timestamps
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, onupdate=datetime.utcnow)

    # Relationships
    items: Mapped[list] = relationship("PurchaseOrderItem", back_populates="purchase_order", cascade="all, delete-orphan")
    sync_logs: Mapped[list] = relationship("PoSyncLog", back_populates="purchase_order", cascade="all, delete-orphan")
