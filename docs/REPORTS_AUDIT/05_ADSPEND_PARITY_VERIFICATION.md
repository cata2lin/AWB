# Ad-Spend Parity — 1:1 Verification Report

**Build:** ad-spend parity (per-SKU marketing, daily-perf, profit/CPA/ROAS)
**Audit window:** 2026-04 (closed, authoritative) + 2026-05 (immature, directional only)
**Scripturi snapshot freeze:** `MAX(created_at)=2026-06-02T12:12:15Z`
**Date:** 2026-06-04
**Overall verdict:** MATCH-within-known-divergence — the per-SKU marketing line is 1:1; every other divergence attributes to a documented knob. No new bugs.

---

## 1. Headline verdict

**The per-SKU MARKETING line is 1:1.**

- **April 2026 (FB-only):** AWB **66,610.33 RON** vs Scripturi **66,610.45 RON** (Δ **−0.12 RON**, pure daily-rounding). **44/44 SKUs exact** within |0.05 RON| = **100%**. This ties the expected ~66,610 anchor exactly.
- **May 2026 (FB+TK):** on the 99 SKUs that have both Scripturi spend AND a realized AWB sale, **99/99 exact = 100%**; overlap totals tie to **+0.01 RON** (AWB 272,671.20 vs SC 272,671.19). FB/TK split exact (0 SKUs differ >|0.05| on `marketing_fb` or `marketing_tk`).

One line per dimension:

| Dimension | One-line verdict |
|---|---|
| **Per-SKU marketing** | **1:1** — 44/44 April exact, 99/99 May-overlap exact; only a sub-bani rounding residual. |
| **Daily-perf ad spend** | MATCH-within-known-divergence — April +7.7% is snapshot-timing (days 1-24 byte-identical), not a computation gap; different source by design. |
| **Order / Revenue / COGS** | MATCH-within-known-divergence — 100% count match; April reconciliation bit-identical to prior baseline; gaps are Grandia stuck-status + immature May. |
| **Profit / CPA / ROAS** | MATCH-within-known-divergence — formulas correct on both sides; divergence flows entirely from the VAT-mechanic + order-universe + transport knobs. |

---

## 2. Per-report parity table

| Report | Verdict | One-line reason |
|---|---|---|
| **Per-SKU profitability — marketing line** | **1:1** | April 66,610.33 vs 66,610.45 (Δ −0.12); 44/44 exact; May overlap 99/99 exact, +0.01 RON. The parity target passes. |
| **Daily-performance ad spend** | MATCH-within-known-divergence | AWB reads its own `marketing_daily_costs` ("Raport Zilnic 2" + "Grandia"); SC reads `daily_perf.db`. April +7.7% (+100,619 RON) is 100% concentrated in the last 6 days (snapshot lag), days 1-24 identical to the cent. |
| **Order / Revenue / COGS** | MATCH-within-known-divergence | Order count 100% match both months; April delivered-rev Δ −2.0%, COGS Δ −0.18%; residuals = Grandia Frisbo-lag (−108,339) + immature May, no ad-spend regression. |
| **Profit / CPA / ROAS** | MATCH-within-known-divergence | CPA=marketing/orders and ROAS=revenue/marketing are arithmetically exact on both sides; same marketing numerator; all divergence inherits from VAT-mechanic + order-universe + transport knobs. |

---

## 3. Every difference + its reason (deduplicated, quantified)

### (a) EXACT / rounding — the marketing line (the parity target)

| Item | AWB | Scripturi | Δ | Reason |
|---|---|---|---|---|
| April per-SKU marketing total | 66,610.33 RON | 66,610.45 RON | **−0.12 RON** | Round-per-day-then-sum (`round(usd_day*4.55,2)`) vs round-USD-sum-then-×4.55. 28/44 SKUs differ at <0.005 RON. 44/44 within |0.05|. |
| May overlap (sold SKUs) marketing | 272,671.20 RON | 272,671.19 RON | **+0.01 RON** | Same rounding mechanic; 99/99 exact; FB/TK split also exact (0 mismatches >|0.05|). |
| Raw `sku_ad_spend_daily` integrity | 2,579 rows / 145 SKUs / FB 311,835.58 / TK 73,109.22 | SC USD source ×4.55 (FB 68,535.31 USD, TK 16,067.96 USD) | within rounding | All rows HA- prefixed (0 non-HA-); fixed 4.55 rate; no FX/source surprises. |

**Rate confirmed identical:** both sides use a fixed USD→RON **4.55** (Scripturi has no USD row in `profit_exchange_rates`, falls back to static 4.55). April is FB-only (TikTok starts 2026-05-15), TK=0 on both.

### (b) DELIBERATE design decisions (marketing-line-only parity scope)

