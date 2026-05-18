"""Full Q2 marketing sync diagnostic."""
import asyncio
import httpx
import csv
import io
from datetime import datetime, date

async def main():
    sid = "1IVg0fI-_Rm7IptmOl3BmGrqtyyzn3auf0ZPuftr9vQo"
    url = f"https://docs.google.com/spreadsheets/d/{sid}/gviz/tq?tqx=out:csv&sheet=Raport%20Zilnic%202"
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
        r = await c.get(url)
    rows = list(csv.reader(io.StringIO(r.text)))

    q2_start = date(2026, 4, 1)
    q2_end = date(2026, 5, 18)

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
        "nubra": "nubra",  # ADD THIS
    }

    short_rows = 0
    too_short = 0
    ok = 0
    sample = None

    for row in rows[1:]:
        if not row or not row[0]:
            continue
        try:
            d = datetime.strptime(row[0].strip(), "%Y-%m-%d").date()
        except Exception:
            continue
        if not (q2_start <= d <= q2_end):
            continue
        if len(row) < 4:
            too_short += 1
        elif len(row) <= 18:
            short_rows += 1
        else:
            ok += 1
        if sample is None:
            col18 = row[18] if len(row) > 18 else "MISSING"
            sample = f"len={len(row)}, date={row[0]}, brand={row[1]}, fb={row[2]}, col18={col18}"

    print(f"Q2 rows: ok(len>18)={ok}, short(4-18)={short_rows}, too_short(<4)={too_short}")
    print(f"Sample: {sample}")

    # Now simulate the EXACT sync logic
    print("\n=== Simulating sync_marketing_costs logic ===")
    daily_records = {}
    for row in rows[1:]:
        if len(row) < 4:
            continue
        val = row[0].strip()
        row_date = None
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%d.%m.%Y", "%m-%d-%Y"):
            try:
                row_date = datetime.strptime(val, fmt).date()
                break
            except ValueError:
                continue
        if row_date is None:
            continue
        if row_date < q2_start or row_date > q2_end:
            continue
        brand = row[1].strip() if len(row) > 1 else ""
        store_name = BRAND_TO_STORE.get(brand.lower().strip())
        if not store_name:
            continue
        facebook = float(row[2].replace(".", "").replace(",", ".")) if len(row) > 2 and row[2] else 0.0
        tiktok = float(row[3].replace(".", "").replace(",", ".")) if len(row) > 3 and row[3] else 0.0
        google = float(row[18].replace(".", "").replace(",", ".")) if len(row) > 18 and row[18] else 0.0
        key = (row_date, store_name)
        if key not in daily_records:
            daily_records[key] = {"facebook": 0, "tiktok": 0, "google": 0}
        daily_records[key]["facebook"] += facebook
        daily_records[key]["tiktok"] += tiktok
        daily_records[key]["google"] += google

    print(f"Records that would be inserted: {len(daily_records)}")
    stores = set(s for (_, s) in daily_records.keys())
    print(f"Stores covered: {sorted(stores)}")
    total = sum(v["facebook"] + v["tiktok"] + v["google"] for v in daily_records.values())
    print(f"Total spend: {total:,.2f}")

asyncio.run(main())
