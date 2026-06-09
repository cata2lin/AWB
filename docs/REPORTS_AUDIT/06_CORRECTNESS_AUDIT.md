# 06 — Correctness Audit (Decision-Ready)

**Date:** 2026-06-05
**Scope:** 5 evidence-based fronts — marketing coverage, orders-sync staleness, cross-report parity, UI correctness, data-source reliability.
**Comparison oracle:** LIVE AWB DB + frozen Scripturi snapshot (2026-06-02 12:12:15Z). All April-2026 figures are on a **closed month** and are the trustworthy comparison; May is still maturing (in-transit lag self-heals).

> **One-line verdict:** AWB's *calculation logic* is correct and, where both sources are finalized, ties to Scripturi to the cent. The data is **NOT yet 100% truthful** today because of (a) **missing marketing** (March/May/June not imported, two stores never mapped), (b) **1,700 sync-stuck orders** hiding ~155K RON of delivered revenue, and (c) **one new P&L variable-shadowing bug** that silently drops 1,696 delivered orders / ~219K RON. Each has a concrete, scoped fix below.

---

## 1. Confidence Scorecard

### 1a. Per-front confidence

| Front | Confidence | One-line basis |
|---|---:|---|
| **Marketing** | 88% | Coverage counts + per-store/per-day reconciliations + staleness proof are direct query results; couldn't re-run live importer to 100%-confirm the sheet *has* March, and Scripturi SQLite freshness is unverified. |
| **Orders Sync** | 88% | Stuck counts, never-run recheck tiers, all-synced-today proof, and 1,351/1,353 Scripturi join are hard facts; Scripturi "Livrata" is itself a proxy and no live single-order Frisbo GET was pulled to confirm the search endpoint is the frozen layer. |
| **Parity** | 88% | Reproduced every April baseline live to the cent and root-caused the new 1,696-order gap exactly (45,481 − 1,696 = 43,785); residual is the stale Scripturi snapshot + SKU-Risk having no SC oracle. |
| **UI** | 80% | Full static read of all 12 tabs + shared filter/helper/router + backend skip/limit confirmation; no live browser run, so a runtime-only render/closure edge could exist. |
| **Data Sources** | 88% | Every finding code-read + live-DB/runtime-verified (parser None test, TOM NameError reproduced, BNR/USD/BGN coverage queried, 599 empty-line_item orders counted); did not capture a live Frisbo partial payload mid-overwrite. |

### 1b. "Will the same data give the same result in both programs?" — per report (April, closed month)

| Report | Same result? | Reason |
|---|---|---|
| **Deliverability** | **YES-except-known-X** | Aggregate rate Δ **0.02 pts** (AWB 83.34% vs SC 83.36%). Per-store diverges on **GRAN** only, due to BUG-1 (Frisbo status-freeze) + SC's Shopify-DELIVERED override + different denominator buckets. All by-design except the upstream Frisbo defect. |
| **P&L / Profitability** | **NO-because-Y** | AWB silently drops **1,696 delivered April orders / ~219K RON native** via a variable-shadowing bug (NEW). Revenue 5,303,445 sits ~326K below SC 5,629,531. This is a **real defect**, not a known knob. |
| **Sales Velocity** | **YES-except-known-X** | By-design: AWB `units_sold`=DELIVERED-only/RON/barcode-grouped; SC `qty_sold`=all-placed-minus-voided/native/raw sku. ~13–15%/SKU. Map SC `qty_sold` → AWB `gross_units`. AWB is the more complete side. Not a bug. |
| **Product Profitability** (SKU Profitability) | **YES-except-known-X** | Marketing line **1:1** (66,610.33 vs 66,610.45). Residual divergence = BUG-2 (global vs per-store cost, 207 conflicts) + SC's 15.6% order shortfall. Note: SKU-Profitability uses a *different order universe* than the main P&L (it keeps gift-SKU orders) — an internal AWB inconsistency, see Parity finding. |
| **SKU Risk** | **NO ORACLE** (internally consistent) | AWB-specific report; no Scripturi number-for-number counterpart. Inherits BUG-1/BUG-2 sensitivity but is internally consistent. 78% reflects *no oracle*, not a known defect. |
| **Daily Performance** | **YES-except-known-X** | Orders + gross revenue match SC to the unit on days 1–24; ROAS/CPA render (4.1/29.67). Divergence is ad-spend source (AWB `marketing_daily_costs` vs SC `daily_perf.db`) → +7.7% concentrated in last 6 days = snapshot timing. By-design. |
| **COGS** | **NO-because-Y** | Net April Δ −0.18% on the both-delivered intersection, but that hides offsetting buckets (BUG-2 +17.5K, BUG-3 covoria empty line_items −5.9K, BUG-4 exclusion −13.9K, BUG-5 GRAND drops −7.1K) **plus** the new whole-order-drop bug now also removes 1,696 orders' COGS from the denominator. Needs fix. |

