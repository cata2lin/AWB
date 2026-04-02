"""CourierCsvImport model."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CourierCsvImport(Base):
    """Log of courier CSV file imports for transport cost tracking."""
    __tablename__ = "courier_csv_imports"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(500))
    courier_name: Mapped[str] = mapped_column(String(100))  # DPD, Sameday, etc.
    
    # Import statistics
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    matched_rows: Mapped[int] = mapped_column(Integer, default=0)
    unmatched_rows: Mapped[int] = mapped_column(Integer, default=0)
    
    status: Mapped[str] = mapped_column(String(50), default="completed")  # completed, failed
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Persistent CSV archive for re-import capability
    saved_file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
