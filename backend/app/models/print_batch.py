"""PrintBatch and PrintBatchItem models."""
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class PrintBatch(Base):
    """Record of a printed batch."""
    __tablename__ = "print_batches"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    batch_number: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    
    # PDF storage
    file_path: Mapped[str] = mapped_column(String(500))
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    
    # Statistics
    order_count: Mapped[int] = mapped_column(Integer, default=0)
    group_count: Mapped[int] = mapped_column(Integer, default=0)
    
    # Status
    status: Mapped[str] = mapped_column(String(50), default="completed")  # pending, completed, failed
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    # Relationships
    items: Mapped[List["PrintBatchItem"]] = relationship(back_populates="batch")


class PrintBatchItem(Base):
    """Individual order within a print batch."""
    __tablename__ = "print_batch_items"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(Integer, ForeignKey("print_batches.id"))
    order_uid: Mapped[str] = mapped_column(String(100), ForeignKey("orders.uid"))
    
    # Group info at time of printing
    group_name: Mapped[str] = mapped_column(String(255))
    group_position: Mapped[int] = mapped_column(Integer, default=0)  # Position within group
    
    # Relationships
    batch: Mapped["PrintBatch"] = relationship(back_populates="items")
    order: Mapped["Order"] = relationship(back_populates="batch_items")
