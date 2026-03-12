"""
Exchange rate model.
Stores daily BNR (Banca Nationala a Romaniei) exchange rates for currency conversion.
"""
from datetime import date, datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, Date, DateTime, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExchangeRate(Base):
    """
    Daily exchange rate from BNR.
    Rate = how many RON for 1 unit (or `multiplier` units) of the currency.
    E.g. EUR rate=5.0934, multiplier=1 → 1 EUR = 5.0934 RON
    E.g. HUF rate=1.3485, multiplier=100 → 100 HUF = 1.3485 RON
    """
    __tablename__ = "exchange_rates"
    __table_args__ = (
        UniqueConstraint('rate_date', 'currency', name='uq_exchange_rate_date_currency'),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    rate_date: Mapped[date] = mapped_column(Date, index=True)
    currency: Mapped[str] = mapped_column(String(10), index=True)
    rate: Mapped[float] = mapped_column(Float)  # RON per unit (or per multiplier units)
    multiplier: Mapped[int] = mapped_column(Integer, default=1)  # BNR multiplier (e.g., 100 for HUF)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