**Bottom line:** **Deliverability, Sales Velocity, Product Profitability, Daily Perf** = trustworthy with documented caveats. **P&L and COGS** = NOT trustworthy until the variable-shadowing bug + marketing backfill land. **SKU Risk** = internally consistent but un-oracled.

---

## 2. Marketing Coverage — Is it 100% for all months + all stores?

**No.** Coverage is full for Jan-2025 → Feb-2026, then breaks. There are also two structural store-mapping gaps that are 0% all-time.

### Coverage facts (`marketing_daily_costs`: 7,526 rows, 2025-01-01..2026-06-02, 21 store_names)

| Month (2026) | Distinct days imported | Expected | Status |
|---|---:|---:|---|
| Jan | 31 (matches SC to the cent) | 31 | OK |
| Feb | 28 (matches SC to the cent) | 28 | OK |
| **Mar** | **8 (Mar 1–8 only)** | 31 | **71% MISSING** |
| Apr | 30 (days 1–24 match to cent; 25–30 AWB is *more-final* than stale SC copy) | 30 | OK |
| **May** | **18** | ~31 | **PARTIAL** |
| **Jun** | **2** | (so far) | **PARTIAL** |

- **March gap is huge:** AWB total FB+TK+G = **376,100 RON** vs Scripturi **1,313,263 RON**, **Δ −937,164 (−71.4%)**. Every mapped store undercounts (esteban.ro AWB 126,519 vs SC 488,299). This **overstates March net profit by ~937K RON** in both daily-perf and the P&L.
- **Root cause:** the sheet→DB importer was only run for the early part of each period and never caught up the tail. (The April 25–30 "overshoot" is the *opposite* — AWB has the finalized next-day sheet values; the Scripturi SQLite copy is the stale side, written intraday before Meta finalized. The `daily_perf.py` docstring claim that AWB "differs 5–10%" is **inaccurate** — they are identical for finalized days.)

### Store-mapping gaps (0% all-time)

| Store | Problem | P&L impact |
|---|---|---|
| **casaofertelor.ro** (id=19) | Real store, **16,267 orders in 2026**, but **ZERO marketing rows ever**. Brand is mapped (`casa ofertelor`→casaofertelor.ro) but neither the CPA sheet nor Scripturi has a "Casa Ofertelor" brand row (SC only has "Ofertele Zilei"). | Per-store net profit **overstated by its entire ad spend** (unknown amount). |
| **bonhausro.ro** | Marketing key with **no matching store** (stores has only bonhaus.bg/.cz/.pl). In `profitability.py` the overall `__total__` (line 676) **sums** bonhausro.ro, but per-store P&L keys by `store_name` so it lands in **no** per-store line. **2026: ~421K RON** (Jan 149,390 + Feb 128,133 + Mar 19,723 + Apr 85,561 + May 38,192). | `sum(per-store net) ≠ overall net`; overall P&L charged ~421K marketing **with no offsetting revenue**. |

### Not bugs (documented divergences)
- **Grandia** present in AWB (own "Grandia" sheet tab, 171 rows), absent from Scripturi daily_perf → explains the Jan/Feb +3–5% delta. AWB is *more complete*.
- **nubra** is a real store, only mapped May onward — March/April spend missing is the same tail-lag, not a mapping fault.

