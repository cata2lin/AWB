"""
READ-ONLY reconciliation harness: AWBprint vs Scripturi (Profitabilitate-Livrabilitate).

The empirical cross-check the audit flagged as missing (Finding C4). Run it to:
  1. Confirm per-store order counts match between the two programs (they do — the
     only total gap is store coverage, not a calc/sync bug).
  2. Quantify the `fulfilled` classifier fix (fulfilled is NOT shipped) on the
     all-time delivery rate.
  3. Confirm the status classifier covers every aggregated_status present in prod.

Credentials are read from the environment — DO NOT hardcode the prod password:
    set RECON_DB_HOST / RECON_DB_USER / RECON_DB_PASS  (see debug/DB_Reference.md)
This host is behind the project's prod-DB safety rail; only ever run SELECTs.

Run (PowerShell):
    $env:RECON_DB_PASS="..."; ./venv/Scripts/python.exe scratch/reconcile_awb_vs_scripturi.py
"""

import os
import psycopg2

HOST = os.environ.get("RECON_DB_HOST", "")
PORT = int(os.environ.get("RECON_DB_PORT", "5432"))
USER = os.environ.get("RECON_DB_USER", "scraper")
PWD = os.environ.get("RECON_DB_PASS", "")

# Nov 2025 (inside the Apr-Dec 2025 overlap), RO-local -> UTC for AWB.
AWB_START, AWB_END = "2025-10-31 22:00:00", "2025-11-30 21:59:59"
SC_START, SC_END = "2025-11-01 00:00:00", "2025-11-30 23:59:59"

# Classifier sets (must mirror app/core/status_classification.py).
DELIVERED = {"delivered", "customer_pickup", "personal_pickup", "in_parcel_locker"}
RETURNED = {
    "back_to_sender",
    "returned",
    "returning_to_sender",
    "received_by_sender",
    "incorrect_address",
    "lost",
    "lost_in_transit",
    "lost_in_warehouse",
    "shipment_refunded",
    "refused",
    "unsuccessful_delivery",
}
IN_TRANSIT = {
    "in_transit",
    "out_for_delivery",
    "redirected",
    "deferred_delivery",
    "on_hold",
    "sending",
}
CANCELLED = {"cancelled", "voided", "shipping_canceled", "fulfillment_cancelled"}


def connect(db):
    if not HOST or not PWD:
        raise SystemExit("Set RECON_DB_HOST and RECON_DB_PASS env vars first.")
    c = psycopg2.connect(
        host=HOST,
        port=PORT,
        user=USER,
        password=PWD,
        dbname=db,
        connect_timeout=15,
        options="-c default_transaction_read_only=on",
    )
    c.set_session(readonly=True, autocommit=True)
    return c


def q(c, sql, a=None):
    with c.cursor() as cur:
        cur.execute(sql, a or ())
        return cur.fetchall()


def norm(n):
    return (n or "").strip().lower().replace(" ", "").replace(".", "")


def main():
    aw = connect("AWBprint")

    # --- 1. all-time status distribution + fulfilled-fix impact ---
    rows = q(aw, "SELECT aggregated_status, COUNT(*) FROM orders GROUP BY 1")
    dist = {(r[0] or "").lower(): r[1] for r in rows}
    delivered = sum(n for s, n in dist.items() if s in DELIVERED)
    returned = sum(n for s, n in dist.items() if s in RETURNED)
    intr = sum(n for s, n in dist.items() if s in IN_TRANSIT)
    ful = dist.get("fulfilled", 0)
    old_shipped = delivered + returned + intr + ful  # fulfilled counted as shipped
    new_shipped = delivered + returned + intr  # fulfilled NOT shipped
    print("=== All-time fulfilled-fix impact ===")
    print(
        f"  delivered={delivered:,} returned={returned:,} in_transit={intr:,} fulfilled={ful:,}"
    )
    print(
        f"  OLD delivery_rate = {delivered / old_shipped * 100:.2f}%  (shipped {old_shipped:,})"
    )
    print(
        f"  NEW delivery_rate = {delivered / new_shipped * 100:.2f}%  (shipped {new_shipped:,})"
    )
    known = DELIVERED | RETURNED | IN_TRANSIT | CANCELLED | {"fulfilled"}
    not_shipped_known = {
        "processing",
        "not_fulfilled",
        "ready_for_pickup",
        "new",
        "waiting_for_courier",
        "errors_incorrect_shipping_address",
        "awaiting_shipment_generation_initialization",
    }
    unmapped = {
        s: n
        for s, n in dist.items()
        if s and s not in known and s not in not_shipped_known
    }
    print(f"  statuses NOT in classifier (would fall to 'other'): {unmapped or 'none'}")

    # --- 2. per-store Nov-2025 counts ---
    awb_stores = {
        norm(r[0]): r[1]
        for r in q(
            aw,
            """
        SELECT s.name, COUNT(*) FROM orders o JOIN stores s ON o.store_uid=s.uid
        WHERE o.frisbo_created_at>=%s AND o.frisbo_created_at<=%s GROUP BY s.name""",
            (AWB_START, AWB_END),
        )
    }
    aw.close()

    sc = connect("Profitabilitate-Livrabilitate")
    sc_stores = {
        norm(r[0]): r[1]
        for r in q(
            sc,
            """
        SELECT st.name, COUNT(*) FROM orders o JOIN stores st ON o.store_id=st.id
        WHERE o.created_at>=%s AND o.created_at<=%s GROUP BY st.name""",
            (SC_START, SC_END),
        )
    }
    sc.close()

    print("\n=== Per-store Nov-2025 counts (normalized names) ===")
    keys = sorted(set(awb_stores) | set(sc_stores))
    ta = ts = 0
    for k in keys:
        a, s = awb_stores.get(k, 0), sc_stores.get(k, 0)
        ta += a
        ts += s
        flag = "" if a and s else "  <- one side only (store coverage)"
        print(f"  {k:<20}{a:>8,}{s:>8,}{a - s:>7,}{flag}")
    print(f"  {'TOTAL':<20}{ta:>8,}{ts:>8,}{ta - ts:>7,}")


if __name__ == "__main__":
    main()
