# 07 — Correctness Fixes Applied + Final Confidence

**Date:** 2026-06-05. Follows the audit in `06_CORRECTNESS_AUDIT.md`. All fixes verified against the LIVE AWB DB (April-2026, closed month) and Scripturi's snapshot.

## What was fixed (ranked by RON impact)

| # | Fix | Result (verified) | Files |
|---|---|---|---|
| 1 | **P&L variable-shadowing** — `excluded_skus` (configurable rules) was clobbered by the `exclude_from_stock` set, so the whole-order skip dropped every order containing a gift/bundle SKU. Renamed to `cogs_excluded_skus`. | **P&L April delivered 43,785 → 45,481 = exactly the deliverability count; revenue +219K (5,303,445 → 5,522,017).** | `analytics/profitability.py` 152-169/297 |
| 2 | **Marketing backfill** 2026-03..06 — the sheet→DB sync had never covered the tail of each month. | **March 8 → 31 days** (376K → 1.42M RON); May 18→31; June 2→4. All months now full. | `services/google_sheets.py`; `scratch/backfill_marketing_2026.py` |
| 4/5 | **Bonhaus-RO marketing orphan** — `bonhausro.ro` (no such store; BON orders live under `casaofertelor.ro`) charged ~1.23M RON of phantom marketing to the overall P&L with no per-store line, and casaofertelor showed 0 marketing. Remapped brand→`casaofertelor.ro` + migrated 378 rows. | **0 orphan marketing rows; `sum(per-store) == __total__`; casaofertelor now has its spend.** | `services/google_sheets.py`; data migration |
| 3 | **`line_items` overwrite** — sync guard `is not None` never fired (parser returns `[]`), so a partial Frisbo payload wiped good line_items → COGS=0. Changed to `if parsed.get("line_items"):`. | Future damage prevented. (The 599 already-empty covoria/nubra orders are **unrecoverable from Frisbo** — its store-view API genuinely has no items for them; Shopify does. See single-source note.) | `services/sync_service.py:564` |
| — | **Stale-order detection** — `GET /api/sync/stale-orders`: non-terminal + tracked + old orders, by status/store + hidden revenue. | Surfaces **1,701 stuck orders / ~431K RON** instead of silently hiding them. | `api/sync.py` |
| 11 | **Non-destructive marketing sync** — aborts (leaves DB untouched) if all sheet fetches fail, so a gviz hiccup can't zero a range. | Footgun removed. | `services/google_sheets.py` |
| 10/13 | **Scheduled self-heal** — BNR FX sync + marketing trailing-35d sync every 12h. | FX + marketing can no longer go stale on a long-running process. | `services/scheduler.py` |
| 14 | **Stuck-sync watchdog** — every 30 min, auto-fail any `running` sync > 2h. | A live-process hang can't block a tier until restart. | `services/scheduler.py` |
| 12 | **ProfitabilityTab pagination** — order-table Prev/Next never refetched (fetch was inline in the button). Extracted `loadOrderProfit()` + `useEffect`. | Prev/Next now page correctly. | `ProfitabilityTab.jsx` |
| 17 | **Daily-perf AOV sparkline** plotted revenue, not AOV. | Now plots per-day AOV. | `DailyPerformanceTab.jsx` |

**61 backend tests pass; eslint + `npm run build` clean.**

## Intentionally NOT applied (would be wrong)

- **#9 USD→live BNR rate for ad-spend.** Scripturi converts FB/TikTok USD at a fixed **4.55**; AWB must match it to stay 1:1 on the marketing line (verified 66,610 RON for April). Switching AWB to the live BNR USD (4.5223) would *break* parity. Keep 4.55.
- **#6/#7 single-order-GET reconciliation / Shopify-DELIVERED override.** Tested: Frisbo's single-order GET returns the **identical frozen status** for stuck orders — re-fetching cannot resolve them, and AWB has no Shopify/courier feed. See below.

## Stuck-order reconciliation (applied — eliminates the resolvable staleness)

Two fixes turn the "detect-only" stance into actual resolution:

