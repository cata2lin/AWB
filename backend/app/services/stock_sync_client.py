"""
Read-only client for the stock-sync v2 API (master stock + per-store allocation).

stock-sync is the source of truth for stock since the July 2026 cutover —
``products.stock_available`` (fed by the old InventorySync) is frozen since
2026-07-22 and must not be used for coverage numbers.

Endpoints used (all GET, token scopes products:read + stores:read):
    /v1/stores                      → store id ↔ shopDomain
    /v1/listings?matchStatus=MATCHED → (store, SKU) → barcode
    /v1/master-products             → every master product (name, image)
    /v1/stock?barcodes=…            → totalUnits + per-store currentUnits (max 200/call)
"""

import asyncio
import logging
from typing import Dict, List

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

STOCK_BATCH_SIZE = 200
PAGE_SIZE = 200
MAX_PARALLEL_STOCK_CALLS = 4


class StockSyncUnavailable(Exception):
    """stock-sync is not configured or did not answer."""


def _headers() -> Dict[str, str]:
    token = settings.stock_sync_api_token
    if not token:
        raise StockSyncUnavailable(
            "STOCK_SYNC_API_TOKEN nu e setat în .env — raportul de stoc nu poate citi masterul."
        )
    return {"Authorization": f"Bearer {token}"}


async def _get(client: httpx.AsyncClient, path: str, params=None) -> dict:
    try:
        resp = await client.get(path, params=params, headers=_headers())
    except httpx.HTTPError as e:
        raise StockSyncUnavailable(f"stock-sync nu răspunde ({path}): {e}") from e
    if resp.status_code != 200:
        raise StockSyncUnavailable(
            f"stock-sync a răspuns {resp.status_code} la {path}: {resp.text[:200]}"
        )
    return resp.json()


async def _paginate(client: httpx.AsyncClient, path: str, key: str, params: dict):
    items: List[dict] = []
    cursor = None
    while True:
        page = await _get(
            client, path, {**params, **({"cursor": cursor} if cursor else {})}
        )
        items.extend(page.get(key) or [])
        cursor = page.get("nextCursor")
        if not cursor:
            return items


async def fetch_snapshot() -> dict:
    """Stores, matched listings and stock for every master product, in one pass.

    Stock is fetched for ALL master products, not only listed ones: ~600 masters
    have no listing anywhere yet hold most of the unallocated units.
    """
    async with httpx.AsyncClient(
        base_url=settings.stock_sync_api_url, timeout=60.0
    ) as client:
        stores = (await _get(client, "/v1/stores")).get("stores") or []
        listings = await _paginate(
            client,
            "/v1/listings",
            "listings",
            {"matchStatus": "MATCHED", "limit": PAGE_SIZE},
        )
        masters = await _paginate(
            client, "/v1/master-products", "masterProducts", {"limit": PAGE_SIZE}
        )

        barcodes = sorted(
            {m["barcodeNormalized"] for m in masters if m.get("barcodeNormalized")}
            | {x["barcodeNormalized"] for x in listings if x.get("barcodeNormalized")}
        )
        sem = asyncio.Semaphore(MAX_PARALLEL_STOCK_CALLS)

        async def _stock_batch(batch: List[str]) -> List[dict]:
            async with sem:
                data = await _get(client, "/v1/stock", {"barcodes": ",".join(batch)})
                return data.get("products") or []

        batches = [
            barcodes[i : i + STOCK_BATCH_SIZE]
            for i in range(0, len(barcodes), STOCK_BATCH_SIZE)
        ]
        results = await asyncio.gather(*(_stock_batch(b) for b in batches))

    stock = {p["barcode"]: p for batch in results for p in batch if p.get("barcode")}
    logger.info(
        "stock-sync snapshot: %d stores, %d listings, %d masters, %d with stock",
        len(stores),
        len(listings),
        len(masters),
        len(stock),
    )
    return {"stores": stores, "listings": listings, "masters": masters, "stock": stock}
