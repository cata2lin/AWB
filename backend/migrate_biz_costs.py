"""One-time migration: add has_tva, pnl_section, display_order to business_costs."""
import psycopg2

conn = psycopg2.connect("postgresql://postgres:123@localhost:5432/awbprint")
cur = conn.cursor()

migrations = [
    "ALTER TABLE business_costs ADD COLUMN IF NOT EXISTS has_tva BOOLEAN DEFAULT TRUE",
    "ALTER TABLE business_costs ADD COLUMN IF NOT EXISTS pnl_section VARCHAR(50) DEFAULT 'fixed'",
    "ALTER TABLE business_costs ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0",
]

for sql in migrations:
    print(f"Running: {sql}")
    cur.execute(sql)

conn.commit()
print("Migration complete!")
conn.close()
