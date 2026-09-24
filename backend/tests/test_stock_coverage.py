"""Unit tests for the Stoc & Viteză report computations (pure, no DB / HTTP)."""

from datetime import datetime

from app.api.stock_coverage.computations import (
    ALL_STORES_UID,
    UNALLOCATED_STORE_UID,
    awb_store_domain,
    build_rows,
    stock_status,
)

NOW = datetime(2026, 9, 24, 12, 0)
SS_STORES = [
    {"id": "ss-oz", "shopDomain": "ofertelezilei.myshopify.com"},
    {"id": "ss-bg", "shopDomain": "ux1x6n-n2.myshopify.com"},
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


def _rows(
    sales, days=30, last_sales=None, costs=None, snapshot=SNAPSHOT, catalog=CATALOG
):
    return build_rows(
        AWB_STORES, snapshot, catalog, sales, days, last_sales, costs, now=NOW
    )


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


def test_status_thresholds():
    assert stock_status(None, 0, None) == "fara_date"
    assert stock_status(0, 5, 0, 1) == "fara_stoc"
    assert stock_status(50, 0, None, None) == "mort"  # nothing sold in a year
    assert stock_status(50, 0, None, 90) == "mort"
    assert stock_status(50, 0, None, 40) == "nu_se_vinde"  # sold, but not this period
    assert stock_status(50, 1, 400, 5) == "foarte_lent"
    assert stock_status(50, 1, 200, 5) == "lent"
    assert stock_status(50, 10, 10, 1) == "se_termina"
    assert stock_status(50, 10, 60, 1) == "ok"


def test_store_row_has_one_stock_one_coverage():
    result = _rows({("oz", "HA-1"): {"units": 60, "name": ""}})
    r = _row(result, "oz", master="m1")
    assert r["stock"] == 30
    assert r["sold_units"] == 60
    assert r["velocity"] == 2.0
    assert r["coverage_days"] == 15.0
    assert r["status"] == "ok"
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


def test_listed_product_without_sales_is_dead_stock():
    r = _row(_rows({}), "oz", master="m2")
    assert r["sold_units"] == 0
    assert r["stock"] == 10
    assert r["coverage_days"] is None
    assert r["status"] == "mort"


def test_no_sales_this_period_but_sold_recently_is_not_dead():
    recent = {("oz", "HA-2"): datetime(2026, 8, 15, 12, 0)}  # 40 days ago
    assert (
        _row(_rows({}, last_sales=recent), "oz", master="m2")["status"] == "nu_se_vinde"
    )
    old = {("oz", "HA-2"): datetime(2026, 6, 1, 12, 0)}  # 115 days ago
    assert _row(_rows({}, last_sales=old), "oz", master="m2")["status"] == "mort"


def test_all_stores_row_sums_every_store():
    result = _rows(
        {
            ("oz", "HA-1"): {"units": 30, "name": ""},
            ("belasil", "BEL-1"): {"units": 30, "name": ""},
        }
    )
    r = _row(result, ALL_STORES_UID, master="m1")
    assert r["stock"] == 100
    assert r["sold_units"] == 60
    assert r["coverage_days"] == 50.0
    assert r["status"] == "ok"
    # m2 has stock and never sold anywhere → dead stock in the total view.
    assert _row(result, ALL_STORES_UID, master="m2")["status"] == "mort"


def test_store_outside_stock_sync_uses_the_pool():
    result = _rows(
        {
            ("oz", "HA-1"): {"units": 30, "name": ""},
            ("belasil", "BEL-1"): {"units": 30, "name": ""},
        }
    )
    bel = _row(result, "belasil", master="m1")
    assert bel["stock_is_pool"] is True
    assert bel["stock"] == 100
    assert bel["sold_units"] == 60
    assert bel["store_sold_units"] == 30
    assert bel["coverage_days"] == 50.0
    assert "belasil.ro" in result["stores_without_master"]


def test_last_sale_per_store_and_across_stores():
    last = {
        ("oz", "HA-1"): datetime(2026, 9, 14, 12, 0),
        ("belasil", "BEL-1"): datetime(2026, 9, 20, 12, 0),
    }
    result = _rows({}, last_sales=last)
    assert _row(result, "oz", master="m1")["days_since_last_sale"] == 10
    assert _row(result, ALL_STORES_UID, master="m1")["days_since_last_sale"] == 4
    assert _row(result, "oz", master="m2")["days_since_last_sale"] is None


def test_stock_value_uses_sku_cost():
    result = _rows({}, costs={"HA-2": 12.5})
    assert _row(result, "oz", master="m2")["stock_value"] == 125.0
    assert _row(result, ALL_STORES_UID, master="m2")["stock_value"] == 125.0
    assert _row(result, "oz", master="m1")["stock_value"] is None


def test_unallocated_row_drains_at_pooled_rate():
    result = _rows({("oz", "HA-1"): {"units": 30, "name": ""}})
    r = _row(result, UNALLOCATED_STORE_UID, master="m1")
    assert r["stock"] == 50  # 100 total − 30 − 20 allocated
    assert r["velocity"] == 1.0
    assert r["coverage_days"] == 50.0
    assert not any(
        x["store_uid"] == UNALLOCATED_STORE_UID and x["master_product_id"] == "m2"
        for x in result["rows"]
    )


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
    result = _rows({}, snapshot=snapshot, catalog=catalog)
    r = _row(result, UNALLOCATED_STORE_UID, master="m4")
    assert r["stock"] == 70
    assert r["sku"] == "HA-4"
    assert r["product_name"] == "Produs patru"
    assert r["image_url"] == "img4"
    assert _row(result, ALL_STORES_UID, master="m4")["status"] == "mort"


def test_sold_sku_not_linked_to_master_still_shows_without_stock():
    result = _rows({("oz", "NOPE-1"): {"units": 6, "name": "Produs vechi"}})
    r = _row(result, "oz", sku="NOPE-1")
    assert r["master_product_id"] is None
    assert r["stock"] is None
    assert r["status"] == "fara_date"
    assert r["product_name"] == "Produs vechi"


def test_as_of_is_latest_stock_sync_sighting():
    assert _rows({})["as_of"] == "2026-09-24T04:40:00Z"


def test_days_since_last_sale_counts_bucharest_calendar_days():
    # 23:00 UTC on the 23rd is already the 24th in Bucharest — sold "today".
    result = _rows({}, last_sales={("oz", "HA-2"): datetime(2026, 9, 23, 23, 0)})
    assert _row(result, "oz", master="m2")["days_since_last_sale"] == 0
    result = _rows({}, last_sales={("oz", "HA-2"): datetime(2026, 9, 23, 20, 0)})
    assert _row(result, "oz", master="m2")["days_since_last_sale"] == 1


def test_cost_prefers_sku_owned_by_this_product_only():
    # HA-1 is m1 on OZ but m3 on BG, so its cost is ambiguous; BEL-1 is m1's alone.
    result = _rows({}, costs={"HA-1": 50.0, "BEL-1": 7.0})
    assert _row(result, "oz", master="m1")["unit_cost"] == 7.0
    assert _row(result, ALL_STORES_UID, master="m1")["stock_value"] == 700.0
    # m3 has only the ambiguous SKU — still better than no value at all.
    assert _row(result, "bg", master="m3")["unit_cost"] == 50.0


def test_new_store_cannot_be_dead_stock():
    # De la Bucsa case: a 10-day-old store has no 90-day history to judge.
    young = {"oz": datetime(2026, 9, 14, 8, 0)}
    r = _row(
        build_rows(
            AWB_STORES, SNAPSHOT, CATALOG, {}, 30, store_first_order=young, now=NOW
        ),
        "oz",
        master="m2",
    )
    assert r["status"] == "nu_se_vinde"
    assert r["history_days"] == 10


def test_new_product_cannot_be_dead_stock():
    fresh = {"HA-2": datetime(2026, 9, 1, 8, 0)}
    result = build_rows(
        AWB_STORES, SNAPSHOT, CATALOG, {}, 30, first_seen=fresh, now=NOW
    )
    assert _row(result, ALL_STORES_UID, master="m2")["status"] == "nou"  # launched 23 days ago: not judged yet
    old = {"HA-2": datetime(2026, 1, 1, 8, 0)}
    result = build_rows(AWB_STORES, SNAPSHOT, CATALOG, {}, 30, first_seen=old, now=NOW)
    assert _row(result, ALL_STORES_UID, master="m2")["status"] == "mort"


def test_stock_listed_nowhere_is_flagged_separately():
    snapshot = {
        **SNAPSHOT,
        "stock": {
            **STOCK,
            "555": {
                "barcode": "555",
                "masterProductId": "m5",
                "name": "Produs nelistat",
                "totalUnits": 40,
                "lastSeenAt": None,
                "stores": [],
            },
        },
    }
    result = _rows({}, snapshot=snapshot)
    r = _row(result, ALL_STORES_UID, master="m5")
    assert r["status"] == "nelistat"
    assert r["listed"] is False
    assert _row(result, UNALLOCATED_STORE_UID, master="m5")["status"] == "nelistat"


def test_store_row_carries_the_product_total_verdict():
    # m1 sells only on Belasil (shared pool): on OZ it is idle, overall it is fine.
    result = _rows({("belasil", "BEL-1"): {"units": 60, "name": ""}})
    oz = _row(result, "oz", master="m1")
    assert oz["status"] == "mort"
    assert oz["total_status"] == "ok"


def test_ledger_arrival_ignores_cutover_seeding():
    from app.api.stock_coverage.computations import stock_arrivals

    ledger = [
        {
            "master": "m1",
            "at": "2026-07-22T10:00:00Z",
            "created": "",
            "before": 0,
            "after": 100,
        },
        {
            "master": "m2",
            "at": "2026-07-22T10:00:00Z",
            "created": "",
            "before": 0,
            "after": 50,
        },
        {
            "master": "m2",
            "at": "2026-08-01T10:00:00Z",
            "created": "",
            "before": 50,
            "after": 0,
        },
        {
            "master": "m2",
            "at": "2026-09-24T09:00:00Z",
            "created": "",
            "before": 0,
            "after": 1800,
            "note": "Corectie dubla numarare receptie C54-C56",
        },
        # old stock counted back in, or moved between warehouses: not new goods
        {"master": "m4", "at": "2026-09-23T12:00:00Z", "created": "", "before": 0,
         "after": 419, "note": "Inventar AWB Arona (bartolomeu)"},
        {"master": "m5", "at": "2026-09-23T12:00:00Z", "created": "", "before": 0,
         "after": 50, "note": "mutare gramada intre depozite dupa numaratoare"},
    ]
    arrivals = stock_arrivals(ledger)
    assert "m1" not in arrivals  # opening stock at the cutover, not new goods
    assert arrivals["m2"] == datetime(2026, 9, 24, 9, 0)
    assert "m4" not in arrivals and "m5" not in arrivals


def test_goods_that_just_arrived_are_new_not_dead():
    # HA-0501: 1800 pieces arrived today, nothing sold in 90 days → "nou".
    result = build_rows(
        AWB_STORES,
        SNAPSHOT,
        CATALOG,
        {},
        30,
        arrivals={"m2": datetime(2026, 9, 24, 9, 0)},
        now=NOW,
    )
    r = _row(result, ALL_STORES_UID, master="m2")
    assert r["status"] == "nou"
    assert r["days_since_arrival"] == 0
    # arrived 120 days ago and still nothing sold → dead after all
    result = build_rows(
        AWB_STORES,
        SNAPSHOT,
        CATALOG,
        {},
        30,
        arrivals={"m2": datetime(2026, 5, 27, 9, 0)},
        now=NOW,
    )
    assert _row(result, ALL_STORES_UID, master="m2")["status"] == "mort"


def test_perfume_stores_and_products_are_left_out():
    stores = AWB_STORES + [
        {"uid": "est", "name": "esteban.ro", "domain": "est.myshopify.com"}
    ]
    snapshot = {
        **SNAPSHOT,
        "stores": SS_STORES + [{"id": "ss-est", "shopDomain": "est.myshopify.com"}],
        "listings": LISTINGS
        + [
            {
                "storeId": "ss-est",
                "sku": "71",
                "barcodeNormalized": "777",
                "masterProductId": "m7",
                "imageUrl": None,
            }
        ],
        "stock": {
            **STOCK,
            "777": {
                "barcode": "777",
                "masterProductId": "m7",
                "name": "No. 71",
                "totalUnits": 90,
                "lastSeenAt": None,
                "stores": [],
            },
            "888": {
                "barcode": "888",
                "masterProductId": "m8",
                "name": "Zeylin No. 160, inspired by Omnia",
                "totalUnits": 60,
                "lastSeenAt": None,
                "stores": [],
            },
        },
    }
    result = build_rows(
        stores,
        snapshot,
        CATALOG,
        {("est", "71"): {"units": 5, "name": ""}},
        30,
        now=NOW,
    )
    masters = {r["master_product_id"] for r in result["rows"]}
    assert "m7" not in masters and "m8" not in masters
    assert not any(r["store_uid"] == "est" for r in result["rows"])
    assert result["excluded_perfume_stores"] == ["esteban.ro"]


def test_products_in_test_period_and_placeholders_are_left_out():
    result = build_rows(
        AWB_STORES,
        SNAPSHOT,
        CATALOG,
        {("oz", "surpriza-X"): {"units": 3, "name": ""}},
        30,
        test_skus={"HA-2"},
        now=NOW,
    )
    masters = {r["master_product_id"] for r in result["rows"]}
    assert "m2" not in masters
    assert not any(r["sku"] == "surpriza-X" for r in result["rows"])


def test_store_without_recent_orders_is_not_judged():
    last = {"oz": datetime(2026, 9, 1, 10, 0), "bg": datetime(2026, 9, 24, 8, 0)}
    result = build_rows(
        AWB_STORES, SNAPSHOT, CATALOG, {}, 30, store_last_order=last, now=NOW
    )
    assert _row(result, "oz", master="m2")["status"] == "date_incomplete"
    assert _row(result, "bg", master="m3")["status"] == "mort"
    assert result["stale_stores"] == ["ofertelezilei.ro"]


def test_velocity_counts_from_first_sale_in_period_like_sales_velocity():
    # First sold 10 days ago (today included): 30 units / 10 days, not / 30.
    sales = {("oz", "HA-1"): {"units": 30, "name": "", "first_day": datetime(2026, 9, 15).date()}}
    r = _row(_rows(sales), "oz", master="m1")
    assert r["velocity"] == 3.0
    assert r["velocity_days"] == 10
    assert r["coverage_days"] == 10.0
    assert r["velocity_basis"] == "perioada"


def test_no_sales_in_period_uses_last_year_pace_not_never():
    result = build_rows(
        AWB_STORES, SNAPSHOT, CATALOG, {}, 30,
        {("oz", "HA-2"): datetime(2026, 6, 1, 12, 0)}, None, now=NOW,
        year_sales={("oz", "HA-2"): 73},
    )
    r = _row(result, "oz", master="m2")
    assert r["velocity_basis"] == "an"
    assert r["velocity"] == 0.2
    assert r["coverage_days"] == 50.0
    assert r["status"] == "mort"  # the verdict still reads the period, not the year
    never = _row(_rows({}), "oz", master="m2")
    assert never["coverage_days"] is None and never["velocity_basis"] is None


def test_sales_summary_drops_only_cancelled_like_sales_velocity():
    from datetime import date

    from app.api.stock_coverage.endpoint import _summarize_sales

    today = date(2026, 9, 24)
    at = datetime(2026, 9, 20, 10, 0)
    history = {
        "today": today,
        "rows": [
            ("oz", "HA-1", "delivered", "", "", date(2026, 9, 20), 2, at, "Unu"),
            ("oz", "HA-1", "refused", "", "", date(2026, 9, 10), 1, at, "Unu"),
            ("oz", "HA-1", "cancelled", "", "", date(2026, 9, 22), 5, at, "Unu"),
            ("oz", "HA-1", "delivered", "", "", None, 4, datetime(2026, 3, 1), "Unu"),
        ],
    }
    sales, year, last = _summarize_sales(history, 30)
    assert sales[("oz", "HA-1")]["units"] == 3  # delivered + refused, not cancelled
    assert sales[("oz", "HA-1")]["first_day"] == date(2026, 9, 20)  # first delivered
    assert year[("oz", "HA-1")] == 7
    assert last[("oz", "HA-1")] == at
    week, _, _ = _summarize_sales(history, 7)
    assert week[("oz", "HA-1")]["units"] == 2


def test_container_booked_as_correction_counts_as_arrival():
    from app.api.stock_coverage.computations import stock_arrivals

    ledger = [
        {"master": "m1", "at": "2026-09-24T08:27:00Z", "created": "", "before": 1338,
         "after": 4018, "reason": "CORRECTION", "note": "Receptie container C55 — numarat la Uzina 2"},
        {"master": "m2", "at": "2026-09-20T08:00:00Z", "created": "", "before": 100,
         "after": 400, "reason": "CORRECTION", "note": "Inventar AWB Arona (bartolomeu)"},
        {"master": "m3", "at": "2026-09-20T08:00:00Z", "created": "", "before": 5,
         "after": 50, "reason": "RECEIVING", "note": "recuperare stoc livrare cmu7 / linia 3"},
        {"master": "m4", "at": "2026-09-20T08:00:00Z", "created": "", "before": 0,
         "after": 60, "reason": "RECEIVING", "note": "ajustare stoc din scaner depozit"},
    ]
    arrivals = stock_arrivals(ledger)
    assert arrivals["m1"] == datetime(2026, 9, 24, 8, 27)
    assert "m2" not in arrivals  # an inventory count is not goods arriving
    assert "m3" in arrivals  # a supplier delivery line
    assert "m4" not in arrivals  # a scanner count, not goods arriving


def test_product_launched_recently_is_new_not_slow():
    # HA-2 first appeared in the catalog 30 days ago: no verdict yet, however its
    # stock was booked.
    result = build_rows(
        AWB_STORES, SNAPSHOT, CATALOG, {}, 30, now=NOW,
        first_seen={"HA-2": datetime(2026, 8, 25)},
    )
    r = _row(result, ALL_STORES_UID, master="m2")
    assert r["status"] == "nou" and r["product_age_days"] == 30
    # m1 = HA-1 (new SKU on OZ) + BEL-1 (on Belasil since 2025): the product is old,
    # so its unsold stock is still dead
    result = build_rows(
        AWB_STORES, SNAPSHOT, CATALOG, {}, 30, now=NOW,
        first_seen={"HA-1": datetime(2026, 9, 1), "BEL-1": datetime(2025, 1, 1)},
    )
    r = _row(result, ALL_STORES_UID, master="m1")
    assert r["product_age_days"] > 365
    assert r["status"] == "mort"


def test_listing_waiting_for_relink_is_not_unlisted():
    snapshot = {
        **SNAPSHOT,
        "masters": [{"id": "m9", "barcodeNormalized": "999", "name": "Set cadou"}],
        "stock": {**STOCK, "999": {"barcode": "999", "masterProductId": "m9", "name": "Set cadou",
                                   "totalUnits": 15, "stores": []}},
        "stores": [*SS_STORES, {"id": "ss-co", "name": "CasaOfertelor", "shopDomain": "co.myshopify.com"}],
        "other_listings": [{"storeId": "ss-co", "sku": "set-1", "barcodeNormalized": "999",
                            "masterProductId": None, "matchStatus": "PENDING_RELINK_REVIEW"}],
    }
    r = _row(_rows({}, snapshot=snapshot), ALL_STORES_UID, master="m9")
    assert r["status"] == "legatura_neaprobata"
    assert "CasaOfertelor" in r["listing_note"]
    assert r["sku"] == "set-1"  # named from the store listing it waits on


def test_perfume_rule_catches_english_names():
    from app.api.stock_coverage.computations import PERFUME_NAME_RE

    assert PERFUME_NAME_RE.search("Essence No. 15, Blue, 50 ml")
    assert PERFUME_NAME_RE.search("No. 110, Elixir Y, Men's Perfume, 50 ml")
    assert PERFUME_NAME_RE.search("No. 119 — Noir Essence")
    assert not PERFUME_NAME_RE.search("Laveta Magica din Microfibra")