### Fix
1. **Backfill** `sync_marketing_costs` over **2026-03-09 .. 2026-06-05** (recovers the ~937K March gap + May/June tails). Verify post-backfill `2026-03` distinct-days=31. — `backend/app/services/google_sheets.py`, one-off `backend/scratch/backfill_marketing_2026.py` — **S**
2. **Self-healing tier:** schedule `sync_marketing_costs` on a rolling trailing ~35-day window + re-sync last ~5 days daily (the exact pattern that made the SC copy stale). — `scheduler.py`, `sync_service.py`, `google_sheets.py` — **M**
3. **casaofertelor.ro:** confirm whether spend is tracked under a different sheet label; add to `BRAND_TO_STORE` if so, else document that its marketing is intentionally 0 and surface a UI "marketing missing" warning. — `google_sheets.py`, `profitability.py` — **M**
4. **bonhausro.ro orphan:** add the RO store, OR remap the key, OR exclude `bonhausro.ro` from `__total__`. Add an assertion `sum(per-store marketing) == __total__` that logs orphan store_names. — `profitability.py` (658–687, 962–965, 1031–1035) — **M**
5. **Coverage self-check report:** flag (month, store) where store has orders but zero marketing, or marketing distinct-days < days-elapsed. — new `marketing_coverage.py` (reuse `csv_coverage.py`) — **M**

---

## 3. Orders Sync / Staleness — Is it stale-free?

**No.** The sync can and **does** leave orders permanently stuck in a non-final status. BUG-1 is real and large.

### Current stuck-order count + hidden revenue (live DB)
- **1,700 orders** sit in `fulfilled` / `waiting_for_courier` with a **valid tracking_number** and `frisbo_created_at > 30d`.
- Cross-referenced 1,353 of the 2026 stuck orders against Scripturi (1,351 matched): **462 resolve to Livrata/Delivered**, 17 in-curs, 13 refuzata.
- **Hidden delivered revenue = ~154,911 RON** (store-currency sum of the 462 Livrata subset) — plus its COGS/profit — invisible to **every** AWB report.
- **696** of the stuck orders are **>90d old** (144 Scripturi-Delivered) — **beyond every tier's window**, unreachable by any current sync.

### Why it's stuck (three compounding causes)
1. **Re-pulling can't cure it.** All 1,700 stuck orders were **synced within the last 24h** yet still read the frozen status. `sync_service.py:528–530` overwrites `aggregated_status` with Frisbo's **search-endpoint** value unconditionally, and `order_awbs.shipment_status` is NULL for all 1,700 (no local courier signal to override). The fix must reconcile against an **independent source** (forced single-order Frisbo GET `/orders/order/{uid}`, Shopify-DELIVERED, or courier feed) — not re-fetch search.
2. **The "cure" tiers never ran.** `recheck_30d` / `recheck_90d` have **zero rows in `sync_logs` in any status, ever**. The running process predates the 2026-06-04 `scheduler.py` edit (mtime confirms) and was never restarted. (`deep_90d` ran 01:18, `window_30d` 05:18 today — scheduler IS alive, just on stale code.)
3. **They vanish from metrics, not just drag the ratio.** `status_classification.py:62–78` buckets `fulfilled`+`waiting_for_courier` into NOT_SHIPPED → `classify()`='other' → excluded from delivered-revenue, COGS, **and** the deliverability denominator. The justifying comment ("all fulfilled orders have shipment_status=not_created, no AWB") is **false for exactly these 1,700** (they have tracking + order-level `shipment_status='created_awb'`).

### Side facts
- `awb_count` is uniformly **1 for all 553,262 orders** — sync never sets it; only a manual PATCH does. Any `awb_count>=1` predicate is a **no-op**; `tracking_number NOT NULL` is the real AWB-existence filter.
- **Stuck-running guard works:** `main.py` lifespan (102–127) flips `running`→`cancelled` on startup; 0 orphaned running rows now, 248 historical cancelled incrementals. Only an **in-flight hang within a live process** is unguarded (APScheduler `max_instances=1` silently skips; no in-process watchdog).

