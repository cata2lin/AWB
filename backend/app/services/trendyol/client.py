"""
Async Trendyol seller-API client.

Ported from Scripturi's ``core/trendyol_client.py`` + ``trendyol_profitability.py``.
This is a thin, read-only client for the profitability report: orders, settlements,
and "other financials" (shipping invoices). Write operations (split, unsupply,
claims, Q&A, labels) are intentionally NOT ported — out of scope.

LOAD-BEARING QUIRKS (do not "clean up"):
  - Auth is HTTP Basic over base64(apiKey:apiSecret). We build the token from the
    two secrets so only the raw key/secret need to live in the env.
  - User-Agent MUST be ``"{seller_id} - SelfIntegration"`` or Trendyol returns 403.
  - Order endpoints OMIT storeFrontCode so BOTH RO and BG packages come back.
  - Settlements / otherfinancials REQUIRE storeFrontCode, must send transactionType
    ONE AT A TIME (comma-separated → 400), and size MUST be exactly 500.
  - Orders API returns wrong results for windows > 7 days → 7-day chunks.
  - Finance API max window is ~15 days → 14-day chunks.
  - Dedup orders on shipmentPackageId (each row is a package/colet, not an order).

Credentials come from env ONLY (TRENDYOL_API_KEY / _SECRET / _SELLER_ID). The
client is "configured" only if all three are present; otherwise it is inert and
the report short-circuits with a data_note.
"""

import asyncio
import base64
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# Orders API gives incorrect results with > 7 day windows.
MAX_ORDER_WINDOW_DAYS = 7
# Finance API max ~15 days per request.
MAX_FINANCE_WINDOW_DAYS = 14
# Finance API only accepts size=500 (smaller → 400).
FINANCE_PAGE_SIZE = 500
ORDER_PAGE_SIZE = 200
# Stay well under 50 req / 10 s.
RATE_LIMIT_DELAY = 0.5

# Settlement transaction types relevant to profitability (Scripturi's set).
SETTLEMENT_TRANSACTION_TYPES = [
    "Sale",
    "Return",
    "Discount",
    "DiscountCancel",
    "Coupon",
    "CouponCancel",
    "CommissionNegative",
    "CommissionPositive",
    "SellerRevenuePositive",
    "SellerRevenueNegative",
    "DeliveryFee",
]

# otherfinancials transaction types that actually return useful data.
# Shipping invoices arrive under DeductionInvoices as "SHIPPING INVOICE-RO".
OTHER_FINANCIAL_TYPES = [
    "DeductionInvoices",
    "ReturnInvoice",
    "CommissionInvoice",
    "CreditNote",
    "FinancialItem",
]


