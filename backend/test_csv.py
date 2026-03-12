"""Debug: show raw Esteban rows around Jan 2026."""
import asyncio
import httpx
import csv
import io

CPA_ID = "1IVg0fI-_Rm7IptmOl3BmGrqtyyzn3auf0ZPuftr9vQo"

async def test():
    async with httpx.AsyncClient(timeout=30) as client:
        url = f"https://docs.google.com/spreadsheets/d/{CPA_ID}/gviz/tq?tqx=out:csv&sheet=Raport%20Zilnic%202"
        resp = await client.get(url, follow_redirects=True)
        reader = csv.reader(io.StringIO(resp.text))
        rows = list(reader)
        
        # Find Esteban rows with non-zero Facebook (column C)
        print("=== Esteban rows with non-zero FB in Jan 2026 ===")
        count = 0
        for row in rows[1:]:
            if len(row) < 4:
                continue
            brand = row[1].strip() if len(row) > 1 else ""
            if brand != "Esteban":
                continue
            date_str = row[0].strip()
            if "2026" in date_str:
                fb = row[2] if len(row) > 2 else "N/A"
                tt = row[3] if len(row) > 3 else "N/A"
                goog = row[18] if len(row) > 18 else "N/A"
                print(f"  Date={date_str} FB_raw='{fb}' TT_raw='{tt}' Google_raw='{goog}'")
                count += 1
                if count >= 10:
                    break
        
        if count == 0:
            print("  No Esteban rows found for 2026!")
            # Show last few Esteban rows regardless of year
            print("\n=== Last 5 Esteban rows (any year) ===")
            esteban_rows = [r for r in rows[1:] if len(r) > 1 and r[1].strip() == "Esteban"]
            for row in esteban_rows[-5:]:
                fb = row[2] if len(row) > 2 else "N/A"
                tt = row[3] if len(row) > 3 else "N/A"
                goog = row[18] if len(row) > 18 else "N/A"
                print(f"  Date={row[0]} FB='{fb}' TT='{tt}' Google='{goog}'")

asyncio.run(test())
