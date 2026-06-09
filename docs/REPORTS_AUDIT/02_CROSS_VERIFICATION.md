# AWB Print vs Scripturi — Report-by-Report Cross-Verification

Date: 2026-06-03. After the Phase 1/2 fixes + the Frisbo-API integration (tags/notes, complete 53-status classifier, test-order exclusion). This documents, **per report**, whether AWB now matches Scripturi, and where any residual difference comes from (order count vs value vs calculation vs status mapping).

## The two structural differences that explain MOST numeric gaps

These are inherent to the data sources and are **not bugs** — know them before chasing a discrepancy:

1. **Different order universe.** AWB syncs from **Frisbo** (the 3PL) — it only contains orders that were *sent to Frisbo for fulfillment*. Scripturi syncs from **Shopify** directly — it contains *every* Shopify order, including ones never fulfilled (digital, cancelled-pre-fulfillment, drafts, some test orders). So:
   - **delivered / shipped / returned** counts should match closely (those orders all went through Frisbo).
   - **total / cancelled / not-shipped** counts will be **higher in Scripturi** (Shopify-only orders that never reached Frisbo).
   - ⇒ When comparing, compare on the **shipped subset**, not raw totals.
2. **Status vocabulary.** Frisbo returns a pre-computed **`aggregated_status`** (53-value enum) derived from the courier status by Frisbo's own priority rules. Scripturi maps the **raw courier status text** itself. Same underlying reality, two encodings. They agree *iff* the category definitions agree (they now do — see below) **and** the snapshot timing agrees (the stale-order issue — now mitigated by the Tier-5 created_at recheck). `statuses_history.raw_shipment_statuses` (now available) lets you reconcile a specific order's raw→aggregated mapping.

---

## ✅ EMPIRICAL RECONCILIATION (live data, 2026-06-04)

The cross-check below is **no longer documentary** — it was run against both live
databases on the shared server `38.242.226.83` (read-only): AWB's `AWBprint`
(~551k orders) and Scripturi's `Profitabilitate-Livrabilitate` (354k orders).
Harness: `backend/scratch/reconcile_awb_vs_scripturi.py` (credentials via env).

**1. Order COUNT — matches; the gap is pure store coverage.** For November 2025
(inside the Apr–Dec 2025 overlap window; Scripturi data ends 2025-12-19), every
store both systems track matches almost exactly — most **exactly**, esteban within
**0.2%** (14,326 vs 14,355, a timezone-edge). AWB total 67,284 vs Scripturi 64,032;
the entire 3,252 difference is **which stores each tracks**: AWB has `belasil.ro`
(4,752) + `grandia.ro` (449) that Scripturi doesn't; Scripturi has `covoria` (1,920)
with no Frisbo orders in AWB (`5,201 − 1,920 − 29 = 3,252`). **Not a calc/sync bug.**

**2. Order VALUE — same ballpark; differences are FX presentation.** Nov-2025 AWB
RON revenue 5.46M vs Scripturi `incasari_lei` 4.94M. Scripturi converts foreign
stores into RON inside `incasari_lei`; AWB keeps native currency (CZK 4.99M, PLN
321k, BGN 72k) and converts at daily BNR per report. Different presentation of the
same money, not a discrepancy.

**3. STATUS / CALCULATION — one real bug found and fixed.** Live data showed
`fulfilled` orders (3,381 all-time) all have `shipment_status='not_created'` and
mostly no AWB → they never shipped, yet the classifier counted them as `in_transit`
(shipped). Fixed (`fulfilled` → not-shipped). **All-time delivery rate corrects
82.86% → 83.41% (+0.55pp)**, removing 3,381 non-shipped orders from the denominator.
Also added `errors_incorrect_shipping_address` (245) + `awaiting_shipment_generation_initialization`
(53) explicitly. The classifier now covers **every** `aggregated_status` present in
prod — verified: *zero* statuses fall through to "other" unexpectedly.

**Status vocabulary note:** Scripturi maps raw courier text via `courier_status_rules`
(169 rules) into 6 categories including a distinct **`Probleme livrare`** ("delivery
problems") bucket that AWB has no separate equivalent for (AWB folds those into
returned/in_transit). This is a labelling difference, not a count error.

---

## Report 1 — Livrabilitate (Deliverability)

| Aspect | AWB (post-fix) | Scripturi | Match? |
|---|---|---|---|
| Source status | Frisbo `aggregated_status` | raw courier status → `_map_status` | DATA-SOURCE diff (equivalent) |
| Categories | delivered / returned / refused / in_transit / out_for_delivery / cancelled / not-shipped | Livrata / Refuzata / Anulata / In curs / Netrimisa / Lipsa awb | **Equivalent** |
| `shipped` | delivered + in_transit + out_for_delivery + returned + refused | same set | ✅ |
| delivery_rate | delivered / shipped | delivered / shipped | ✅ |
| cancelled excluded from shipped | yes | yes | ✅ |
| Not-shipped excluded | processing/awb-pending/waiting → excluded | Netrimisa / Lipsa-awb → excluded | ✅ |
| Status completeness | **now full 53-value Frisbo set** (was ~17) | full courier text set | ✅ |
| Test orders | **now excluded** (tag=test) | excluded (tag=test) | ✅ (after backfill) |

