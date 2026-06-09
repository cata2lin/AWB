# 04 — Ad-Spend / Delivery-Rate / Discount Parity Spec

**Status:** decision-ready, not yet implemented.
**Goal:** make AWB's per-SKU profitability report (and, optionally, daily-perf) match Scripturi's new ad-spend / delivery-rate / discount behaviour **1:1**.
**Date:** 2026-06-05.
**Scope owner:** AWB lead engineer.

This spec is the synthesis of four independent analyses of the colleague's Scripturi change (sync-logic, report-flow, refreshed-data, awb-gap), **cross-checked against the actual AWB code and the live Scripturi SQLite copies**. Every claim below was verified, not just summarised.

---

## 0. Verification done before writing this spec

| Claim | Verified how | Result |
|---|---|---|
| AWB `SkuMarketingCost` is monthly, single `amount` (RON), no fb/tk/delivery split | read `app/models/sku_marketing_cost.py` | TRUE — cols `id,sku,label,amount,month,created_at,updated_at` |
| AWB endpoint pro-rates monthly marketing by month-window fraction and subtracts it | read `app/api/sku_profitability/endpoint.py` lines 114-183, 443-465 | TRUE — `_month_window_fraction` + `costs = cogs+transport+fees+marketing` |
| Scripturi `analytics_product_costs` gained `marketing_fb`, `marketing_tk`, has `delivery_rate` | `PRAGMA table_info` on `product_analytics.db` | TRUE — cols `sku, marketing, transport_per_unit, delivery_rate, marketing_fb, marketing_tk`, 1308 rows |
| Per-SKU spend scope, invariants | SQL on `analytics_product_costs` | 131 fb>0, 69 tk>0, 145 marketing>0, 1011 delivery_rate≠100, **14** legacy rows where marketing≠fb+tk (total-only, pre-split) |
| Daily tables exist & coverage | SQL on `analytics_fb_spend_daily`, `analytics_tk_spend_daily` | fb: 2365 rows, 2026-03-17..2026-06-03, $68,535.31 · tk: 1233 rows, 2026-05-15..2026-06-03, $16,067.96 |
| Implied stored rate ≠ windowed default | `SUM(marketing_fb)/SUM(amount_usd)` | **4.4638** stored vs **4.55** sync/report default — they disagree |
| Scripturi has no USD FX row (4.55 is the only source) | SQL on `profit_exchange_rates` | latest month has BGN/CZK/EUR/PLN only; `USD` count = 0 |
| AWB cannot supply a live USD rate | grep `app/api/exchange_rates.py` | 0 `USD` mentions; AWB FX is BNR-XML (BGN/CZK/EUR/PLN). **Must hardcode 4.55** |
| AWB `daily_perf` deliberately has no ad-spend | read `app/api/analytics/daily_perf.py` docstring | TRUE — "no ad-spend data in AWB … intentionally dropped" |
| COGS importer pattern to mirror | read `backend/scratch/import_scripturi_cogs.py` | dry-run/`--apply`, backup table + CSV, pg upsert `on_conflict_do_update` |
| Prior audit harness | read `backend/scratch/full_audit_2026_04.py` | per-order JOIN on `order_number==order_name`, status confusion, COGS Δ, delivered-rev RON by prefix |

---

## 1. What changed in Scripturi & why its reports moved

The colleague added **per-SKU Facebook + TikTok ad-spend attribution**, a **delivery-rate sync**, and a **Shopify discount/refund/cancellation revenue change**, all inside `Scripturi/api/product_analytics.py`. Spend is attributed **by SKU text-matched out of the ad name** — a regex `HA-(\d{3,5})` is pulled from the **Facebook *Campaign name*** and the **TikTok *Ad Group***, and **100% of that row's spend is assigned to that one SKU** (no sales-share allocation; unattributable brand/retargeting rows are dropped). The source is a pulled **Google Spreadsheet** (`15SMYpck3AOZKeD9S5xw_lkYlNvXEqKVeEBtoK5N2TSQ`, FB gid `204666248`, TK gid `245375920`) via a gspread service account — not a pasted CSV. Spend lands per `(date, sku)` as **USD-equivalent** in two new append-only daily tables (`analytics_fb_spend_daily`, `analytics_tk_spend_daily`), and cumulative per-SKU RON totals are written to `analytics_product_costs.{marketing_fb, marketing_tk, marketing}`. `GET get_product_costs` was rewritten to be **date-range aware**: with a `from_date/to_date` it ignores the static cumulative columns and instead **sums the daily USD tables in the window × the USD rate**; the marketing value flows into the **frontend** report (`static/js/product-profitability.js _pp_calc`) as a **flat per-SKU period total subtracted from profit — NOT pro-rated per unit**. The **profit formula structure is unchanged**; what changed are its inputs: marketing is now FB+TK-summed/date-filtered, COGS now multiplies **`qty_net`** (net of cancellations/refunds), and revenue is net of Shopify line discounts and refunds. **`delivery_rate` is display-only** (informational; never enters profit/CPA/ROAS).

