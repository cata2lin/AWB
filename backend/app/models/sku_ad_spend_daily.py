"""SkuAdSpendDaily — per-SKU daily Facebook/TikTok ad spend (RON).

Imported from Scripturi's `analytics_fb_spend_daily` / `analytics_tk_spend_daily`
(USD), converted at a fixed USD→RON = 4.55 (Scripturi's only USD source; AWB's BNR
feed has no USD). Stored DAILY so the per-SKU profitability report can sum the exact
spend in any `[date_from, date_to]` window — matching Scripturi's date-range mode
(which sums the daily tables), not a monthly pro-rate approximation.

All spend rows are HA-/Hairo SKUs (Scripturi attributes by a `HA-(\\d{3,5})` regex on
the FB campaign / TK ad-group name; 100% of a row's spend goes to that one SKU).
"""

from datetime import date as date_type

from sqlalchemy import Date, Float, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SkuAdSpendDaily(Base):
    __tablename__ = "sku_ad_spend_daily"
    __table_args__ = (UniqueConstraint("date", "sku", name="uq_sku_ad_spend_date_sku"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date_type] = mapped_column(Date, index=True)
    sku: Mapped[str] = mapped_column(String(100), index=True)
    amount_fb_ron: Mapped[float] = mapped_column(Float, default=0.0)
    amount_tk_ron: Mapped[float] = mapped_column(Float, default=0.0)
