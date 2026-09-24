"""
Pure computations for the per-store stock coverage report ("Stoc & Viteză").

No DB / HTTP here — the endpoint feeds in the AWB stores, the stock-sync snapshot,
the AWB catalog for stores stock-sync doesn't manage, and per-(store, SKU) sales.

Row identity is (AWB store, master product). A row whose SKU is not linked to any
master product is keyed by SKU instead and carries no stock.
"""

from collections import defaultdict
from typing import Dict, Iterable, List, Optional, Tuple

UNALLOCATED_STORE_UID = "__nealocat__"
UNALLOCATED_STORE_NAME = "Nealocat (pe niciun magazin)"

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


def build_rows(
    awb_stores: List[dict],
    snapshot: dict,
    awb_catalog: Iterable[Tuple[str, str, str, str]],
    sales: Dict[Tuple[str, str], dict],
    period_days: int,
) -> dict:
    """Build every report row for every AWB store (filtering happens later).

    awb_catalog: (awb_store_uid, sku, barcode, title) for active AWB products — used
        only for stores stock-sync doesn't manage, and as a name fallback.
    sales: (awb_store_uid, sku) → {"units": float, "name": str}, cancelled excluded.
    """
    listings = snapshot["listings"]
    stock_by_barcode = snapshot["stock"]
    awb_to_ss = map_awb_to_stock_sync(awb_stores, snapshot["stores"])
    store_names = {s["uid"]: s["name"] for s in awb_stores}

    stock_by_master: Dict[str, dict] = {
        p["masterProductId"]: p
        for p in stock_by_barcode.values()
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
    ss_store_masters: Dict[str, Dict[str, dict]] = defaultdict(
        dict
    )  # ss store → master → info
    for listing in listings:
        master = listing.get("masterProductId")
        if not master:
            continue
        if listing.get("barcodeNormalized"):
            barcode_to_master[listing["barcodeNormalized"]] = master
        sku = (listing.get("sku") or "").strip()
        info = ss_store_masters[listing["storeId"]].setdefault(
            master, {"skus": set(), "image_url": None}
        )
        if sku:
            listing_master[(listing["storeId"], sku)] = master
            info["skus"].add(sku)
        if not info["image_url"] and listing.get("imageUrl"):
            info["image_url"] = listing["imageUrl"]

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
        if ss_store:
            return listing_master.get((ss_store, sku)) or catalog_master.get(
                (store_uid, sku)
            )
        return catalog_master.get((store_uid, sku))

    # (awb store, master or "sku:<sku>") → units sold; plus pooled units per master.
    store_sold: Dict[Tuple[str, str], float] = defaultdict(float)
    store_sold_skus: Dict[Tuple[str, str], set] = defaultdict(set)
    pool_sold: Dict[str, float] = defaultdict(float)
    sale_name: Dict[str, str] = {}
    for (store_uid, sku), agg in sales.items():
        master = resolve_master(store_uid, sku)
        key = (store_uid, master or f"sku:{sku}")
        store_sold[key] += agg["units"]
        store_sold_skus[key].add(sku)
        if master:
            pool_sold[master] += agg["units"]
        if agg.get("name") and sku not in sale_name:
            sale_name[sku] = agg["name"]

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

    def make_row(store_uid, store_name, master, skus, store_units, image_url=None):
        stock = stock_by_master.get(master) if master else None
        total_units = stock.get("totalUnits") if stock else None
        sold = store_sold.get((store_uid, master or f"sku:{next(iter(skus), '')}"), 0.0)
        velocity = sold / period_days if period_days else 0.0
        pooled = pool_sold.get(master, 0.0) if master else 0.0
        pool_velocity = pooled / period_days if period_days else 0.0
        days_left = (
            _safe_div(store_units, velocity) if store_units is not None else None
        )
        days_left_total = (
            _safe_div(total_units, pool_velocity) if total_units is not None else None
        )
        return {
            "store_uid": store_uid,
            "store_name": store_name,
            "master_product_id": master,
            "sku": ", ".join(sorted(skus)),
            "barcode": stock.get("barcode") if stock else None,
            "product_name": product_name(master, skus),
            "image_url": image_url or (master_info.get(master) or {}).get("imageUrl"),
            "store_units": store_units,
            "total_units": total_units,
            "sold_units": round(sold, 2),
            "velocity": round(velocity, 2),
            "days_left": round(days_left, 1) if days_left is not None else None,
            "pool_sold_units": round(pooled, 2),
            "pool_velocity": round(pool_velocity, 2),
            "days_left_total": round(days_left_total, 1)
            if days_left_total is not None
            else None,
            "in_master": bool(stock),
            "last_seen_at": stock.get("lastSeenAt") if stock else None,
        }

    rows: List[dict] = []
    for store in awb_stores:
        uid, name = store["uid"], store["name"]
        ss_store = awb_to_ss.get(uid)
        masters: Dict[str, dict] = {}
        if ss_store:
            for master, info in ss_store_masters.get(ss_store, {}).items():
                masters[master] = {
                    "skus": set(info["skus"]),
                    "image_url": info["image_url"],
                }
        else:
            for (store_uid, sku), master in catalog_master.items():
                if store_uid == uid:
                    masters.setdefault(master, {"skus": set(), "image_url": None})[
                        "skus"
                    ].add(sku)

        sold_here = {k[1]: v for k, v in store_sold_skus.items() if k[0] == uid}
        for key, skus in sold_here.items():
            if key.startswith("sku:"):
                continue
            masters.setdefault(key, {"skus": set(), "image_url": None})["skus"].update(
                skus
            )

        for master, info in masters.items():
            store_units = None
            if ss_store:
                stock = stock_by_master.get(master)
                if stock:
                    store_units = next(
                        (
                            s.get("currentUnits") or 0
                            for s in stock.get("stores") or []
                            if s.get("storeId") == ss_store
                        ),
                        0,
                    )
            rows.append(
                make_row(
                    uid, name, master, info["skus"], store_units, info["image_url"]
                )
            )

        for key, skus in sold_here.items():
            if key.startswith("sku:"):
                rows.append(make_row(uid, name, None, skus, None))

    for master, stock in stock_by_master.items():
        allocated = sum(
            (s.get("allocatedUnits") or 0) for s in stock.get("stores") or []
        )
        unallocated = (stock.get("totalUnits") or 0) - allocated
        if unallocated <= 0:
            continue
        row = make_row(
            UNALLOCATED_STORE_UID, UNALLOCATED_STORE_NAME, master, set(), unallocated
        )
        # Unallocated stock has no store of its own — it drains at the pooled rate.
        row["sold_units"] = row["pool_sold_units"]
        row["velocity"] = row["pool_velocity"]
        row["days_left"] = (
            round(unallocated / row["pool_velocity"], 1)
            if row["pool_velocity"]
            else None
        )
        skus = {sku for (_, sku), m in listing_master.items() if m == master}
        row["sku"] = ", ".join(
            sorted(skus or catalog_skus_by_master.get(master, set()))
        )
        rows.append(row)

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
