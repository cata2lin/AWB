"""SyncLog model."""
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, Text, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SyncLog(Base):
    """Log of synchronization runs."""
    __tablename__ = "sync_logs"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    status: Mapped[str] = mapped_column(String(50), default="running")  # running, completed, failed
    sync_type: Mapped[str] = mapped_column(String(30), default="45_day")  # 45_day, full, custom, product
    orders_fetched: Mapped[int] = mapped_column(Integer, default=0)
    orders_new: Mapped[int] = mapped_column(Integer, default=0)
    orders_updated: Mapped[int] = mapped_column(Integer, default=0)
    
    # Custom sync filters
    store_uids: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)  # store UIDs filter (null = all)
    date_from: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    date_to: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

