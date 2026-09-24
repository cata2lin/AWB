"""Unit tests for the Stoc & Viteză report computations (pure, no DB / HTTP)."""

from app.api.stock_coverage.computations import (
    UNALLOCATED_STORE_UID,
    awb_store_domain,
    build_rows,
)

SS_STORES = [
    {"id": "ss-oz", "shopDomain": "ofertelezilei.myshopify.com"},
    {"id": "ss-bg", "shopDomain": "ux1x6n-n2.myshopify.com"},
    {"id": "ss-orc", "shopDomain": "oriceredus.myshopify.com"},
]
AWB_STORES = [
    {"uid": "oz", "name": "ofertelezilei.ro", "domain": "ofertelezilei.myshopify.com"},
    {"uid": "bg", "name": "bonhaus.bg", "domain": "ux1x6n-n2.myshopify.com"},
    {"uid": "belasil", "name": "belasil.ro", "domain": "dvk4hu-dq.myshopify.com"},
]
LISTINGS = [
    {
        "storeId": "ss-oz",
        "sku": "HA-1",
        "barcodeNormalized": "111",
        "masterProductId": "m1",
        "imageUrl": "img1",
    },
    {
        "storeId": "ss-oz",
        "sku": "HA-2",
        "barcodeNormalized": "222",
        "masterProductId": "m2",
        "imageUrl": None,
    },
    # Same SKU, different product on another store — must not borrow OZ's sales.
    {
        "storeId": "ss-bg",
        "sku": "HA-1",
        "barcodeNormalized": "333",
        "masterProductId": "m3",
        "imageUrl": None,
    },
]
STOCK = {
    "111": {
        "barcode": "111",
        "masterProductId": "m1",
        "name": "Produs unu",
        "totalUnits": 100,
        "lastSeenAt": "2026-09-24T04:40:00Z",
        "stores": [
            {"storeId": "ss-oz", "currentUnits": 30, "allocatedUnits": 30},
            {"storeId": "ss-bg", "currentUnits": 20, "allocatedUnits": 20},
        ],
    },
    "222": {
        "barcode": "222",
        "masterProductId": "m2",
        "name": "Produs doi",
        "totalUnits": 10,
        "lastSeenAt": "2026-09-23T04:40:00Z",
        "stores": [{"storeId": "ss-oz", "currentUnits": 10, "allocatedUnits": 10}],
    },
    "333": {
        "barcode": "333",
        "masterProductId": "m3",
        "name": "Produs trei",
        "totalUnits": 5,
        "lastSeenAt": "2026-09-22T04:40:00Z",
        "stores": [{"storeId": "ss-bg", "currentUnits": 5, "allocatedUnits": 5}],
    },
}
SNAPSHOT = {"stores": SS_STORES, "listings": LISTINGS, "stock": STOCK}
CATALOG = [("belasil", "BEL-1", "111", "Produs unu (Belasil)")]


def _rows(sales, days=30):
    return build_rows(AWB_STORES, SNAPSHOT, CATALOG, sales, days)


def _row(result, store_uid, master=None, sku=None):
    for r in result["rows"]:
        if r["store_uid"] == store_uid and (
            (master and r["master_product_id"] == master)
            or (sku and r["sku"] == sku and not master)
        ):
            return r
    raise AssertionError(f"no row for {store_uid} {master or sku}")


def test_domain_prefers_manual_then_xconnector_then_slug():
    orc = "37c35854-8b4b-4f40-9ccc-79522fc526d6-1786618849-SE8MNAKFPG"
    assert awb_store_domain(orc, None, None, None) == "oriceredus.myshopify.com"
    assert (
        awb_store_domain("x", "A.myshopify.com", "b.myshopify.com", "c")
        == "a.myshopify.com"
    )
    assert awb_store_domain("x", None, None, "a98a4e-16") == "a98a4e-16.myshopify.com"
    assert awb_store_domain("x", None, None, None) is None


def test_store_row_uses_store_allocation_and_store_sales():
    result = _rows({("oz", "HA-1"): {"units": 60, "name": ""}})
    r = _row(result, "oz", master="m1")
    assert r["store_units"] == 30
    assert r["total_units"] == 100
    assert r["sold_units"] == 60
    assert r["velocity"] == 2.0
    assert r["days_left"] == 15.0
    assert r["image_url"] == "img1"


def test_same_sku_on_other_store_maps_to_its_own_product():
    result = _rows(
        {
            ("oz", "HA-1"): {"units": 60, "name": ""},
            ("bg", "HA-1"): {"units": 3, "name": ""},
        }
    )
    assert _row(result, "bg", master="m3")["sold_units"] == 3
    assert _row(result, "oz", master="m1")["sold_units"] == 60
    assert _row(result, "bg", master="m3")["pool_sold_units"] == 3


def test_listed_product_without_sales_has_no_days_left():
    result = _rows({})
    r = _row(result, "oz", master="m2")
    assert r["sold_units"] == 0
    assert r["store_units"] == 10
    assert r["days_left"] is None
    assert r["days_left_total"] is None


def test_store_outside_stock_sync_sells_from_pool():
    result = _rows(
        {
            ("oz", "HA-1"): {"units": 30, "name": ""},
            ("belasil", "BEL-1"): {"units": 30, "name": ""},
        }
    )
    bel = _row(result, "belasil", master="m1")
    assert bel["store_units"] is None
    assert bel["total_units"] == 100
    assert bel["pool_sold_units"] == 60
    assert bel["days_left_total"] == 50.0
    assert "belasil.ro" in result["stores_without_master"]


def test_unallocated_row_drains_at_pooled_rate():
    result = _rows(
        {
            ("oz", "HA-1"): {"units": 30, "name": ""},
            ("bg", "HA-1"): {"units": 0, "name": ""},
        }
    )
    r = _row(result, UNALLOCATED_STORE_UID, master="m1")
    assert r["store_units"] == 50  # 100 total − 30 − 20 allocated
    assert r["velocity"] == 1.0
    assert r["days_left"] == 50.0
    assert not any(
        x["store_uid"] == UNALLOCATED_STORE_UID and x["master_product_id"] == "m2"
        for x in result["rows"]
    )


def test_sold_sku_not_linked_to_master_still_shows_without_stock():
    result = _rows({("oz", "NOPE-1"): {"units": 6, "name": "Produs vechi"}})
    r = _row(result, "oz", sku="NOPE-1")
    assert r["master_product_id"] is None
    assert r["store_units"] is None
    assert r["sold_units"] == 6
    assert r["product_name"] == "Produs vechi"


def test_as_of_is_latest_stock_sync_sighting():
    assert _rows({})["as_of"] == "2026-09-24T04:40:00Z"


def test_unlisted_master_stock_counts_as_unallocated():
    snapshot = {
        **SNAPSHOT,
        "masters": [
            {
                "id": "m4",
                "barcode": "444",
                "barcodeNormalized": "444",
                "name": "Produs patru",
                "imageUrl": "img4",
            }
        ],
        "stock": {
            **STOCK,
            "444": {
                "barcode": "444",
                "masterProductId": "m4",
                "name": "Default Title",
                "totalUnits": 70,
                "lastSeenAt": None,
                "stores": [],
            },
        },
    }
    catalog = CATALOG + [("oz", "HA-4", "444", "Titlu AWB")]
    result = build_rows(AWB_STORES, snapshot, catalog, {}, 30)
    r = _row(result, UNALLOCATED_STORE_UID, master="m4")
    assert r["store_units"] == 70
    assert r["sku"] == "HA-4"
    assert r["product_name"] == "Produs patru"
    assert r["image_url"] == "img4"
