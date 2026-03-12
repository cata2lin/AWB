"""SkuCost model."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Float, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SkuCost(Base):
    """SKU production cost configuration."""
    __tablename__ = "sku_costs"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # Display name
    cost: Mapped[float] = mapped_column(Float, default=0.0)  # Production/procurement cost
    currency: Mapped[str] = mapped_column(String(10), default="RON")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, onupdate=datetime.utcnow)
