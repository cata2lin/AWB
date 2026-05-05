from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from app.core.timezone import date_str_to_utc_start, date_str_to_utc_end

date_from = "2026-04-29"
date_to = "2026-04-29"

dt_from = date_str_to_utc_start(date_from)
dt_to = date_str_to_utc_end(date_to)

print(f"dt_from: {dt_from}")
print(f"dt_to: {dt_to}")

period_days = max((dt_to - dt_from).days, 1)
print(f"period_days: {period_days}")

prev_from = dt_from - timedelta(days=period_days)
prev_to = dt_from - timedelta(seconds=1)
print(f"prev_from: {prev_from}")
print(f"prev_to: {prev_to}")

query_margin = timedelta(hours=2)
query_start = prev_from - query_margin
query_end = dt_to + query_margin
print(f"SQL query_start: {query_start}")
print(f"SQL query_end: {query_end}")

order_date = datetime(2026, 4, 28, 11, 14, 49)
s_start = dt_from
s_end = dt_to

is_current = order_date >= s_start and order_date <= s_end
is_prev = order_date < s_start and order_date >= prev_from

print(f"order_date: {order_date}")
print(f"is_current: {is_current}")
print(f"is_prev: {is_prev}")
