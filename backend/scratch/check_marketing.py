import asyncio
import httpx
import csv
import io
from datetime import date

async def test():
    sheet_name = "Raport Zilnic 2"
    sid = "1IVg0fI-_Rm7IptmOl3BmGrqtyyzn3auf0ZPuftr9vQo"
    url = (
        f"https://docs.google.com/spreadsheets/d/{sid}"
        f"/gviz/tq?tqx=out:csv&sheet={sheet_name.replace(' ', '%20')}"
    )
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(url, follow_redirects=True)
    rows = list(csv.reader(io.StringIO(r.text)))
    print(f"HTTP {r.status_code}, Total rows: {len(rows)}")
    print("\nFirst 10 rows (date + brand + fb):")
    for row in rows[1:11]:
        d = row[0] if row else ""
        b = row[1] if len(row) > 1 else ""
        fb = row[2] if len(row) > 2 else ""
        print(f"  date={d!r:20s}  brand={b!r:20s}  fb={fb!r}")

    # Parse dates and find Q2 2026
    from datetime import datetime
    def parse_date(val):
        val = val.strip()
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%d.%m.%Y"):
            try:
                return datetime.strptime(val, fmt).date()
            except ValueError:
                continue
        return None

    q2_start = date(2026, 4, 1)
    q2_end = date(2026, 6, 30)
    q2_rows = []
    bad_dates = []
    for row in rows[1:]:
        if not row or not row[0]:
            continue
        d = parse_date(row[0])
        if d is None:
            bad_dates.append(row[0])
        elif q2_start <= d <= q2_end:
            q2_rows.append((d, row[1] if len(row) > 1 else "", row[2] if len(row) > 2 else ""))

    print(f"\nQ2 2026 rows: {len(q2_rows)}")
    print(f"Unparseable date values (first 5): {bad_dates[:5]}")

    # Latest date in sheet
    all_dates = []
    for row in rows[1:]:
        if row and row[0]:
            d = parse_date(row[0])
            if d:
                all_dates.append(d)
    if all_dates:
        print(f"Date range in sheet: {min(all_dates)} to {max(all_dates)}")

    # Check DB cache
    import sys, os
    sys.path.insert(0, os.getcwd())
    os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///awb_print.db")
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import text
    from dotenv import load_dotenv
    load_dotenv()
    db_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///awb_print.db")
    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        result = await session.execute(
            text("SELECT MIN(cost_date), MAX(cost_date), COUNT(*), SUM(facebook+tiktok+google) FROM marketing_daily_costs WHERE cost_date >= '2026-04-01' AND cost_date <= '2026-06-30'")
        )
        row = result.fetchone()
        print(f"\nDB cache Q2 2026: min={row[0]}, max={row[1]}, rows={row[2]}, total_spend={row[3]}")
    await engine.dispose()

asyncio.run(test())
