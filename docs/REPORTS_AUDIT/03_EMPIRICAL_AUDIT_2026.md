# AWB Print vs Scripturi — Empirical Reconciliation Audit (2026-04 / 2026-05)

**Audit date:** 2026-06-04 · **Method:** per-order join `order_number == order_name`, 100% universe match for 2026 (57,438 April orders matched, 0 unmatched on either side). AWB read LIVE; Scripturi read from a static snapshot frozen at **2026-06-02 12:12 UTC** (file mtime 2026-06-03 14:15).

---

## 1. Executive summary

**Verdict: AWB is reporting correctly.** Every material divergence is explained by either (a) an *upstream Frisbo status-sync defect* that suppresses AWB's delivered count, (b) a *stale Scripturi snapshot* that lags live AWB by ~1.5 days, or (c) *intentional design differences* (delivered-only vs gross, RON vs native currency, no ad-spend source). AWB's classifier, P&L formula, and daily-perf engine each behave exactly as specified. Where the two systems' completeness can be compared head-to-head, **AWB is the more complete source** (it matches Scripturi's own `profit_orders` 1:1, while Scripturi's product-analytics pipeline drops ~15.6% of orders).

### Headline numbers

| Metric | April 2026 (completed) | May 2026 (settling) |
|---|---|---|
| **Delivered revenue — AWB** | 5,515,340 RON | 6,036,138 RON |
| **Delivered revenue — Scripturi** | 5,629,531 RON | 5,632,908 RON |
| **Delta (AWB − SC)** | **−114,190 RON** (−2.0%) | **+403,230 RON** (+7.2%) |
| **COGS — AWB** | 1,299,182 RON | — |
| **COGS — Scripturi** | 1,301,512 RON | — |
| **COGS delta** | **−2,329 RON (−0.18%)** | +69 RON |
| **Status agreement** | **99.59%** (234 / 57,438 disagree) | ~99.4% |
| **COGS exact-match rate** | **91.2%** (41,465 / 45,463 delivered) | similar |

### One-line cause of each major difference

- **April −114,190 RON:** 95% (−108,339) is the **Grandia (GRAN) gap** — *Frisbo status-sync defect, AWB-side data-quality issue* (fixable in sync layer, not the P&L). Ex-Grandia residual is only −5,852 RON and is the same Frisbo-status-lag mechanism. **Not** stale data; April will not converge by re-snapshotting.
- **May +403,230 RON:** ~100% is **pure snapshot timing** — 3,407 orders delivered in live AWB but still in-transit in the frozen Scripturi snapshot (95% placed 22–31 May). *Intentional / self-healing*; converges on Scripturi re-snapshot.
- **COGS −0.18%:** nets tiny by coincidence — a **+17,501 RON over-cost** (cross-store cost collapse, *AWB bug*) offset by **−13,969 RON** (excluded gift/bundle SKUs, *policy decision*) and **−5,861 RON** (covoria.ro empty line_items, *AWB-side sync defect*). Fixing one side alone swings the total 6k–17k RON.
- **Status disagreements (234):** almost entirely *source/timing* at the delivered/returned/cancelled frontier — Frisbo `aggregated_status` vs DPD courier feed. Classifier needs no change.
- **SKU velocity deltas (~10–20%/SKU):** *Scripturi-side defect* — its product-analytics sync drops 8,939 April orders (incl. the entire Nubra store). AWB is correct/more complete.
- **Daily-perf missing columns (spend/ROAS/CPA):** *intentional structural gap* — AWB has no ad-spend ingestion source.

---

## 2. Real bugs / data-quality issues (AWB-side)

Ranked by RON impact. These are the items worth engineering time. Note that several are *upstream Frisbo sync* defects rather than AWB-code bugs — AWB's `classify()` and P&L are correct given their inputs; the fix belongs in the sync/reconciliation layer.

### BUG-1 — Grandia: 77 (+5) orders frozen at Frisbo `fulfilled`/`waiting_for_courier` despite valid AWB + Shopify-DELIVERED · **~107,564 RON** · severity HIGH

