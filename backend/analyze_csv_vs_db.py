"""
Deliverability comparison: CSV vs DB — per-store rates + orders causing differences.
Mirrors the deliverability analytics endpoint logic for both data sources.
"""
import asyncio
import pandas as pd
from datetime import datetime
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.timezone import date_str_to_utc_start, date_str_to_utc_end

CSV_PATH = r"c:\Users\Admin\Desktop\AWB Print\debug\Profitabilitate 2025 - Februarie 2026.csv"
OUTPUT = r"c:\Users\Admin\Desktop\AWB Print\debug\Deliverability_Comparison.xlsx"

# CSV courier_status -> normalized aggregated status (matching DB vocabulary)
CSV_STATUS_MAP = {
    'Delivered': 'delivered',
    'delivered': 'delivered',
    'livrata': 'delivered',
    'Coletul a fost livrat cu succes.': 'delivered',
    'Rambursul a fost transferat.': 'delivered',
    'Delivered Back to Sender': 'back_to_sender',
    'Returned To Sender': 'back_to_sender',
    'Return to Sender': 'back_to_sender',
    'returned': 'back_to_sender',
    'posted back': 'back_to_sender',
    "Ti-am returnat coletul cu succes.": 'back_to_sender',
    'Anulata': 'cancelled',
    'Canceled': 'cancelled',
    'cancelled': 'cancelled',
    'Stopped by sender': 'cancelled',
    'Administrative Closure': 'cancelled',
    'Destroyed': 'cancelled',
    'AWB Invalid': 'cancelled',
    'AWB Generat': 'processing',
    'Neplecata': 'processing',
    'Shipment data received': 'processing',
    'received data': 'processing',
    'prepared for departure': 'processing',
    'ready for pickup': 'ready_for_pickup',
    'Awaiting Delivery To Econt': 'in_transit',
    'handed to carrier': 'in_transit',
    'departed': 'in_transit',
    'arrived': 'in_transit',
    "Din pacate, coletul nu poate fi localizat. Revenim cu vesti.": 'in_transit',
    'Out for Delivery': 'out_for_delivery',
    'Unsuccessful Delivery': 'refused',
}

STORE_MAP = {
    'EST': 'esteban.ro', 'OFER': 'ofertelezilei.ro', 'BON': 'casaofertelor.ro',
    'GT': 'georgetalent.ro', 'PL': 'bonhaus.pl', 'CZ': 'bonhaus.cz',
    'BELA': 'belasil.ro', 'GRAND': 'grandia.ro', 'BONBG': 'bonhaus.bg',
    'LUX': 'nocturnalux.ro', 'MAG': 'magdeal.ro', 'BG': 'nocturna.bg',
    'GEN': 'gento.ro', 'ROSSI': 'rossinails.ro', 'NOC': 'nocturna.ro',
    'APR': 'apreciat.ro', 'RED': 'reduceribune.ro', 'CARP': 'carpetto.ro',
    'PAT': 'cepatai.ro', 'COV': 'covoria.ro',
}

def compute_deliverability(statuses):
    """Compute deliverability stats from a list of aggregated statuses.
    Mirrors backend deliverability.py logic exactly."""
    total = len(statuses)
    delivered = sum(1 for s in statuses if s == 'delivered')
    cancelled = sum(1 for s in statuses if s == 'cancelled')
    returned = sum(1 for s in statuses if s == 'back_to_sender')
    in_transit = sum(1 for s in statuses if s == 'in_transit')
    out_for_delivery = sum(1 for s in statuses if s == 'out_for_delivery')
    refused = sum(1 for s in statuses if s == 'refused')
    processing = sum(1 for s in statuses if s == 'processing')
    
    # shipped = everything that left the warehouse
    shipped = delivered + in_transit + out_for_delivery + returned + refused
    
    delivery_rate = (delivered / shipped * 100) if shipped > 0 else 0
    return_rate = (returned / shipped * 100) if shipped > 0 else 0
    refused_rate = (refused / shipped * 100) if shipped > 0 else 0
    cancelled_rate = (cancelled / total * 100) if total > 0 else 0
    expedition_rate = (shipped / total * 100) if total > 0 else 0
    
    return {
        'total': total,
        'delivered': delivered,
        'cancelled': cancelled,
        'returned': returned,
        'refused': refused,
        'in_transit': in_transit,
        'out_for_delivery': out_for_delivery,
        'processing': processing,
        'shipped': shipped,
        'delivery_rate': round(delivery_rate, 2),
        'return_rate': round(return_rate, 2),
        'refused_rate': round(refused_rate, 2),
        'cancelled_rate': round(cancelled_rate, 2),
        'expedition_rate': round(expedition_rate, 2),
    }