### The exact formulas (Scripturi, as reported)

Per-SKU, per selected `[from_date, to_date]` window:

```
# marketing (date-range mode)
fb_usd   = SUM(amount_usd in analytics_fb_spend_daily WHERE from<=date<=to, GROUP BY sku)
tk_usd   = SUM(amount_usd in analytics_tk_spend_daily WHERE from<=date<=to, GROUP BY sku)
usd_rate = _get_exchange_rates().get('USD', 4.55)         # 4.55 — no USD row exists, fallback always hits
marketing_fb = fb_usd * usd_rate
marketing_tk = tk_usd * usd_rate
marketing    = round(marketing_fb + marketing_tk, 2)       # FLAT per-SKU total

# P&L  (incasari = net revenue; qty_net = net of cancel/refund)
incasari        = revenue_net                              # discounted - refunds, cancelled excluded by default
cogs_total      = cogs_unit * qty_net
transport_total = transport_per_unit * orders             # ORDERS, not units
baza_tva        = incasari - transport_total - cogs_total
tva             = baza_tva > 0 ? baza_tva * 0.21 : 0       # FLAT 21%, marketing excluded from base
profit_brut     = incasari - cogs_total - marketing - transport_total
profit_net      = profit_brut - tva
marja_neta      = incasari > 0 ? profit_net / incasari * 100 : 0
cpa             = (orders > 0 && marketing > 0) ? marketing / orders : 0
roas            = marketing > 0 ? incasari / marketing : 0

# delivery_rate (DISPLAY ONLY — never subtracted)
plecate       = livrata + refuzata + in_curs              # min 3 to report
delivery_rate = round(livrata / plecate * 100, 1)
```

### Revenue netting (Shopify sales sync)

```
discount_total      = SUM(discountAllocations.allocatedAmountSet.shopMoney.amount) per line
rev_after_discount  = line_revenue - discount_total
qty_net             = currentQuantity                     # net of cancellations
revenue_net         = rev_after_discount - refund_subtotals
# order filtering: KEEP REFUNDED; skip only VOIDED-and-not-cancelled; cancelledAt => cancelled bucket
# default report mode = "fara anulate": uses qty_net / revenue_net, orders = total - orders_cancelled
```

> **Two known Scripturi quirks (do NOT blindly copy):**
> 1. `sync_delivery_rates`' `INSERT OR REPLACE` omits `marketing_fb/marketing_tk`, so a delivery sync run *after* a spend sync silently zeroes the fb/tk subcolumns of touched rows (marketing total preserved). This is a bug; AWB must not replicate it.
> 2. The discount change subtracts `discountAllocations` from `discountedTotalSet`. If `discountedTotalSet` already nets line-level discounts, **order-level discounts double-count**. Validate before copying (see Open Decisions).

---

## 2. AWB parity plan

### 2.1 What's already right in AWB (do not change)

- The per-SKU endpoint **already subtracts marketing** from contribution (`costs = cogs+transport+fees+marketing`, line 464). The formula is correct; the table is **empty in prod** (0 rows) — marketing is starved, not broken.
- Marketing is **not** divided by VAT (foreign ad spend carries no RO TVA) — matches Scripturi (marketing excluded from the TVA base).
- COGS is delivered-only; transport fallback chain; per-store breakdown — all fine.

### 2.2 The single biggest divergence to resolve first

