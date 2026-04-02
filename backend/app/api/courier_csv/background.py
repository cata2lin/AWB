"""
Background CSV processing — streaming file reader, batch DB matching, and progress tracking.

Enhanced for multi-AWB support with 3-tier matching:
  Tier 1: Match AWB against order_awbs.tracking_number (existing)
  Tier 2: Match AWB against orders.tracking_number, create OrderAwb
  Tier 3: Match by order_ref against orders.order_number, create OrderAwb
"""
import csv
import os
import logging
from typing import Optional, Dict, Callable, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Order, CourierCsvImport
from app.models.order_awb import OrderAwb
from app.api.courier_csv.parsers import parse_row_data

logger = logging.getLogger(__name__)

# Processing constants
AWB_BATCH_SIZE = 500         # AWBs per DB batch (keep < 1000 for SQL param limits)
SQL_SUB_BATCH = 400          # Max items in a single IN clause
COMMIT_INTERVAL = 2000       # Commit every N matched rows
PROGRESS_UPDATE_INTERVAL = 2000  # Update progress every N rows read


def _sub_batches(items: list, size: int = SQL_SUB_BATCH):
    """Yield sub-batches of a list to avoid SQL IN clause parameter overflow."""
    for i in range(0, len(items), size):
        yield items[i:i + size]


async def process_csv_background(import_id: int, file_path: str,
                                  delimiter: str, awb_idx: int,
                                  pkg_idx, wgt_idx, cost_idx,
                                  encoding: str = 'utf-8-sig',
                                  awb_transform: Optional[Callable] = None,
                                  cost_transform: Optional[Callable] = None,
                                  # --- NEW optional indices ---
                                  order_ref_idx: Optional[int] = None,
                                  awb_type_idx: Optional[int] = None,
                                  original_awb_idx: Optional[int] = None,
                                  cost_fara_tva_idx: Optional[int] = None,
                                  cost_tva_idx: Optional[int] = None,
                                  cost_currency_idx: Optional[int] = None,
                                  content_idx: Optional[int] = None,
                                  status_idx: Optional[int] = None,
                                  order_ref_transform: Optional[Callable] = None,
                                  awb_type_transform: Optional[Callable] = None,
                                  courier_key: Optional[str] = None,
                                  delete_file_after: bool = True,
                                  ):
    """
    Background task that processes the CSV file in streaming fashion.
    Uses its own DB session (not tied to HTTP request lifecycle).
    """
    from app.core.database import AsyncSessionLocal

    total_rows = 0
    matched_rows = 0
    created_rows = 0
    skipped_manual = 0
    errors = 0
    awb_batch: Dict[str, dict] = {}
    uncommitted_matches = 0
    affected_order_ids = set()

    async with AsyncSessionLocal() as db:
        try:
            with open(file_path, 'r', encoding=encoding, errors='replace') as f:
                reader = csv.reader(f, delimiter=delimiter)

                try:
                    next(reader)  # skip header
                except StopIteration:
                    await _update_import_status(db, import_id, 'failed',
                                                error_message='CSV file is empty')
                    return

                for row in reader:
                    total_rows += 1

                    try:
                        awb, data = parse_row_data(
                            row, awb_idx, pkg_idx, wgt_idx, cost_idx,
                            awb_transform=awb_transform,
                            cost_transform=cost_transform,
                            order_ref_idx=order_ref_idx,
                            awb_type_idx=awb_type_idx,
                            original_awb_idx=original_awb_idx,
                            cost_fara_tva_idx=cost_fara_tva_idx,
                            cost_tva_idx=cost_tva_idx,
                            cost_currency_idx=cost_currency_idx,
                            content_idx=content_idx,
                            status_idx=status_idx,
                            order_ref_transform=order_ref_transform,
                            awb_type_transform=awb_type_transform,
                            courier_key=courier_key,
                        )
                    except Exception:
                        errors += 1
                        continue

                    if awb is None:
                        continue

                    awb_batch[awb] = data

                    if len(awb_batch) >= AWB_BATCH_SIZE:
                        m, c, s, oids = await _flush_awb_batch(db, awb_batch, courier_key)
                        matched_rows += m
                        created_rows += c
                        skipped_manual += s
                        affected_order_ids.update(oids)
                        uncommitted_matches += m + c
                        awb_batch.clear()

                        if uncommitted_matches >= COMMIT_INTERVAL:
                            await db.commit()
                            uncommitted_matches = 0

                    if total_rows % PROGRESS_UPDATE_INTERVAL == 0:
                        await _update_import_progress(db, import_id, total_rows, matched_rows + created_rows)

                # Flush remaining
                if awb_batch:
                    m, c, s, oids = await _flush_awb_batch(db, awb_batch, courier_key)
                    matched_rows += m
                    created_rows += c
                    skipped_manual += s
                    affected_order_ids.update(oids)

                # Recalculate transport costs for all affected orders
                if affected_order_ids:
                    await _recalculate_order_transport_costs(db, affected_order_ids)
                    logger.info(f"Recalculated transport costs for {len(affected_order_ids)} orders")

                await db.commit()

            total_matched = matched_rows + created_rows
            await _update_import_status(
                db, import_id, 'completed',
                total_rows=total_rows,
                matched_rows=total_matched,
                unmatched_rows=total_rows - total_matched - skipped_manual - errors,
            )
            logger.info(
                f"CSV import #{import_id} completed: "
                f"{total_rows} rows, {matched_rows} matched existing, "
                f"{created_rows} new AWBs created, "
                f"{skipped_manual} skipped (manual), {errors} errors"
            )

        except Exception as e:
            logger.exception(f"CSV import #{import_id} failed: {e}")
            try:
                await db.rollback()
                await _update_import_status(db, import_id, 'failed',
                                            total_rows=total_rows,
                                            matched_rows=matched_rows + created_rows,
                                            error_message=str(e)[:500])
            except Exception:
                pass

        finally:
            if delete_file_after:
                try:
                    os.unlink(file_path)
                except OSError:
                    pass