- **Impact:** 95% of the entire April topline gap. AWB delivered count is 85 short on GRAN (3,131 vs 3,216); 77 of that shortfall is this single cause (100,879 RON), plus 5 `waiting_for_courier` orders.
- **Root cause:** these GRAND orders sit at `aggregated_status='fulfilled'`, `shipment_status='not_created'` in AWB's Postgres (synced from Frisbo). `classify()` correctly maps `fulfilled` → `other` (NOT_SHIPPED set). But the premise is false for these rows: each has `awb_count=1`, a valid 8-digit Sameday tracking (`93…`), and Scripturi's `shopify_delivery_status='DELIVERED'`. Frisbo simply never advanced their lifecycle past `fulfilled`. Same orders, same money: **AWB `total_price` == Scripturi `revenue` to the cent (100,879.30 RON each side), AWB.`tracking_number` == Scripturi.`awb` for all 77.** Rows were re-synced LIVE today (2026-06-04 14:23) and remain stuck — *not* snapshot timing, *not* a revenue problem.
- **Evidence (order ids):** GRAND7068 (trk 93316957, tp 999.0), GRAND7168 (trk 93316842, tp 2499.9), GRAND7178 (trk 93316821, tp 849.0), GRAND7195 (trk 93361929, tp 999.0), GRAND10079 (fulfilled, sc_awb 93551937, DELIVERED). All 77 `store_uid = 8a438d7e…RZF1BEIFMY` (grandia.ro); all `frisbo_created_at` in 2026-04. Plus 5 at `waiting_for_courier` (dpd-ro, Shopify DELIVERED).
- **Fix:** Do **not** change `classify()` — `fulfilled → other` is correct for genuinely not-shipped orders. Add a **reconciliation rule**: an order in the NOT_SHIPPED pre-expedition set BUT with non-null `tracking_number` AND `awb_count >= 1` is a *stuck-status candidate*; surface these in the Tier-6 / data-quality sync report instead of silently dropping their revenue. Root fix is upstream: investigate why Frisbo never advances grandia.ro Sameday shipments past `fulfilled` (likely a missing Sameday tracking webhook for that store) and trigger a Frisbo re-pull. Optionally let analytics treat `tracked + Shopify-DELIVERED` orders as delivered, matching Scripturi.

### BUG-2 — Cross-store COGS collapse: global `sku_costs` ignores per-store cost · **+17,501 RON/month over-cost** · severity HIGH

- **Impact:** single largest COGS residual driver. +17,501 RON April (+14,319 May); the pure cross-store sub-component is +10,675 RON on 1,669 orders. Masked in the net total only because the exclusion bucket (BUG-4 below) offsets it.
- **Root cause:** Scripturi stores cost **per (sku, store/prefix)** — 171 SKUs have >1 distinct cost across stores. AWB's `sku_costs` table holds a **single global cost per SKU**, so for any multi-store SKU it applies whichever value it was imported with, systematically mismatching the order's actual store.
- **Evidence (SKUs):**
  - `fata-masa-rotunda` = 11.58 in OFER/MAG but 33.0 in RED; AWB uses 33.0 globally → OFER14752 (qty 3) costed **AWB 99.0 vs SC 34.74** (11.58×3). Same on OFER14792, OFER14979.
  - 152 numeric SKUs shared by Estrella + Nubra cost **9.0 in EST but 7.95 in NUB**; AWB collapsed all to 9.0 → every NUBRA order over-costed ~1.05/unit, e.g. NUBRA1831 (SKUs 156/163/29) **AWB 27.0 vs SC 23.85**.
  - `profit_cogs_override` is EMPTY in Scripturi, confirming its per-store costs come from `analytics_products.cost` keyed by prefix. 207 `(sku, prefix)` pairs where AWB single-cost ≠ SC prefix-cost.
- **Fix:** Make AWB COGS **store-aware** — import cost per `(sku, store_uid)` from Scripturi `analytics_products` (keyed by prefix) and resolve at COGS time using the order's store, not a global lookup. **Highest-value correctness fix here.** ⚠️ Removing this +17.5k *without* simultaneously deciding BUG-4 will swing the monthly COGS total downward by ~17.5k. Treat BUG-2 and BUG-4 as a coupled change.

### BUG-3 — covoria.ro: 220 delivered orders sync with empty `line_items` ([]) · **−5,861 RON/month under-cost** · severity MEDIUM

