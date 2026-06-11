# 11 — Full May-2026 reconciliation: AWB Arona vs Scripturi (2026-06-11)

Both systems freshly synced (Scripturi courier re-track: Livrata 46,456 / In-curs down to 261; AWB scheduler
current). Scripturi code re-pulled and re-diffed (only change since 06-09: a CS-agent status-bucket feature —
non-financial). Comparison = per-order full join of **Bucharest-local May** (Apr 30 21:00 → May 31 21:00 UTC,
exactly Scripturi's `_parse_month_range` semantics) + each system's OWN report output. Artifacts:
`c:/tmp/per_order_may.csv` (59,982 rows), `awb_2026_05_reports.json`, `sc_2026_05_report_fresh.json`.

## Headline: the two systems see the SAME May

| Metric | AWB | Scripturi | Δ |
|---|--:|--:|--:|
| **Orders in May (raw)** | **59,982** | **59,982** | **0 — identical universes** |
| Orders in report | 59,982 | 58,646 | 1,336 = SC's `test`-tag exclusion (below) |
| Status agreement (per order) | — | — | **97.90%** (94.94% strict 4-pair + 1,779 not-shipped semantic) |
| Delivered | 46,743 | 46,456 | +287 (+0.61%) |
| Shipped vs plecate | 55,760 | 55,753 | **+7** |
| Deliverability rate | 83.83% | 83.32% | +0.51pp |
| Delivered revenue | — | — | **+0.38%** (decomposed to 0.00 residual) |
| COGS | — | — | −0.86% |
| Per-SKU units (barcode-family join) | — | — | **r = 0.994**, −1.5% |

**The earlier "different number of orders" is GONE** — it was two artifacts: (a) my previous comparison
bucketed AWB by UTC month vs Scripturi's Bucharest month (caused the phantom 309/285 "only-in-one" orders);
(b) Scripturi's report-time exclusion of 1,336 test orders. With correct bounds, the universes are identical.

## Every difference, root-caused

### 1. The 1,336 order-count gap = magdeal **test orders** (AWB should exclude too) — `awb-issue`
All 1,336 are magdeal.ro Releasit COD-form test submissions tagged `test` (155,724 RON nominal, **0 delivered,
0 shipped**). SC excludes them at report time (`profit_exclusion_rules`). AWB **built the identical mechanism**
(`order_filters.py` + `exclusion_rules` + tag sync) for exactly this parity, but it's currently inert in the
running report. Effects on AWB: magdeal total overstated 34%, expedition_rate −23pp on MAG, the global `other`
bucket 93% junk (1,333/1,427), 155K phantom gross_sales on MAG. **P&L profit and delivery_rate untouched**
(none delivered). Fix = activate the exclusion (rule row + tags present + deployed code).

### 2. NEW AWB classifier bug: **`customer_pickup` ≠ delivered** — `awb-issue`
AWB's `classify()` maps Frisbo `customer_pickup` → delivered. Reality (courier feed, 278 May orders): **only 1
actually collected**; 164 still waiting at the pickup point, 54 already "Returned to Office" (= became
returns), 37 cancelled. AWB prematurely books ~30–38K RON revenue + COGS as delivered on parcels that
demonstrably convert to returns. Drives CZ +1.27pp rate vs SC. **Fix: map `customer_pickup` → in_transit**
(terminal only on a real collection scan).

### 3. Frisbo-frozen orders (the known durable limit) — `frisbo-upstream`
238 orders frozen at `waiting_for_courier`/`fulfilled` that couriers show DELIVERED (~50K RON, 172 = BELA) +
57 "cancelled" in Frisbo that physically shipped & returned (BELA 42). BELA is the only store where AWB
under-counts delivered (−169). Same single-source root cause as documented; the periodic Scripturi
reconciliation pass is the mitigation.

### 4. Scripturi blind spots — `scripturi-issue`
- **199 delivered + 91 returned orders SC calls "Netrimisa"** (OFER/RED/MAG/BON): Shopify fulfillment was
  never recorded → SC has no AWB number to track (sc_has_awb=0) and assumes never-shipped. SC under-counts
  livrata/refuzata (~34K RON). Explains most of OFER's +128 delivered delta.
- **Marketing STILL split-brain**: SC's report marketing = 401,469 — bit-identical to the stale finding; the
  app-read `daily_perf.db` remains frozen at 2026-05-27 (15/31 days) while the cron writes the complete copy
  (1.44M) elsewhere. Unfixed since the last audit.
- **Per-SKU analytics revenue bug**: `product_analytics.py` subtracts `discountAllocations` from the
  already-discounted `discountedTotalSet` → ~halves per-SKU revenue on discount-heavy stores (EST/GT/NUB).

### 5. By-design / methodology (documented, not bugs)
- **Transport −82.5K**: AWB real per-order cost vs SC flat per-parcel. Side finding: SC's flat rates
  understate real cost on CZ (22.5 vs ~31.75) and BELA, overstate GRAN.
- **FX +15.2K revenue**: SC static rates (PLN 1.16, EUR 4.97) vs AWB daily BNR (~1.225/~5.2). Native amounts
  identical per order — pure rate-table difference.
- **Cancel-vs-return naming** (114 orders): post-dispatch cancels/sender recalls — AWB books the physical
  return (cost-true), SC books intent (Anulata). Both defensible.
- **Grandia untracked courier** (44 in-curs, 66.6K RON — biggest single revenue cell): neither system has real
  tracking; SC guesses in-transit, AWB shows Frisbo's frozen `fulfilled`.
- **AWB per-SKU revenue uses Frisbo list price** (ignores order-level discount allocation) → +11.8% per-SKU
  revenue overstatement on EST; order-level totals are correct.
- 143 delivered↔Refuzata hard contradictions (Frisbo "delivered" vs courier "Returned to Office") — needs a
  10-order physical spot check to adjudicate; ~19K RON.
- AWB deliverability table has a **hidden bucket**: 1,427 orders ('fulfilled' + 2 error statuses) appear in
  store totals but in no displayed column (display gap; rate unaffected — mostly the test orders from #1).

## Bottom line
Both programs are looking at the **same orders** and agree on **97.9%** of statuses, revenue to **0.4%**, COGS
to **0.9%**, per-SKU units at **r=0.994**. Every residual is attributed: 2 fixable AWB items (activate test
exclusion; `customer_pickup` mapping), 3 Scripturi items for the colleague (split-brain marketing — still
broken; Netrimisa AWB-linkage gap; per-SKU discount double-subtraction), the known Frisbo-frozen upstream
class, and quantified by-design differences (flat transport, static FX, naming).
