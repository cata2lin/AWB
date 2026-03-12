"""
Marketing daily cost model.
Caches daily marketing spend (Facebook, TikTok, Google Ads) per store,
sourced from the external CPA Google Spreadsheet.
"""
from datetime import date, datetime
from typing import Optional
from sqlalchemy import String, Float, Date, DateTime, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MarketingDailyCost(Base):
    """
    Daily marketing costs per store, synced from Google Sheets CPA data.
    
    Each row = one day + one store's ad spend across platforms.
    Unique on (cost_date, store_name) to allow upsert.
    """
    __tablename__ = "marketing_daily_costs"
    __table_args__ = (
        UniqueConstraint('cost_date', 'store_name', name='uq_mkt_date_store'),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    
    # Date of the cost entry
    cost_date: Mapped[date] = mapped_column(Date, index=True)
    
    # Store name (e.g., "esteban.ro", matches Store.name)
    store_name: Mapped[str] = mapped_column(String(100), index=True)
    
    # Ad spend amounts (in RON, no TVA — foreign platforms)
    facebook: Mapped[float] = mapped_column(Float, default=0.0)
    tiktok: Mapped[float] = mapped_column(Float, default=0.0)
    google: Mapped[float] = mapped_column(Float, default=0.0)
    
    # Source sheet name for traceability
    source_sheet: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Sync timestamp
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
