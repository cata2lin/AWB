"""
Exchange rate service — BNR sync and currency conversion.

Uses the official Banca Nationala a Romaniei (BNR) XML feed:
  - Current rates: https://www.bnr.ro/nbrfxrates.xml
  - Yearly archive: https://www.bnr.ro/nbrfxrates{YYYY}.xml
"""
import logging
from datetime import date, timedelta
from typing import Optional, Dict
import xml.etree.ElementTree as ET

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.exchange_rate import ExchangeRate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/exchange-rates", tags=["exchange-rates"])

BNR_CURRENT_URL = "https://www.bnr.ro/nbrfxrates.xml"
BNR_YEAR_URL = "https://www.bnr.ro/files/xml/years/nbrfxrates{year}.xml"
BNR_NS = {"bnr": "http://www.bnr.ro/xsd"}


# ---------------------------------------------------------------------------
# BNR XML parsing
# ---------------------------------------------------------------------------

def _parse_bnr_xml(xml_text: str) -> list[dict]:
    """Parse BNR XML into a list of {date, currency, rate, multiplier} dicts."""
    root = ET.fromstring(xml_text)
    results = []
    for cube in root.findall(".//bnr:Cube", BNR_NS):
        cube_date_str = cube.get("date")
        if not cube_date_str:
            continue
        cube_date = date.fromisoformat(cube_date_str)
        for rate_el in cube.findall("bnr:Rate", BNR_NS):
            currency = rate_el.get("currency")
            multiplier = int(rate_el.get("multiplier", "1"))
            try:
                rate_value = float(rate_el.text)
            except (TypeError, ValueError):
                continue
            results.append({
                "rate_date": cube_date,
                "currency": currency,
                "rate": rate_value,
                "multiplier": multiplier,
            })
    return results


# ---------------------------------------------------------------------------
# Database sync
# ---------------------------------------------------------------------------

async def _upsert_rates(db: AsyncSession, rates: list[dict]) -> int:
    """Insert rates that don't already exist. Returns count of new rows."""
    inserted = 0
    for r in rates:
        exists = await db.execute(
            select(ExchangeRate).where(
                and_(
                    ExchangeRate.rate_date == r["rate_date"],
                    ExchangeRate.currency == r["currency"],
                )
            )
        )
        if exists.scalar_one_or_none() is None:
            db.add(ExchangeRate(**r))
            inserted += 1
    if inserted:
        await db.flush()
    return inserted