async def _flush_awb_batch(db: AsyncSession, awb_batch: Dict[str, dict],
                            courier_key: Optional[str] = None) -> tuple:
    """
    Match a batch of AWBs with 3-tier matching.
    Returns (matched_count, created_count, skipped_manual_count, affected_order_ids).
    """
    awb_list = list(awb_batch.keys())
    matched = 0
    created = 0
    skipped = 0
    affected_order_ids = set()

    # ── Tier 1: Match against order_awbs.tracking_number ──
    existing_awb_map = {}
    for sub in _sub_batches(awb_list):
        result = await db.execute(
            select(OrderAwb).where(OrderAwb.tracking_number.in_(sub))
        )
        for oa in result.scalars().all():
            existing_awb_map[oa.tracking_number] = oa

    # Load related orders to check shipping_data_manual
    order_ids = list({oa.order_id for oa in existing_awb_map.values()})
    orders_map = {}
    if order_ids:
        for sub in _sub_batches(order_ids):
            result = await db.execute(select(Order).where(Order.id.in_(sub)))
            for o in result.scalars().all():
                orders_map[o.id] = o

    # Process Tier 1 matches
    matched_awbs = set()
    for tracking, order_awb in existing_awb_map.items():
        order = orders_map.get(order_awb.order_id)
        if not order:
            continue
        if order.shipping_data_manual:
            skipped += 1
            matched_awbs.add(tracking)
            continue
        data = awb_batch.get(tracking, {})
        if data:
            _apply_data_to_order_awb(order_awb, data, courier_key)
            affected_order_ids.add(order_awb.order_id)
            matched += 1
            matched_awbs.add(tracking)

    # ── Tier 2 & 3: Handle unmatched AWBs ──
    unmatched = {awb: data for awb, data in awb_batch.items() if awb not in matched_awbs}

    if unmatched:
        t2_created, t2_matched_awbs, t2_oids = await _tier2_match(db, unmatched, courier_key)
        created += t2_created
        affected_order_ids.update(t2_oids)

        # Remove Tier 2 matches from unmatched
        still_unmatched = {awb: d for awb, d in unmatched.items() if awb not in t2_matched_awbs}

        if still_unmatched:
            t3_created, t3_oids = await _tier3_match(db, still_unmatched, courier_key)
            created += t3_created
            affected_order_ids.update(t3_oids)

    return matched, created, skipped, affected_order_ids


