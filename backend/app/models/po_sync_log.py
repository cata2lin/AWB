"""PoSyncLog model — audit trail for TOM API sync operations."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class PoSyncLog(Base):
    """
    Records every TOM API interaction for a purchase order.

    Actions: TOM_PO_CREATE, TOM_PO_REFRESH, TOM_PO_AMEND, TOM_PO_CANCEL
    Status: PENDING, SUCCESS, FAILED

    The `details` JSONB column stores the full request/response payloads
    for audit and debugging purposes.
    """
    __tablename__ = "po_sync_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_order_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(50))  # TOM_PO_CREATE / TOM_PO_REFRESH / TOM_PO_AMEND / TOM_PO_CANCEL
    status: Mapped[str] = mapped_column(String(20), default="PENDING")  # PENDING / SUCCESS / FAILED
    items_affected: Mapped[int] = mapped_column(Integer, default=0)
    details: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)  # Full request/response payloads
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    # Relationships
    purchase_order = relationship("PurchaseOrder", back_populates="sync_logs")
