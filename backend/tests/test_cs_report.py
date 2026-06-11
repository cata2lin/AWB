"""
Deterministic unit tests for the CS-agent report core (`aggregate_cs`).

These pin the report's logic to Scripturi's `api/customer_service.py` contract so
any drift is caught in CI, independent of the DB and of how complete Frisbo's tags
are. The real-data parity check (AWB output vs Scripturi output on the same tag set)
lives in `backend/scratch/verify_cs_report_parity.py`.
"""

from app.api.cs_report import aggregate_cs, CS_BUCKETS, _CAT_TO_BUCKET


def _rec(tags, status, store="esteban", revenue_ron=100.0):
    return {"tags": tags, "status": status, "store": store, "revenue_ron": revenue_ron}


def _agent(result, tag):
    return next(a for a in result["agents"] if a["tag"] == tag)


def test_buckets_cover_all_classify_categories():
    # Every classify() category maps to exactly one bucket; the five buckets are fixed.
    assert set(_CAT_TO_BUCKET.values()) == set(CS_BUCKETS)
    assert CS_BUCKETS == ["livrate", "in_curs", "neexpediate", "refuzate", "anulate"]


def test_status_to_bucket_mapping():
    # delivered->livrate, refused/returned->refuzate, cancelled->anulate,
    # in_transit/customer_pickup->in_curs, fulfilled (pre-ship)->neexpediate.
    cases = {
        "delivered": "livrate",
        "customer_pickup": "in_curs",
        "in_transit": "in_curs",
        "refused": "refuzate",
        "back_to_sender": "refuzate",
        "cancelled": "anulate",
        "fulfilled": "neexpediate",
    }
    for status, bucket in cases.items():
        r = aggregate_cs([_rec(["Oana"], status)], ["Oana"])
        assert _agent(r, "Oana")["buckets"][bucket] == 1, status
        assert sum(_agent(r, "Oana")["buckets"].values()) == 1, status


def test_exact_token_match_not_substring():
    # "Oana" must NOT match "OanaO", and vice versa (the substring bug we fixed).
    recs = [
        _rec(["Oana"], "delivered"),
        _rec(["OanaO"], "delivered"),
    ]
    r = aggregate_cs(recs, ["Oana", "OanaO"])
    assert _agent(r, "Oana")["total_orders"] == 1
    assert _agent(r, "OanaO")["total_orders"] == 1


def test_case_insensitive_match():
    r = aggregate_cs(
        [_rec(["RALUCA"], "delivered"), _rec(["raluca"], "refused")], ["Raluca"]
    )
    assert _agent(r, "Raluca")["total_orders"] == 2


def test_distinct_order_totals_but_per_agent_double_count():
    # An order tagged by two agents counts ONCE in grand totals, but once per agent.
    r = aggregate_cs(
        [_rec(["Oana", "Raluca"], "delivered", revenue_ron=80.0)], ["Oana", "Raluca"]
    )
    assert r["totals"]["orders"] == 1
    assert r["totals"]["delivered"] == 1
    assert r["totals"]["revenue_ron"] == 80.0
    assert _agent(r, "Oana")["total_orders"] == 1
    assert _agent(r, "Raluca")["total_orders"] == 1


def test_revenue_and_delivered_revenue():
    recs = [
        _rec(["Oana"], "delivered", revenue_ron=100.0),
        _rec(["Oana"], "refused", revenue_ron=40.0),  # shipped but not delivered
    ]
    r = aggregate_cs(recs, ["Oana"])
    a = _agent(r, "Oana")
    assert a["total_orders"] == 2
    assert a["total_revenue_ron"] == 140.0
    assert a["delivered_orders"] == 1
    assert a["delivered_revenue_ron"] == 100.0  # only the delivered order


def test_per_store_split():
    recs = [
        _rec(["Oana"], "delivered", store="esteban", revenue_ron=100.0),
        _rec(["Oana"], "delivered", store="belasil", revenue_ron=50.0),
        _rec(["Oana"], "refused", store="belasil", revenue_ron=30.0),
    ]
    a = _agent(aggregate_cs(recs, ["Oana"]), "Oana")
    stores = {s["store"]: s for s in a["by_store"]}
    assert stores["esteban"]["orders"] == 1 and stores["esteban"]["delivered"] == 1
    assert stores["belasil"]["orders"] == 2 and stores["belasil"]["delivered"] == 1
    assert stores["belasil"]["buckets"]["refuzate"] == 1


def test_untagged_and_unconvertible_skipped():
    recs = [
        _rec([], "delivered"),  # no tags -> skip
        _rec(["nonagent"], "delivered"),  # tag, but not a CS agent -> skip
        _rec(["Oana"], "delivered", revenue_ron=None),  # unconvertible -> skip
        _rec(["Oana"], "delivered", revenue_ron=10.0),  # the only counted one
    ]
    r = aggregate_cs(recs, ["Oana"])
    assert r["orders_scanned"] == 4
    assert r["orders_matched"] == 1
    assert _agent(r, "Oana")["total_orders"] == 1


def test_empty_input():
    r = aggregate_cs([], ["Oana", "Raluca"])
    assert r["totals"]["orders"] == 0
    assert all(a["total_orders"] == 0 for a in r["agents"])
    assert r["orders_scanned"] == 0


def test_bucket_sum_equals_total_per_agent():
    # The five buckets are mutually exclusive and sum to the agent's total — Scripturi invariant.
    recs = [
        _rec(["Oana"], "delivered"),
        _rec(["Oana"], "customer_pickup"),
        _rec(["Oana"], "fulfilled"),
        _rec(["Oana"], "refused"),
        _rec(["Oana"], "cancelled"),
    ]
    a = _agent(aggregate_cs(recs, ["Oana"]), "Oana")
    assert sum(a["buckets"].values()) == a["total_orders"] == 5
    assert a["buckets"] == {
        "livrate": 1,
        "in_curs": 1,
        "neexpediate": 1,
        "refuzate": 1,
        "anulate": 1,
    }