AWB pro-rates a **monthly** total by day-fraction; Scripturi sums **exact daily** spend in the window. **These agree only for full-calendar-month windows.** For any partial-month window (the common case in this report) AWB's monthly-pro-rate is a uniform-daily approximation and will **not** tie out. This forces the choice between **Path A** (fast, approximate) and **Path C** (exact). See §2.4.

### 2.3 Which AWB reports/endpoints must change

| Endpoint / file | Change required | Why |
|---|---|---|
| `app/api/sku_profitability/endpoint.py` | (depends on path) consume daily spend OR keep monthly pro-rate; surface `marketing_fb`/`marketing_tk`; optionally expose `delivery_rate`, `cpa`, `roas`; align qty basis | this is AWB's `_pp_calc` equivalent |
| `app/models/sku_marketing_cost.py` | Path B only: add `marketing_fb`, `marketing_tk` columns | fidelity for the split |
| `app/models/sku_cost.py` | Path B only: add `delivery_rate` (nullable) | per-SKU, display-only |
| `app/models/sku_ad_spend_daily.py` (NEW) | Path C only: `(date, sku, amount_fb_ron, amount_tk_ron)` | true per-window parity |
| `backend/scratch/import_scripturi_marketing.py` (NEW) | importer mirroring `import_scripturi_cogs.py` | identical inputs to Scripturi |
| `app/api/analytics/daily_perf.py` | OPTIONAL, separate — brand-level ad-spend gap | only if user wants brand parity |

**`daily_perf` is explicitly out of the per-SKU scope.** Scripturi keeps its `daily_perf.db` (brand-level fb/tk/roas/cpa) entirely separate from the per-SKU tables. Do not source per-SKU spend from daily-perf or vice-versa.

### 2.4 What new DATA AWB needs, and how to get it

**Preferred: import Scripturi's already-computed numbers, mirroring the COGS importer** so inputs are byte-identical to Scripturi rather than re-deriving from the Google Sheet (which would re-introduce the regex/TEST-filter/TK-account-currency logic and risk drift).

Source files (local SQLite copies of the VPS):
- `c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/product_analytics.db`
  - `analytics_product_costs(sku, marketing, marketing_fb, marketing_tk, transport_per_unit, delivery_rate)` — **all-time** cumulative
  - `analytics_fb_spend_daily(date, sku, amount_usd)` — 2026-03-17→
  - `analytics_tk_spend_daily(date, sku, amount_usd)` — 2026-05-15→

**Path A importer (monthly, no schema change — recommended first step):**
1. Read `analytics_fb_spend_daily` + `analytics_tk_spend_daily`.
2. Aggregate `amount_usd` per `(sku, YYYY-MM)` (group the `date` by month).
3. `ron = usd * 4.55` — **hardcode 4.55** (Scripturi's only USD source; AWB's BNR has no USD). Do NOT use BNR.
4. Upsert **one** `sku_marketing_costs` row per `(sku, month)` with `amount = fb_ron + tk_ron`, `label = "Scripturi FB+TK <month>"`.
5. dry-run/`--apply`, backup table + CSV, pg `on_conflict_do_update` — exactly like the COGS importer.

This fills the empty table; the existing endpoint pro-rates and subtracts. **Numeric caveat:** matches Scripturi only on full-month windows.

**Path C data (daily, exact):** import the daily rows 1:1 into a new `sku_ad_spend_daily` table (USD→RON at 4.55 at import, or store USD and convert at report time — pick once, §Open Decisions), then sum over `[date_from, date_to]` in the endpoint.

> **FX lock:** whichever path, freeze **USD→RON = 4.55**. The implied *stored* rate in Scripturi's static columns is 4.4638 (a historical artifact of when rows were written), but the **windowed/report path uses 4.55**, and the report is what the user reads. Use 4.55 so windowed numbers tie out. Document that static-vs-windowed will differ by ~1.9% inside Scripturi itself.

### 2.5 FORMULA changes in the endpoint

Only if the user wants full `profit_net` parity (not just the marketing line):