class TrendyolClient:
    """Stateless async Trendyol seller-API client (read-only, profitability scope)."""

    BASE_URL = "https://apigw.trendyol.com"

    def __init__(
        self,
        seller_id: Optional[str] = None,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
    ):
        self.seller_id = seller_id or os.getenv("TRENDYOL_SELLER_ID", "")
        self.api_key = api_key or os.getenv("TRENDYOL_API_KEY", "")
        self.api_secret = api_secret or os.getenv("TRENDYOL_API_SECRET", "")
        self.integration_base = f"{self.BASE_URL}/integration"

    @classmethod
    def is_configured(cls) -> bool:
        """True only when all three credentials are present in the environment."""
        return all(
            os.getenv(k)
            for k in ("TRENDYOL_API_KEY", "TRENDYOL_API_SECRET", "TRENDYOL_SELLER_ID")
        )

    # ─── Auth / headers ───────────────────────────────────────────────

    def _token(self) -> str:
        raw = f"{self.api_key}:{self.api_secret}".encode("utf-8")
        return base64.b64encode(raw).decode("ascii")

    def _base_headers(self) -> Dict[str, str]:
        # User-Agent is MANDATORY — Trendyol returns 403 without this exact format.
        return {
            "Authorization": f"Basic {self._token()}",
            "Content-Type": "application/json",
            "User-Agent": f"{self.seller_id} - SelfIntegration",
        }

    def _order_headers(self) -> Dict[str, str]:
        """No storeFrontCode → both RO and BG packages are returned."""
        return self._base_headers()

    def _finance_headers(self, store_front_code: str) -> Dict[str, str]:
        """Finance endpoints require storeFrontCode."""
        return {**self._base_headers(), "storeFrontCode": store_front_code}

    @staticmethod
    def _epoch_ms(dt: datetime) -> int:
        return int(dt.timestamp() * 1000)

    # ─── Low-level GET with rate limiting + tolerant error handling ───

    async def _get(
        self,
        client: httpx.AsyncClient,
        url: str,
        params: dict,
        headers: dict,
        label: str = "",
    ) -> Optional[dict]:
        """GET that returns parsed JSON or None. Never raises on HTTP errors.

        Trendyol returns 400/500 for unsupported (type, storefront) combos and 429
        on rate-limit; we log quietly and treat as "no data" so one bad window
        doesn't abort the whole report.
        """
        await asyncio.sleep(RATE_LIMIT_DELAY)
        try:
            r = await client.get(url, params=params, headers=headers)
        except httpx.RequestError as e:
            logger.warning("[Trendyol] request error %s: %s", label, e)
            return None
        if r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return None
        if r.status_code == 429:
            logger.warning("[Trendyol] 429 rate-limited on %s", label)
            await asyncio.sleep(5)
            return None
        # 400/500/556 → unsupported combo / cloudflare; quiet.
        logger.debug("[Trendyol] %s → HTTP %s", label, r.status_code)
        return None

    # ─── Orders ───────────────────────────────────────────────────────

    async def fetch_orders(
        self, start_date: datetime, end_date: datetime
    ) -> List[dict]:
        """Fetch shipment packages (colete) in [start_date, end_date].

        7-day windows (orders API is inaccurate for wider ranges); dedup on
        shipmentPackageId across windows. No storeFrontCode → RO + BG both return.
        """
        all_orders: List[dict] = []
        seen_ids = set()
        url = f"{self.integration_base}/order/sellers/{self.seller_id}/orders"

        async with httpx.AsyncClient(timeout=60.0) as client:
            window_start = start_date
            while window_start < end_date:
                window_end = min(
                    window_start + timedelta(days=MAX_ORDER_WINDOW_DAYS), end_date
                )
                page = 0
                while page < 500:
                    data = await self._get(
                        client,
                        url,
                        params={
                            "startDate": self._epoch_ms(window_start),
                            "endDate": self._epoch_ms(window_end),
                            "page": page,
                            "size": ORDER_PAGE_SIZE,
                            "orderByField": "PackageLastModifiedDate",
                            "orderByDirection": "DESC",
                        },
                        headers=self._order_headers(),
                        label=f"orders {window_start.date()}..{window_end.date()} p{page}",
                    )
                    content = (data or {}).get("content") or []
                    if not content:
                        break
                    for order in content:
                        oid = (
                            order.get("shipmentPackageId")
                            or order.get("orderNumber")
                            or id(order)
                        )
                        if oid not in seen_ids:
                            seen_ids.add(oid)
                            all_orders.append(order)
                    if page >= (data or {}).get("totalPages", 1) - 1:
                        break
                    page += 1
                window_start = window_end

        logger.info("[Trendyol] fetched %d packages", len(all_orders))
        return all_orders

    # ─── Settlements ──────────────────────────────────────────────────

    async def fetch_settlements(
        self,
        start_date: datetime,
        end_date: datetime,
        transaction_type: str,
        store_front_code: str = "RO",
    ) -> List[dict]:
        """Fetch settlement records for ONE transactionType in [start, end].

        14-day windows, size=500, storeFrontCode required. Sending more than one
        transactionType per call returns 400, so callers loop over types.
        """
        all_records: List[dict] = []
        url = (
            f"{self.integration_base}/finance/che/sellers/{self.seller_id}/settlements"
        )
        headers = self._finance_headers(store_front_code)

        async with httpx.AsyncClient(timeout=60.0) as client:
            window_start = start_date
            while window_start < end_date:
                window_end = min(
                    window_start + timedelta(days=MAX_FINANCE_WINDOW_DAYS), end_date
                )
                page = 0
                while page < 500:
                    data = await self._get(
                        client,
                        url,
                        params={
                            "startDate": self._epoch_ms(window_start),
                            "endDate": self._epoch_ms(window_end),
                            "transactionType": transaction_type,
                            "page": page,
                            "size": FINANCE_PAGE_SIZE,
                        },
                        headers=headers,
                        label=f"settlements/{transaction_type} "
                        f"{window_start.date()}..{window_end.date()} p{page}",
                    )
                    content = (data or {}).get("content") or []
                    if not content:
                        break
                    all_records.extend(content)
                    if page >= (data or {}).get("totalPages", 1) - 1:
                        break
                    page += 1
                window_start = window_end
        return all_records

    async def fetch_all_settlements(
        self,
        start_date: datetime,
        end_date: datetime,
        transaction_types: Optional[List[str]] = None,
        store_front_code: str = "RO",
    ) -> List[dict]:
        """Fetch every relevant transactionType (one call per type) and concat."""
        types = transaction_types or SETTLEMENT_TRANSACTION_TYPES
        records: List[dict] = []
        for tx_type in types:
            records.extend(
                await self.fetch_settlements(
                    start_date, end_date, tx_type, store_front_code=store_front_code
                )
            )
        logger.info("[Trendyol] fetched %d settlement records", len(records))
        return records

    # ─── Other financials (shipping invoices) ─────────────────────────

    async def fetch_other_financials(
        self,
        start_date: datetime,
        end_date: datetime,
        storefronts: Optional[List[str]] = None,
    ) -> List[dict]:
        """Fetch otherfinancials for BOTH RO and BG storefronts.

        Shipping invoices come back under DeductionInvoices with
        transactionType="SHIPPING INVOICE-RO" for BOTH RO and BG packages — Bulgaria
        shipping is only visible by querying the BG storefront too. Each record is
        tagged with ``_storefront``.
        """
        storefronts = storefronts or ["RO", "BG"]
        all_records: List[dict] = []
        url = f"{self.integration_base}/finance/che/sellers/{self.seller_id}/otherfinancials"

        async with httpx.AsyncClient(timeout=60.0) as client:
            for storefront in storefronts:
                headers = self._finance_headers(storefront)
                window_start = start_date
                while window_start < end_date:
                    window_end = min(
                        window_start + timedelta(days=MAX_FINANCE_WINDOW_DAYS), end_date
                    )
                    for tx_type in OTHER_FINANCIAL_TYPES:
                        data = await self._get(
                            client,
                            url,
                            params={
                                "startDate": self._epoch_ms(window_start),
                                "endDate": self._epoch_ms(window_end),
                                "transactionType": tx_type,
                                "page": 0,
                                "size": FINANCE_PAGE_SIZE,
                            },
                            headers=headers,
                            label=f"otherfinancials/{tx_type}[{storefront}]",
                        )
                        for rec in (data or {}).get("content") or []:
                            rec["_storefront"] = storefront
                            all_records.append(rec)
                    window_start = window_end
        return all_records
