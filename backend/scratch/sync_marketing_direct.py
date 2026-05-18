"""
Standalone script: fetch May 2026 marketing costs from Google Sheets
and write directly to the marketing_daily_costs DB table.
Does NOT need the FastAPI server to be running.
"""
import asyncio
import httpx
import csv
import io
import psycopg2
import os
from datetime import datetime, date
from dotenv import load_dotenv

load_dotenv()

SPREADSHEET_ID = "1IVg0fI-_Rm7IptmOl3BmGrqtyyzn3auf0ZPuftr9vQo"
CPA_SHEETS = ["Raport Zilnic 2", "Grandia"]

BRAND_TO_STORE = {
    "esteban": "esteban.ro", "gt parfumuri": "georgetalent.ro",
    "george talent": "georgetalent.ro", "grandia": "grandia.ro",
    "rossi nails": "rossinails.ro", "nocturna": "nocturna.ro",
    "nocturna lux": "nocturnalux.ro", "nocturna bg": "nocturna.bg",
    "bonhaus pl": "bonhaus.pl", "bonhaus bg": "bonhaus.bg",
    "bonhaus cz": "bonhaus.cz", "bonhaus ro": "bonhausro.ro",
    "apreciat": "apreciat.ro", "belasil": "belasil.ro",
    "carpetto": "carpetto.ro", "covoria": "covoria.ro",
    "magdeal": "magdeal.ro", "gento": "gento.ro",
    "reduceri bune": "reduceribune.ro", "ce pat ai": "cepatai.ro",
    "ofertele zilei": "ofertelezilei.ro",
    "nubra": "nubra",
    "casa ofertelor": "casaofertelor.ro",
    "casaofertelor": "casaofertelor.ro",
}

RANGES = [
    (date(2026, 3, 9), date(2026, 5, 18)),   # Fill from last sync to today
]

def parse_date(val: str):
    val = val.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%d.%m.%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            continue
    return None

def parse_float(val: str) -> float:
    if not val:
        return 0.0
    val = val.strip().replace(".", "").replace(",", ".")
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


async def fetch_sheet(sheet_name: str) -> list:
    url = (
        f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}"
        f"/gviz/tq?tqx=out:csv&sheet={sheet_name.replace(' ', '%20')}"
    )
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
        r = await c.get(url)
    print(f"  Sheet '{sheet_name}': HTTP {r.status_code}, {len(r.text)} bytes")
    rows = list(csv.reader(io.StringIO(r.text)))
    print(f"  Rows: {len(rows)}")
    return rows


async def main():
    date_from = date(2026, 3, 9)
    date_to = date(2026, 5, 18)
    print(f"Syncing {date_from} → {date_to}")

    # Collect records
    daily_records = {}
    for sheet_name in CPA_SHEETS:
        rows = await fetch_sheet(sheet_name)
        if len(rows) < 2:
            print(f"  WARNING: no data rows in '{sheet_name}'")
            continue
        matched = 0
        for row in rows[1:]:
            if len(row) < 4:
                continue
            row_date = parse_date(row[0])
            if row_date is None or row_date < date_from or row_date > date_to:
                continue
            brand = row[1].strip() if len(row) > 1 else ""
            if sheet_name == "Grandia":
                brand = "Grandia"
            store_name = BRAND_TO_STORE.get(brand.lower().strip())
            if not store_name:
                continue
            facebook = parse_float(row[2]) if len(row) > 2 else 0.0
            tiktok = parse_float(row[3]) if len(row) > 3 else 0.0
            google = parse_float(row[18]) if len(row) > 18 else 0.0
            key = (row_date, store_name)
            if key not in daily_records:
                daily_records[key] = {"facebook": 0.0, "tiktok": 0.0, "google": 0.0, "source": sheet_name}
            daily_records[key]["facebook"] += facebook
            daily_records[key]["tiktok"] += tiktok
            daily_records[key]["google"] += google
            matched += 1
        print(f"  Matched {matched} rows from '{sheet_name}'")

    print(f"\nTotal records to insert: {len(daily_records)}")
    stores = set(s for (_, s) in daily_records.keys())
    print(f"Stores: {sorted(stores)}")
    total = sum(v["facebook"] + v["tiktok"] + v["google"] for v in daily_records.values())
    print(f"Total spend: {total:,.2f} RON")

    if not daily_records:
        print("No records to insert — exiting.")
        return

    # Write to DB
    db_url = os.getenv("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # Delete existing records in range
    cur.execute(
        "DELETE FROM marketing_daily_costs WHERE cost_date >= %s AND cost_date <= %s",
        (date_from, date_to)
    )
    deleted = cur.rowcount
    print(f"\nDeleted {deleted} existing records in range")

    # Insert fresh
    now = datetime.utcnow()
    inserted = 0
    for (cost_date, store_name), costs in daily_records.items():
        cur.execute(
            """INSERT INTO marketing_daily_costs
               (cost_date, store_name, facebook, tiktok, google, source_sheet, synced_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (
                cost_date, store_name,
                round(costs["facebook"], 2),
                round(costs["tiktok"], 2),
                round(costs["google"], 2),
                costs["source"],
                now,
            )
        )
        inserted += 1

    conn.commit()
    print(f"Inserted {inserted} records")

    # Verify
    cur.execute("""
        SELECT cost_date::text[:7], COUNT(*), ROUND(SUM(facebook+tiktok+google)::numeric, 2)
        FROM marketing_daily_costs
        WHERE cost_date >= '2026-03-09'
        GROUP BY 1 ORDER BY 1
    """)
    print("\nDB verification:")
    for row in cur.fetchall():
        print(f"  {row[0]}: {row[1]} records, total={row[2]:,}")

    cur.close()
    conn.close()

asyncio.run(main())
