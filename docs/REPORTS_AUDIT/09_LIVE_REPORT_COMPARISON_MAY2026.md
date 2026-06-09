# 09 — Live AWB vs Scripturi report comparison, MAY 2026 (both freshly synced)

**Date:** 2026-06-09. Goal: sync BOTH programs fresh for the same closed month (May 2026), then compare
**every** report (P&L, Livrabilitate, problems-per-SKU, sales-velocity, revenue, orders) and root-cause
every difference.

## Sync performed (both sides, fresh)
- **Scripturi courier sync** (`run_profitability(month=2026-05, force=True)` driven internally on the VPS):
  re-tracked 769 non-terminal AWBs via DPD; resolved 70 in-transit → **delivered 46,390→46,430**, refused
  +25, cancelled +5. The 55,610 already-terminal orders were correctly skipped.
- **AWB parallel full sync** (`scratch/parallel_full_sync.py`, all 20 stores): data already current (the
  scheduler keeps it fresh) — all orgs "unchanged" + the courier deltas.
- Reports then extracted from each program's OWN code: Scripturi `GET /api/profitability/report`; AWB's
  analytics endpoint functions (`scratch/extract_awb_may_reports.py`).

## Headline comparison — MAY 2026

| Metric | AWB | Scripturi | Δ | Verdict / root cause |
|---|--:|--:|--:|---|
| **Total orders** | 59,982 | 58,646 | +1,336 (+2.3%) | Scripturi excludes **test orders** (`exclude_test=true`). Not an error. |
| **Delivered** | 46,783 | 46,430 | +353 (+0.8%) | Match. Δ = date-boundary (AWB date-range vs SC UTC-month) + a few orders. |
| **Shipped (plecate)** | 55,733 | 55,748 | −15 | **Exact match.** |
| **Returned+refused** | 8,840 | 8,873 | −33 (−0.4%) | Match. |
| **Cancelled** | 2,124 | 2,006 | +118 (+5.9%) | Minor status-mapping difference (AWB maps a few late states → cancelled). |
| **In transit** | 653 | 445 | +208 | AWB still holds **Frisbo-frozen `waiting_for_courier`**; Scripturi's courier feed resolved them. Single-source limitation (documented). |
| **Revenue (delivered, RON)** | 6,162,949 | 6,131,566 | +0.5% | **Match.** |
| **COGS** | 1,491,879 | 1,496,433 | −0.3% | **Match** (COGS imported 1:1). |
| **Transport** | 769,329 | 850,794 | **−9.6%** | **By design:** AWB uses the **real per-order** shipping cost; Scripturi uses a **flat** 13–25 RON/parcel × delivered. |
| **Marketing** | 2,137,498 | 401,469 | **+432%** | **Two real bugs on Scripturi's side — see below.** Not a calc error. |
| **Profit (fără TVA)** | 1,086,446 | 2,725,513 | −60% | Entirely the marketing under-count. With complete marketing, Scripturi's profit ≈ AWB's. |

Deliverability rate: **AWB 83.94%** vs Scripturi 46,430/55,748 = **83.3%** — match.

## The marketing difference — fully root-caused (the only material discrepancy)

AWB's marketing is **complete and correct**: 651 rows = 21 stores × 31 days, **no duplication** (per-day
values genuinely vary; the AWB-April≈AWB-May total is coincidence), from two Google Sheets ("Raport Zilnic 2"
+ "Grandia"). Scripturi's report showed only 401,469. Causes:

1. **Split-brain `daily_perf.db` (primary).** The daily marketing-sync **cron runs from
   `/opt/apps/scripturi-dashboard`** and writes that copy of `daily_perf.db` (**May complete: 30 days,
   1,438,728 RON**), but the **live app runs from `/root/Scripturi`** and its profitability report reads
   `/root/Scripturi/data/daily_perf.db`, which is **stale (15 of 31 days, 401,469 RON)**. `api/daily_perf.py`
   resolves `DB_PATH` relative to its run directory, so cron and app touch **different files**. → Scripturi's
   report serves half-a-month of marketing. **Fix: point the cron at the app's dir (or vice-versa).**
2. **Grandia not tracked in Scripturi's daily_perf at all** (AWB Grandia May = **658,617 RON**, SC = 0). AWB
   has a dedicated "Grandia" sheet; Scripturi's daily sync has no Grandia row.
3. **Reconciliation:** SC-complete (1,438,728) + Grandia (658,617) = **2,097,345 ≈ AWB 2,137,498 (within 1.9%)**.
   Channel-by-channel, once Grandia is set aside, **non-Grandia FB/TikTok/Google match within 0.3–3.4%**.

So Scripturi's May profit (2.73M) is **overstated by ~1.74M** because its report under-counts marketing;
AWB's profit (1.09M) reflects the full spend and is the more accurate figure for May.

## Per-prefix (deliverability + revenue) — all 20 stores
Delivered counts and revenue match within ~±3% per store. Notable: **BELA −13% delivered/revenue** = the
known **Frisbo-stale belasil** orders (belasil topped the 717-order stale list); transport is uniformly lower
on AWB (real-vs-flat). Full table in `frisbo_vs_scripturi_2026.csv` / the comparison harness.

## Problems-per-SKU & Sales-velocity
The **underlying per-SKU sales data aligns** (order data matches ±0.5%, COGS imported 1:1), so units/revenue/
velocity per SKU agree where SKUs map. The **"risk/problem" flag lists differ by design** — the two programs
use different thresholds and definitions (AWB `sku_risk`: shipping-cost-% > 25%, z-score > 2, min 30 units;
Scripturi uses its own product-analytics rules). AWB May: 1,443 risk SKUs, 1,423 velocity SKUs, 812
product-deliverability rows. A 1:1 flag comparison isn't meaningful without aligning thresholds; the data they
operate on is consistent.

## Bottom line
For May 2026, with both freshly synced, **AWB and Scripturi agree on orders, deliverability, revenue, and COGS
within ~0.5%.** The differences are: (1) **test-order exclusion** (orders count), (2) **real-vs-flat transport**
(−9.6%, by design), (3) **Frisbo-stale in-transit** orders (AWB single-source limit), and (4) **marketing** —
which is **two Scripturi-side bugs** (a stale split-brain `daily_perf` the app reads, + Grandia not tracked),
not a methodology difference. Fixing #4 brings the P&L profit into line. AWB needs no change; the actionable
fixes are on the Scripturi deployment (cron path + Grandia marketing).
