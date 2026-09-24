"""
Pure computations for the per-store stock coverage report ("Stoc & Viteză").

No DB / HTTP here — the endpoint feeds in the AWB stores, the stock-sync snapshot,
the AWB catalog for stores stock-sync doesn't manage, per-(store, SKU) sales, last
sale dates and SKU costs.

Two views share one row shape:
  • per store — (AWB store, master product); the stock is what that store holds;
  • "Toate magazinele" — one row per master product; stock = master total, sales
    and last sale taken across every store.
Every row carries ONE stock, ONE coverage and a status, so "what isn't selling"
reads straight off the table.
"""

from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

UNALLOCATED_STORE_UID = "__nealocat__"
UNALLOCATED_STORE_NAME = "Nealocat (pe niciun magazin)"
ALL_STORES_UID = "__toate__"
ALL_STORES_NAME = "Toate magazinele"

BUCHAREST = ZoneInfo("Europe/Bucharest")

SOON_DAYS = 14
SLOW_DAYS = 180
VERY_SLOW_DAYS = 365
# Dead stock: nothing sold for this long, whatever period the page is showing.
DEAD_DAYS = 90

# AWB stores that have neither xconnector_domain nor shopify_domain set, matched to
# their stock-sync store by hand (identified from their order-number prefixes).
MANUAL_STORE_DOMAINS: Dict[str, str] = {
    # ORC… orders
    "37c35854-8b4b-4f40-9ccc-79522fc526d6-1786618849-SE8MNAKFPG": "oriceredus.myshopify.com",
    # HU… orders
    "89ac70a9-2ccf-4386-b905-cb858119ae14-1786621119-X2CTQOL3Q6": "63e901-2f.myshopify.com",
    # SK… orders
    "ee9c0806-71fb-4475-a120-43c87e4ba0e1-1786621084-2JVFQ716LH": "16w7xv-0w.myshopify.com",
}


def awb_store_domain(
    uid: str,
    xconnector_domain: Optional[str],
    shopify_domain: Optional[str],
    frisbo_store_slug: Optional[str],
) -> Optional[str]:
    """The Shopify domain stock-sync knows this AWB store by (lower-case)."""
    domain = (
        MANUAL_STORE_DOMAINS.get(uid)
        or xconnector_domain
        or shopify_domain
        or (f"{frisbo_store_slug}.myshopify.com" if frisbo_store_slug else None)
    )
    return domain.strip().lower() if domain else None


def map_awb_to_stock_sync(
    awb_stores: Iterable[dict], stock_sync_stores: Iterable[dict]
) -> Dict[str, str]:
    """AWB store uid → stock-sync store id, matched on the Shopify domain."""
    by_domain = {
        (s.get("shopDomain") or "").strip().lower(): s["id"]
        for s in stock_sync_stores
        if s.get("shopDomain")
    }
    mapping = {}
    for s in awb_stores:
        domain = s.get("domain")
        if domain and domain in by_domain:
            mapping[s["uid"]] = by_domain[domain]
    return mapping


def _safe_div(a: float, b: float) -> Optional[float]:
    return a / b if b else None


def _bucharest_date(utc_naive: datetime):
    return utc_naive.replace(tzinfo=timezone.utc).astimezone(BUCHAREST).date()


def stock_status(
    stock: Optional[float],
    sold: float,
    coverage: Optional[float],
    days_since_last_sale: Optional[int] = None,
) -> str:
    """Verdict for one row — does this stock move?

    `days_since_last_sale` None means no sale within the last-sale lookback (a year).
    """
    if stock is None:
        return "fara_date"
    if stock <= 0:
        return "fara_stoc"
    if not sold:
        # Sales in the period always win: the cached last-sale date can lag them.
        if days_since_last_sale is None or days_since_last_sale >= DEAD_DAYS:
            return "mort"
        return "nu_se_vinde"
    if coverage is not None and coverage > VERY_SLOW_DAYS:
        return "foarte_lent"
    if coverage is not None and coverage > SLOW_DAYS:
        return "lent"
    if coverage is not None and coverage < SOON_DAYS:
        return "se_termina"
    return "ok"


