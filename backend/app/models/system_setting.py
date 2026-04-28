"""SystemSetting model — key/value store for runtime-configurable settings.

Stores TOM API credentials, PO category definitions, and other settings
that need to be changeable without redeploying or editing .env files.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SystemSetting(Base):
    """
    Runtime-configurable key/value settings.

    Keys follow a dotted namespace:
      - tom.base_url, tom.api_key_id, tom.hmac_secret, tom.source_code
      - po.categories  (JSON array of {key, label, stores[], tom_enabled})
    """
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    value_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
