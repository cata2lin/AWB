"""Script to clear orders and stop running syncs."""
from sqlalchemy import create_engine, text

engine = create_engine('postgresql://postgres:123@localhost:5432/awbprint')
with engine.connect() as conn:
    conn.execute(text("UPDATE sync_logs SET status = 'cancelled' WHERE status = 'running'"))
    result = conn.execute(text("DELETE FROM orders"))
    conn.commit()
    print(f"Stopped running syncs and deleted all orders from database")