| Knob | AWB mechanic | Scripturi mechanic | Quantified on HA-0001 |
|---|---|---|---|
| **VAT mechanic** (NOT rate) | Divide each line by (1+vat); RO=**0.21** for Apr 2026 | Deduct separate `tva=(gross−transport−cogs)×0.21` on gross | contribution 2,979.87 vs profit_net 2,080.86. Rate is identical 21% — only the math differs. |
| **Transport model** | Revenue-share of each order's actual `transport_cost` | Flat `transport_per_unit (13.00) × orders` | 3,156.62 vs 3,458.00 (~300 RON gross). |
| **Marketing-line-only scope** | Marketing matched 1:1; profit/CPA/ROAS intentionally not forced to parity | Full gross P&L model | By design — only the marketing line is the parity target. |

> **Brief correction:** the task brief's "AWB keeps RO 19% vs Scripturi flat 21%" is inaccurate for April 2026. `app/core/vat.py` applies **RO=21%** after the 2025-08-01 increase, and Scripturi's per-SKU JS also uses flat 0.21. For April the **VAT rate is identical (21%)**; only the **mechanic** differs (divide-out vs separate-line-on-gross). The 19% only applies to RO orders dated before 2025-08-01.

### (c) DIFFERENT SOURCE — daily-perf ad spend (AWB sheet vs Scripturi DB)

| Item | AWB | Scripturi | Δ | Reason |
|---|---|---|---|---|
| April matched-brand total | 1,412,320.06 RON | 1,311,700.61 RON | **+100,619.45 (+7.7%)** | Different source: AWB `marketing_daily_costs` vs SC `daily_perf.db`. Inside the documented 5-10% band. |
| Day-granularity (5 brands) | days 1-24 = SC exactly | days 1-24 identical | **+0.0%** days 1-24 | Root cause is **snapshot timing**, not sheet computation. |
| Late tail 04-25..04-30 | higher | undercounted | **+37%..+69%/brand** (Esteban +63%, Bonhaus RO +69%, Reduceri bune +62%, Magdeal +46%, Ofertele Zilei +37%) | SC `daily_perf.db` snapshotted ~06-04 before platforms finalized late spend; AWB sheet holds reconciled finals. This tail = 100% of the monthly delta. |
| ROAS / CPA | Now render (2026-04-15 totals roas=4.1, cpa=29.67; 17/17 brands roas, 16 cpa) | SC stores roas/cpa | exposed on both | The ad-spend metric the original port dropped is now live; both null-guard div-by-zero. |
| Google spend | Included (Belasil 3,839.95, Rossi Nails 509.54, Nocturna 773.91 + Grandia 86,746) | Included (total 4,832.37) | <0.4% of total | Like-for-like: both sum fb+tk+google; small Google brands match to the cent. |
| **Grandia** (AWB-only brand) | grandia.ro April fb+tk+google = 98,831.12 RON ("Grandia" sheet, mostly Google) | no Grandia brand | AWB-only | Excluded from the +7.7% matched comparison (no SC counterpart). |

### (d) DATA / UNIVERSE differences

| Item | AWB | Scripturi | Δ | Reason |
|---|---|---|---|---|
| **April COGS "moved to 1,368,548"?** | both-delivered COGS 1,299,182 (45,463 orders) | full delivered universe 1,368,547.91 (45,603); both-delivered subset 1,301,511.61 | 1,368,548 − 1,301,512 = **67,036.30** | NOT a refresh delta — it's SUM over SC's full delivered universe vs the both-delivered intersection the harness compares. The 67,036 = 140 orders SC delivers but AWB does not (132 'other' + 8 'returned'). |
| Order count match | April 57,438 / May 59,982 | April 57,438 / May 59,982 | **0 unmatched** | All 21 (Apr) / 20 (May) prefixes at 100.0%. Ad-spend build did not touch the order universe. |
| April delivered-rev | 5,515,340 | 5,629,531 | **−114,190 (−2.0%)** | Bit-identical to prior baseline; snapshot did not advance (freeze still 2026-06-02 12:12:15Z). |
| **Grandia stuck-status gap** | GRAN delivered 601,712 (3,131 orders) | 710,051 (3,216 orders) | **−108,339 RON (= 95% of April topline gap)** | 85 gap orders all have valid tracking; raw status = 78 'fulfilled' + 5 'waiting_for_courier' + 2 'back_to_sender'. Frisbo never advanced past 'fulfilled' though courier shows DELIVERED. Upstream Frisbo defect (prior BUG-1), persistent — will NOT converge by re-snapshotting. |
| sku_costs tie | n=2,416 single global cost/SKU | `analytics_products.cost` keyed (sku,prefix); 1,539/2,201 exact (69.9%) | order-level Δ −2,329 (Apr) / +580 (May) | Cross-store cost ambiguity (prior BUG-2): same SKU has per-store costs in SC. Over/under buckets offset → order-level COGS within ±0.18%. Not a regression. |
| **May (immature)** delivered-rev | 6,056,766 | 5,888,789 | **+167,978 (AWB ahead)** | 1,692 AWB-delivered-but-SC-not orders (1,599 SC 'In curs de livrare', 92% created 22-31 May). Snapshot-timing signature; gap shrank from prior +403,230 as SC May matured. Self-healing. |
| May status disagreement | 3,552 / 59,982 (5.92%) | matched 100% | vs April 0.41% (234) | Entirely in-transit lag (1,602 'AWB delivered/SC other' + 818 'AWB in_transit/SC other'). classify() faithful; collapses on next SC snapshot. |
| Revenue native mismatches | April 69 (VOIDED COD headers); May 50 (price drift) | — | <0.12% of orders both months | April = known VOIDED cancelled-COD (0 P&L impact); May = minor per-order price drift across snapshot boundary. |
| **May per-SKU coverage gap** | 45 SKUs absent (no realized AWB sale in window) | 144 SKUs with spend; total 286,558.95 | **−13,887.75 RON (FB 13,867.76 + TK 19.99)** | = 100% of the May AWB-vs-SC total marketing delta; no unexplained residual. AWB only emits a SKU sold in delivered/returned/in_transit lines. Their orders are all cancelled/other → 0 realized units. Immature-month effect, not a bug. |
| **April per-SKU coverage gap** | — | — | **0.00 RON** | Every April FB-spend SKU also sold in the window; the coverage knob did not bite in April. |
| Order universe (profit basis) | delivered+returned+in_transit, revenue/cogs on delivered units (HA-0001: 341u/234o, 16,943 net rev) | all orders created-in-window minus cancellations, qty_net basis (HA-0001: 389u/266o, 19,860 gross rev) | ~2,900 RON revenue-basis gap before VAT | Dominant driver of profit/CPA/ROAS divergence; CPA 12.81 vs 11.27, ROAS 5.65× vs 6.63×. Same marketing numerator/denominator — divergence is purely the universe + VAT-mechanic knobs. |
| delivery_rate | window order-based (HA-0001 81.5) | cumulative/all-time stored (HA-0001 82.0) | mean abs **1.88 pts**, max ~3.2 pts | Different scope (window vs all-time) and source report. Display-only, explicitly not a parity target. |

