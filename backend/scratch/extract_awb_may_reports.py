"""
Extract AWB's OWN computed reports for a month (default 2026-05) by calling the
analytics endpoint functions internally (no HTTP server needed) and dump to JSON.

Reports: profitability (P&L), deliverability (Livrabilitate), product-deliverability
(problems per SKU), sales-velocity, sku-risk. Used to compare 1:1 against Scripturi's
own report output for the same month.

Run: cd backend && ./venv/Scripts/python.exe -u scratch/extract_awb_may_reports.py [YYYY-MM]
"""

import sys
import json
import asyncio

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.api.analytics.profitability import get_overall_profitability  # noqa: E402
from app.api.analytics.deliverability import get_deliverability_stats  # noqa: E402
from app.api.analytics.product_deliverability import get_product_deliverability  # noqa: E402
from app.api.sales_velocity.endpoint import get_sales_velocity  # noqa: E402
from app.api.sku_risk.endpoint import get_sku_risk  # noqa: E402


def _month_bounds(month: str):
    y, m = month.split("-")
    y, m = int(y), int(m)
    nm = f"{y + 1}-01-01" if m == 12 else f"{y}-{m + 1:02d}-01"
    # date_to is inclusive YYYY-MM-DD in these endpoints; use last day of month
    import calendar

    last = calendar.monthrange(y, m)[1]
    return f"{y}-{m:02d}-01", f"{y}-{m:02d}-{last:02d}", nm


async def main():
    month = sys.argv[1] if len(sys.argv) > 1 else "2026-05"
    d_from, d_to, _ = _month_bounds(month)
    print(f"AWB reports for {month}  ({d_from} .. {d_to})", flush=True)
    out = {"month": month, "date_from": d_from, "date_to": d_to}

    async with AsyncSessionLocal() as db:

        async def safe(name, coro):
            try:
                r = await coro
                print(f"  ✓ {name}", flush=True)
                return r
            except Exception as e:
                import traceback

                print(f"  ✗ {name}: {type(e).__name__}: {e}", flush=True)
                traceback.print_exc()
                return {"_error": f"{type(e).__name__}: {e}"}

        out["profitability"] = await safe(
            "profitability",
            get_overall_profitability(db=db, date_from=d_from, date_to=d_to, days=None),
        )
        out["deliverability"] = await safe(
            "deliverability",
            get_deliverability_stats(db=db, date_from=d_from, date_to=d_to, days=None),
        )
        out["product_deliverability"] = await safe(
            "product_deliverability",
            get_product_deliverability(
                db=db,
                store_uids=None,
                exclude_store_uids=None,
                date_from=d_from,
                date_to=d_to,
                days=None,
                min_orders=5,
            ),
        )
        out["sales_velocity"] = await safe(
            "sales_velocity",
            get_sales_velocity(
                db=db,
                days=31,
                date_from=d_from,
                date_to=d_to,
                store_uids=None,
                country_code=None,
                min_units=1,
                min_stock=None,
                max_stock=None,
                min_days_left=None,
                max_days_left=None,
            ),
        )
        out["sku_risk"] = await safe(
            "sku_risk",
            get_sku_risk(
                db=db,
                days=31,
                date_from=d_from,
                date_to=d_to,
                store_uids=None,
                courier_name=None,
                country_code=None,
                min_units_sold=30,
                min_orders_with_sku=20,
                include_delivery_problems=True,
                shipping_cost_pct_threshold=0.25,
                z_score_threshold=2.0,
            ),
        )

    path = rf"c:/tmp/awb_{month.replace('-', '_')}_reports.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, default=str, ensure_ascii=False)
    print(f"\nWROTE {path}", flush=True)

    # quick top-line echo
    prof = out.get("profitability") or {}
    deliv = out.get("deliverability") or {}
    print(
        "  profitability keys:",
        list(prof.keys())[:12] if isinstance(prof, dict) else type(prof),
    )
    print(
        "  deliverability keys:",
        list(deliv.keys())[:12] if isinstance(deliv, dict) else type(deliv),
    )


if __name__ == "__main__":
    asyncio.run(main())
    print("DONE")
