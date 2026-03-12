"""
Business cost model.
Stores fixed and seasonal costs (salaries, utilities, subscriptions, etc.)
with monthly granularity, historical tracking, and store scope.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Text, Float, DateTime, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BusinessCost(Base):
    """
    Individual business cost entry, tied to a specific month.
    
    Examples:
      - Salary: category="salary", month="2026-02", amount=35000, scope="all"
      - Store subscription: category="subscription", month="2026-02", amount=100, scope="store", store_uids=["abc"]
      - Marketing: category="marketing", month="2026-02", amount=5000, scope="all"
    """
    __tablename__ = "business_costs"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Category of cost
    category: Mapped[str] = mapped_column(String(50), index=True)
    # "salary" | "utility" | "subscription" | "marketing" | "rent" | "other"

    # User-defined label, e.g. "Salarii angajați", "Curent electric"
    label: Mapped[str] = mapped_column(String(255))

    # Cost amount in RON
    amount: Mapped[float] = mapped_column(Float, default=0.0)

    # Month this cost applies to (format: "YYYY-MM")
    month: Mapped[str] = mapped_column(String(7), index=True)

    # Type: "fixed" (recurring, can be cloned) or "seasonal" (one-time for this month)
    cost_type: Mapped[str] = mapped_column(String(20), default="fixed")

    # Scope: "all" (business-wide) | "stores" (specific stores) | "store" (single store)
    scope: Mapped[str] = mapped_column(String(20), default="all")

    # Store UIDs this cost applies to (null/empty for scope="all")
    store_uids: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Free-text notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --- P&L Configuration ---
    
    # Whether this cost includes Romanian TVA (deductible).
    # True = amount includes TVA, fara_tva = amount / 1.21
    # False = no TVA (e.g. foreign services), fara_tva = cu_tva
    has_tva: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")

    # Which P&L section this cost appears in:
    # "cogs" | "operational" | "marketing" | "fixed"
    pnl_section: Mapped[str] = mapped_column(String(30), default="fixed", server_default="fixed")

    # Display order within the section (lower = higher position)
    display_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, onupdate=datetime.utcnow)

