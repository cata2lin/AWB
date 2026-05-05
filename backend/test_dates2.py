import asyncio
from datetime import datetime
from sqlalchemy import text
from app.core.database import engine
from app.api.sales_velocity.endpoint import _get_store_bounds
from app.core.timezone import date_str_to_utc_start, date_str_to_utc_end

async def main():
    async with engine.begin() as conn:
        res = await conn.execute(text("SELECT frisbo_created_at, store_uid FROM orders WHERE order_number='BELA31524'"))
        order_date, store_uid = res.fetchone()
        
        print(f"order_date: {order_date}, store_uid: {store_uid}")
        
        dt_from = date_str_to_utc_start("2026-04-29")
        dt_to = date_str_to_utc_end("2026-04-29")
        print(f"dt_from: {dt_from}, dt_to: {dt_to}")
        
        s_start, s_end = dt_from, dt_to  # default fallback if no explicit tz
        is_current = order_date >= s_start and order_date <= s_end
        print(f"is_current: {is_current}")

asyncio.run(main())