async def analyze():
    # ── 1. Load CSV ──
    print("Loading CSV...")
    df = pd.read_csv(CSV_PATH, encoding="utf-8")
    df = df.dropna(subset=["ORDER_NAME"]).reset_index(drop=True)
    df["store_prefix"] = df["ORDER_NAME"].str.extract(r"^([A-Za-z]+)")
    df["csv_status"] = df["courier_status"].map(CSV_STATUS_MAP).fillna("unknown")
    
    # ── 2. Query DB ──
    print("Querying DB...")
    db_start = date_str_to_utc_start("2026-02-01")
    db_end = date_str_to_utc_end("2026-02-28")
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("""
            SELECT o.order_number, o.aggregated_status, o.shipment_status,
                   o.tracking_number, o.courier_name, s.name as store_name
            FROM orders o
            LEFT JOIN stores s ON o.store_uid = s.uid
            WHERE o.frisbo_created_at >= :start AND o.frisbo_created_at <= :end
        """), {"start": db_start, "end": db_end})
        db_rows = result.fetchall()
    
    db_df = pd.DataFrame(db_rows, columns=[
        "order_number", "aggregated_status", "shipment_status",
        "tracking_number", "courier_name", "store_name"
    ])
    print(f"  CSV: {len(df)} | DB: {len(db_df)}")
    
    # ── 3. Compute deliverability per store from BOTH sources ──
    print("\nComputing deliverability...\n")
    
    comparison_rows = []
    all_diff_orders = []
    
    for prefix, db_name in sorted(STORE_MAP.items(), key=lambda x: x[1]):
        csv_store = df[df["store_prefix"] == prefix]
        db_store = db_df[db_df["store_name"] == db_name]
        
        csv_statuses = csv_store["csv_status"].tolist()
        db_statuses = (db_store["aggregated_status"].fillna("unknown")).tolist()
        
        csv_deliv = compute_deliverability(csv_statuses)
        db_deliv = compute_deliverability(db_statuses)
        
        row = {
            "Store": db_name,
            "Prefix": prefix,
            # CSV
            "CSV Total": csv_deliv["total"],
            "CSV Shipped": csv_deliv["shipped"],
            "CSV Delivered": csv_deliv["delivered"],
            "CSV Returned": csv_deliv["returned"],
            "CSV Cancelled": csv_deliv["cancelled"],
            "CSV Refused": csv_deliv["refused"],
            "CSV Delivery Rate %": csv_deliv["delivery_rate"],
            "CSV Return Rate %": csv_deliv["return_rate"],
            "CSV Cancelled Rate %": csv_deliv["cancelled_rate"],
            "CSV Expedition Rate %": csv_deliv["expedition_rate"],
            # DB
            "DB Total": db_deliv["total"],
            "DB Shipped": db_deliv["shipped"],
            "DB Delivered": db_deliv["delivered"],
            "DB Returned": db_deliv["returned"],
            "DB Cancelled": db_deliv["cancelled"],
            "DB Refused": db_deliv["refused"],
            "DB Delivery Rate %": db_deliv["delivery_rate"],
            "DB Return Rate %": db_deliv["return_rate"],
            "DB Cancelled Rate %": db_deliv["cancelled_rate"],
            "DB Expedition Rate %": db_deliv["expedition_rate"],
            # Deltas
            "Rate Diff (DB-CSV) pp": round(db_deliv["delivery_rate"] - csv_deliv["delivery_rate"], 2),
            "Return Diff (DB-CSV) pp": round(db_deliv["return_rate"] - csv_deliv["return_rate"], 2),
        }
        comparison_rows.append(row)
        
        print(f"  {db_name:22s}: CSV={csv_deliv['delivery_rate']:6.2f}%  DB={db_deliv['delivery_rate']:6.2f}%  diff={row['Rate Diff (DB-CSV) pp']:+.2f}pp")
        
        # ── Find orders that cause status differences ──
        csv_indexed = csv_store.drop_duplicates(subset="ORDER_NAME").set_index("ORDER_NAME")
        db_indexed = db_store.drop_duplicates(subset="order_number").set_index("order_number")
        matched = set(csv_indexed.index) & set(db_indexed.index)
        
        for order in matched:
            csv_s = csv_indexed.loc[order, "csv_status"]
            db_s = db_indexed.loc[order, "aggregated_status"] or "unknown"
            
            if csv_s != db_s:
                # Determine if this affects deliverability calculation
                csv_is_delivered = csv_s == "delivered"
                db_is_delivered = db_s == "delivered"
                csv_is_shipped = csv_s in ("delivered", "in_transit", "out_for_delivery", "back_to_sender", "refused")
                db_is_shipped = db_s in ("delivered", "in_transit", "out_for_delivery", "back_to_sender", "refused")
                
                impact = "none"
                if csv_is_delivered and not db_is_delivered:
                    impact = "CSV=delivered, DB=not -> CSV rate higher"
                elif not csv_is_delivered and db_is_delivered:
                    impact = "DB=delivered, CSV=not -> DB rate higher"
                elif csv_is_shipped != db_is_shipped:
                    impact = "shipped vs not-shipped difference"
                
                all_diff_orders.append({
                    "store": db_name,
                    "prefix": prefix,
                    "order_number": order,
                    "csv_courier_status": csv_indexed.loc[order, "courier_status"],
                    "csv_normalized": csv_s,
                    "db_aggregated_status": db_s,
                    "db_shipment_status": db_indexed.loc[order, "shipment_status"] or "",
                    "csv_payment_status": csv_indexed.loc[order, "payment_status"],
                    "impact_on_deliverability": impact,
                })
    
    # ── 4. Compute TOTALS row ──
    comp_df = pd.DataFrame(comparison_rows)
    totals = {
        "Store": "TOTAL",
        "Prefix": "",
    }
    for col in comp_df.columns:
        if col in ("Store", "Prefix"):
            continue
        if "Rate" in col or "Diff" in col:
            continue
        totals[col] = comp_df[col].sum()
    
    csv_shipped_total = totals["CSV Shipped"]
    db_shipped_total = totals["DB Shipped"]
    totals["CSV Delivery Rate %"] = round(totals["CSV Delivered"] / csv_shipped_total * 100, 2) if csv_shipped_total else 0
    totals["CSV Return Rate %"] = round(totals["CSV Returned"] / csv_shipped_total * 100, 2) if csv_shipped_total else 0
    totals["CSV Cancelled Rate %"] = round(totals["CSV Cancelled"] / totals["CSV Total"] * 100, 2) if totals["CSV Total"] else 0
    totals["CSV Expedition Rate %"] = round(csv_shipped_total / totals["CSV Total"] * 100, 2) if totals["CSV Total"] else 0
    totals["DB Delivery Rate %"] = round(totals["DB Delivered"] / db_shipped_total * 100, 2) if db_shipped_total else 0
    totals["DB Return Rate %"] = round(totals["DB Returned"] / db_shipped_total * 100, 2) if db_shipped_total else 0
    totals["DB Cancelled Rate %"] = round(totals["DB Cancelled"] / totals["DB Total"] * 100, 2) if totals["DB Total"] else 0
    totals["DB Expedition Rate %"] = round(db_shipped_total / totals["DB Total"] * 100, 2) if totals["DB Total"] else 0
    totals["Rate Diff (DB-CSV) pp"] = round(totals["DB Delivery Rate %"] - totals["CSV Delivery Rate %"], 2)
    totals["Return Diff (DB-CSV) pp"] = round(totals["DB Return Rate %"] - totals["CSV Return Rate %"], 2)
    
    comp_df = pd.concat([comp_df, pd.DataFrame([totals])], ignore_index=True)
    
    # ── 5. Write Excel ──
    print("\nWriting Excel...")
    diff_orders_df = pd.DataFrame(all_diff_orders)
    
    with pd.ExcelWriter(OUTPUT, engine="openpyxl") as writer:
        # Sheet 1: Side-by-side deliverability
        comp_df.to_excel(writer, sheet_name="Deliverability Comparison", index=False)
        
        # Sheet 2: All orders with different statuses
        if len(diff_orders_df) > 0:
            diff_orders_df = diff_orders_df.sort_values(["store", "csv_normalized", "db_aggregated_status"])
            diff_orders_df.to_excel(writer, sheet_name="Orders With Differences", index=False)
        
        # Sheet 3: Impact summary - orders that flip deliverability
        if len(diff_orders_df) > 0:
            impact_summary = diff_orders_df[diff_orders_df["impact_on_deliverability"] != "none"]
            impact_by_store = impact_summary.groupby(["store", "impact_on_deliverability"]).size().reset_index(name="count")
            impact_by_store = impact_by_store.sort_values(["store", "count"], ascending=[True, False])
            impact_by_store.to_excel(writer, sheet_name="Impact Summary", index=False)
            
            # Sheet 4: Detailed impact orders
            impact_summary = impact_summary.sort_values(["store", "impact_on_deliverability"])
            impact_summary.to_excel(writer, sheet_name="Impact Orders Detail", index=False)
        
        # Sheet 5: Status transition heatmap data
        if len(diff_orders_df) > 0:
            heatmap = diff_orders_df.groupby(["csv_normalized", "db_aggregated_status"]).size().reset_index(name="count")
            heatmap = heatmap.sort_values("count", ascending=False)
            heatmap.to_excel(writer, sheet_name="Status Transition Map", index=False)
    
    print(f"  Saved: {OUTPUT}")
    
    # Summary
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"  Orders with different statuses: {len(diff_orders_df)}")
    if len(diff_orders_df) > 0:
        impact_count = len(diff_orders_df[diff_orders_df["impact_on_deliverability"] != "none"])
        print(f"  Orders impacting deliverability rate: {impact_count}")
    print(f"\nDONE!")

asyncio.run(analyze())
