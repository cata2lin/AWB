"""
AGGRESSIVE parallel full sync — fetch EVERY order from all stores at once and write the
freshest Frisbo data to the LIVE database, fast.

Why this exists (vs the scheduled tiers):
  Frisbo's store-view API IGNORES `created_at_start` / `updated_at_start` (verified:
  querying created_at_start=<5d ago> still returns orders from 3 months back). So every
  scheduled tier silently paginates the ENTIRE order base via the rate-limited (20 req/s)
  FrisboClient — a full sweep takes ~1h48m and the tiers overlap. This script instead
  pulls all orgs in parallel over pooled keep-alive connections (no rate limiter) and
  finishes the fetch in minutes.

What it writes:
  The SAME canonical upsert as app/services/sync_service.sync_orders — field-for-field:
  the don't-downgrade-terminal rule, the line_items guard, coalesced fields, and the AWB
  upsert. The ONLY behavioural addition is change-detection: an existing order whose
  tracked fields already match Frisbo is left untouched (no redundant write), so this is
  safe to run alongside the live scheduler and only touches genuine deltas + new orders.

Run:
  cd backend && ./venv/Scripts/python.exe -u scratch/parallel_full_sync.py
    [--org-concurrency 6] [--page-concurrency 12] [--dry-run]
"""

import sys
import time
import asyncio
import argparse
import logging
from collections import defaultdict
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.models import Order, OrderAwb, Store, SyncLog  # noqa: E402
from app.services.frisbo.parser import parse_order  # noqa: E402
from app.services.sync_service import ensure_store_exists  # noqa: E402
from app.core.status_classification import classify  # noqa: E402

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("app.services.frisbo.client").setLevel(logging.WARNING)

PAGE = 100
_TERMINAL_CATS = {"delivered", "returned", "cancelled"}


# ──────────────────────────────────────────────────────────────────────────
# Change detection — does Frisbo's payload carry anything new vs the DB row?
# Mirrors exactly which fields the canonical upsert would change, so "no change"
# here means the canonical upsert would have been a no-op write.
# ──────────────────────────────────────────────────────────────────────────
def order_changed(existing: Order, p: dict) -> bool:
    new_agg = p.get("aggregated_status")
    # don't-downgrade: a terminal→non-terminal agg is NOT applied, so it's not a change
    agg_would_change = (
        bool(new_agg)
        and not (
            classify(existing.aggregated_status) in _TERMINAL_CATS
            and classify(new_agg) not in _TERMINAL_CATS
        )
        and existing.aggregated_status != new_agg
    )
    if agg_would_change:
        return True

    # coalesced fields: only count as change when the payload has a value AND it differs
    def diff(cur, val):
        return bool(val) and cur != val

    if diff(existing.shipment_status, p.get("shipment_status")):
        return True
    if existing.fulfillment_status != p.get("fulfillment_status"):
        return True
    if diff(existing.tracking_number, p.get("tracking_number")):
        return True
    if diff(existing.courier_name, p.get("courier_name")):
        return True
    if diff(existing.awb_pdf_url, p.get("awb_pdf_url")):
        return True
    if diff(existing.shipment_uid, p.get("shipment_uid")):
        return True
    if diff(existing.fulfilled_at, p.get("fulfilled_at")):
        return True
    if diff(existing.total_price, p.get("total_price")):
        return True
    if diff(existing.subtotal_price, p.get("subtotal_price")):
        return True
    if diff(existing.total_discounts, p.get("total_discounts")):
        return True
    if diff(existing.currency, p.get("currency")):
        return True
    if diff(existing.payment_gateway, p.get("payment_gateway")):
        return True
    if p.get("line_items") and existing.line_items != p["line_items"]:
        return True
    if diff(existing.tags, p.get("tags")):
        return True
    if diff(existing.note, p.get("note")):
        return True
    return False


