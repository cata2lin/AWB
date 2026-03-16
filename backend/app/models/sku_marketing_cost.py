"""
SKU Marketing Cost model.
Stores per-product marketing spend entries with monthly granularity.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Float, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SkuMarketingCost(Base):
    """Per-SKU marketing cost entry (e.g., Facebook campaign for product X in March 2026)."""
    __tablename__ = "sku_marketing_costs"

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(100), index=True)
    label: Mapped[str] = mapped_column(String(255))  # e.g. "Facebook Campanie Martie"
    amount: Mapped[float] = mapped_column(Float, default=0.0)  # RON
    month: Mapped[str] = mapped_column(String(7), index=True)  # YYYY-MM
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, onupdate=datetime.utcnow)
