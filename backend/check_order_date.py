import asyncio
from app.core.database import AsyncSessionLocal
from sqlalchemy import text

async def main():
    async with AsyncSessionLocal() as db:
        r = await db.execute(text(
            "SELECT order_number, frisbo_created_at, synced_at, fulfilled_at "
            "FROM orders WHERE order_number = 'EST142529'"
        ))
        row = r.fetchone()
        if row:
            with open("date_result.txt", "w") as f:
                f.write(f"order_number:      {row[0]}\n")
                f.write(f"frisbo_created_at: {row[1]}\n")
                f.write(f"synced_at:         {row[2]}\n")
                f.write(f"fulfilled_at:      {row[3]}\n")
                f.write(f"type:              {type(row[1])}\n")
            print("Written to date_result.txt")
        else:
            print("NOT FOUND")

asyncio.run(main())