### Concrete fix
1. **Reconciliation tier (`reconcile_tracked`)** — target the BUG-1 shape directly: `aggregated_status IN (fulfilled, waiting_for_courier, processing…) AND tracking_number IS NOT NULL AND not-yet-terminal`, oldest-first, batched/capped (~500/run) so it covers **all ages incl. >90d**. For each, forced single-order Frisbo GET (richer than search) and/or honor a Shopify-DELIVERED/courier signal. Run every 1–3h. — `sync_service.py`, `scheduler.py`, `frisbo/client.py` (has `get_order()`) — **L**
2. **Treat tracked + Shopify-DELIVERED as delivered:** ingest/refresh `order_awbs.shipment_status`; in `status_classification.py` add an override so an order whose latest outbound AWB event is delivered counts as delivered even when Frisbo is frozen. Backfill once over the 1,700. — `status_classification.py`, `sync_service.py`, one-off `migrate_reconcile_stuck.py` — **M**
3. **Restart the backend** so the merged `recheck_30d/90d` tiers actually start; confirm via `sync_logs`. Necessary but **not sufficient** (re-pull returns frozen status) — pair with #1. — operational — **S**
4. **In-process watchdog:** at the start of each scheduled sync, cancel any `running` sync_log older than ~2h (same logic as lifespan guard) so a live-process hang can't keep `max_instances=1` blocking new runs without a restart. — `sync_service.py` / `scheduler.py` — **S**
5. **Populate `awb_count`** from parsed outbound AWBs during sync so multi-AWB logic is meaningful. — `sync_service.py`, `migrate_backfill_awb_count.py` — **S**

---

## 4. UI — Do all filters / date-pickers / sorting work?

**Mostly yes.** Plumbing is mature: UTC-safe `fmtLocal()` date pickers (no off-by-one), period presets + custom-range guards, server-side sort/filter/pagination with 300ms debounce in Orders.jsx (resets page on filter change), URL-persisted store multi-select, empty/loading/error states on every tab, `dark:` variants present, sorting toggles asc/desc(/off in SkuCosts) on the right field. The new `cpa/roas/delivery_rate` null columns **do not crash sort** (every tab coerces via `?? 0` / `?? -1` / `|| 0`).

### Concrete bugs found (2)

| # | Tab | Bug | Severity |
|---|---|---|---|
| **1** | **ProfitabilityTab** | **Order-table Prev/Next pagination never refetches** (stuck on page 0). The orders fetch lives **only** inside the inline `onClick` of "Load Orders" (lines 129–153) reading `skip=orderProfitPage*25` at click time. Prev/Next (391–404) call `setOrderProfitPage(...)` but **there is no `useEffect`**, so nothing re-fires on page change. The counter + disabled-state update, but the table keeps showing rows 0–24. Backend supports it (`profitability_orders.py get_order_profitability(skip,limit)`). | **medium** (functional) |
| **2** | **DailyPerformanceTab** | **AOV KpiCard sparkline plots revenue, not AOV.** Line 252 passes `sparkKey="incasari"` (revenue). Headline value/delta correctly use `tTotals.aov`, but the mini-trend draws the daily revenue line. Misleading only; the series rows carry `incasari/comenzi/livrate`, no per-day `aov`. | **low** (cosmetic) |

### Not bugs (intentional / convention nits)
- **Null-sort semantics** on cpa/roas/delivery_rate are lossy (a `null` roas coerces to 0/−1 and ranks with real zeros) but **never throw** — intentional simplification.
- ProfitabilityTab "Load Orders" / "Load Gaps" use **inline `onClick`** instead of named handlers — violates the greppability convention; every other tab follows it.
- **"30 zile" preset = 31 inclusive days** in most tabs but **30** in ProductDeliverabilityTab (`getDate()-29`) — same label, off-by-one window. Cosmetic.

