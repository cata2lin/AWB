"""ExclusionRule model — configurable order-exclusion rules for analytics reports.

Mirrors Scripturi's ``profit_exclusion_rules`` table: an admin can exclude orders
by ``tag`` (any order whose Frisbo tags contain the value) or by ``sku`` (any order
containing a line item with that SKU). Applied — on top of the always-on built-in
``test``/``sample`` tags — across the analytics reports via
``app/core/order_filters.py``.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExclusionRule(Base):
    """A single configurable exclusion rule.

    rule_type: "tag" | "sku"
    value:     the tag key or SKU to exclude (stored as-entered; matched lowercased)
    reason:    optional human note (why this is excluded)
    """

    __tablename__ = "exclusion_rules"
    __table_args__ = (UniqueConstraint("rule_type", "value", name="uq_exclusion_rule"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    rule_type: Mapped[str] = mapped_column(String(10), index=True)
    value: Mapped[str] = mapped_column(String(255))
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=True
    )