async def _tier2_match(db: AsyncSession, unmatched: Dict[str, dict],
                        courier_key: Optional[str]) -> tuple:
    """
    Tier 2: Match AWBs against orders.tracking_number → create OrderAwb.
    Returns (created_count, matched_awb_set, affected_order_ids).
    """
    awb_list = list(unmatched.keys())
    created = 0
    matched_awbs = set()
    affected = set()

    order_by_tracking = {}
    for sub in _sub_batches(awb_list):
        result = await db.execute(
            select(Order).where(Order.tracking_number.in_(sub))
        )
        for o in result.scalars().all():
            if o.tracking_number and not o.shipping_data_manual:
                order_by_tracking[o.tracking_number] = o

    for awb, data in unmatched.items():
        order = order_by_tracking.get(awb)
        if not order:
            continue

        matched_awbs.add(awb)
        new_awb = OrderAwb(
            order_id=order.id,
            tracking_number=awb,
            courier_name=order.courier_name or (courier_key.upper() if courier_key else None),
            awb_type=data.get('awb_type', 'outbound'),
            data_source='csv_import',
        )
        _apply_data_to_order_awb(new_awb, data, courier_key)
        db.add(new_awb)
        created += 1
        affected.add(order.id)

    return created, matched_awbs, affected


async def _tier3_match(db: AsyncSession, unmatched: Dict[str, dict],
                        courier_key: Optional[str]) -> tuple:
    """
    Tier 3: Match by order_ref against orders.order_number → create OrderAwb.
    Returns (created_count, affected_order_ids).
    """
    # Collect order refs from CSV data
    ref_to_awbs: Dict[str, List[tuple]] = {}
    for awb, data in unmatched.items():
        ref = data.get('order_ref')
        if ref:
            ref_to_awbs.setdefault(ref, []).append((awb, data))

    if not ref_to_awbs:
        return 0, set()

    created = 0
    affected = set()
    ref_list = list(ref_to_awbs.keys())

    # Batch-query orders by order_number
    order_by_ref = {}
    for sub in _sub_batches(ref_list):
        result = await db.execute(
            select(Order).where(Order.order_number.in_(sub))
        )
        for o in result.scalars().all():
            if o.order_number and not o.shipping_data_manual:
                order_by_ref[o.order_number] = o

    for ref, awb_list in ref_to_awbs.items():
        order = order_by_ref.get(ref)
        if not order:
            continue

        for awb, data in awb_list:
            new_awb = OrderAwb(
                order_id=order.id,
                tracking_number=awb,
                courier_name=order.courier_name or (courier_key.upper() if courier_key else None),
                awb_type=data.get('awb_type', 'outbound'),
                data_source='csv_import',
            )
            _apply_data_to_order_awb(new_awb, data, courier_key)
            db.add(new_awb)
            created += 1
            affected.add(order.id)

    return created, affected