---

## 4. Real bugs vs prior audit's open items

**No new bug was introduced by the ad-spend build.** Every divergence maps to a documented knob or a pre-existing open item:

| Item | Status | Notes |
|---|---|---|
| **BUG-1 — Grandia/Frisbo stuck-status** | PRE-EXISTING, persistent (−108,339 RON, 85 orders) | Upstream Frisbo sync defect: orders DELIVERED at courier never advance past 'fulfilled'. 95% of the April topline gap. Will NOT self-heal by re-snapshotting. Not touched by this build. |
| **BUG-2 — single global SKU cost** | PRE-EXISTING (bare-SKU tie 69.9%) | AWB holds one global cost; SC keys cost by (sku,prefix). Offsetting buckets keep order-level COGS within ±0.18%. Not touched by this build. |
| Daily-perf April +7.7% | NOT a bug | Snapshot-timing on the last 6 days; days 1-24 byte-identical. Documented source difference. |
| May divergences (rev/status/coverage) | NOT a bug | Snapshot-immature month; self-healing on next SC snapshot. |
| Sub-bani marketing rounding | NOT a bug | <0.0002%, inside |0.05 RON| tolerance, every SKU. |

**Verdict: zero new defects.** The two open items (Grandia Frisbo-lag, global SKU cost) are inherited from the prior audit and are unaffected by the ad-spend work.

---

## 5. Bottom line

**What the user can trust as 1:1:**
- **The per-SKU marketing line.** April 66,610.33 vs 66,610.45 RON (Δ −0.12, pure rounding), 44/44 SKUs exact. May overlap 99/99 exact (+0.01 RON), FB/TK split exact. This is the parity target and it passes.
- **CPA and ROAS arithmetic** (marketing/orders, revenue/marketing) — formulas are exact on both sides; the marketing numerator is identical.
- **Order/revenue/COGS reconciliation** — stable and bit-identical to the prior baseline; 100% order-count match; the ad-spend build introduced no regression.
- **ROAS/CPA now render** in the AWB daily-perf endpoint (the metric the original port had dropped).

**What differs by design (not a parity target):**
- **Profit/contribution** — VAT mechanic (divide-out vs separate-line-on-gross; rate identical at 21%), transport model (real per-order share vs flat 13.00/unit), and order universe (delivered-centric vs sold-in-window).
- **Daily-perf ad-spend totals** — AWB reads its own finalized sheet; Scripturi reads a `daily_perf.db` snapshot that lags on the tail days. Compare only the closed month, only days 1-24 for byte-equality.
- **delivery_rate** — window-scoped vs cumulative/all-time; display-only.

**What to remember about May:** treat May as directional only until Scripturi re-snapshots. The −13,887.75 RON per-SKU marketing delta is 100% the spend-but-no-realized-sale coverage gap, and the +167,978 RON delivered-rev delta is the in-transit lag — both self-heal as the snapshot matures.