### Fix
1. Extract the inline "Load Orders" fetch into a named `loadOrderProfit()` and add `useEffect([orderProfitPage, orderProfitStatus])` (only after first load) so Prev/Next fetch the next page. Keep explicit-click for the **first** load. — `ProfitabilityTab.jsx` — **S**
2. Change `sparkKey` on line 252 away from `incasari` (smallest fix) or add a per-day `aov` to the range series. — `DailyPerformanceTab.jsx` — **S**
3. Optional polish: centralize 30d/90d inclusive-day arithmetic in `analyticsHelpers.js`; convert the two inline onClicks to named handlers. — `analyticsHelpers.js`, `ProfitabilityTab.jsx`, `ProductDeliverabilityTab.jsx` — **M**

---

## 5. Data Sources — All correctly implemented + reliable?

All 7 sources are wired and AWB **degrades gracefully** if any single one is down (every external call logs + continues). But there are 6 real bugs (1 high) and 2 latent-but-harmless-today items.

| Source | Verdict | Gap |
|---|---|---|
| **Frisbo** | OK-with-gaps | Multi-org token rotation + 20 req/s token bucket + correct pagination, BUT **no retry on transient 429/5xx** (3-consecutive-error org-abandon; next cycle recovers → bounded latency, not loss). |
| **Google Sheets (marketing)** | **RISKY** | Public gviz CSV, no auth/retry, DB-cache-first. **Delete-then-insert can silently zero a date range on fetch failure** (both sheets `[]` → range deleted, nothing re-inserted → cached cost becomes 0 with no error to the P&L). |
| **BNR exchange rates** | **STALE-RISK** | Covers EUR/CZK/PLN/BGN/USD/HUF with 30-day fallback, BUT **synced only at app startup — no scheduled job**. A long-running process never ingests new daily rates; masked today only because the table is current from a recent restart. |
| **Scripturi imports (sku_costs, sku_ad_spend_daily)** | By-design staleness | One-shot manual scratch CLIs reading **local SQLite copies** of the VPS DBs. Not scheduled; freeze at last manual run; **no freshness indicator in UI**. |
| **TOM PO API** | Latent landmine | HMAC-signed; `tom_client.py` references **undefined module globals** (`TOM_BASE_URL/TOM_API_KEY_ID/TOM_HMAC_SECRET`) → `NameError` reproduced on partial config. Dodged today only because `settings.py:159` guards all 3 keys present. `_sign_request` is dead code. |
| **eMAG / Trendyol** | OK | Env-gated/inert, fully graceful. |
| **InventorySync stock** | OK | Wired, graceful. |

### The high-severity one
**Partial Frisbo payload silently wipes line_items → COGS=0.** `sync_service.py:564` does `if parsed.get("line_items") is not None: existing.line_items = ...`, but `parser.py:73–82` **never returns None** (it returns `[]`). So any recheck that re-fetches an order whose payload omits/empties line_items overwrites good data with `[]` and zeros `item_count`. **Live DB: 599 delivered-2026 orders already have item_count=0** (covoria.ro 497, nubra 93, grandia.ro 8, magdeal.ro 1) → COGS computes as 0 for all of them.

### Verified side-facts
- **USD ad-spend hardcoded at 4.55**, but BNR **does** carry USD (n=819, latest 2026-06-04 = **4.5223**). The "AWB BNR has no USD" comment is **false**; the frozen 4.55 over-converts per-SKU FB/TK spend ~0.6% and drifts.
- **BGN feed dead since 2025-12-31** (Bulgaria adopted EUR 2026-01-01). 30-day fallback now exhausted, but **live impact = 0** (all 33 BGN-2026 orders dated 2026-01-01; BG stores now bill in EUR). Latent only.