async def sync_bnr_rates(db: AsyncSession) -> dict:
    """Fetch current day's BNR rates and store them."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(BNR_CURRENT_URL)
            resp.raise_for_status()
        rates = _parse_bnr_xml(resp.text)
        inserted = await _upsert_rates(db, rates)
        logger.info(f"BNR sync: parsed {len(rates)} rates, inserted {inserted} new")
        return {"parsed": len(rates), "inserted": inserted}
    except Exception as e:
        logger.error(f"BNR sync failed: {e}")
        return {"error": str(e)}


async def sync_bnr_year(db: AsyncSession, year: int) -> dict:
    """Backfill an entire year of BNR rates."""
    url = BNR_YEAR_URL.format(year=year)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            resp.raise_for_status()
        rates = _parse_bnr_xml(resp.text)
        inserted = await _upsert_rates(db, rates)
        logger.info(f"BNR year {year}: parsed {len(rates)} rates, inserted {inserted} new")
        return {"year": year, "parsed": len(rates), "inserted": inserted}
    except Exception as e:
        logger.error(f"BNR year {year} sync failed: {e}")
        return {"year": year, "error": str(e)}


# ---------------------------------------------------------------------------
# Rate lookup & conversion
# ---------------------------------------------------------------------------

async def get_rate(currency: str, target_date: date, db: AsyncSession) -> Optional[float]:
    """
    Get the RON exchange rate for 1 unit of the given currency on target_date.
    Falls back to the most recent previous date if no rate exists for that day.
    Returns None if no rate is found at all.
    """
    if currency.upper() == "RON":
        return 1.0

    # Look for exact date or the most recent previous date (up to 10 days back)
    result = await db.execute(
        select(ExchangeRate)
        .where(
            and_(
                ExchangeRate.currency == currency.upper(),
                ExchangeRate.rate_date <= target_date,
                ExchangeRate.rate_date >= target_date - timedelta(days=30),
            )
        )
        .order_by(ExchangeRate.rate_date.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None
    # Convert: rate is for `multiplier` units, so 1 unit = rate / multiplier RON
    return row.rate / row.multiplier


async def convert_to_ron(amount: float, currency: str, target_date: date, db: AsyncSession) -> Optional[float]:
    """Convert an amount to RON using the BNR rate for the given date."""
    if currency.upper() == "RON" or amount == 0:
        return amount
    rate = await get_rate(currency, target_date, db)
    if rate is None:
        return None
    return round(amount * rate, 2)


# ---------------------------------------------------------------------------
# Batch rate pre-loading (for performance in analytics)
# ---------------------------------------------------------------------------

async def preload_rates(currencies: set[str], date_range: tuple[date, date], db: AsyncSession) -> Dict[str, Dict[date, float]]:
    """
    Pre-load all rates for the given currencies and date range into a nested dict:
    { "EUR": { date(2026,1,5): 5.09, date(2026,1,6): 5.10, ... }, ... }
    
    This avoids N+1 queries when processing many orders.
    """
    if not currencies or "RON" in currencies and len(currencies) == 1:
        return {}
    
    non_ron = {c.upper() for c in currencies if c.upper() != "RON"}
    if not non_ron:
        return {}
    
    # Fetch all rates in the date range (with 30-day buffer for weekend/gap fallback)
    min_date = date_range[0] - timedelta(days=30)
    result = await db.execute(
        select(ExchangeRate)
        .where(
            and_(
                ExchangeRate.currency.in_(non_ron),
                ExchangeRate.rate_date >= min_date,
                ExchangeRate.rate_date <= date_range[1],
            )
        )
        .order_by(ExchangeRate.rate_date)
    )
    rows = result.scalars().all()
    
    # Build lookup: { currency: { date: rate_per_unit } }
    lookup: Dict[str, Dict[date, float]] = {}
    for row in rows:
        if row.currency not in lookup:
            lookup[row.currency] = {}
        lookup[row.currency][row.rate_date] = row.rate / row.multiplier
    
    return lookup


def get_rate_from_cache(currency: str, target_date: date, cache: Dict[str, Dict[date, float]]) -> Optional[float]:
    """
    Get rate from the pre-loaded cache, falling back to the most recent previous date.
    """
    if currency.upper() == "RON":
        return 1.0
    
    currency_rates = cache.get(currency.upper())
    if not currency_rates:
        return None
    
    # Try exact date first
    if target_date in currency_rates:
        return currency_rates[target_date]
    
    # Fall back: find the most recent previous date
    for days_back in range(1, 31):
        fallback = target_date - timedelta(days=days_back)
        if fallback in currency_rates:
            return currency_rates[fallback]
    
    return None


def convert_to_ron_cached(amount: float, currency: str, target_date: date, cache: Dict[str, Dict[date, float]]) -> Optional[float]:
    """Convert amount to RON using pre-loaded cache."""
    if currency.upper() == "RON" or amount == 0:
        return amount
    rate = get_rate_from_cache(currency, target_date, cache)
    if rate is None:
        return None
    return round(amount * rate, 2)


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@router.get("/sync")
async def api_sync_rates(db: AsyncSession = Depends(get_db)):
    """Manually trigger BNR rate sync for current day."""
    result = await sync_bnr_rates(db)
    await db.commit()
    return result


@router.get("/sync-year/{year}")
async def api_sync_year(year: int, db: AsyncSession = Depends(get_db)):
    """Backfill BNR rates for an entire year."""
    result = await sync_bnr_year(db, year)
    await db.commit()
    return result


@router.get("")
async def api_get_rate(
    currency: str = Query(..., description="Currency code, e.g. EUR"),
    rate_date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format"),
    db: AsyncSession = Depends(get_db),
):
    """Look up the exchange rate for a currency on a given date."""
    target = date.fromisoformat(rate_date) if rate_date else date.today()
    rate = await get_rate(currency, target, db)
    if rate is None:
        return {"currency": currency, "date": target.isoformat(), "rate": None, "error": "No rate found"}
    return {"currency": currency, "date": target.isoformat(), "rate_per_unit": round(rate, 6)}
