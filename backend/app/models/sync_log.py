"""SyncLog model."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SyncLog(Base):
    """Log of synchronization runs."""
    __tablename__ = "sync_logs"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    status: Mapped[str] = mapped_column(String(50), default="running")  # running, completed, failed
    orders_fetched: Mapped[int] = mapped_column(Integer, default=0)
    orders_new: Mapped[int] = mapped_column(Integer, default=0)
    orders_updated: Mapped[int] = mapped_column(Integer, default=0)
    
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
