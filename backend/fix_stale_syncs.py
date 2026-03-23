"""Fix stale running syncs — mark them as failed."""
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:123@localhost:5432/awbprint")

conn = psycopg2.connect(DATABASE_URL)
conn.autocommit = True
cur = conn.cursor()
cur.execute(
    "UPDATE sync_logs SET status='failed', error_message='Stale - server restarted', completed_at=NOW() WHERE status='running'"
)
print(f"Fixed {cur.rowcount} stale running syncs")
conn.close()
