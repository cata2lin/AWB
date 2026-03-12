"""
Google Sheets service for reading and caching marketing costs (CPA data).

Reads Facebook, TikTok, and Google Ads costs from the external
"CPA si financiar 2025" spreadsheet, then caches in the
marketing_daily_costs DB table.

Source sheets: "Raport Zilnic 2" (all brands), "Grandia" (Grandia only)
Columns: A=Date, B=Brand, C=Facebook, D=TikTok, S=Google Ads
"""
import logging
import csv
import io
from datetime import date, datetime, timedelta
from typing import Optional, Dict
from collections import defaultdict

import httpx
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

CPA_SPREADSHEET_ID = "1IVg0fI-_Rm7IptmOl3BmGrqtyyzn3auf0ZPuftr9vQo"
CPA_SHEETS = ["Raport Zilnic 2", "Grandia"]

# Brand name in CPA sheet → store name in our DB
BRAND_TO_STORE = {
    "esteban": "esteban.ro",
    "gt parfumuri": "georgetalent.ro",
    "george talent": "georgetalent.ro",
    "grandia": "grandia.ro",
    "rossi nails": "rossinails.ro",
    "nocturna": "nocturna.ro",
    "nocturna lux": "nocturnalux.ro",
    "nocturna bg": "nocturna.bg",
    "bonhaus pl": "bonhaus.pl",
    "bonhaus bg": "bonhaus.bg",
    "bonhaus cz": "bonhaus.cz",
    "bonhaus ro": "bonhausro.ro",
    "apreciat": "apreciat.ro",
    "belasil": "belasil.ro",
    "carpetto": "carpetto.ro",
    "covoria": "covoria.ro",
    "magdeal": "magdeal.ro",
    "gento": "gento.ro",
    "reduceri bune": "reduceribune.ro",
    "ce pat ai": "cepatai.ro",
    "ofertele zilei": "ofertelezilei.ro",
}


def _parse_date(val: str) -> Optional[date]:
    """Parse a date string from Google Sheets (various formats)."""
    if not val:
        return None
    val = val.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%d.%m.%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            continue
    return None


def _parse_float(val: str) -> float:
    """Safely parse a float from spreadsheet cell (European format: comma = decimal)."""
    if not val:
        return 0.0
    val = val.strip()
    # European format: "4.113,62" means 4113.62
    # Remove dots (thousands separator) then replace comma (decimal separator) with dot
    val = val.replace(".", "").replace(",", ".")
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


async def _fetch_sheet_data(sheet_name: str) -> list:
    """Fetch and parse CSV rows from a Google Sheets tab."""
    async with httpx.AsyncClient(timeout=30) as client:
        url = (
            f"https://docs.google.com/spreadsheets/d/{CPA_SPREADSHEET_ID}"
            f"/gviz/tq?tqx=out:csv&sheet={sheet_name.replace(' ', '%20')}"
        )
        logger.info(f"📊 Fetching CPA data from sheet: {sheet_name}")
        resp = await client.get(url, follow_redirects=True)
        
        if resp.status_code != 200:
            logger.error(f"Failed to fetch sheet '{sheet_name}': HTTP {resp.status_code}")
            return []
        
        reader = csv.reader(io.StringIO(resp.text))
        rows = list(reader)
        logger.info(f"📊 Got {len(rows)-1} data rows from '{sheet_name}'")
        return rows


async def sync_marketing_costs(db: AsyncSession, date_from: date, date_to: date) -> dict:
    """
    Fetch marketing costs from Google Sheets and upsert into the DB cache.
    
    Returns summary stats of what was synced.
    """
    from app.models.marketing_daily_cost import MarketingDailyCost
    
    # Collect all daily records: { (date, store_name): { facebook, tiktok, google, source_sheet } }
    daily_records = {}
    
    for sheet_name in CPA_SHEETS:
        try:
            rows = await _fetch_sheet_data(sheet_name)
            if len(rows) < 2:
                continue
            
            for row in rows[1:]:
                if len(row) < 4:
                    continue
                
                row_date = _parse_date(row[0])
                if row_date is None:
                    continue
                if row_date < date_from or row_date > date_to:
                    continue
                
                # Brand mapping
                brand = row[1].strip() if len(row) > 1 else ""
                if sheet_name == "Grandia":
                    brand = "Grandia"
                
                store_name = BRAND_TO_STORE.get(brand.lower().strip())
                if not store_name:
                    continue
                
                facebook = _parse_float(row[2]) if len(row) > 2 else 0.0
                tiktok = _parse_float(row[3]) if len(row) > 3 else 0.0
                google = _parse_float(row[18]) if len(row) > 18 else 0.0
                
                key = (row_date, store_name)
                if key not in daily_records:
                    daily_records[key] = {'facebook': 0, 'tiktok': 0, 'google': 0, 'source_sheet': sheet_name}
                
                daily_records[key]['facebook'] += facebook
                daily_records[key]['tiktok'] += tiktok
                daily_records[key]['google'] += google
                
        except Exception as e:
            logger.error(f"Error reading sheet '{sheet_name}': {e}")
    
    # Delete existing records in the date range, then insert fresh
    await db.execute(
        delete(MarketingDailyCost).where(
            and_(
                MarketingDailyCost.cost_date >= date_from,
                MarketingDailyCost.cost_date <= date_to,
            )
        )
    )
    
    inserted = 0
    for (cost_date, store_name), costs in daily_records.items():
        record = MarketingDailyCost(
            cost_date=cost_date,
            store_name=store_name,
            facebook=round(costs['facebook'], 2),
            tiktok=round(costs['tiktok'], 2),
            google=round(costs['google'], 2),
            source_sheet=costs['source_sheet'],
            synced_at=datetime.utcnow(),
        )
        db.add(record)
        inserted += 1
    
    await db.commit()
    
    logger.info(f"📊 Marketing costs synced: {inserted} daily records for {date_from} to {date_to}")
    return {
        'records_synced': inserted,
        'date_from': str(date_from),
        'date_to': str(date_to),
        'stores': len(set(sn for (_, sn) in daily_records.keys())),
    }


