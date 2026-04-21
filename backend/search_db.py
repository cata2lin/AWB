"""Quick DB search for a specific value."""
import asyncio
from sqlalchemy import text
from app.core.database import engine

VAL = "8d6f3815-7a29-4707-886b-cb2ef29660d0-1776694457-LQRO9MNU1J"

async def search():
    async with engine.connect() as conn:
        r = await conn.execute(
            text("SELECT uid, order_number, tracking_number FROM orders WHERE uid = :v OR order_number = :v OR tracking_number = :v LIMIT 5"),
            {"v": VAL}
        )
        rows = r.fetchall()
        if rows:
            print("FOUND in orders (exact):")
            for row in rows:
                print(f"  uid={row[0]}, order_number={row[1]}, tracking={row[2]}")
        else:
            print("Not found in orders (exact)")

        r2 = await conn.execute(
            text("SELECT id, order_id, tracking_number FROM order_awbs WHERE tracking_number = :v LIMIT 5"),
            {"v": VAL}
        )
        rows2 = r2.fetchall()
        if rows2:
            print("FOUND in order_awbs:")
            for row in rows2:
                print(f"  id={row[0]}, order_id={row[1]}, tracking={row[2]}")
        else:
            print("Not found in order_awbs")

        r3 = await conn.execute(
            text("SELECT uid, name FROM stores WHERE uid = :v LIMIT 5"),
            {"v": VAL}
        )
        rows3 = r3.fetchall()
        if rows3:
            print("FOUND in stores:")
            for row in rows3:
                print(f"  uid={row[0]}, name={row[1]}")
        else:
            print("Not found in stores")

        # LIKE search across orders
        r4 = await conn.execute(
            text("SELECT uid, order_number, tracking_number FROM orders WHERE uid LIKE :v OR order_number LIKE :v OR tracking_number LIKE :v LIMIT 5"),
            {"v": f"%{VAL}%"}
        )
        rows4 = r4.fetchall()
        if rows4:
            print("LIKE match in orders:")
            for row in rows4:
                print(f"  uid={row[0]}, order_number={row[1]}, tracking={row[2]}")

asyncio.run(search())