### Fix
1. **Fix line_items overwrite:** use `if parsed.get('line_items'):` (non-empty) or a parser sentinel distinguishing absent-payload from genuinely-0-items. Backfill the 599 affected orders via full single-order GET. — `sync_service.py:564–569`, `parser.py:73–88`, scratch backfill — **M**
2. **Replace frozen 4.55 with live `get_rate('USD', date)`**; re-run the per-SKU ad-spend import. Keep 4.55 only as last-resort fallback. — `scratch/import_scripturi_marketing.py`, `sku_ad_spend_daily.py`, `sku_profitability/endpoint.py` — **S**
3. **Scheduled BNR sync** (daily after ~13:00 EET). — `scheduler.py` — **S**
4. **Non-destructive marketing sync:** only DELETE+reinsert a (date,store) key when that sheet fetch succeeded; skip delete entirely if both sheets returned `[]`; surface a failed-fetch error. — `google_sheets.py:86–189` — **M**
5. **Fix TOM globals:** delete dead `_sign_request`, read defaults from `_cfg()` not undefined `TOM_*`, remove stray module-level `TOM_SOURCE_CODE` @property. — `tom_client.py:38–63,140–167` — **S**
6. **Bounded retry/backoff** (2–3 attempts honoring Retry-After) for Frisbo 429/5xx before the 3-error abandon. — `frisbo/client.py:45–110` — **M**
7. **Stale-rate/dead-currency guard:** if `get_rate` falls back beyond N days, or a currency (BGN) has no in-window rate, flag in `unconvertible_currencies` surfaced to the P&L UI instead of returning None silently. — `exchange_rates.py:118–144,200–221` — **S**

---

## 6. Prioritized Fix Plan (impact × effort)

### REAL BUGS — ranked. ★ = required to truthfully say "the data is 100% correct."