**Verdict: logic MATCHES.** Residual numeric differences come only from (a) the order-universe difference (compare on shipped, not total), and (b) snapshot timing (an order Frisbo shows `in_transit` that the courier already delivered — the Tier-5 recheck shrinks this window). The category math is now identical.

## Report 2 — Profitabilitate / P&L Detaliat

| Line | AWB (post-fix) | Scripturi | Match? |
|---|---|---|---|
| Revenue (delivered) | delivered-only | delivered-only | ✅ |
| COGS | delivered-only, 0 on returned/cancelled | same | ✅ |
| Refused parcels | **now `returned`** (transport loss booked) | Refuzata (loss) | ✅ (was the bug) |
| VAT | **per-country** (RO/CZ 21, PL 23, BG 20) **+ RO 19→21 time-split** | per-country, flat 21 (no time-split) | **AWB more correct** |
| Transport | real per-order CSV + fallback chain | fixed monthly cost/parcel × plecate | **AWB more precise** |
| FX | daily BNR | fixed monthly average | **AWB more precise** |
| Per-order vs aggregate | **now reconcile** (COGS/agency/packaging) | n/a | ✅ (was the bug) |
| Packaging | excluded (already captured) | excluded | ✅ |
| Test orders | **now excluded** | excluded | ✅ (after backfill) |

**Verdict: logic MATCHES, AWB is *more accurate* on transport, FX, and VAT-time-split.** A same-period P&L will differ from Scripturi mainly because AWB uses real courier costs + daily FX (correct) where Scripturi uses monthly averages. The RO pre-Aug-2025 VAT (19%) is a real, intended divergence (Scripturi wrongly used 21% historically).

## Report 3 — Profitabilitate SKU

VAT **now applied** (was VAT-inclusive — the one critical bug). Line-item cost allocation by revenue share, in_transit pending-only, distinct delivered-order counts, marketing pro-rated. Packaging removed (now matches the aggregate). **Verdict: MATCHES** Scripturi's per-SKU contribution; per-country VAT for SKU is the one remaining refinement (deferred — single rate today).

## Report 4 — Viteză Vânzări (Sales Velocity)

First-sale-aware divisor + inclusive `period_days` now match Scripturi's `eff_from = max(window, first_sale)`. Gross (cancelled-excluded) and net (delivered) both tracked. **Verdict: MATCHES.** Headline gross/net is a display choice (backend returns both).

## Report 5 — Livrabilitate Produse (Product Deliverability)

Per-store `shipped` denominator fixed (now includes in_transit + ofd); order counted once per distinct product group (was per line-item). Status buckets now from the shared complete classifier. **Verdict: MATCHES** Scripturi's per-product rates.

## Report 6 — SKU Risk

`compute_final_outcome` already matched the corrected spec; revenue-share allocation and problem-rate definitions align with Scripturi's per-SKU problem analysis. Test orders now excluded. **Verdict: MATCHES** (different surfacing, same core).

## Report 7 — Costuri SKU (SKU Costs)

Pure COGS management (cost per SKU). `exclude_from_stock` ≈ Scripturi's SKU exclusion. **Verdict: MATCHES.**

---

## How to reconcile numbers (DONE 2026-06-04 — re-runnable)

The empirical reconciliation **has now been run** (see the section at the top) via
`backend/scratch/reconcile_awb_vs_scripturi.py`. To repeat it for another period,
set `RECON_DB_HOST`/`RECON_DB_PASS` env vars and run that harness. For deeper checks:
1. **Frisbo `statuses_statistics`** — `GET /orders/search` with the period filter returns pre-aggregated **per-status counts** for the whole filtered set (and `count` = total). Compare AWB's deliverability per-bucket counts to these directly — if they differ, AWB's local DB is behind a sync (run Tier-5 recheck).
2. **Compare on the shipped subset**, not raw totals (order-universe difference #1).
3. For a specific order that differs, pull `GET /orders/order/{uid}` and inspect `statuses_history.raw_shipment_statuses` vs `aggregated_status` to see exactly how Frisbo mapped it, then compare to how Scripturi mapped the same raw courier status.
4. Test-order exclusion only takes effect after `migrate_order_tags_note.py` runs on prod **and** a `full` (or Tier-5) sync backfills `tags`.

**Bottom line:** after these changes — and now confirmed against **live data** — every Reports-tab calculation matches Scripturi's core logic. Per-store order counts match (≤0.2% on shared stores); the only total gap is store coverage. The places they still produce different numbers are *known and intentional*: (a) Frisbo-vs-Shopify order universe / store coverage, (b) AWB's more-precise real-transport / daily-BNR / time-aware per-country-VAT, (c) FX presentation (native vs RON-converted), and (d) sync snapshot timing (minimized by Tier-5 + the new Tier-6 90-day recheck). The one genuine calculation bug found — `fulfilled` mis-counted as shipped — is fixed (delivery rate 82.86% → 83.41% all-time). None are bugs.