- **Impact:** −5,860.96 RON April COGS (COV only). 18.0% of all covoria.ro delivered orders (220 / 1,220). **April-specific** — this bucket is absent in May, indicating a one-off COV sync gap. Only 2 other empties exist across all stores (grandia.ro).
- **Root cause:** Frisbo returns no `line_items` for these COV orders (`item_count=0`, `line_items=[]`), so the COGS loop has nothing to iterate and books 0. Not a casing/coverage issue — case-insensitive and absent-SKU counters both returned 0; AWB's `sku_costs` coverage is complete.
- **Evidence (order ids):** COV12440, COV12511, COV12523, COV12732, COV12976 — all `status=delivered`, `item_count=0`. Scripturi costs them normally (COV12732 cogs=26.12).
- **Fix:** Sync/Frisbo data-completeness problem, not a COGS-formula problem. Investigate why covoria.ro orders sync with `line_items=[]` (likely a Frisbo store-view payload quirk) and re-sync. Until fixed, COV COGS is understated.

### BUG-4 — Excluded gift/bundle SKUs zero out COGS · **−13,969 RON/month under-cost** · severity HIGH (policy decision, not a code bug)

- **Impact:** −13,821.69 RON April / −14,149.38 RON May on ~1,650 orders. Almost exactly offsets BUG-2, which is why the net COGS residual is tiny.
- **Root cause:** AWB intentionally drops SKUs with `products.exclude_from_stock=true` from the COGS map. The dominant one is `surpriza-EST 41` (surprise-gift SKU) in 1,387 April delivered orders, plus `cad` (118) and bundle SKUs `set-5-m`/`set-5-s`/`set-10-s-10-m`. Scripturi does NOT exclude these — it costs `surpriza-EST 41` at 9.0, `set-5-m` at 4.66, etc.
- **Evidence:** `surpriza-EST 41` has `exclude_from_stock=true` AND `sku_costs=9.0` (would cost 9.0 if not excluded). 17 fully-excluded orders e.g. BELA31486 (set-5-m), BELA30916 (set-5-s). Snapshot drift on the gift SKU itself: EST143315 has `surpriza-EST 41` in AWB vs `surpriza-EST 84` in SC — immaterial since AWB excludes the family anyway.
- **Fix:** **Business decision — flag to the user, do not fix silently.** If surprise-gift / bundle SKUs incur real procurement cost (Scripturi treats them as costing 9.0/4.66), `exclude_from_stock` should gate *stock reports only, not COGS*, so they contribute to COGS. If they truly have zero marginal cost, AWB is correct and Scripturi over-costs. Because BUG-2 (+17.5k) and BUG-4 (−13.9k) currently cancel, **changing only one side swings the monthly total by ~14–17k RON** — decide both together.

### BUG-5 — grandia.ro furniture: partial `line_items` dropped by Frisbo sync · **−7,143 RON/month** · severity MEDIUM

- **Impact:** "line-item-set-mismatch" bucket −7,143.48 RON on 2,109 orders (much is surpriza-swap noise; the real furniture cases are a subset).
- **Root cause:** AWB drops individual lines on some multi-line GRAND furniture orders. Cost mapping itself is **correct and identical** to Scripturi (all 6 GD-* SKU costs match to the cent); the defect is line_items *completeness*, same class as BUG-3 but partial.
- **Evidence (order ids):** GRAND7873 — AWB `item_count=10`, lines GD-IL-6658×2, GD-IL-6659×2, GD-IL-INT-6656×6 (cogs 693.24); SC lists all four incl. **GD-IL-INT-11141×6**, delta −286.20 = 47.70×6 exactly. GRAND8887 −126.72.
- **Fix:** Investigate Frisbo sync for grandia.ro multi-line furniture orders dropping lines; re-sync and re-check `item_count` vs Frisbo source. Cost config is right; the payload is incomplete.

### Confirmed NON-bugs (do not "fix")

- **42 "COV=0 vs SC 217/118" mismatches:** VOIDED cancelled-COD orders. AWB zeroes the header (`total_price=0`, `financial_status=pending`, `aggregated_status=cancelled`, `payment_gateway=COD`); Scripturi retains the placed value but tags `Anulata`/`VOIDED`. **Both systems exclude these from delivered revenue → 0 RON P&L impact.** A raw-column artifact, not a bug. (COV12454, COV12458, COV12496, COV12500, COV12521…)
- **318 April / 300 May delivered orders with `total_price=0` in BOTH systems:** a *shared upstream* Shopify/Frisbo header-total defect (~39k RON April / ~41k May, ~0.55% of topline). Line_items carry real prices (314/318 > 0) but the order-header total is genuinely 0 (promo/free-gift/manual orders; 72/318 contain `surpriza/cadou` SKUs). **No AWB-vs-Scripturi divergence** — both book 0. Worth fixing at the source as a revenue-leak (fall back to `sum(line_item.price × qty)` when delivered + `total_price=0` + line_items > 0), and surfacing a data-quality count. Examples: NUBRA1688 (li_sum 120), EST142669 (135), GRAND9470 (249), ROSSI30027 (169.99); concentrated in esteban.ro (176), nubra (43), georgetalent.ro (43).