| # | ★ | Fix | Front | Impact | Effort | Files |
|---|:--:|---|---|---|:--:|---|
| 1 | ★ | **P&L variable-shadowing** — rename the `exclude_from_stock` set (line 158) to `cogs_excluded_skus` so it stops clobbering the configurable `excluded_skus` (line 120) used by the whole-order skip (line 291). Re-enables the intended SKU-exclusion rule AND stops dropping 1,696 orders / ~219K RON revenue. Add regression test: P&L delivered count == deliverability delivered count. | Parity | **~219K RON + 1,696 orders restored to P&L/COGS** | **S** | `profitability.py` 120/158/291; `tests/` |
| 2 | ★ | **Marketing backfill** 2026-03-09..06-05 + verify Mar distinct-days=31 | Marketing | **~937K RON March overstatement removed + May/June tails** | **S** | `google_sheets.py`; `scratch/backfill_marketing_2026.py` |
| 3 | ★ | **line_items overwrite fix** (`if parsed.get('line_items'):`) + backfill 599 orders | Sources | **599 orders' COGS recovered from 0** | **M** | `sync_service.py:564`; `parser.py:73`; scratch |
| 4 | ★ | **bonhausro.ro orphan** — remap / add store / exclude from `__total__` + add `sum(per-store)==__total__` assertion | Marketing | **~421K RON phantom marketing on overall P&L** | **M** | `profitability.py` 658–687/962–965/1031–1035 |
| 5 | ★ | **casaofertelor.ro zero-marketing** — map brand or document+warn | Marketing | **16,267-order store's net profit overstated** | **M** | `google_sheets.py`; `profitability.py` |
| 6 | ★ | **Sync reconciliation tier** (`reconcile_tracked`, forced single-order GET, all ages incl. >90d) | Sync | **~155K RON delivered revenue + 462 orders recovered** | **L** | `sync_service.py`; `scheduler.py`; `frisbo/client.py` |
| 7 | ★ | **Tracked + Shopify-DELIVERED → delivered** override in classifier + backfill 1,700 | Sync / Parity | **Deliverability + GRAN −108K April recovered; stops metric-vanishing** | **M** | `status_classification.py`; `sync_service.py`; migrate |
| 8 | | **Restart backend** so recheck_30d/90d tiers run (necessary, not sufficient — pair with #6) | Sync | Enables tail re-pull | **S** | operational |
| 9 | | **USD 4.55 → live BNR rate** + re-run ad-spend import | Sources | ~0.6% ad-spend accuracy, drift-proof | **S** | `import_scripturi_marketing.py`; `sku_profitability/endpoint.py` |
| 10 | | **Scheduled BNR sync** (daily) | Sources | Prevents long-process rate drift | **S** | `scheduler.py` |
| 11 | | **Non-destructive marketing sync** (no delete on empty fetch) | Sources | Prevents future silent zeroing | **M** | `google_sheets.py:86–189` |
| 12 | | **ProfitabilityTab pagination** (named `loadOrderProfit` + `useEffect`) | UI | Functional: Prev/Next actually pages | **S** | `ProfitabilityTab.jsx` |
| 13 | | **Self-healing marketing tier** (rolling 35d + last-5d daily) | Marketing | Stops future tail-lag | **M** | `scheduler.py`; `sync_service.py`; `google_sheets.py` |
| 14 | | **In-process stuck-sync watchdog** (cancel running >2h) | Sync | Hang no longer blocks max_instances=1 | **S** | `sync_service.py` / `scheduler.py` |
| 15 | | **TOM globals fix** (dead `_sign_request`, `_cfg()` defaults) | Sources | Removes NameError landmine | **S** | `tom_client.py:38–63,140–167` |
| 16 | | **Frisbo 429/5xx retry/backoff** | Sources | Fewer org-abandons | **M** | `frisbo/client.py:45–110` |
| 17 | | **DailyPerformanceTab AOV sparkline** (`sparkKey` off `incasari`) | UI | Cosmetic correctness | **S** | `DailyPerformanceTab.jsx:252` |
| 18 | | **Populate `awb_count`** from outbound AWBs | Sync | Makes multi-AWB logic meaningful | **S** | `sync_service.py`; migrate |
| 19 | | **awb_count / coverage self-check reports + stale-rate guard** | Marketing / Sources | Visibility of future gaps | **M / S** | new `marketing_coverage.py`; `exchange_rates.py` |
| 20 | | **Align P&L vs SKU-Profitability order universe** (after #1) | Parity | Internal report consistency | **M** | `profitability.py`; `sku_profitability/endpoint.py` |

### BY-DESIGN DIVERGENCES (do NOT "fix" — document only)
- **Grandia** in AWB, absent in SC daily_perf (AWB more complete; own sheet tab).
- **Deliverability denominator buckets differ** (AWB splits returned/refused/ofd; SC folds) — nets to Δ 0.02 pts.
- **Deliverability source differs** (AWB Frisbo aggregated_status vs SC DPD/Sameday + Shopify-DELIVERED override) — root of per-store GRAN gap; the *override* should be adopted (fix #7), but the source difference itself is by-design.
- **Sales Velocity** universe (DELIVERED-only/RON/barcode vs all-placed/native/raw) — map SC `qty_sold` → AWB `gross_units`.
- **Product Profitability** universe (SC drops ~15.6% incl. all Nubra) — AWB more complete.
- **VAT mechanic** (divide-out vs separate-line; rate identical 21% for April — the brief's "19% vs 21%" is inaccurate for April).
- **Transport** (AWB real per-order share vs SC flat 13.00/unit), **FX** (AWB daily-BNR vs SC flat-monthly).
- **April 25–30 marketing "overshoot"** — AWB is *more-final*; the Scripturi SQLite copy is the stale side. Correct the `daily_perf.py` docstring (it claims a 5–10% methodology difference that does not exist).
- **Scripturi SQLite imports** stale by design (manual one-shot off local copies) — add a freshness indicator, don't re-architect.
- **BGN dead feed** — 0 impact today (BG stores on EUR); latent only.
- **UI null-sort coercion, 30d off-by-one, inline onClicks** — intentional/convention nits.

### "Is the data 100% correct?" — the must-fix gate
The data is **not** 100% correct today. To truthfully claim it is, land the **★ items (#1–#7)** in this order:
**#1 (P&L shadowing, S)** and **#2 (marketing backfill, S)** are the two highest-impact, lowest-effort fixes — do them first; together they recover ~219K + ~937K RON of misstatement. Then **#3 (line_items, M)**, **#4/#5 (marketing mapping, M)**, and **#6/#7 (sync reconciliation, L+M)** to recover the ~155K RON of hidden delivered revenue and stop the metric-vanishing. Everything else is hardening/visibility, not correctness-blocking.
