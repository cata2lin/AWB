"""
Profitability configuration model.
Stores operational cost parameters for profit calculations.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Text, Float, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ProfitabilityConfig(Base):
    """
    Single-row configuration table for profitability calculation parameters.
    All monetary values are in RON unless otherwise specified.
    """
    __tablename__ = "profitability_config"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Packaging cost per order (default: 3.7 RON)
    packaging_cost_per_order: Mapped[float] = mapped_column(Float, default=3.7)

    # Agency commission - percentage of total_price (default: 2.5%)
    agency_commission_pct: Mapped[float] = mapped_column(Float, default=2.5)
    # Store UIDs excluded from agency commission (e.g., Grandia)
    agency_commission_excluded_stores: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True, default=list)
    # Order tags excluded from agency commission (e.g., ["test"])
    agency_commission_excluded_tags: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True, default=list)

    # George Talent (GT) commission - percentage of revenue (default: 5%)
    gt_commission_pct: Mapped[float] = mapped_column(Float, default=5.0)
    # The store UID for George Talent (set via UI)
    gt_commission_store_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Payment processing fee (default: 1.9% + 1.25 RON)
    payment_processing_pct: Mapped[float] = mapped_column(Float, default=1.9)
    payment_processing_fixed: Mapped[float] = mapped_column(Float, default=1.25)

    # Frisbo fulfillment fee per order (default: 0, placeholder)
    frisbo_fee_per_order: Mapped[float] = mapped_column(Float, default=0.0)

    # VAT rate (default: 21% = 0.21)
    vat_rate: Mapped[float] = mapped_column(Float, default=0.21)

    # Monthly subscriptions per store (JSON: { "store_uid": { "month": "2026-02", "amount": 100, "label": "Shopify" } })
    subscriptions: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True, default=dict)

    # Monthly marketing costs (JSON: { "2026-02": { "facebook": 500, "google": 300, "tiktok": 200 } })
    marketing_costs: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True, default=dict)

    # Warehouse salary cost per shipped package (RON)
    warehouse_salary_per_package: Mapped[float] = mapped_column(Float, default=0.0)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, onupdate=datetime.utcnow)