def apply_update(existing: Order, p: dict, status_changes: list):
    """Faithful copy of the UPDATE branch in sync_service.sync_orders."""
    old_agg = existing.aggregated_status
    new_agg = p.get("aggregated_status")
    old_shipment = existing.shipment_status
    new_shipment = p.get("shipment_status")
    if old_agg != new_agg or old_shipment != new_shipment:
        status_changes.append(existing.order_number)

    existing.tracking_number = p.get("tracking_number") or existing.tracking_number
    existing.awb_pdf_url = p.get("awb_pdf_url") or existing.awb_pdf_url
    existing.courier_name = p.get("courier_name") or existing.courier_name
    existing.shipment_uid = p.get("shipment_uid") or existing.shipment_uid
    existing.fulfillment_status = p["fulfillment_status"]
    existing.shipment_status = new_shipment or existing.shipment_status
    # don't-downgrade a settled order
    if new_agg and not (
        classify(existing.aggregated_status) in _TERMINAL_CATS
        and classify(new_agg) not in _TERMINAL_CATS
    ):
        existing.aggregated_status = new_agg
    if (
        existing.waiting_for_courier_since
        and new_agg
        and new_agg != "waiting_for_courier"
    ):
        existing.waiting_for_courier_since = None
    existing.fulfilled_at = p.get("fulfilled_at") or existing.fulfilled_at
    existing.total_price = p.get("total_price") or existing.total_price
    existing.subtotal_price = p.get("subtotal_price") or existing.subtotal_price
    existing.total_discounts = p.get("total_discounts") or existing.total_discounts
    existing.currency = p.get("currency") or existing.currency
    existing.payment_gateway = p.get("payment_gateway") or existing.payment_gateway
    if p.get("line_items"):
        existing.line_items = p["line_items"]
        existing.item_count = p["item_count"]
        existing.unique_sku_count = p["unique_sku_count"]
    existing.tags = p.get("tags") or existing.tags
    existing.note = p.get("note") or existing.note
    existing.synced_at = datetime.utcnow()


def build_new(p: dict) -> Order:
    """Faithful copy of the CREATE branch in sync_service.sync_orders."""
    return Order(
        uid=p["uid"],
        order_number=p["order_number"],
        store_uid=p["store_uid"],
        customer_name=p["customer_name"],
        customer_email=p.get("customer_email"),
        shipping_address=p.get("shipping_address"),
        line_items=p["line_items"],
        item_count=p["item_count"],
        unique_sku_count=p["unique_sku_count"],
        tracking_number=p.get("tracking_number"),
        courier_name=p.get("courier_name"),
        awb_pdf_url=p.get("awb_pdf_url"),
        shipment_uid=p.get("shipment_uid"),
        fulfillment_status=p["fulfillment_status"],
        financial_status=p.get("financial_status", "pending"),
        shipment_status=p.get("shipment_status"),
        aggregated_status=p.get("aggregated_status"),
        frisbo_created_at=p.get("frisbo_created_at"),
        fulfilled_at=p.get("fulfilled_at"),
        total_price=p.get("total_price"),
        subtotal_price=p.get("subtotal_price"),
        total_discounts=p.get("total_discounts"),
        currency=p.get("currency", "RON"),
        payment_gateway=p.get("payment_gateway"),
        tags=p.get("tags"),
        note=p.get("note"),
        synced_at=datetime.utcnow(),
    )


async def upsert_awbs(db, order_obj, all_awbs):
    """Faithful copy of the AWB upsert in sync_service.sync_orders."""
    if not all_awbs:
        return
    await db.flush()
    existing_awbs_result = await db.execute(
        select(OrderAwb).where(OrderAwb.order_id == order_obj.id)
    )
    existing_awbs = {
        oa.tracking_number: oa for oa in existing_awbs_result.scalars().all()
    }
    for awb in all_awbs:
        tn = awb.get("tracking_number")
        if not tn:
            continue
        if tn in existing_awbs:
            ea = existing_awbs[tn]
            ea.courier_name = awb.get("courier_name") or ea.courier_name
            ea.awb_type = awb.get("awb_type") or ea.awb_type
            ea.shipment_uid = awb.get("shipment_uid") or ea.shipment_uid
            ea.awb_pdf_url = awb.get("awb_pdf_url") or ea.awb_pdf_url
            ea.awb_pdf_format = awb.get("awb_pdf_format") or ea.awb_pdf_format
            ea.shipment_status = awb.get("shipment_status") or ea.shipment_status
            ea.shipment_status_date = (
                awb.get("shipment_status_date") or ea.shipment_status_date
            )
            ea.shipment_events = awb.get("shipment_events") or ea.shipment_events
            ea.is_return_label = (
                awb.get("is_return_label")
                if awb.get("is_return_label") is not None
                else ea.is_return_label
            )
            ea.is_redirect_label = (
                awb.get("is_redirect_label")
                if awb.get("is_redirect_label") is not None
                else ea.is_redirect_label
            )
            ea.paid_by = awb.get("paid_by") or ea.paid_by
            ea.cod_value = (
                awb.get("cod_value")
                if awb.get("cod_value") is not None
                else ea.cod_value
            )
            ea.cod_currency = awb.get("cod_currency") or ea.cod_currency
            ea.shipment_created_at = (
                awb.get("shipment_created_at") or ea.shipment_created_at
            )
        else:
            db.add(
                OrderAwb(
                    order_id=order_obj.id,
                    tracking_number=tn,
                    courier_name=awb.get("courier_name"),
                    awb_type=awb.get("awb_type", "outbound"),
                    shipment_uid=awb.get("shipment_uid"),
                    awb_pdf_url=awb.get("awb_pdf_url"),
                    awb_pdf_format=awb.get("awb_pdf_format"),
                    shipment_status=awb.get("shipment_status"),
                    shipment_status_date=awb.get("shipment_status_date"),
                    is_return_label=awb.get("is_return_label", False),
                    is_redirect_label=awb.get("is_redirect_label", False),
                    paid_by=awb.get("paid_by"),
                    cod_value=awb.get("cod_value"),
                    cod_currency=awb.get("cod_currency"),
                    shipment_created_at=awb.get("shipment_created_at"),
                    shipment_events=awb.get("shipment_events"),
                    data_source="frisbo_sync",
                    created_at=datetime.utcnow(),
                )
            )