def build_rows(
    awb_stores: List[dict],
    snapshot: dict,
    awb_catalog: Iterable[Tuple[str, str, str, str]],
    sales: Dict[Tuple[str, str], dict],
    period_days: int,
    last_sales: Optional[Dict[Tuple[str, str], datetime]] = None,
    costs: Optional[Dict[str, float]] = None,
    now: Optional[datetime] = None,
) -> dict:
    """Build every report row (per store, unallocated, all stores); filtering happens later.

    awb_catalog: (awb_store_uid, sku, barcode, title) for active AWB products — used
        for stores stock-sync doesn't manage, and as a name / SKU fallback.
    sales: (awb_store_uid, sku) → {"units": float, "name": str} in the period,
        cancelled excluded.
    last_sales: (awb_store_uid, sku) → last non-cancelled order date (naive UTC).
    costs: sku → unit cost in RON.
    """
    last_sales = last_sales or {}
    costs = costs or {}
    today = _bucharest_date(now or datetime.utcnow())
    awb_to_ss = map_awb_to_stock_sync(awb_stores, snapshot["stores"])
    store_names = {s["uid"]: s["name"] for s in awb_stores}

    stock_by_master: Dict[str, dict] = {
        p["masterProductId"]: p
        for p in snapshot["stock"].values()
        if p.get("masterProductId")
    }
    master_info: Dict[str, dict] = {}
    barcode_to_master: Dict[str, str] = {}
    for m in snapshot.get("masters") or []:
        master_info[m["id"]] = m
        for bc in (m.get("barcodeNormalized"), m.get("barcode")):
            if bc:
                barcode_to_master[bc.strip()] = m["id"]

    listing_master: Dict[Tuple[str, str], str] = {}  # (ss store, sku) → master
    ss_store_masters: Dict[str, Dict[str, set]] = defaultdict(lambda: defaultdict(set))
    master_skus: Dict[str, set] = defaultdict(set)
    master_image: Dict[str, str] = {}
    for listing in snapshot["listings"]:
        master = listing.get("masterProductId")
        if not master:
            continue
        if listing.get("barcodeNormalized"):
            barcode_to_master[listing["barcodeNormalized"]] = master
        sku = (listing.get("sku") or "").strip()
        store_masters = ss_store_masters[listing["storeId"]]
        store_masters[master]  # listed even when the listing has no SKU
        if sku:
            listing_master[(listing["storeId"], sku)] = master
            store_masters[master].add(sku)
            master_skus[master].add(sku)
        if master not in master_image and listing.get("imageUrl"):
            master_image[master] = listing["imageUrl"]

    catalog_master: Dict[Tuple[str, str], str] = {}  # (awb store, sku) → master
    catalog_name: Dict[str, str] = {}
    catalog_skus_by_master: Dict[str, set] = defaultdict(set)
    for store_uid, sku, barcode, title in awb_catalog:
        sku = (sku or "").strip()
        if not sku:
            continue
        if title and sku not in catalog_name:
            catalog_name[sku] = title
        master = barcode_to_master.get((barcode or "").strip())
        if master:
            catalog_master[(store_uid, sku)] = master
            catalog_skus_by_master[master].add(sku)

    def resolve_master(store_uid: str, sku: str) -> Optional[str]:
        ss_store = awb_to_ss.get(store_uid)
        if ss_store and (ss_store, sku) in listing_master:
            return listing_master[(ss_store, sku)]
        return catalog_master.get((store_uid, sku))

    # Keyed by (awb store, master or "sku:<sku>"); pooled figures keyed by master.
    store_sold: Dict[Tuple[str, str], float] = defaultdict(float)
    store_skus: Dict[Tuple[str, str], set] = defaultdict(set)
    store_last: Dict[Tuple[str, str], datetime] = {}
    pool_sold: Dict[str, float] = defaultdict(float)
    pool_last: Dict[str, datetime] = {}
    sale_name: Dict[str, str] = {}
    for (store_uid, sku), agg in sales.items():
        master = resolve_master(store_uid, sku)
        key = (store_uid, master or f"sku:{sku}")
        store_sold[key] += agg["units"]
        store_skus[key].add(sku)
        if master:
            pool_sold[master] += agg["units"]
        if agg.get("name") and sku not in sale_name:
            sale_name[sku] = agg["name"]
    for (store_uid, sku), when in last_sales.items():
        if not when:
            continue
        master = resolve_master(store_uid, sku)
        key = (store_uid, master or f"sku:{sku}")
        if key not in store_last or when > store_last[key]:
            store_last[key] = when
        if master and (master not in pool_last or when > pool_last[master]):
            pool_last[master] = when

    def product_name(master: Optional[str], skus: Iterable[str]) -> str:
        if master:
            for source in (master_info, stock_by_master):
                name = (source.get(master) or {}).get("name") or ""
                # Single-variant Shopify products report their variant title.
                if name and name != "Default Title":
                    return name
        for sku in skus:
            if catalog_name.get(sku) or sale_name.get(sku):
                return catalog_name.get(sku) or sale_name[sku]
        return ""

    # sku_costs is keyed by SKU alone, and the same SKU can be a different product
    # on another store — prefer SKUs that belong to this product only.
    sku_owners: Dict[str, set] = defaultdict(set)
    for (_, sku), master in listing_master.items():
        sku_owners[sku].add(master)
    for (_, sku), master in catalog_master.items():
        sku_owners[sku].add(master)

    def unit_cost(master: Optional[str], skus: Iterable[str]) -> Optional[float]:
        candidates = sorted(skus)
        if master:
            candidates += sorted(
                master_skus.get(master, set())
                | catalog_skus_by_master.get(master, set())
            )
            candidates.sort(key=lambda sku: sku_owners.get(sku, {master}) != {master})
        for sku in candidates:
            if costs.get(sku):
                return costs[sku]
        return None

    def make_row(
        store_uid: str,
        store_name: str,
        master: Optional[str],
        skus: set,
        stock_units: Optional[float],
        sold: float,
        pooled: float,
        last_sale: Optional[datetime],
        stock_is_pool: bool = False,
    ) -> dict:
        stock = stock_by_master.get(master) if master else None
        velocity = sold / period_days if period_days else 0.0
        coverage = _safe_div(stock_units, velocity) if stock_units is not None else None
        cost = unit_cost(master, skus)
        days_since = (today - _bucharest_date(last_sale)).days if last_sale else None
        value = (
            stock_units * cost if (cost and stock_units and stock_units > 0) else None
        )
        return {
            "store_uid": store_uid,
            "store_name": store_name,
            "master_product_id": master,
            "sku": ", ".join(sorted(skus)),
            "barcode": stock.get("barcode") if stock else None,
            "product_name": product_name(master, skus),
            "image_url": master_image.get(master)
            or (master_info.get(master) or {}).get("imageUrl"),
            "stock": stock_units,
            "stock_is_pool": stock_is_pool,
            "total_units": stock.get("totalUnits") if stock else None,
            "sold_units": round(sold, 2),
            "velocity": round(velocity, 2),
            "coverage_days": round(coverage, 1) if coverage is not None else None,
            "pool_sold_units": round(pooled, 2),
            "last_sale_at": last_sale.isoformat() if last_sale else None,
            "days_since_last_sale": days_since,
            "unit_cost": cost,
            "stock_value": round(value, 2) if value is not None else None,
            "status": stock_status(stock_units, sold, coverage, days_since),
            "in_master": bool(stock),
        }

    rows: List[dict] = []
    for store in awb_stores:
        uid, name = store["uid"], store["name"]
        ss_store = awb_to_ss.get(uid)
        masters: Dict[str, set] = defaultdict(set)
        if ss_store:
            for master, skus in ss_store_masters.get(ss_store, {}).items():
                masters[master] |= skus
        else:
            for (store_uid, sku), master in catalog_master.items():
                if store_uid == uid:
                    masters[master].add(sku)
        for (store_uid, key), skus in store_skus.items():
            if store_uid == uid and not key.startswith("sku:"):
                masters[key] |= skus

        for master, skus in masters.items():
            stock = stock_by_master.get(master)
            pooled = pool_sold.get(master, 0.0)
            if ss_store:
                units = None
                if stock:
                    units = next(
                        (
                            s.get("currentUnits") or 0
                            for s in stock.get("stores") or []
                            if s.get("storeId") == ss_store
                        ),
                        0,
                    )
                rows.append(
                    make_row(
                        uid,
                        name,
                        master,
                        skus,
                        units,
                        store_sold.get((uid, master), 0.0),
                        pooled,
                        store_last.get((uid, master)),
                    )
                )
            else:
                # Not in stock-sync: the store sells from the shared pool, so the
                # pool's stock drains at the pace of every store together.
                row = make_row(
                    uid,
                    name,
                    master,
                    skus,
                    stock.get("totalUnits") if stock else None,
                    pooled,
                    pooled,
                    pool_last.get(master),
                    stock_is_pool=True,
                )
                row["store_sold_units"] = round(store_sold.get((uid, master), 0.0), 2)
                rows.append(row)

        for (store_uid, key), skus in store_skus.items():
            if store_uid == uid and key.startswith("sku:"):
                rows.append(
                    make_row(
                        uid,
                        name,
                        None,
                        skus,
                        None,
                        store_sold[(store_uid, key)],
                        0.0,
                        store_last.get((store_uid, key)),
                    )
                )

    for master, stock in stock_by_master.items():
        total = stock.get("totalUnits") or 0
        pooled = pool_sold.get(master, 0.0)
        skus = set(
            master_skus.get(master) or catalog_skus_by_master.get(master) or set()
        )
        if total > 0 or pooled > 0:
            rows.append(
                make_row(
                    ALL_STORES_UID,
                    ALL_STORES_NAME,
                    master,
                    skus,
                    total,
                    pooled,
                    pooled,
                    pool_last.get(master),
                )
            )
        allocated = sum(
            (s.get("allocatedUnits") or 0) for s in stock.get("stores") or []
        )
        if total - allocated > 0:
            # Unallocated stock has no store of its own — it drains at the pooled rate.
            rows.append(
                make_row(
                    UNALLOCATED_STORE_UID,
                    UNALLOCATED_STORE_NAME,
                    master,
                    skus,
                    total - allocated,
                    pooled,
                    pooled,
                    pool_last.get(master),
                )
            )

    last_seen = [
        p.get("lastSeenAt") for p in stock_by_master.values() if p.get("lastSeenAt")
    ]
    return {
        "rows": rows,
        "as_of": max(last_seen) if last_seen else None,
        "stores_without_master": sorted(
            store_names[s["uid"]] for s in awb_stores if s["uid"] not in awb_to_ss
        ),
    }
