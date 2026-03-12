"""Quick test to check profitability endpoint for runtime errors."""
import asyncio
import traceback

async def test():
    from app.core.database import AsyncSessionLocal
    from app.api.analytics.profitability import get_profitability_stats
    
    async with AsyncSessionLocal() as db:
        try:
            result = await get_profitability_stats(
                store_uids="75801bb8-54c7-461a-9e82-665c58405876-1749063850-WIUC7717L6",
                date_from="2026-01-01",
                date_to="2026-01-31",
                db=db
            )
            pnl = result.get("pnl", {})
            inc = pnl.get("income", {})
            print("SUCCESS!")
            print("GROSS:", inc.get("gross_sales"))
            print("RETS:", inc.get("returns_cancelled"))
            print("RET_CNT:", inc.get("returns_cancelled_count"))
            print("DEL:", inc.get("sales_delivered"))
            print("MKT:", pnl.get("marketing"))
            print("RET_CT:", pnl.get("returned_count"))
        except Exception as e:
            print(f"ERROR: {e}")
            traceback.print_exc()

asyncio.run(test())