1. **Marketing split:** expose `marketing_fb` + `marketing_tk` (sum == `marketing`). Path A can carry the split as two extra `SkuMarketingCost` columns (Path B) or split at import into two labelled rows; Path C carries it natively.
2. **VAT rate:** Scripturi's per-SKU JS uses **flat 21%**; AWB Phase-3 uses **per-country `resolve_vat_rate`** (RO 19%). For 1:1 profit_net, AWB's per-SKU report would have to revert to flat 21% — **this is a deliberate divergence, flag it, do not silently change** (see Open Decisions).
3. **qty basis:** Scripturi `cogs_total = cogs_unit * qty_net` (net of cancel/refund). AWB uses delivered units (`units_sold`). Confirm whether AWB's delivered-unit basis already equals Scripturi's `qty_net` or is a further divergence (Open Decisions).
4. **transport:** Scripturi `transport_per_unit * orders`. AWB allocates transport by revenue share per line — a *different model*. For the marketing line alone this doesn't matter; for full profit parity it does. Out of scope unless full-parity is chosen.
5. **delivery_rate:** display-only. If surfaced, compute `livrata/(livrata+refuzata+in_curs)*100`, min-3, with an include-in-transit toggle. **Never subtract from contribution.**

### 2.6 Schema migrations + **prod deploy-order risk (explicit)**

Per AWB CLAUDE.md Tier-1 and the global lesson: **`Base.metadata.create_all()` adds new *tables* but NEVER new *columns* to existing tables.** Consequences by path:

- **Path A:** no schema change. Data-only insert into the existing empty `sku_marketing_costs`. **Zero migration risk.**
- **Path B (adds columns to existing tables):** REQUIRES migrations `backend/migrate_sku_marketing_split.py` (`ALTER TABLE sku_marketing_costs ADD COLUMN IF NOT EXISTS marketing_fb FLOAT DEFAULT 0`, same for `marketing_tk`) and `backend/migrate_sku_delivery_rate.py` (`ALTER TABLE sku_costs ADD COLUMN IF NOT EXISTS delivery_rate FLOAT`). **DEPLOY ORDER IS LOAD-BEARING:** run the migration on prod **BEFORE** deploying the model change. If the model ships first, the ORM `SELECT` of the new column 500s on every read of `sku_costs`/`sku_marketing_costs` — i.e. the whole profitability tab breaks. Migrations must be `IF NOT EXISTS` (idempotent) and reversible.
- **Path C (adds a NEW table only):** `create_all()` is sufficient — no `ALTER`, no column-add risk. Only the endpoint edit needs care. **This is the lowest schema risk for true parity.**

---

## 3. Ranked task list

Ordered smallest-blast-radius → largest. Stop at the line that satisfies the chosen parity bar.

| # | Task | File(s) | Effort | Risk |
|---|---|---|---|---|
| 1 | **Path A importer** — aggregate Scripturi daily USD spend per `(sku, month)`, ×4.55, upsert one `sku_marketing_costs` row per `(sku,month)` as `fb_ron+tk_ron`. dry-run/`--apply`, backup table+CSV, pg upsert. Mirror COGS importer exactly. | NEW `backend/scratch/import_scripturi_marketing.py` | **S** (~2h) | **LOW** — data-only insert into an empty table |
| 2 | **Verify Path A numbers** vs Scripturi for a **full-month** window (April) per-SKU — expect exact on full months, approximate on partial. | reuse `full_audit_*` join pattern | S | LOW |
| 3 | **Surface marketing_fb / marketing_tk** in the endpoint JSON + UI table columns (display only; sum==marketing). | `endpoint.py`, `frontend/.../ProductProfitabilityTab.jsx` (+ Path B migrations if column-backed) | **M** (~half day) | **MED** if Path B (column add → deploy order); LOW if split at import into 2 labelled rows |
| 4 | **delivery_rate (display-only)** — compute `livrata/(livrata+refuzata+in_curs)*100`, min-3, include-in-transit toggle; surface, never subtract. | `endpoint.py` (+ `migrate_sku_delivery_rate.py` if stored on `sku_costs`) | M | MED (column add) / LOW (compute live) |
| 5 | **Path C: `SkuAdSpendDaily` table + daily importer + endpoint sum** — true per-window parity on arbitrary date ranges. Replaces monthly pro-rate with `SUM(daily in [from,to])`. New table ⇒ `create_all` OK, no ALTER. | NEW `app/models/sku_ad_spend_daily.py`, NEW importer, edit `endpoint.py` lines 153-183/443/464 | **L** (~1-1.5 days) | **MED** — endpoint logic change; needs the §5 verification before trusting |
| 6 | **VAT reconciliation (flat 21% vs per-country 19%)** — only if full `profit_net` parity is required. Adds a per-SKU-report VAT mode. | `endpoint.py`, `profitability_config` | M | **MED-HIGH** — changes reported profit for every SKU; user decision required |
| 7 | **Discount/refund/cancel revenue netting** — match Scripturi's `incasari`: subtract Shopify `discountAllocations`, use `currentQuantity`, subtract refund subtotals, keep REFUNDED/skip VOIDED-not-cancelled. **Validate the double-count risk first.** | AWB sales/sync + endpoint revenue basis | **L** | **HIGH** — touches revenue across the board; double-count hazard |
| 8 | **(Separate) daily_perf ad-spend** — add `fb_spend/tk_spend/total_spend/roas/cpa` per brand/day. Reuse the store-level Google-Sheets marketing already in `profitability.py` rather than re-importing. | `app/api/analytics/daily_perf.py` | **L** | MED — separate surface, only if user wants brand parity |

