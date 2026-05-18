"""Trigger Q2 2026 marketing cost sync via API."""
import asyncio
import httpx

async def main():
    base = "http://localhost:8000"

    # Login
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(f"{base}/api/auth/login", json={"username": "admin", "password": "admin"})
        if r.status_code != 200:
            # Try token endpoint
            r = await c.post(f"{base}/api/auth/token", data={"username": "admin", "password": "admin"})
        print(f"Login: {r.status_code}")
        token = r.json().get("access_token") or r.json().get("token")
        if not token:
            print("No token found, response:", r.text[:200])
            return
        print(f"Token obtained: {token[:30]}...")
        headers = {"Authorization": f"Bearer {token}"}

    # Sync April 2026
    print("\nSyncing April 2026...")
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.post(f"{base}/api/analytics/marketing/sync?date_from=2026-04-01&date_to=2026-04-30", headers=headers)
        print(f"  April: {r.status_code} -> {r.text[:300]}")

    # Sync May 2026
    print("\nSyncing May 2026...")
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.post(f"{base}/api/analytics/marketing/sync?date_from=2026-05-01&date_to=2026-05-18", headers=headers)
        print(f"  May:   {r.status_code} -> {r.text[:300]}")

    # Verify DB
    print("\nVerifying DB cache...")
    import psycopg2
    from dotenv import load_dotenv
    import os
    load_dotenv()
    conn = psycopg2.connect(os.getenv("DATABASE_URL"))
    cur = conn.cursor()
    cur.execute("""
        SELECT cost_date::text[:7] as month, COUNT(*), ROUND(SUM(facebook+tiktok+google)::numeric,2)
        FROM marketing_daily_costs
        WHERE cost_date >= '2026-04-01'
        GROUP BY 1 ORDER BY 1
    """)
    rows = cur.fetchall()
    if rows:
        for row in rows:
            print(f"  {row[0]}: {row[1]} records, total spend={row[2]}")
    else:
        print("  Still empty after sync!")
    cur.close()
    conn.close()

asyncio.run(main())
