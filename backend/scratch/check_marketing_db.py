"""Check marketing costs DB cache directly via psycopg2."""
import os
from dotenv import load_dotenv
import psycopg2

load_dotenv()
db_url = os.getenv("DATABASE_URL", "")
# Strip asyncpg prefix if present
db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

conn = psycopg2.connect(db_url)
cur = conn.cursor()

print("=== Marketing DB cache by quarter ===")
cur.execute("""
    SELECT 
        CASE 
            WHEN cost_date >= '2026-04-01' THEN 'Q2-2026'
            WHEN cost_date >= '2026-01-01' THEN 'Q1-2026'
            ELSE 'pre-2026'
        END as period,
        MIN(cost_date), MAX(cost_date), COUNT(*), 
        ROUND(SUM(facebook+tiktok+google)::numeric, 2) as total
    FROM marketing_daily_costs
    GROUP BY 1
    ORDER BY 2
""")
for row in cur.fetchall():
    print(f"  {row}")

print("\n=== Last synced_at ===")
cur.execute("SELECT MAX(synced_at) FROM marketing_daily_costs")
print(" ", cur.fetchone()[0])

print("\n=== Q2 2026 sample rows (first 10) ===")
cur.execute("""
    SELECT cost_date, store_name, facebook, tiktok, google, synced_at
    FROM marketing_daily_costs
    WHERE cost_date >= '2026-04-01'
    ORDER BY cost_date LIMIT 10
""")
rows = cur.fetchall()
if rows:
    for row in rows:
        print(f"  {row}")
else:
    print("  NO ROWS FOUND - cache is empty for Q2 2026!")

print("\n=== Stores in DB (all time) ===")
cur.execute("SELECT DISTINCT store_name FROM marketing_daily_costs ORDER BY 1")
print(" ", [r[0] for r in cur.fetchall()])

cur.close()
conn.close()
