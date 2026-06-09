# 08 — Scripturi re-pull, change analysis & AWB parity re-check (2026-06-09)

**Trigger:** colleague maintains the Scripturi profitability/product-analytics area and may have changed
report logic. Goal: re-pull all Scripturi code, diff vs the last baseline, re-analyze its database, pull
fresh data, and confirm AWB's reports still match 1:1 in **numbers and data**.

**Method:** fresh tarball pulled from the VPS (`84.46.242.181:/root/Scripturi`, 66.4 MB) → extracted to
`c:/tmp/scr_new`; baseline = the 2026-06-05 snapshot (`scripturi_new.tgz`) → `c:/tmp/scr_old`. Recursive
diff + per-file analysis + a 4-agent adversarial verification workflow + a live AWB-vs-Scripturi numeric
comparison (`backend/scratch/compare_awb_vs_scripturi_2026.py`).

---

## 1. What the colleague changed (code)

355 files vs 352; full diff covers ~50 files. **Only TWO changes touch reported numbers — both in
`api/profitability.py`** (verified by a completeness critic that read all 21 changed `.py` files and
could NOT refute "only two"):

| # | Change | Numeric? | Verdict |
|---|--------|----------|---------|
| 1 | **RO VAT default `0.19 → 0.21`** (`DEFAULT_VAT_RATES["RO"]` + two `.get(country, 0.19→0.21)` fallbacks). Comment: *"RO trecut la 21% (aug 2025)"*. | **No-op** | The effective rate is read from `profit_settings.vat_rates`, which **already stored `RO:0.21` in BOTH old and new** DBs. The default only fires when the setting is absent — it isn't. So this is a cosmetic/safety alignment; **effective RO VAT was 21% before and after.** |
| 2 | **Transport always VAT-removed** — old code divided transport by `(1+vat)` only when `vat_included=True`, else kept it raw; new code **always** divides. | **Real** | All 20→62 `profit_transport_costs` rows have `vat_included=0`, so the old path kept transport at full value. New path removes VAT (`÷1.21` for RO). **This moves Scripturi ONTO AWB's existing behavior** — it tightens parity, not breaks it. |

**Everything else is non-numeric** (verified): perf only (`PRAGMA busy_timeout/synchronous`, new indexes,
loop→`executemany`, an N+1→GROUP BY in `purchase_orders.py`), a SQLite connection-leak fix, secrets moved
to `.env` (Trendyol/Shopify/JWT), the new `core/brands.py` (BRAND_TO_PREFIX consolidated — **byte-identical**
mapping, plus the known `GRAND→GRAN` alias), and `invoice_parser.py` touching only a text `supplier_name`.
`api/profitability.py.bak_vat` is a leftover backup, not imported. USD/FX rate unchanged (4.55).

## 2. Database re-analysis

**No schema changes** in any of the 3 Scripturi SQLite DBs (no tables/columns added or removed). Only:
- `profit_transport_costs` 20→**62 rows** (transport config now spans more months — consistent with change #2 applying retroactively across months).
- `profit_status_mapping` +2 courier rules; `analytics_order_lines` +5,154; `analytics_sales` +669; fb/tk spend +128/+43 — incremental data refresh.
- `profit_orders` now spans **2026-01 → 2026-06** (277,662 courier-resolved orders) — a clean overlap window with AWB.

## 3. Does AWB need any change? **No.** (independently verified)

- **RO VAT 2026 = 21%** — `app/core/vat.py:54-56` (`resolve_vat_rate`), RO splits 19→21 at `2025-08-01`; all 2026 orders get 21%. Matches Scripturi.
- **AWB removes VAT from transport** — `app/api/analytics/profitability.py:463-477`: `shipping_fara += shipping_cost / (1+order_vat)`; per-store path mirrors it (`s_split`, :920-923/:1024-1027). Matches Scripturi's **new** behavior.

So AWB was already on the new basis on both counts. No code change required.

## 4. Numbers comparison — AWB vs Scripturi, 2026 (delivered orders)

Closed months **Jan–May**, by store prefix (delivered = AWB `aggregated_status='delivered'` vs SC `status_category='Livrata'`):

- **TOTAL: AWB 217,529 vs Scripturi 217,118 → +0.2%.** Per-month: Jan −0.8%, Feb −0.3%, **Mar +2.3%**, **Apr −0.3%** (45,462 vs 45,603), **May −0.0%** (46,386 vs 46,390).
- Most stores agree within ±1% (EST −0.0%, CZ 0.0%, GT +0.1%, BON −0.1%, PL 0.0%, LUX −0.1%, GEN −0.1%, NOC −0.2%, APR −0.1%, PAT −0.3%).

**Every residual is explained — none is a calculation difference:**

| Store / period | Δ | Reason (verified) |
|---|---|---|
| **BELA** | −215 (−3.1%) | **Frisbo-stale orders** — belasil was #1 in the 717-order Frisbo-stale list (222). AWB mirrors Frisbo's frozen status; single-source limitation, not a calc gap. |
| **COV** | +586 (+32%) | **Scripturi is missing March covoria entirely** (block COV11244–COV12394, ~913 orders, Feb→Apr jump). AWB's March COV are all genuine DPD-AWB delivereds (back_to_sender/cancelled correctly excluded). AWB is *more* complete here. |
| **Mar (all)** | +996 (+2.3%) | Almost entirely the COV March coverage gap above; big stores match within 0–2. |
| **GRAN** | rev −5.6% (count −0.9%) | Grandia revenue/FX presentation — AWB uses its own (more complete) marketing/revenue sheet for GRAN. By-design. |
| **June** | n/a | Scripturi's SQLite cache hasn't courier-resolved June yet (SC 86 vs AWB 6,485) — not a fair comparison month. |

Transport-VAT change #2, quantified across 2026: lowers Scripturi's transport cost (ex-VAT) by **576,417 RON**
(raises reported profit by that much) — onto the basis AWB already used.

## 5. Bottom line

The colleague's changes are **safe for AWB parity**: one is a no-op, the other moves Scripturi onto AWB's
existing transport-VAT treatment. **AWB needs no code change.** AWB and Scripturi agree on delivered volume
to **+0.2%** across Jan–May 2026; the only material residuals are (a) the known **Frisbo-stale** orders AWB
can't resolve upstream, and (b) **gaps in Scripturi's own ingest** (March covoria, June) where AWB is the
more complete source. Comparison data exported to `frisbo_vs_scripturi_2026.csv`; re-runnable via
`backend/scratch/compare_awb_vs_scripturi_2026.py`.
