"""Custom Product model — for products not synced from Frisbo."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CustomProduct(Base):
    """
    Custom products that can be added to Purchase Orders.
    These are not managed by Frisbo and do not have live stock.
    """
    __tablename__ = "custom_products"

    id: Mapped[int] = mapped_column(primary_key=True)
    uid: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    sku: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    product_name: Mapped[str] = mapped_column(String(500))
    barcode: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    default_unit_cost: Mapped[float] = mapped_column(Float, default=0.0)
    hs_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    weight_grams: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
