"""OrderAwb model — stores all AWBs per order (outbound + return)."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class OrderAwb(Base):
    """
    One row per AWB per order.
    
    An order may have multiple AWBs:
      - Multiple packages shipped with different tracking numbers
      - Return shipments (customer sends back)
    
    transport_cost is populated from courier CSV import (cu TVA / with VAT).
    transport_cost_fara_tva is the net cost without VAT (DPD only).
    The parent Order.transport_cost = SUM(order_awbs.transport_cost) for all outbound AWBs.
    """
    __tablename__ = "order_awbs"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    tracking_number: Mapped[str] = mapped_column(String(100), index=True)
    courier_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # 'outbound' = sent to customer, 'return' = sent back
    awb_type: Mapped[str] = mapped_column(String(20), default="outbound")
    
    # Shipping data (populated from courier CSV import)
    transport_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)            # cu TVA
    transport_cost_fara_tva: Mapped[Optional[float]] = mapped_column(Float, nullable=True)   # DPD: "Total fara TVA"
    transport_cost_tva: Mapped[Optional[float]] = mapped_column(Float, nullable=True)        # DPD: "Total VAT"
    currency: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)               # DPD: "Total|Valuta"
    package_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    package_weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Order reference from CSV (e.g. EST101078, PL18160) — used for multi-AWB matching
    order_ref: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    # For return AWBs: the original outbound AWB number (DPD "Expediere primara")
    original_awb: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    data_source: Mapped[str] = mapped_column(String(50), default="frisbo_sync")  # frisbo_sync | csv_import | manual

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationship
    order: Mapped["Order"] = relationship(back_populates="awbs")
