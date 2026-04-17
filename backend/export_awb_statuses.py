"""
Extract all unique AWB csv_status values and their billable classification.

Run on the server:
  cd /opt/awb-print/backend
  python export_awb_statuses.py

Outputs: awb_statuses.csv
"""
import asyncio
import csv
from sqlalchemy import text
from app.core.database import engine
from app.models.order_awb import is_billable_status


async def export():
    async with engine.begin() as conn:
        result = await conn.execute(text("""
            SELECT 
                csv_status,
                courier_name,
                COUNT(*) as awb_count,
                SUM(CASE WHEN transport_cost IS NOT NULL THEN transport_cost ELSE 0 END) as total_cost
            FROM order_awbs
            WHERE csv_status IS NOT NULL
            GROUP BY csv_status, courier_name
            ORDER BY courier_name, awb_count DESC
        """))
        rows = result.fetchall()

    output_file = "awb_statuses.csv"
    with open(output_file, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "Courier",
            "CSV Status",
            "AWB Count",
            "Total Cost (RON)",
            "Billable (Paid by us)",
            "Classification"
        ])
        
        for row in rows:
            csv_status = row[0]
            courier = row[1] or "Unknown"
            count = row[2]
            total_cost = round(row[3], 2) if row[3] else 0
            billable = is_billable_status(csv_status)
            classification = "✅ BILLABLE - counts toward transport cost" if billable else "❌ EXCLUDED - not counted"
            
            writer.writerow([
                courier,
                csv_status,
                count,
                total_cost,
                "Yes" if billable else "No",
                classification
            ])
    
    # Also print summary to console
    print(f"\nExported {len(rows)} unique status+courier combinations to {output_file}\n")
    print(f"{'Courier':<15} {'Status':<50} {'Count':>6} {'Cost':>10} {'Billable':>10}")
    print("-" * 95)
    for row in rows:
        csv_status = row[0]
        courier = row[1] or "Unknown"
        count = row[2]
        total_cost = round(row[3], 2) if row[3] else 0
        billable = is_billable_status(csv_status)
        marker = "✅" if billable else "❌"
        print(f"{courier:<15} {csv_status:<50} {count:>6} {total_cost:>10.2f} {marker:>10}")


if __name__ == "__main__":
    asyncio.run(export())