async def sync_one_org(
    org, known_store_uids, page_concurrency, dry_run, stats, lock, max_blocks=0
):
    """Fetch one org's orders in streaming blocks and upsert deltas in its own session."""
    name = org.get("name", "org")
    headers = {
        "Authorization": f"Bearer {org['token']}",
        "Content-Type": "application/json",
    }
    limits = httpx.Limits(
        max_connections=page_concurrency + 5,
        max_keepalive_connections=page_concurrency + 5,
    )
    s = {
        "fetched": 0,
        "new": 0,
        "updated": 0,
        "unchanged": 0,
        "skipped": 0,
        "changes": [],
    }
    t0 = time.time()

    async with (
        AsyncSessionLocal() as db,
        httpx.AsyncClient(
            base_url=settings.frisbo_api_url,
            headers=headers,
            timeout=60.0,
            limits=limits,
        ) as client,
    ):

        async def page(skip):
            try:
                r = await client.get(
                    "/orders/search", params={"skip": skip, "limit": PAGE}
                )
                if r.status_code != 200:
                    return []
                data = r.json().get("data", {})
                return (
                    data.get("orders", []) if isinstance(data, dict) else data
                ) or []
            except Exception:
                return []

        skip = 0
        blocks_done = 0
        while True:
            skips = [skip + i * PAGE for i in range(page_concurrency)]
            batches = await asyncio.gather(*[page(sk) for sk in skips])
            block = [o for b in batches for o in b if isinstance(o, dict)]
            if block:
                await process_block(db, name, block, known_store_uids, dry_run, s)
            blocks_done += 1
            if any(len(b) < PAGE for b in batches):
                break
            if max_blocks and blocks_done >= max_blocks:
                break
            skip += page_concurrency * PAGE

    s["elapsed"] = round(time.time() - t0, 1)
    async with lock:
        for k in ("fetched", "new", "updated", "unchanged", "skipped"):
            stats[k] += s[k]
        stats["changes"] += s["changes"]
        stats["per_org"][name] = {
            k: s[k]
            for k in ("fetched", "new", "updated", "unchanged", "skipped", "elapsed")
        }
    print(
        f"  [{name}] {s['fetched']:,} fetched | +{s['new']} new ~{s['updated']} upd "
        f"·{s['unchanged']} unchanged ✗{s['skipped']} skip | {s['elapsed']}s",
        flush=True,
    )


