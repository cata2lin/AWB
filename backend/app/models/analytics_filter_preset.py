"""AnalyticsFilterPreset model — saved filter sets for analytics reports.

A single row stores one named preset for one report_key (e.g.
'livrabilitate_produse'). The `filters` JSON blob is opaque to the
backend; the frontend owns its shape because filter sets differ per
report. The backend just stores and lists them.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Boolean, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AnalyticsFilterPreset(Base):
    """Shared filter preset for an analytics report."""

    __tablename__ = "analytics_filter_presets"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_key: Mapped[str] = mapped_column(String(80), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True, onupdate=datetime.utcnow
    )
    created_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