---

## 3. Intentional / structural divergences

These are *expected by design*. The table notes which side is "more correct" for the intended use.

| Divergence | Mechanism | Magnitude | Which side is correct |
|---|---|---|---|
| **Snapshot timing (May +403k)** | Scripturi `profit_orders` frozen at 2026-06-02 12:12 UTC; AWB live. 3,407 orders delivered in AWB but in-transit (OUT_FOR_DELIVERY 1,640 / LABEL_PRINTED 1,733) at snapshot. 95% placed 22–31 May; spread across all stores. | +406,186 RON net | **AWB** (fresher). Self-heals on Scripturi re-snapshot. |
| **Frisbo status-lag (April ex-Grandia −5,852)** | Completed-month residual: Frisbo `aggregated_status` stuck at `fulfilled`/`waiting_for_courier` while courier/Shopify says DELIVERED. BELA −4,371, EST −1,112, BONBG −414, COV −236. | −5,852 RON/mo, persistent | **Scripturi** (reads courier/Shopify directly). Same root as BUG-1; will NOT converge by re-snapshotting. |
| **Refused/returned vs cancelled vocabulary** | 26 "AWB returned / SC cancelled" + 23 "AWB cancelled / SC returned" + 13 "AWB delivered / SC returned" — Frisbo physical status vs DPD `courier_status` ("Delivered Back to Sender") vs Shopify VOIDED. Both labels defensible. | ~62 orders, ~0 net P&L | Mixed. The 13 "AWB delivered / SC returned" (VOIDED in Shopify) are the riskiest — AWB may over-count; flag in a data-quality report. |
| **COGS exclusion policy** | `exclude_from_stock=true` zeroes gift/bundle SKUs in AWB; Scripturi costs everything. | −13.9k/mo | **Undecided — business call** (see BUG-4). |
| **SKU velocity: delivered-only vs gross** | AWB `units_sold`/`revenue` = DELIVERED-only, RON-converted, barcode-grouped across stores. Scripturi `analytics_sales.qty_sold` = ALL placed (status:any minus VOIDED/REFUNDED), native currency, raw sku+prefix. | ~13–15%/SKU | Neither — *different columns*. Map Scripturi `qty_sold` → AWB `gross_units`, not `units_sold`. |
| **FX: native vs RON** | Scripturi `analytics_sales.revenue` in store-native currency (CZK/EUR/PLN); AWB converts per-order at daily BNR. | up to ~5× apparent distortion on raw foreign rows | Reconciles after conversion. Residual = flat-monthly (SC) vs daily-BNR (AWB) — accepted caveat. |
| **Daily-perf: ad-spend/ROAS/CPA absent** | Scripturi carries fb/tk/google_spend, total_spend, profit, ROAS, CPA from Ads APIs + Sheets. AWB has NO ad-spend source; rebuild intentionally drops these 7 columns. | 7 columns missing | **By design.** AWB daily-perf is an operational revenue pulse, not a marketing P&L. |
| **Brand granularity** | AWB folds multi-store brands (casaofertelor + ofertelezilei → "OFER"); Scripturi keeps them separate (also splits Esteban / Esteban Parfum, has Bonhaus SK / Nocturna / Gento that AWB never syncs). | a few brands, grouping only | Neither — needs an explicit store→brand mapping before cross-system comparison. |

**Snapshot signature (diagnostic to keep):** timing gaps pile into the most-recent ~10 days and spread across all stores; structural gaps don't. May extra-delivered by creation date-band: 01-07=12, 08-14=18, 15-21=128, **22-31=3,249 (95.4%)**.

---

## 4. Per-report verdict table

