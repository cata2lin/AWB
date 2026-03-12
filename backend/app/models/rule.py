"""Rule and RulePreset models."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Text, Boolean, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Rule(Base):
    """Grouping rule configuration."""
    __tablename__ = "rules"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    priority: Mapped[int] = mapped_column(Integer, default=0, index=True)  # Lower = higher priority
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Conditions (JSON structure)
    # Example: {"store_uids": ["abc"], "min_items": 1, "max_items": 1, "sku_contains": "XYZ"}
    conditions: Mapped[dict] = mapped_column(JSON, default=dict)
    
    # Target group configuration
    # Example: {"name": "Single Items", "color": "#22c55e"}
    group_config: Mapped[dict] = mapped_column(JSON, default=dict)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RulePreset(Base):
    """Saved rule set configuration (preset)."""
    __tablename__ = "rule_presets"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rules_snapshot: Mapped[dict] = mapped_column(JSON)  # Array of rule configs
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)  # Currently loaded preset
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, onupdate=datetime.utcnow)
