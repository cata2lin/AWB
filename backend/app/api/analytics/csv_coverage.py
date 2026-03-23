"""CSV coverage gap detection — find periods missing courier cost data."""
from datetime import datetime, timedelta
from collections import defaultdict

from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db


async def get_csv_coverage_gaps(
    db: AsyncSession = Depends(get_db),
    months: int = 6,
):
    """
    Analyze orders by courier and week to find periods where
    transport cost data is missing (no CSV import coverage).

    Returns gaps grouped by courier, with consecutive missing weeks
    merged into date ranges for cleaner display.
    """
    cutoff = datetime.utcnow() - timedelta(days=months * 30)

    # Raw SQL avoids asyncpg parameter binding issues with CASE expressions
    sql = text("""
        SELECT
            courier_name,
            date_trunc('week', frisbo_created_at) AS week_start,
            COUNT(*) AS total_orders,
            COUNT(*) FILTER (WHERE transport_cost IS NOT NULL AND transport_cost > 0) AS orders_with_cost
        FROM orders
        WHERE courier_name IS NOT NULL
          AND courier_name != ''
          AND frisbo_created_at >= :cutoff
          AND aggregated_status NOT IN ('cancelled', 'voided')
        GROUP BY courier_name, date_trunc('week', frisbo_created_at)
        ORDER BY courier_name, date_trunc('week', frisbo_created_at)
    """)

    result = await db.execute(sql, {"cutoff": cutoff})
    rows = result.all()

    # Collect weeks with missing costs per courier
    courier_weeks = defaultdict(list)
    for row in rows:
        with_cost = int(row.orders_with_cost or 0)
        missing = row.total_orders - with_cost
        if missing > 0:
            courier_weeks[row.courier_name].append({
                'week_start': row.week_start,
                'total_orders': row.total_orders,
                'orders_with_cost': with_cost,
                'orders_missing_cost': missing,
            })

    # Merge consecutive weeks into date ranges per courier
    gaps_by_courier = []
    for courier, weeks in sorted(courier_weeks.items()):
        merged = []
        cur = None
        for w in weeks:
            ws = w['week_start']
            if cur is None:
                cur = {
                    'date_from': ws,
                    'date_to': ws + timedelta(days=6),
                    'total_orders': w['total_orders'],
                    'orders_with_cost': w['orders_with_cost'],
                    'orders_missing_cost': w['orders_missing_cost'],
                    'weeks': 1,
                }
            elif (ws - cur['date_to']).days <= 8:
                cur['date_to'] = ws + timedelta(days=6)
                cur['total_orders'] += w['total_orders']
                cur['orders_with_cost'] += w['orders_with_cost']
                cur['orders_missing_cost'] += w['orders_missing_cost']
                cur['weeks'] += 1
            else:
                merged.append(cur)
                cur = {
                    'date_from': ws,
                    'date_to': ws + timedelta(days=6),
                    'total_orders': w['total_orders'],
                    'orders_with_cost': w['orders_with_cost'],
                    'orders_missing_cost': w['orders_missing_cost'],
                    'weeks': 1,
                }
        if cur:
            merged.append(cur)

        # Format dates for JSON and compute coverage %
        for r in merged:
            r['date_from'] = r['date_from'].strftime('%Y-%m-%d')
            r['date_to'] = r['date_to'].strftime('%Y-%m-%d')
            t = r['total_orders']
            r['coverage_pct'] = round(r['orders_with_cost'] / t * 100, 1) if t > 0 else 0

        total_missing = sum(r['orders_missing_cost'] for r in merged)
        gaps_by_courier.append({
            'courier_name': courier,
            'gap_count': len(merged),
            'total_orders_missing': total_missing,
            'gaps': merged,
        })

    # Worst gaps first
    gaps_by_courier.sort(key=lambda x: x['total_orders_missing'], reverse=True)

    return {
        'couriers': gaps_by_courier,
        'total_couriers_with_gaps': len(gaps_by_courier),
        'analysis_months': months,
    }
