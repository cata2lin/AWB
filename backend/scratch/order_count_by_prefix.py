import sys, asyncio

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from datetime import datetime
from collections import Counter
import re

LO = datetime(2026, 3, 31, 21, 0, 0)
HI = datetime(2026, 4, 30, 20, 59, 59)


def prefix_of(onum):
    m = re.match(r"^([A-Za-z]+)", onum or "")
    return m.group(1).upper() if m else "?"


async def main():
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text("""
            SELECT order_number FROM orders
            WHERE frisbo_created_at >= :lo AND frisbo_created_at <= :hi
        """),
                {"lo": LO, "hi": HI},
            )
        ).all()
    c = Counter(prefix_of(r[0]) for r in rows)
    print(f"AWB April orders (frisbo_created_at window): {len(rows)}")
    for p, n in c.most_common():
        print(f"  {p:<8} {n}")


asyncio.run(main())
print("DONE")