**Recommended cut line for a first ship:** tasks **1–4** (fill marketing, show the FB/TK split + delivery_rate, verify on a full month). That makes the marketing *line* and its display match Scripturi. Tasks 5–7 are the "true 1:1 on arbitrary windows + identical profit_net" tier and each needs a user decision below.

---

## 4. Open decisions for the user

1. **Import vs native sync.** Recommend **importing** Scripturi's already-computed daily/cumulative spend (Path A or C) so inputs are identical. Native re-sync from the Google Sheet means re-implementing the regex attribution, TEST-filter, TK USD-account map, and append guard — more code, more drift. **Decision: import (recommended) or native sync?**
2. **Window granularity / parity bar.** **Path A** (monthly pro-rate, no migration, *approximate on partial months*) vs **Path C** (daily table, exact on any window). Which window-granularity does the user actually report on? If they routinely pick partial-month ranges, Path A will visibly diverge.
3. **USD→RON rate.** Lock to **4.55** (Scripturi's only USD source; AWB BNR has no USD). Confirm we freeze 4.55 and accept the ~1.9% static-vs-windowed gap that exists inside Scripturi itself (stored implies 4.4638).
4. **VAT divergence.** Scripturi per-SKU JS = **flat 21%**; AWB = **per-country `resolve_vat_rate` (19%)**. Is per-SKU `profit_net` parity in scope (⇒ AWB reverts that report to flat 21%), or is only the **marketing line** in scope (⇒ leave VAT as-is)? **Do not silently change VAT.**
5. **qty basis.** Scripturi COGS uses `qty_net` (after cancel/refund); AWB uses delivered units. Are these already equal in practice, or a further gap to close (requires the discount/cancel netting in task 7)?
6. **Discount double-count.** Does Shopify `discountedTotalSet` already net line-level discounts? If so, Scripturi's extra subtraction of `discountAllocations` double-counts order-level discounts. **AWB must validate before copying** (task 7).
7. **daily_perf ad-spend.** Should AWB's brand-level daily-perf gain `fb_spend/tk_spend/roas/cpa` (reusing the store-level Google-Sheets source already in `profitability.py`), or stay revenue-only? Separate surface, separate decision.
8. **Prior-audit caveats (order universe / zero-revenue / snapshot).** The 318 zero-revenue / order-universe caveats and snapshot timing from the empirical audit (`03_EMPIRICAL_AUDIT_2026.md`) still apply: April is closed and ties out; **May is immature (2,765 in-transit)** and will keep rising — do **not** hard-compare May totals. Confirm we audit only on **closed months** (April).
9. **Scope inertness.** All FB/TK spend is **HA-/Hairo only**. Confirm AWB syncs that store; if not, the feature is inert for AWB and only the plumbing matters.

---

## 5. Verification plan (prove 1:1 per report)

Reuse the prior audit method (`backend/scratch/full_audit_2026_04.py`): join AWB↔Scripturi on `order_number == order_name`, compare per-order, aggregate. Extend it with **per-SKU + per-period** marketing/profit joins.

### 5.1 Per-SKU marketing join (the core proof)

New scratch script `backend/scratch/audit_marketing_parity.py`:
- For a fixed window `[from,to]` (use a **closed full month, April 2026**), pull Scripturi's windowed `GET /api/analytics/product-costs?from_date=&to_date=` per SKU → `{marketing, marketing_fb, marketing_tk}`.
- Pull AWB's `GET /analytics/sku-profitability?date_from=&date_to=` per SKU → `marketing` (and `marketing_fb/tk` if surfaced).
- Assert per SKU: `|awb.marketing − scripturi.marketing| < 0.05`. Bucket mismatches into: **(a)** SKU present one side only, **(b)** rate drift (ratio ≈ 4.55/4.4638), **(c)** windowing (partial-month → Path A approximation), **(d)** FB/TK split mismatch.
- Report: `% SKUs exact`, total marketing AWB vs Scripturi, top-10 absolute Δ with SKU + which bucket.

### 5.2 Per-period profit/CPA/ROAS join

- For the same window, compare per-SKU `profit_net`, `cpa`, `roas`. Expect mismatch **iff** VAT (decision 4) or qty/transport basis differs — those are *known, explained* divergences, not bugs. Tag each mismatched SKU with its cause.

### 5.3 Delivered-revenue topline (existing harness)

- Run `full_audit_2026_04.py` for April: delivered-revenue-RON-by-prefix must still tie (April reference **5,629,531 RON**, FX CZK 0.21 / PLN 1.16 / EUR 4.97 / RON 1.0). April **COGS reference moved to ~1,368,548** (up from 1,301,512 after the data refresh / per-SKU overrides incl. HA-1005) — compare against the *new* baseline, not the old audit number.

### 5.4 Expected, explainable differences (do NOT treat as failures)

| Difference | Why | Expected magnitude |
|---|---|---|
| **Order universe** | AWB and Scripturi don't have byte-identical order sets every day | small, per prior audit match-rate by prefix |
| **Snapshot timing** | May is immature (2,765 in-transit vs April's 9) | May totals keep rising — audit closed months only |
| **FX (USD)** | static columns imply 4.4638, windowed uses 4.55 | ~1.9% on the marketing line if comparing static vs windowed; **0 if both use windowed 4.55** |
| **Partial-month window (Path A)** | AWB monthly-pro-rate ≈ uniform-daily vs Scripturi exact-daily | 0 on full months; grows with window's deviation from a calendar month |
| **VAT (decision 4)** | 21% flat vs 19% per-country | deterministic per-SKU; reconciles once decision 4 is made |
| **FB April partiality** | FB daily starts 2026-03-17, so April is full but TK starts 2026-05-15 (no TK in April) | April marketing = FB-only; expected, mirror it |

### 5.5 Pass criteria

- **Marketing line:** ≥ 99% of HA- SKUs exact (±0.05 RON) on a **full-month** window with both sides at 4.55. Remaining <1% explained by bucket (a)/(d).
- **Topline:** April delivered-revenue-RON Δ within the prior audit's order-universe tolerance; April COGS within the *new* ~1,368,548 baseline.
- **profit_net:** exact **only after** decisions 4 (VAT) and 5 (qty) are made; otherwise diff is fully attributable to those two knobs.

---

## Appendix — file index

- AWB endpoint: `awb-print-manager/backend/app/api/sku_profitability/endpoint.py`
- AWB models: `app/models/sku_marketing_cost.py`, `app/models/sku_cost.py`
- COGS importer to mirror: `awb-print-manager/backend/scratch/import_scripturi_cogs.py`
- Prior audit harness: `awb-print-manager/backend/scratch/full_audit_2026_04.py`
- AWB daily-perf: `awb-print-manager/backend/app/api/analytics/daily_perf.py`
- AWB FX (no USD): `awb-print-manager/backend/app/api/exchange_rates.py`
- Scripturi source DBs: `c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/{product_analytics,profitability}.db`
- Scripturi logic: `c:/Users/Admin/Desktop/scripturi-vps/Scripturi/api/product_analytics.py`, `static/js/product-profitability.js`
