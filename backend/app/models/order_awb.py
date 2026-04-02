"""OrderAwb model — stores all AWBs per order (outbound + return)."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, DateTime, Boolean, ForeignKey, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


# ── AWB statuses that should NOT count toward transport costs ──
# These are AWBs that were created but never actually shipped/used.
#
# Sameday/DPD numeric statuses:
#   0 = "Fara comanda" (no order)
#   1 = "Neridicat" (not picked up)
#   7 = "Anulat" (cancelled)
#   8 = "Inchis intern" (closed internally)
#
# Packeta text statuses:
#   "Expedierea a fost înregistrată." (registered but not shipped)
#   "Așteptăm ridicarea tuturor coletelor." (waiting for pickup)
#   "Expedierea a fost anulată." (cancelled)
#   "Ridicarea nu a avut loc" (pickup didn't happen)
#
# NOTE: Returned packages ("9 - Returnat", "Ți-am returnat coletul")
# ARE billable — the courier actually transported them.

NON_BILLABLE_STATUS_PATTERNS = [
    # Exact numeric codes (Sameday/DPD Status column)
    '0',
    '1',
    '7',
    '8',
    # Sameday/DPD State Name column
    '0 - Fara comanda',
    '1 - Neridicat',
    '7 - Anulat',
    '8 - Inchis intern',
    # Packeta packetExport English exact matches
    'Cancelled',
    'We are waiting for the package handover',
]

# Substring patterns for Packeta and other text-based statuses
NON_BILLABLE_STATUS_SUBSTRINGS = [
    'anulat',            # "Expedierea a fost anulată" / "7 - Anulat"
    'cancelled',         # Packeta EN "Cancelled"
    'neridicat',         # "1 - Neridicat"
    'fara comanda',      # "0 - Fara comanda"
    'inchis intern',     # "8 - Inchis intern"
    'înregistrată',      # "Expedierea a fost înregistrată."
    'așteptăm ridicarea',   # "Așteptăm ridicarea tuturor coletelor." (export_AWB RO)
    'așteptăm predarea',    # "Așteptăm predarea coletului" (packetExport RO)
    'waiting for the package handover',  # Packeta EN
    'ridic' + 'area nu a avut loc',  # "Ridicarea nu a avut loc..."
]


def is_billable_status(csv_status: str) -> bool:
    """
    Determine if an AWB's csv_status indicates it was actually shipped/delivered.
    Returns True if the AWB should count toward transport costs.
    Returns True if csv_status is None (no CSV data yet = assume billable).
    """
    if not csv_status:
        return True  # No status data → assume billable (conservative)
    
    status = csv_status.strip()
    
    # Check exact matches first
    if status in NON_BILLABLE_STATUS_PATTERNS:
        return False
    
    # Check substring patterns (case-insensitive)
    status_lower = status.lower()
    for pattern in NON_BILLABLE_STATUS_SUBSTRINGS:
        if pattern in status_lower:
            return False
    
    return True


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
    
    # --- Frisbo shipment data (populated during order sync) ---
    shipment_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)          # Frisbo shipment UID
    awb_pdf_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)                  # Direct label download URL
    awb_pdf_format: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)         # Label format (pdf, zpl)
    shipment_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)        # Latest event key
    shipment_status_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True) # Latest event date
    is_return_label: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=False)  # ShipmentDocument.is_return
    is_redirect_label: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=False) # ShipmentDocument.is_redirect
    paid_by: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)                # sender/receiver/third_party
    cod_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)                 # Cash on delivery value
    cod_currency: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)           # COD currency
    shipment_created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True) # Frisbo shipment creation
    shipment_events: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)             # Full events array
    
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
    
    # CSV debug: last status from courier CSV (e.g. "9 - Returnat", "Livrat")
    csv_status: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    data_source: Mapped[str] = mapped_column(String(50), default="frisbo_sync")  # frisbo_sync | csv_import | manual

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationship
    order: Mapped["Order"] = relationship(back_populates="awbs")
