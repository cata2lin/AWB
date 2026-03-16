"""Store model."""
from datetime import datetime
from typing import List, Optional
from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Store(Base):
    """Store configuration model."""
    __tablename__ = "stores"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    uid: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    color_code: Mapped[str] = mapped_column(String(7), default="#6366f1")  # Hex color
    shopify_domain: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # e.g. "store-name.myshopify.com"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    # Relationships
    orders: Mapped[List["Order"]] = relationship(back_populates="store")
