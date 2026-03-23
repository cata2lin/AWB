"""Migration: Add sync_type, store_uids, date_from, date_to to sync_logs."""
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:123@localhost:5432/awbprint")


def migrate():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cursor = conn.cursor()

    # Check existing columns
    cursor.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'sync_logs'
    """)
    existing = {row[0] for row in cursor.fetchall()}

    new_columns = [
        ("sync_type", "VARCHAR(30) DEFAULT '45_day'"),
        ("store_uids", "JSONB"),
        ("date_from", "TIMESTAMP"),
        ("date_to", "TIMESTAMP"),
    ]

    for col_name, col_type in new_columns:
        if col_name not in existing:
            cursor.execute(f"ALTER TABLE sync_logs ADD COLUMN {col_name} {col_type}")
            print(f"  [+] Added column: {col_name}")
        else:
            print(f"  [=] Column already exists: {col_name}")

    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    migrate()