def _apply_data_to_order_awb(order_awb: OrderAwb, data: dict, courier_key: Optional[str] = None):
    """Apply parsed CSV data to an OrderAwb record."""
    if 'package_count' in data:
        order_awb.package_count = data['package_count']
    if 'package_weight' in data:
        order_awb.package_weight = data['package_weight']
    if 'transport_cost' in data:
        order_awb.transport_cost = data['transport_cost']
    if 'transport_cost_fara_tva' in data:
        order_awb.transport_cost_fara_tva = data['transport_cost_fara_tva']
    if 'transport_cost_tva' in data:
        order_awb.transport_cost_tva = data['transport_cost_tva']
    if 'currency' in data:
        order_awb.currency = data['currency']
    if 'order_ref' in data:
        order_awb.order_ref = data['order_ref']
    if 'original_awb' in data:
        order_awb.original_awb = data['original_awb']
    if 'awb_type' in data:
        order_awb.awb_type = data['awb_type']
    if 'csv_status' in data:
        order_awb.csv_status = data['csv_status']
    order_awb.data_source = 'csv_import'


async def _recalculate_order_transport_costs(db: AsyncSession, order_ids: set):
    """
    Recalculate Order.transport_cost = SUM(billable outbound AWB costs).
    
    Only AWBs with billable csv_status are included. AWBs that were created
    but never picked up (status 0/1), cancelled (7), or closed internally (8)
    are excluded from the transport cost sum.
    """
    from app.models.order_awb import is_billable_status
    
    if not order_ids:
        return

    oid_list = list(order_ids)

    # Fetch all outbound AWBs with costs, then filter by billable status in Python
    # (can't use Python functions in SQL WHERE clauses)
    cost_sums = {}
    excluded_counts = {}
    
    for sub in _sub_batches(oid_list):
        result = await db.execute(
            select(OrderAwb)
            .where(OrderAwb.order_id.in_(sub))
            .where(OrderAwb.awb_type == 'outbound')
            .where(OrderAwb.transport_cost.isnot(None))
        )
        for awb in result.scalars().all():
            if is_billable_status(awb.csv_status):
                cost_sums[awb.order_id] = cost_sums.get(awb.order_id, 0) + awb.transport_cost
            else:
                excluded_counts[awb.order_id] = excluded_counts.get(awb.order_id, 0) + 1
                logger.info(
                    f"[CSV] Excluding non-billable AWB {awb.tracking_number} "
                    f"(status='{awb.csv_status}', cost={awb.transport_cost}) "
                    f"from order_id={awb.order_id}"
                )
    
    if excluded_counts:
        total_excluded = sum(excluded_counts.values())
        logger.info(f"[CSV] Excluded {total_excluded} non-billable AWBs across {len(excluded_counts)} orders")

    # Update orders
    for sub in _sub_batches(oid_list):
        result = await db.execute(select(Order).where(Order.id.in_(sub)))
        for order in result.scalars().all():
            total_cost = cost_sums.get(order.id)
            if total_cost is not None:
                order.transport_cost = round(total_cost, 2)
                order.shipping_data_source = 'csv_import'
            elif order.id in excluded_counts and order.id not in cost_sums:
                # All AWBs were non-billable → set cost to 0
                order.transport_cost = 0
                order.shipping_data_source = 'csv_import'


async def _update_import_status(db: AsyncSession, import_id: int, status: str,
                                 total_rows: int = None, matched_rows: int = None,
                                 unmatched_rows: int = None, error_message: str = None):
    """Update the import log record with final status."""
    result = await db.execute(
        select(CourierCsvImport).where(CourierCsvImport.id == import_id)
    )
    imp = result.scalar_one_or_none()
    if imp:
        imp.status = status
        if total_rows is not None:
            imp.total_rows = total_rows
        if matched_rows is not None:
            imp.matched_rows = matched_rows
        if unmatched_rows is not None:
            imp.unmatched_rows = unmatched_rows
        if error_message:
            imp.error_message = error_message
        await db.commit()


async def _update_import_progress(db: AsyncSession, import_id: int,
                                   total_rows: int, matched_rows: int):
    """Lightweight progress update during processing."""
    try:
        result = await db.execute(
            select(CourierCsvImport).where(CourierCsvImport.id == import_id)
        )
        imp = result.scalar_one_or_none()
        if imp:
            imp.total_rows = total_rows
            imp.matched_rows = matched_rows
            await db.commit()
    except Exception:
        pass
