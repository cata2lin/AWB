"""
Timezone utilities for converting UTC ↔ Romanian time (Europe/Bucharest).

The database stores all datetimes as naive UTC. This module provides functions
to convert them to Romanian local time for API responses, and to convert
Romanian local date inputs to UTC for database queries.

Romania observes:
  - EET  (UTC+2) in winter (last Sunday of October → last Sunday of March)
  - EEST (UTC+3) in summer (last Sunday of March → last Sunday of October)
"""
from datetime import datetime, timedelta, date
from typing import Optional
from zoneinfo import ZoneInfo

# Bucharest timezone — handles DST transitions automatically
BUCHAREST_TZ = ZoneInfo("Europe/Bucharest")
UTC_TZ = ZoneInfo("UTC")


def to_bucharest(dt: Optional[datetime]) -> Optional[datetime]:
    """
    Convert a naive UTC datetime to a timezone-aware Europe/Bucharest datetime.
    
    Returns None if input is None.
    If the datetime is already timezone-aware, converts from its timezone.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        # Assume naive datetime is UTC
        dt = dt.replace(tzinfo=UTC_TZ)
    return dt.astimezone(BUCHAREST_TZ)


def to_bucharest_iso(dt: Optional[datetime]) -> Optional[str]:
    """
    Convert a naive UTC datetime to Romanian time and return as ISO string.
    
    Returns None if input is None.
    The ISO string includes the timezone offset (e.g., +03:00 or +02:00).
    """
    converted = to_bucharest(dt)
    if converted is None:
        return None
    return converted.isoformat()


def romania_now() -> datetime:
    """Get the current datetime in Romanian time (timezone-aware)."""
    return datetime.now(BUCHAREST_TZ)


def romania_today_start_utc() -> datetime:
    """
    Get the start of "today" in Romanian time, expressed as a naive UTC datetime.
    
    This is what should replace `datetime.utcnow().replace(hour=0, ...)` 
    when calculating "today's" boundaries for database queries.
    
    Example: If it's April 6 in Romania (EEST, UTC+3),
    "today" starts at 00:00 EEST = 21:00 UTC on April 5.
    """
    now_romania = romania_now()
    start_of_day_romania = now_romania.replace(hour=0, minute=0, second=0, microsecond=0)
    # Convert to UTC and strip tzinfo for naive UTC comparison with DB
    start_utc = start_of_day_romania.astimezone(UTC_TZ)
    return start_utc.replace(tzinfo=None)


def date_str_to_utc_start(date_str: str) -> datetime:
    """
    Convert a "YYYY-MM-DD" date string (Romanian local date) to
    the corresponding naive UTC datetime for the START of that day.
    
    "2026-04-06" in Romania (EEST) → 2026-04-05 21:00:00 UTC
    """
    local_date = datetime.strptime(date_str, "%Y-%m-%d")
    local_aware = local_date.replace(tzinfo=BUCHAREST_TZ)
    utc_dt = local_aware.astimezone(UTC_TZ)
    return utc_dt.replace(tzinfo=None)


def date_str_to_utc_end(date_str: str) -> datetime:
    """
    Convert a "YYYY-MM-DD" date string (Romanian local date) to
    the corresponding naive UTC datetime for the END of that day (23:59:59).
    
    "2026-04-06" in Romania (EEST) → 2026-04-06 20:59:59 UTC
    """
    local_date = datetime.strptime(date_str, "%Y-%m-%d")
    local_end = local_date.replace(hour=23, minute=59, second=59)
    local_aware = local_end.replace(tzinfo=BUCHAREST_TZ)
    utc_dt = local_aware.astimezone(UTC_TZ)
    return utc_dt.replace(tzinfo=None)


def to_bucharest_date(dt: Optional[datetime]) -> Optional[date]:
    """
    Convert a naive UTC datetime to a Romanian local date.
    
    Use this instead of `dt.date()` when you need the Romanian calendar date
    (e.g., for exchange rate lookups, daily chart bucketing).
    
    Example: 2026-04-06 22:30:00 UTC → 2026-04-07 (Romanian date, because
    22:30 UTC = 01:30 EEST next day)
    """
    converted = to_bucharest(dt)
    return converted.date() if converted else None


def romania_today() -> date:
    """
    Get today's date in Romanian time.
    
    Use instead of `datetime.utcnow().date()` or `date.today()`
    when you need "today" from the Romanian business perspective.
    """
    return romania_now().date()

