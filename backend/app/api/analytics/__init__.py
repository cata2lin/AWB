"""
Analytics API package — splits the analytics endpoints into focused modules.

- summary.py          → get_analytics() + get_quick_summary()
- geographic.py       → get_geographic_stats()
- deliverability.py   → get_deliverability_stats()
- profitability.py    → get_profitability_stats() [P&L, the big one]
- profitability_orders.py → get_order_profitability() [per-order audit]
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.analytics.summary import get_analytics, get_quick_summary
from app.api.analytics.geographic import get_geographic_stats
from app.api.analytics.deliverability import get_deliverability_stats
from app.api.analytics.profitability import get_overall_profitability
from app.api.analytics.profitability_orders import get_order_profitability
from app.api.analytics.csv_coverage import get_csv_coverage_gaps
from app.core.database import get_db

router = APIRouter(prefix="/analytics", tags=["analytics"])

# Register all endpoint functions directly onto the combined router
router.add_api_route("", get_analytics, methods=["GET"])
router.add_api_route("/summary", get_quick_summary, methods=["GET"])
router.add_api_route("/geographic", get_geographic_stats, methods=["GET"])
router.add_api_route("/deliverability", get_deliverability_stats, methods=["GET"])
router.add_api_route("/profitability", get_overall_profitability, methods=["GET"])
router.add_api_route("/profitability/orders", get_order_profitability, methods=["GET"])
router.add_api_route("/csv-coverage-gaps", get_csv_coverage_gaps, methods=["GET"])


async def sync_marketing_costs_endpoint(
    date_from: str = Query(None, description="Start date YYYY-MM-DD"),
    date_to: str = Query(None, description="End date YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
):
    """Sync marketing costs from Google Sheets CPA spreadsheet into DB cache."""
    from app.services.google_sheets import sync_marketing_costs
    
    if date_from:
        d_from = datetime.strptime(date_from, "%Y-%m-%d").date()
    else:
        d_from = datetime.utcnow().date().replace(day=1)
    
    if date_to:
        d_to = datetime.strptime(date_to, "%Y-%m-%d").date()
    else:
        d_to = datetime.utcnow().date()
    
    result = await sync_marketing_costs(db, d_from, d_to)
    return {"status": "ok", **result}

router.add_api_route("/marketing/sync", sync_marketing_costs_endpoint, methods=["POST"])