| Report | Verdict | One-line reason |
|---|---|---|
| **P&L (revenue)** | **MATCHES-with-known-divergence** | April ex-Grandia within −5,852 RON (~0.1%); May +403k is pure snapshot timing; only AWB-side issue is the Frisbo-stuck-status undercount (BUG-1). |
| **COGS** | **NEEDS-FIX** | Net −0.18% hides +17.5k cross-store over-cost (BUG-2) + −5.9k COV empty line_items (BUG-3) + −7.1k GRAND line drops (BUG-5) + −13.9k exclusion policy (BUG-4). |
| **Deliverability** | **MATCHES-with-known-divergence** | Delivered counts trail SC only where Frisbo status is frozen (GRAN −85, EST −4, BELA −28); 23 refused-returns mislabeled `cancelled` make deliverability % slightly optimistic. Classifier correct. |
| **Status classification** | **MATCHES** | 99.59% agreement; all 234 disagreements are source/timing at the delivered/returned/cancelled frontier. `classify()` faithful to its single input field — no change. |
| **SKU profitability** | **MATCHES** (AWB more complete) | AWB cost mapping matches SC to the cent for non-conflicting SKUs; deltas are Scripturi's 15.6% analytics shortfall + cross-store cost ambiguity (BUG-2). |
| **Sales velocity** | **MATCHES** (AWB more complete) | Scripturi `analytics_sales` drops 8,939 April orders (incl. entire Nubra store, 1,023 orders); AWB built on the complete order set. Use AWB as source of truth. |
| **Product deliverability** | **MATCHES-with-known-divergence** | Same Frisbo status-lag as P&L; no independent defect. |
| **Daily performance** | **MATCHES-with-known-divergence** | Orders + gross revenue match Scripturi to the unit (Esteban Apr 1-5 identical: 599/674/622/466/525); spend/ROAS/CPA absent by design; OFER grouping differs. |

---

## 5. Recommended fixes (prioritized)

1. **[HIGH · correctness] Make AWB COGS store-aware (BUG-2).** Import cost per `(sku, store_uid)` from Scripturi `analytics_products` keyed by prefix; resolve at COGS time by the order's store. Removes +17.5k/mo over-cost. **Must ship together with #2** — decoupling swings the total ~17k.
2. **[HIGH · business decision] Decide the `exclude_from_stock` → COGS policy (BUG-4).** If gift/bundle SKUs incur real cost, make `exclude_from_stock` gate stock reports only, not COGS (+13.9k/mo back in). Surface to the user; the +17.5k/−13.9k pair currently cancels.
3. **[HIGH · data-quality] Stuck-status reconciliation rule (BUG-1 + April status-lag).** Flag any order in the NOT_SHIPPED set with `tracking_number != null` AND `awb_count >= 1` as a stuck-status candidate in the Tier-6 sync report; optionally treat `tracked + Shopify-DELIVERED` as delivered. Recovers ~107k RON of GRAN April delivered revenue + the systematic ~5.9k/mo ex-Grandia undercount. Trigger an upstream Frisbo re-pull for grandia.ro Sameday shipments.
4. **[MEDIUM · sync] Fix covoria.ro empty `line_items` (BUG-3).** Investigate the Frisbo store-view payload for covoria.ro; re-sync. Recovers −5.9k/mo COV COGS.
5. **[MEDIUM · sync] Fix grandia.ro furniture partial line drops (BUG-5).** Re-sync multi-line GRAND orders; verify `item_count` vs Frisbo. Recovers ~−7k/mo.
6. **[MEDIUM · revenue leak, both systems] Delivered-zero fallback.** When `aggregated_status=delivered` AND `total_price=0` AND line_items sum > 0, fall back revenue to `sum(line_item.price × qty)`. Recovers ~40k RON/mo understated in BOTH systems. Add a data-quality count to the P&L.
7. **[LOW · audit hygiene] Add a snapshot-timestamp row to Scripturi `profit_settings`** so future audits don't infer the as-of date from `MAX(created_at)`. Compare delivered-only revenue, never the raw revenue column. Report Scripturi's 15.6% product-analytics order shortfall (incl. Nubra) to the Scripturi owner.
8. **[LOW · reconciliation map] Build an explicit AWB-store → Scripturi-brand mapping** (split OFER/casaofertelor, Esteban/Esteban Parfum) and a column-mapping note (`qty_sold` → `gross_units`; native → RON) before any cross-system daily-perf / SKU-velocity comparison.

**Do NOT touch:** `status_classification.py` `classify()` (correct for its input), the P&L revenue formula, or AWB sales-velocity (more complete than Scripturi). Every classifier "disagreement" is upstream source/timing, not a mapping bug.

---

*Scope note:* All RON figures and order ids above are drawn from the live AWB read (2026-06-04) joined against the Scripturi snapshot (2026-06-02). April is a completed month; May is still settling, so its +403k delta is expected to collapse to a few thousand RON on the next Scripturi snapshot, leaving only the persistent Frisbo-status-lag residual.