async def process_block(db, name, block, known_store_uids, dry_run, s):
    # Parse the whole block, then preload existing rows in ONE query (vs per-order SELECT).
    parsed = []
    for ro in block:
        try:
            p = parse_order(ro)
        except Exception:
            s["skipped"] += 1
            continue
        if p.get("uid"):
            parsed.append(p)
    s["fetched"] += len(block)
    if not parsed:
        return

    uids = [p["uid"] for p in parsed]
    existing_rows = (
        (await db.execute(select(Order).where(Order.uid.in_(uids)))).scalars().all()
    )
    existing = {o.uid: o for o in existing_rows}

    touched = False
    for p in parsed:
        try:
            async with db.begin_nested():
                store_uid = p["store_uid"]
                if store_uid and store_uid not in known_store_uids:
                    if not dry_run:
                        await ensure_store_exists(db, store_uid)
                    known_store_uids.add(store_uid)

                row = existing.get(p["uid"])
                if row is None:
                    if dry_run:
                        s["new"] += 1
                        continue
                    row = build_new(p)
                    db.add(row)
                    await upsert_awbs(db, row, p.get("all_awbs", []))
                    s["new"] += 1
                    touched = True
                elif order_changed(row, p):
                    if dry_run:
                        s["updated"] += 1
                        continue
                    apply_update(row, p, s["changes"])
                    await upsert_awbs(db, row, p.get("all_awbs", []))
                    s["updated"] += 1
                    touched = True
                else:
                    s["unchanged"] += 1
        except Exception as e:
            s["skipped"] += 1
            if s["skipped"] <= 3:
                print(
                    f"    [{name}] skip {p.get('order_number')}: {type(e).__name__}: {str(e)[:120]}",
                    flush=True,
                )

    if touched and not dry_run:
        # Deadlock-resilient commit — retry once, then give the block up (the scheduler
        # will re-cover it). Per-order savepoints already isolated bad rows.
        for attempt in (1, 2):
            try:
                await db.commit()
                break
            except Exception as e:
                await db.rollback()
                if attempt == 2:
                    print(
                        f"    [{name}] block commit failed: {type(e).__name__}: {str(e)[:120]}",
                        flush=True,
                    )
                else:
                    await asyncio.sleep(0.3)

    # Drop this block's ORM objects so the per-org session's identity map can't grow to
    # 174k rows (esteban) over the run. Safe: no pending changes remain after commit/rollback.
    db.expunge_all()


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--org-concurrency", type=int, default=6)
    ap.add_argument("--page-concurrency", type=int, default=12)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--max-blocks", type=int, default=0, help="debug: cap blocks/org (0=unlimited)"
    )
    args = ap.parse_args()

    orgs = [o for o in settings.get_org_tokens() if o.get("token")]
    print(
        f"=== PARALLEL FULL SYNC ===  {len(orgs)} orgs | org-concurrency={args.org_concurrency} "
        f"| {args.page_concurrency} pages/org | {'DRY-RUN' if args.dry_run else 'WRITE TO LIVE DB'}\n",
        flush=True,
    )

    # Preload known stores + open the audit SyncLog row.
    async with AsyncSessionLocal() as db:
        known_store_uids = {r[0] for r in (await db.execute(select(Store.uid))).all()}
        sync_log = None
        if not args.dry_run:
            sync_log = SyncLog(status="running", sync_type="full")
            db.add(sync_log)
            await db.commit()
            sync_log_id = sync_log.id
    print(f"Known stores: {len(known_store_uids)}\n", flush=True)

    stats = {
        "fetched": 0,
        "new": 0,
        "updated": 0,
        "unchanged": 0,
        "skipped": 0,
        "changes": [],
        "per_org": {},
    }
    lock = asyncio.Lock()
    sem = asyncio.Semaphore(args.org_concurrency)
    t0 = time.time()

    async def guarded(o):
        async with sem:
            await sync_one_org(
                o,
                known_store_uids,
                args.page_concurrency,
                args.dry_run,
                stats,
                lock,
                args.max_blocks,
            )

    # Largest orgs first so the long pole starts immediately.
    ORDER = [
        "esteban.ro",
        "bonhaus.cz",
        "casaofertelor.ro",
        "georgetalent.ro",
        "ofertelezilei.ro",
        "belasil.ro",
    ]
    orgs.sort(key=lambda o: ORDER.index(o["name"]) if o.get("name") in ORDER else 99)

    await asyncio.gather(*[guarded(o) for o in orgs])
    elapsed = time.time() - t0

    # Close the audit row + clear the analytics cache (same as the canonical sync).
    if not args.dry_run:
        async with AsyncSessionLocal() as db:
            sl = (
                await db.execute(select(SyncLog).where(SyncLog.id == sync_log_id))
            ).scalar_one()
            sl.orders_fetched = stats["fetched"]
            sl.orders_new = stats["new"]
            sl.orders_updated = stats["updated"]
            sl.orders_skipped = stats["skipped"]
            sl.status = "completed"
            sl.completed_at = datetime.utcnow()
            await db.commit()
        try:
            from app.core.analytics_cache import cache_clear

            cache_clear()
        except Exception:
            pass

    print("\n" + "=" * 64)
    print(
        f"DONE in {elapsed:.1f}s  ({stats['fetched'] / max(elapsed, 0.1):,.0f} orders/s)"
    )
    print("=" * 64)
    print(f"  fetched   : {stats['fetched']:,}")
    print(f"  new       : {stats['new']:,}")
    print(f"  updated   : {stats['updated']:,}")
    print(f"  unchanged : {stats['unchanged']:,}  (already fresh — not rewritten)")
    print(f"  skipped   : {stats['skipped']:,}")
    print(f"  status changes written: {len(stats['changes']):,}")


if __name__ == "__main__":
    asyncio.run(main())
    print("\nALL DONE")
