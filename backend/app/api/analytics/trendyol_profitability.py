"""
Trendyol SALES & SETTLEMENTS profitability report.

Ported from Scripturi's ``trendyol_profitability.py::calculate_profitability``.
Computes profitability on-demand from the Trendyol seller API (no DB table):

  Încasări (per Sale)   = sellerRevenue + commissionAmount   (the "Valoarea facturii")
  − Returnări           = sellerRevenue + commissionAmount    per Return
  Comisioane            = Σ commissionAmount over Sales
  Transport             = shipping invoices (SHIPPING INVOICE-RO, RO+BG) in-period
                          + product penalty fees (WRONG/MISSING/...) in-period
  COGS                  = Σ (AWB SkuCost.cost × units sold), matched by barcode/sku
  Profit brut           = Încasări − COGS − Comisioane − Transport
  TVA de plată          = (Încasări − COGS) × tva_rate
  Profit net            = Profit brut − TVA de plată

LOAD-BEARING date-window widening (preserved from Scripturi):
  - Settlements are indexed by PAYMENT date, not order date, so we fetch ±30 days
    around the requested period and then filter by ``orderDate`` (GMT+3 ms epoch).
  - Shipping invoices are issued retroactively (~3 weeks later), so we fetch
    −14d / +45d and keep only invoices whose date lands inside the period.

CURRENCY: Trendyol RO settlements are already in RON — do NOT re-convert. If any
record reports a non-RON currency we convert via convert_to_ron_cached and surface
a note; we never re-convert RON.

If the client is not configured (TRENDYOL_* env vars missing) the endpoint returns
immediately with an inert payload + data_note.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.analytics_cache import cached_analytics
from app.core.vat import resolve_vat_rate
from app.api.exchange_rates import preload_rates, get_rate_from_cache
from app.models import SkuCost
from app.services.trendyol import TrendyolClient

router = APIRouter()
logger = logging.getLogger(__name__)

INERT_NOTE = (
    "Trendyol nu este configurat. Setează variabilele de mediu TRENDYOL_API_KEY, "
    "TRENDYOL_API_SECRET și TRENDYOL_SELLER_ID, apoi repornește backend-ul."
)


def _f(val) -> float:
    """Best-effort float; Trendyol sends numbers and occasionally null/strings."""
    try:
        return float(val or 0)
    except (TypeError, ValueError):
        return 0.0


async def _load_sku_costs(db: AsyncSession) -> dict:
    """AWB SkuCost catalog keyed by sku (already RON). Returns {sku_lower: cost}."""
    rows = (await db.execute(select(SkuCost))).scalars().all()
    costs = {}
    for r in rows:
        if r.sku:
            costs[str(r.sku).strip().lower()] = _f(r.cost)
    return costs


def _settlement_barcode(s: dict) -> str:
    return (s.get("barcode") or s.get("stockCode") or "").strip()


@router.get("/analytics/trendyol-profitability")
@cached_analytics("trendyol_profitability")
async def trendyol_profitability(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Trendyol P&L for the requested period (orderDate-filtered settlements)."""
    if not TrendyolClient.is_configured():
        return {
            "configured": False,
            "data_note": INERT_NOTE,
            "summary": {},
            "products": [],
            "period": {"start": date_from, "end": date_to},
        }

    # ── Resolve period ──
    today = datetime.now()
    if date_from and date_to:
        start_date = datetime.strptime(date_from, "%Y-%m-%d")
        end_date = datetime.strptime(date_to, "%Y-%m-%d").replace(
            hour=23, minute=59, second=59
        )
    else:
        end_date = today
        start_date = end_date - timedelta(days=30)

    client = TrendyolClient()

    # ── Settlements: fetch ±30d, filter by orderDate (payment-date vs order-date) ──
    fetch_start = start_date - timedelta(days=30)
    fetch_end = min(end_date + timedelta(days=30), today + timedelta(days=1))
    all_settlements = await client.fetch_all_settlements(fetch_start, fetch_end)

    start_ts = int(start_date.timestamp() * 1000)
    end_ts = int(end_date.timestamp() * 1000)
    settlements = []
    for s in all_settlements:
        od = s.get("orderDate")
        try:
            if od is not None and start_ts <= int(od) <= end_ts:
                settlements.append(s)
        except (TypeError, ValueError):
            continue

    # ── Shipping invoices: fetch −14d/+45d (issued retroactively), RO + BG ──
    shipping_start = start_date - timedelta(days=14)
    shipping_end = min(end_date + timedelta(days=45), today + timedelta(days=1))
    other_financials = await client.fetch_other_financials(shipping_start, shipping_end)

    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")
    transport_total = 0.0
    fees_total = 0.0
    for rec in other_financials:
        tx = (rec.get("transactionType") or "").upper()
        debt = _f(rec.get("debt"))
        td = rec.get("transactionDate")
        if not td:
            continue
        try:
            inv_date = datetime.fromtimestamp(int(td) / 1000).strftime("%Y-%m-%d")
        except (TypeError, ValueError, OSError):
            continue
        if not (start_str <= inv_date <= end_str):
            continue
        if "SHIPPING" in tx:
            transport_total += debt
        elif any(kw in tx for kw in ("WRONG", "MISSING", "DEFECTIVE", "UNSUPPLIED")):
            fees_total += debt
    transport_total += fees_total

    # ── COGS catalog + VAT rate ──
    costs = await _load_sku_costs(db)
    vat_rate = resolve_vat_rate("RO", start_date.date())

    # ── Currency: RO settlements are RON. Detect any non-RON and convert. ──
    non_ron_currencies = set()
    for s in settlements:
        cur = (s.get("currency") or "RON").upper()
        if cur and cur != "RON":
            non_ron_currencies.add(cur)
    rate_cache = {}
    if non_ron_currencies:
        rate_cache = await preload_rates(
            non_ron_currencies, (start_date.date(), end_date.date()), db
        )

    def _ron(amount: float, s: dict) -> Optional[float]:
        cur = (s.get("currency") or "RON").upper()
        if cur == "RON":
            return amount
        fx = get_rate_from_cache(cur, start_date.date(), rate_cache)
        return round(amount * fx, 2) if fx else None

    # ── Aggregate per barcode ──
    barcode_data: dict = {}
    total_returns = 0.0
    total_discounts = 0.0
    unconvertible = set()

    for s in settlements:
        barcode = _settlement_barcode(s) or "necunoscut"
        tx_type = s.get("transactionType", "")
        debt = _f(s.get("debt"))
        commission_amount = _f(s.get("commissionAmount"))
        seller_revenue = _f(s.get("sellerRevenue"))
        valoare_factura = seller_revenue + commission_amount

        d = barcode_data.setdefault(
            barcode,
            {
                "barcode": barcode,
                "sales_count": 0,
                "returns_count": 0,
                "incasari": 0.0,
                "return_amount": 0.0,
                "commission_total": 0.0,
            },
        )

        if tx_type in ("Sale", "Satış"):
            val = _ron(valoare_factura, s)
            comm = _ron(commission_amount, s)
            if val is None or comm is None:
                unconvertible.add((s.get("currency") or "?").upper())
                continue
            d["sales_count"] += 1
            d["incasari"] += val
            d["commission_total"] += comm
        elif tx_type in ("Return", "İade"):
            val = _ron(valoare_factura, s)
            if val is None:
                unconvertible.add((s.get("currency") or "?").upper())
                continue
            d["returns_count"] += 1
            d["return_amount"] += val
            total_returns += val
        elif tx_type in ("Discount", "İndirim"):
            val = _ron(debt, s)
            if val is not None:
                total_discounts += val

    # ── Per-product results + COGS matching ──
    products = []
    missing_cost_barcodes = set()
    total_incasari = 0.0
    total_cogs = 0.0
    total_commission = 0.0
    total_sales = 0
    total_returned = 0

    for barcode, d in barcode_data.items():
        key = barcode.strip().lower()
        unit_cost = costs.get(key)
        matched = unit_cost is not None
        if not matched and d["sales_count"] > 0:
            missing_cost_barcodes.add(barcode)
        unit_cost = unit_cost or 0.0

        incasari = d["incasari"]
        cogs = unit_cost * d["sales_count"]
        commission = d["commission_total"]
        profit = incasari - cogs - commission
        margin = (profit / incasari * 100) if incasari > 0 else 0.0

        total_incasari += incasari
        total_cogs += cogs
        total_commission += commission
        total_sales += d["sales_count"]
        total_returned += d["returns_count"]

        products.append(
            {
                "barcode": barcode,
                "sales_count": d["sales_count"],
                "returns_count": d["returns_count"],
                "incasari": round(incasari, 2),
                "cogs": round(cogs, 2),
                "commission": round(commission, 2),
                "return_amount": round(d["return_amount"], 2),
                "profit": round(profit, 2),
                "margin": round(margin, 1),
                "cost_matched": matched,
            }
        )

    products.sort(key=lambda p: p["profit"], reverse=True)

    # ── Summary (matches Scripturi formula) ──
    incasari_net = total_incasari - total_returns
    profit_brut = incasari_net - total_cogs - total_commission - transport_total
    tva_de_plata = (incasari_net - total_cogs) * vat_rate
    profit_net = profit_brut - tva_de_plata
    margin = (profit_net / incasari_net * 100) if incasari_net > 0 else 0.0

    summary = {
        "incasari": round(total_incasari, 2),
        "returnari": round(total_returns, 2),
        "incasari_net": round(incasari_net, 2),
        "cogs": round(total_cogs, 2),
        "comisioane": round(total_commission, 2),
        "transport": round(transport_total, 2),
        "profit_brut": round(profit_brut, 2),
        "tva_de_plata": round(tva_de_plata, 2),
        "profit_net": round(profit_net, 2),
        "margin": round(margin, 1),
        "reduceri": round(total_discounts, 2),
        "sales_count": total_sales,
        "returns_count": total_returned,
        "vat_rate": vat_rate,
    }

    notes = []
    if missing_cost_barcodes:
        notes.append(
            f"{len(missing_cost_barcodes)} barcode-uri Trendyol nu au cost SKU în "
            f"catalog (COGS=0 pentru ele) — adaugă-le în Costuri SKU pentru un profit corect."
        )
    if unconvertible:
        notes.append(
            "Valute neconvertibile (lipsă curs BNR): "
            + ", ".join(sorted(unconvertible))
            + ". Înregistrările respective au fost ignorate."
        )

    return {
        "configured": True,
        "summary": summary,
        "products": products[:200],
        "period": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d"),
        },
        "missing_cost_count": len(missing_cost_barcodes),
        "currency": "RON",
        "data_note": " ".join(notes) if notes else None,
    }
