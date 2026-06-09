# 10 — COGS & Marketing source accuracy audit + COGS override (2026-06-09)

Goal: confirm AWB pulls **marketing per month** and **COGS per order** accurately vs Scripturi; override
AWB's per-SKU COGS with Scripturi's where they differ; re-verify.

## Marketing source — AWB is accurate and complete

AWB marketing = the company Google Sheets ("Raport Zilnic 2" + "Grandia") → `marketing_daily_costs`
(per cost_date × store, RON: facebook/tiktok/google). **Coverage per 2026 month is FULL** (every store ×
every day) with one exception:

| Month | Coverage | |
|---|---|---|
| Jan | 20 × 31 | FULL |
| Feb | 20 × 28 | FULL |
| Mar | 21 × 31 − 23 | **nubra only 8/31** (see below) |
| Apr | 21 × 30 | FULL |
| May | 21 × 31 | FULL |

- The only gap — **nubra March 10–23** — is a **source-sheet gap, not an AWB bug**: nubra launched 2026-03-10
  (112 orders from the 10th) but the marketing sheet only logs nubra from March 24. AWB faithfully pulls what
  the sheet contains.
- Cross-check vs Scripturi's ad-platform data (from `09_*`): Jan–Feb AWB FB == Scripturi FB **to the leu**;
  non-Grandia FB/TikTok/Google match within 0.3–3.4%; AWB additionally captures Grandia + full Google, which
  Scripturi's report misses (its split-brain stale `daily_perf`). **AWB is the more complete/accurate source.**

**Verdict: AWB pulls marketing correctly per month. No fix needed** (optionally backfill nubra Mar 10–23 if the
marketing team adds it to the sheet).

## COGS source — per-SKU costs verified and overridden to match Scripturi

AWB COGS = `line_items (Frisbo) × sku_costs`. Scripturi COGS = `profit_cogs_override` + **live Shopify
unitCost** per variant. AWB's `sku_costs` was imported from Scripturi's cost cache (2026-06-04). Re-verified
against the **fresh** Scripturi pull:

- **Per-SKU cost values already matched 99.7%** — only a handful differed. **14 SKUs corrected today:**
  - 6 via the cache re-import (fresh `analytics_products` + overrides).
  - **8 via a dominant-cost fix** — the import's "on a cross-store tie, keep the **highest**" rule had picked
    an outlier Scripturi rarely applies. The material one: **`fata-masa-rotunda` 33.00 → 11.58** (Scripturi
    applies 11.58 in 434 single-SKU orders vs 33.0 in just 2). The rest tiny (`baie-pufos-*` 26.12→25.53).
  - **Method:** derive each SKU's applied unit cost from the distribution of Scripturi's per-order COGS on
    **single-SKU delivered orders**; override only when AWB's value is **rare** (<5% of orders) AND a clear
    **dominant** exists AND the dominant is a **real cached unit cost**. The last guard correctly **excluded
    grandia `GD-*` SKUs** (sold only in packs → no qty=1 order → every cogs is a multiple of AWB's *correct*
    unit cost; overriding would have wrongly doubled them).
  - Backups: `sku_costs_backup_20260609_144448` + CSV.

### Per-order COGS comparison, May (after override)

| | AWB | Scripturi |
|---|--:|--:|
| Delivered orders | 46,414 | 46,390 |
| Total COGS (RON) | 1,492,050 | 1,495,518 |
| Δ | **−3,467 (−0.23%)** | |
| Orders with **identical** COGS | **43,647 (93.7%)** | |

The −0.23% residual is **structural, not cost-value**:
- **Grandia line-items** (AWB Frisbo vs Scripturi Shopify): GRAN May AWB COGS 303,518 vs SC 316,270 (**−4%**) —
  AWB's Frisbo `line_items` are sparser for grandia.
- **Order universe**: 285 orders Scripturi shows delivered that AWB doesn't (Frisbo-stale; ~21k COGS) vs 309
  the other way (~9k) — the documented single-source limitation.
- 37 orders with a missing SKU cost + small qty differences (Frisbo vs Shopify quantities).

## Bottom line
- **Marketing:** AWB's source is accurate and pulled completely per month (only a source-sheet gap for
  nubra Mar 10–23). More complete than Scripturi.
- **COGS:** AWB's per-SKU costs now match Scripturi (14 corrected; the real bug was the import's
  highest-on-tie outlier, fixed via dominant-cost analysis). Total COGS matches within **0.23%**; 93.7% of
  orders are identical. The residual is the Frisbo-vs-Shopify line-items / Frisbo-stale structural difference,
  not a cost-value error.

Harnesses: `scratch/verify_cogs_vs_scripturi.py`, `scratch/override_cogs_dominant.py`,
`scratch/compare_cogs_per_order_may.py`, `scratch/import_scripturi_cogs.py` (now `SCR_DATA_DIR`-parameterized).