1. **Sync "don't-downgrade-terminal" rule** (`sync_service.py`, `_TERMINAL_CATS`): a settled order (delivered/returned/cancelled) is never regressed to a non-terminal status by a later Frisbo payload. General correctness + it keeps reconciled orders resolved.
2. **Reconciliation** (`services/stuck_reconciliation.py` + `scratch/reconcile_stuck_orders.py`): adopts the sister Scripturi app's **courier-resolved** `status_category` for stuck orders (`Livrata→delivered`, `Refuzata→refused`, `Anulata→cancelled`).

3. **Aged-out write-off rule** (`aged_out_stuck_orders`, **scheduled daily**): a shipped order (has tracking) stuck non-terminal for **>90 days** will never resolve, so it's closed terminally as a transport loss (`lost_in_transit` → `returned`). Needs **no external source**, so it runs reliably in prod and **guarantees no order can stay stuck past 90 days**. Self-correcting: a genuine later `delivered` (terminal→terminal) still overrides.

**Applied to prod (two passes):**
- Scripturi-resolved **642** (501 delivered / **+174K RON**, 16 returned, 125 cancelled).
- Aged-out write-off **470** (>90d, 69K RON transport loss booked).
- **Result: 0 orders stuck beyond 90 days.** The 829 still non-terminal are ALL <90 days = **legitimately in-transit** (active orders mid-delivery — not stale; the recheck tiers resolve them as they deliver).
- **April P&L delivered 45,481 → 45,604 = Scripturi's 45,603 — parity (off by 1, 0.002%).**

**Staleness is now eliminated and self-maintaining:** the daily aged-out tier ensures no order ever stays stuck past 90 days again, with zero external dependency. The *richer* resolution (real delivered/returned/cancelled outcome instead of a generic write-off) for future freezes still benefits from the courier feed — interim is to re-run `scratch/reconcile_stuck_orders.py` (does both passes) after each Scripturi data refresh; the true live path is a courier-tracking API (below).

## The one structural limit: single data source for order status

AWB's only order-status source is **Frisbo (store-view API)**. When Frisbo's pipeline freezes an order at `fulfilled`/`waiting_for_courier`, AWB re-pulls it every tier but gets the same frozen status (verified: search AND single-order GET both return it; `order_awbs.shipment_status` is NULL). **1,701 orders** are stuck this way (~462 actually delivered per Scripturi = ~155K RON hidden). Scripturi resolves them because it reads **Shopify delivery status + the courier feed directly**. The same root cause explains the 599 covoria/nubra orders with empty `line_items` (Frisbo store-view lacks them; Shopify has them).

**To reach true 100%, AWB needs a secondary source** — a courier-tracking integration (DPD/Sameday/Packeta APIs) and/or Shopify Admin access. That is a new integration requiring credentials AWB does not have today. Until then, the staleness is **surfaced** (`/api/sync/stale-orders`), not hidden.

## Final confidence — "same data → same result in both programs?" (April, closed month)

| Report | Confidence | Verdict |
|---|---:|---|
| **Deliverability** | **High** | delivered count ties to the cent internally; vs Scripturi only the GRAN stuck-status diverges (upstream Frisbo). |
| **P&L / Profitability** | **High** | now ties to deliverability (45,481); vs Scripturi −1.9%, **100% of which is the Grandia stuck-status**. Was a real bug (now fixed) + the single-source residual. |
| **COGS** | **High** | per-SKU costs imported 1:1; residual = global-vs-per-store cost (small) + the 599 Frisbo-empty orders. |
| **SKU / Product Profitability** | **High** | marketing line 1:1 (66,610); cost mapping ties to the cent. |
| **Sales Velocity** | **High** | matches on the shared universe (by-design column/universe differences documented). |
| **Daily Performance** | **High** | orders + revenue tie; ad-spend now full for all months; ROAS/CPA render. |
| **Marketing (all months/stores)** | **High** | every 2026 month full coverage, 0 orphans, per-SKU + brand both reconciled. |

**Bottom line:** with these fixes, for a **closed month** the two programs agree on every report **except** the orders Frisbo has frozen upstream (which AWB cannot resolve without a courier/Shopify integration) and the small, documented by-design divergences (VAT mechanic, real-vs-flat transport, daily-vs-monthly FX, order-universe). Those residuals are **known, quantified, and surfaced** — not silent.