async def get_marketing_costs_from_db(
    db: AsyncSession,
    date_from: date,
    date_to: date,
) -> Dict[str, Dict[str, float]]:
    """
    Read marketing costs from the DB cache, aggregated per store for the date range.
    
    Returns:
        {
            store_name: { "facebook": X, "tiktok": Y, "google": Z, "total": T },
            "__total__": { ... aggregate ... }
        }
    """
    from app.models.marketing_daily_cost import MarketingDailyCost
    
    result = await db.execute(
        select(MarketingDailyCost).where(
            and_(
                MarketingDailyCost.cost_date >= date_from,
                MarketingDailyCost.cost_date <= date_to,
            )
        )
    )
    records = result.scalars().all()
    
    aggregated = defaultdict(lambda: {"facebook": 0.0, "tiktok": 0.0, "google": 0.0, "total": 0.0})
    
    for r in records:
        aggregated[r.store_name]["facebook"] += r.facebook
        aggregated[r.store_name]["tiktok"] += r.tiktok
        aggregated[r.store_name]["google"] += r.google
        aggregated[r.store_name]["total"] += r.facebook + r.tiktok + r.google
        
        aggregated["__total__"]["facebook"] += r.facebook
        aggregated["__total__"]["tiktok"] += r.tiktok
        aggregated["__total__"]["google"] += r.google
        aggregated["__total__"]["total"] += r.facebook + r.tiktok + r.google
    
    # Round all values
    for store_data in aggregated.values():
        for k in store_data:
            store_data[k] = round(store_data[k], 2)
    
    return dict(aggregated)


async def get_marketing_costs(
    date_from: date,
    date_to: date,
    db: Optional[AsyncSession] = None,
) -> Dict[str, Dict[str, float]]:
    """
    Get marketing costs — from DB cache if available, otherwise fetch live from Google Sheets.
    If db session is provided, tries cache first. Falls back to live fetch.
    """
    # Try DB cache first
    if db is not None:
        cached = await get_marketing_costs_from_db(db, date_from, date_to)
        if cached and '__total__' in cached and cached['__total__']['total'] > 0:
            logger.info(f"📊 Marketing costs from DB cache: {cached['__total__']['total']:.2f} total")
            return cached
        
        # Cache miss — sync from Google Sheets then read from cache
        logger.info("📊 Marketing costs cache miss — syncing from Google Sheets...")
        try:
            await sync_marketing_costs(db, date_from, date_to)
            cached = await get_marketing_costs_from_db(db, date_from, date_to)
            if cached:
                return cached
        except Exception as e:
            logger.error(f"Failed to sync marketing costs: {e}")
    
    # Fallback: live fetch from Google Sheets (no caching)
    return await _fetch_live(date_from, date_to)


async def _fetch_live(date_from: date, date_to: date) -> Dict[str, Dict[str, float]]:
    """Direct fetch from Google Sheets without caching (fallback)."""
    result = defaultdict(lambda: {"facebook": 0.0, "tiktok": 0.0, "google": 0.0, "total": 0.0})
    
    for sheet_name in CPA_SHEETS:
        try:
            rows = await _fetch_sheet_data(sheet_name)
            if len(rows) < 2:
                continue
            
            for row in rows[1:]:
                if len(row) < 4:
                    continue
                
                row_date = _parse_date(row[0])
                if row_date is None or row_date < date_from or row_date > date_to:
                    continue
                
                brand = row[1].strip() if len(row) > 1 else ""
                if sheet_name == "Grandia":
                    brand = "Grandia"
                
                store_name = BRAND_TO_STORE.get(brand.lower().strip())
                if not store_name:
                    continue
                
                facebook = _parse_float(row[2]) if len(row) > 2 else 0.0
                tiktok = _parse_float(row[3]) if len(row) > 3 else 0.0
                google = _parse_float(row[18]) if len(row) > 18 else 0.0
                
                result[store_name]["facebook"] += facebook
                result[store_name]["tiktok"] += tiktok
                result[store_name]["google"] += google
                result[store_name]["total"] += facebook + tiktok + google
                
                result["__total__"]["facebook"] += facebook
                result["__total__"]["tiktok"] += tiktok
                result["__total__"]["google"] += google
                result["__total__"]["total"] += facebook + tiktok + google
        except Exception as e:
            logger.error(f"Error reading sheet '{sheet_name}': {e}")
    
    for store_data in result.values():
        for k in store_data:
            store_data[k] = round(store_data[k], 2)
    
    return dict(result)
