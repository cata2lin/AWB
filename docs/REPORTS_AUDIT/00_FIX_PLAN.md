All findings verified against current code. The per-order returned loss at line 220 does double-count COGS + packaging + commissions + fees (vs aggregate's `-shipping_cost` only), agency commission is re-introduced at lines 199-201/215, and the SKU endpoint's `dynamic_vat_rate` at line 164 is confirmed dead. I have enough ground-truth to write the plan.

---

# AWB Print — Reports Tab Fix Plan

## 1. Verdict

AWB's order reports are **structurally sound but contain one critical and several high-severity defects that bias real money**, concentrated in three places: (a) the per-SKU profitability report applies **no VAT at all** (every contribution/margin number is VAT-inclusive and wrong), (b) **`refused`/`unsuccessful_delivery` orders are mis-classified into `other`** in the aggregate P&L (dropping a real transport loss and contradicting AWB's own deliverability tab and spec), and (c) the **per-order endpoint disagrees with the aggregate engine** on returned-loss, agency commission, packaging, and status mapping, so the two views don't reconcile. The root cause of most drift is that AWB maintains **four hand-copied status classifiers** instead of one shared module like Scripturi. Everything that is *not* on the fix list — real per-order CSV transport, daily BNR FX, returned-order COGS recovery, barcode grouping, and the already-fixed `compute_final_outcome()` — is confirmed correct or *more* accurate than Scripturi and must not be touched.

---

## 2. Discrepancy Register

Sorted by severity, then classification. **NDsn?** = needs user decision.

| # | Title | Report | Sev | Class | Conf | NDsn? | One-line fix |
|---|-------|--------|-----|-------|------|-------|--------------|
| A | VAT (fara_tva) computed but NEVER applied — all SKU contribution/margin VAT-inclusive | sku-profitability | CRIT | AWB_BUG | HIGH | No | Divide revenue/COGS/transport/fees by (1+vat); marketing stays no_tva |
| B | P&L drops `refused`/`unsuccessful_delivery` into `other` (transport loss lost) | profitability-agg / status | HIGH | AWB_BUG | HIGH | No | Add both statuses to the `returned` category list |
| C | Per-order returned-loss double-counts COGS + adds packaging/commissions/fees | perorder | HIGH | AWB_BUG | HIGH | No | Zero COGS on returned/cancelled; returned loss = `-shipping_cost` only |
| D | Per-order re-introduces agency commission that aggregate+spec removed | perorder | HIGH | AWB_BUG | HIGH | No | Drop agency_commission from total_costs/profit |
| E | in_transit counted as REALIZED delivered revenue + COGS in per-SKU contribution | sku-profitability | HIGH | AWB_BUG | HIGH | No* | Restrict realized contribution to `delivered`; surface in_transit as pending |
| F | SKU status mapping diverges from main P&L (mis-buckets pickup/locker/refused/lost/...) | sku-profitability | HIGH | AWB_BUG | HIGH | No | Use the shared classifier verbatim |
| G | No test-order exclusion anywhere; over-counts orders/revenue/COGS | cross-cutting / all | HIGH | AWB_WEAKER | HIGH | **Yes** | Add `Order.tags` + parser ingest + global test filter |
| H | Single VAT rate for all countries (PL 23% / BG 20% differ from RO 21%) | profitability-agg / cross | HIGH | AWB_WEAKER | HIGH | **Yes** | Add Store.country + per-country vat_rates config |
| I | Velocity not first-sale-aware; new SKUs under-counted up to 5× | sales-velocity | HIGH | AWB_WEAKER | HIGH | No | Clamp divisor to per-SKU active span |
| J | Three/four hand-maintained status mappings instead of one classifier | status / all | MED | AWB_WEAKER | HIGH | **Yes** (scope) | Extract `app/core/status_classification.py` |
| K | Per-order status mapping narrower/inconsistent with aggregate | perorder | MED | AWB_BUG | HIGH | No | Use shared classifier (folds into J) |
| L | Per-order subtracts packaging from profit; aggregate excludes it | perorder | MED | AWB_BUG | HIGH | No | Drop packaging from per-order total_costs/profit |
| M | Per-SKU marketing summed over whole months, ignores intra-month window | sku-profitability | MED | AWB_BUG | HIGH | No | Pro-rate marketing by window/month fraction |
| N | Product per-store delivery_rate denominator excludes in_transit/ofd | product-deliv | MED | AWB_BUG | HIGH | No | Add in_transit+ofd to per-store shipped |
| O | Per-product denominator counts raw line-items, not distinct group/order | product-deliv | MED | AWB_BUG | HIGH | No | Dedupe (order, group_key) before incrementing |
| P | velocity period_days off-by-one (N-1 not N); last day dropped from charts | sales-velocity | MED | AWB_BUG | HIGH | No | `period_days = (to - from).days + 1` inclusive |
| Q | Unconvertible FX silently aggregated as raw foreign number into RON totals | cross-cutting | MED | AWB_BUG | HIGH | **Yes** (remedy) | Skip from RON sums or use configured fallback rate |
| R | VAT period boundary anchored to date_to, not per-order date (aggregate) | profitability-agg | MED | NEEDS_DECISION | HIGH | **Yes** | Per-order-date VAT, or document intra-month-only |
| S | Per-order vs aggregate VAT basis can diverge across Aug-2025 cutoff | perorder | LOW | NEEDS_DECISION | MED | **Yes** | Align both to one basis (recommend per-order date) |
| T | SKUs with no cost record counted COGS=0, inflating contribution | sku-profitability | MED | NEEDS_DECISION | MED | **Yes** | Null contribution/margin when `has_cost=false` |
| U | SKU report: single global VAT vs per-country (PL/BG) | sku-profitability | MED | AWB_WEAKER | HIGH | **Yes** (folds into H) | Per-country VAT once finding A is fixed |
| V | No test-order/exclusion filtering in SKU profitability | sku-profitability | MED | AWB_WEAKER | MED | **Yes** (folds into G) | Apply shared test filter |
| W | redirected/deferred/on_hold = in_transit in P&L but DELIVERY_PROBLEM in SKU-risk | status | LOW | NEEDS_DECISION | HIGH | **Yes** | Presentation choice; no correctness fix |
| X | Headline velocity NET vs Scripturi GROSS (~23% gap, different rankings) | sales-velocity | MED | NEEDS_DECISION | HIGH | **Yes** | Switch headline/sort/KPIs/alerts to gross (recommended) |
| Y | Packaging computed but silently dropped from aggregate P&L | profitability-agg | LOW | NEEDS_DECISION | HIGH | **Yes** | Include in operational total OR delete dead computation |
| Z | Multi-period division map may drop unmapped stores (e.g. Nubra) into OTHER | perorder-multi | LOW | NEEDS_DECISION | LOW | **Yes** | Confirm store roster; add OTHER bucket or pattern |
| AA | orders_delivered incremented per line-item, includes in_transit | sku-profitability | LOW | AWB_BUG | MED | No | Count distinct delivered order ids per SKU |
| — | Real per-order CSV transport + daily BNR FX | profitability-agg | LOW | AWB_BETTER | HIGH | No | **Keep — do not change** |
| — | days_left includes incoming PO stock + gross-velocity fallback | sales-velocity | LOW | AWB_BETTER | HIGH | No | **Keep** |
| — | Per-store timezone bounds (CZ/PL) | sales-velocity | LOW | AWB_BETTER | MED | No | **Keep** (optional consistency) |
| — | Barcode-group + Nubra isolation grouping | product-deliv | LOW | AWB_BETTER | HIGH | No | **Keep** |
| — | COGS=0 for returned/cancelled, kept for `other` | profitability-agg | LOW | AWB_BETTER | HIGH | No | **Keep** |
| — | Returned-order loss = -transport (equivalent to Scripturi) | profitability-agg/sku | LOW | DATA_SOURCE_DIFF | HIGH | No | **Keep** (depends on B) |
| — | SKU `exclude_from_stock` ≈ Scripturi SKU exclusion | cross-cutting | LOW | DATA_SOURCE_DIFF | MED | No | **Keep** |
| — | compute_final_outcome already matches Corrected table | status/velocity/cross | LOW | AWB_BETTER | HIGH | No | **Keep** (already fixed) |
| — | Deliverability SQL buckets + formulas spec-conformant | deliverability | LOW | DATA_SOURCE_DIFF | HIGH | No | **Keep** |
| — | Refused+returned split vs merge / no Lipsa-awb bucket | deliverability | LOW | DATA_SOURCE_DIFF | HIGH | No | **Keep** |
| — | Product-deliv status bucket mapping matches store-level | product-deliv | LOW | DATA_SOURCE_DIFF | HIGH | No | **Keep** |
| — | SKU returned-order handling equivalent to P&L | sku-profitability | LOW | DATA_SOURCE_DIFF | HIGH | No | **Keep** (depends on F) |

\* E is "no decision" on *correctness* (match the P&L = delivered is realized) but the chosen *presentation* (exclude vs separate pending bucket) is a small product call — recommended default below.

---

## 3. Confirmed Bugs to Fix (no decision needed)

Ordered for implementation: **systemic/shared first**, then per-report. Each fix is the conservative one that makes a report *match AWB's own authoritative aggregate engine and spec* — none changes a number that is currently correct.

### 3.0 — SHARED: Single status classifier (Findings J, K, F — structural root cause)

**What's wrong:** Four independent, hand-copied `aggregated_status → category` tables that must be kept in lockstep by hand: `deliverability.py:52-61` (SQL CASE), `profitability.py:293-302` (5-cat if/elif), `profitability_orders.py:175-184` (narrower), `sku_profitability/endpoint.py:198-207` (narrowest), plus `computations.py:14-27` (final-outcome layering). They already disagree — that divergence *is* how findings B, F, K arose. `profitability.py:293-302` is the authoritative AWB mapping (verified correct against spec).

**Exact fix:**
- New file `backend/app/core/status_classification.py` exposing the canonical dict, derived verbatim from `profitability.py:293-302`:
  - `delivered = {delivered, customer_pickup, in_parcel_locker}`
  - `returned = {back_to_sender, returned, returning_to_sender, incorrect_address, lost, refused, unsuccessful_delivery}` ← **this already folds in Finding B**
  - `cancelled = {cancelled, voided}`
  - `in_transit = {in_transit, out_for_delivery, fulfilled, redirected, deferred_delivery, on_hold}`
  - else `other`
  - Expose `classify(aggregated_status) -> category` and a `CATEGORY_STATUS_LISTS` dict so `deliverability.py` can build its SQL CASE from the same source.
- Refactor consumers to import it: `profitability.py` (replace 293-302), `profitability_orders.py` (replace 175-184 **and** SQL status filter 62-69), `sku_profitability/endpoint.py` (replace 198-207), `deliverability.py`/`product_deliverability.py` (build SQL CASE from `CATEGORY_STATUS_LISTS`). Leave `compute_final_outcome()` layering on top — it is finer-grained (DELIVERY_PROBLEM/REFUSED) and already correct; it can *consume* the base map but keep its workflow/shipment/fulfillment fallback layering.

**Verify:** Unit test asserting all five call sites return the same category for every one of the ~17 Frisbo enum values. Regression assert: the three mappings agree specifically on `refused` and `unsuccessful_delivery` (→ `returned`).

**Migration/data:** None.

### 3.1 — Finding B: refused/unsuccessful_delivery → `returned` in aggregate P&L (AWB_BUG)

**What's wrong:** `profitability.py:295-296` omits `refused`/`unsuccessful_delivery`; they fall to `other`, keep full COGS, get `profit_gross=0`, and are excluded from the Returnate/Refuzate income line — so a refused parcel's real transport loss vanishes from the P&L. Contradicts `deliverability.py` (counts them as shipped), `compute_final_outcome()` (REFUSED), and the spec `PNL_KNOWLEDGE.md:513-514`.

**Exact fix:** Folded into 3.0 — adding both to the `returned` list routes them through the existing `returned` branch: COGS zeroed (line 306), `profit_gross = -shipping_cost` (line 342). If 3.0 is staged after, the one-line interim fix is to extend the list at `profitability.py:295`. Also fix the misleading comment at line 292/335.

**Verify:** Unit test: an order with `aggregated_status='refused'` produces COGS=0 and `profit_gross == -shipping_cost`. Regression: sum of refused-order P&L contribution equals `-Σ shipping`.

**Migration/data:** None.

### 3.2 — Finding C: Per-order returned-loss double-counts COGS + extras (AWB_BUG)

**What's wrong:** `profitability_orders.py:220` computes returned loss as `-(order_sku_cost + shipping_cost + packaging_cost + gt_commission + payment_fee + frisbo_fee)`, and never zeroes `order_sku_cost` for returned/cancelled. The aggregate (`profitability.py:305-306, 342`) zeroes COGS and books `-shipping_cost` only. Products come back and are resold — booking their COGS as a loss is wrong; Scripturi agrees (COGS only on Livrata).

**Exact fix:** In `profitability_orders.py`, after `cat` is assigned (~175-184): set `order_sku_cost = 0` when `cat in ('returned','cancelled')`; change line 220 to `profit_gross = -shipping_cost`.

**Verify:** Regression test (the reconciliation guard described in Phase 3 below): `Σ per-order profit_gross` for one period == aggregate `by_status` (delivered profit + returned loss) within rounding.

**Migration/data:** None.

### 3.3 — Finding D: Per-order re-introduces agency commission (AWB_BUG)

**What's wrong:** `profitability_orders.py:199-201,215` adds `agency_commission = revenue * agency_commission_pct/100` into `total_costs`/`profit_gross`. The aggregate removed it (`profitability.py:335-336`) and it's now a monthly `business_costs` entry (`PNL_KNOWLEDGE.md:573`). Per-order double-counts it against the monthly cost, depressing per-order profit by ~2.5% of revenue.

**Exact fix:** Remove `agency_commission` from `total_costs` (line 215) and `profit_gross`. Keep as display-only field at most (value 0 or surfaced separately), never inside the profit math.

**Verify:** Same reconciliation test (3.2). Assert delivered per-order profit == aggregate per-order contribution.

**Migration/data:** None.

### 3.4 — Finding L: Per-order subtracts packaging; aggregate excludes it (AWB_BUG)

**What's wrong:** `profitability_orders.py:196,215,220` subtracts `packaging_cost` (3.7 RON) from profit and from the returned loss. The aggregate excludes packaging from `total_operational` (`profitability.py:472`) and zeros it in output (line 649). The two views disagree by 3.7 RON × order.

**Exact fix:** Remove `packaging_cost` from per-order `total_costs`/`profit_gross` and from the returned loss, matching the aggregate (which is authoritative today). **Note the coupling to Finding Y:** if the user decides packaging *is* a real cost (Y), it must be added to **both** endpoints together — do not resolve C/L in a way that pre-judges Y. The conservative move now is "per-order matches aggregate" = exclude in both.

**Verify:** Reconciliation test (3.2).

**Migration/data:** None.

### 3.5 — Finding A: SKU profitability applies NO VAT (CRITICAL, AWB_BUG)

**What's wrong:** `sku_profitability/endpoint.py:164` computes `dynamic_vat_rate` and then **never uses it** (confirmed: variable is dead). Revenue, COGS, transport, packaging, payment_fee, gt_commission, frisbo_fee, contribution (332), margin_pct (333), avg_selling_price (336) and the per-store block are all VAT-inclusive. The main P&L divides by `(1+vat)` (`profitability.py:349-350, 447-451`). Every SKU contribution is overstated and every margin% distorted.

**Exact fix:** Apply VAT consistently with the main P&L. Add `net = lambda v: v/(1+dynamic_vat_rate) if dynamic_vat_rate>0 else v`. Divide revenue, line_cogs, alloc_transport, alloc_packaging, alloc_payment, alloc_gt, alloc_frisbo by `(1+dynamic_vat_rate)` before aggregating. **Do NOT VAT-divide per-SKU marketing** — treat as `no_tva_split`, exactly as Facebook/TikTok/Google ad spend is treated in the main P&L. Then `contribution = revenue_fara - (cogs_fara + transport_fara + fees_fara + marketing)`, margin on fara_tva.

**Verify:** Regression test asserting `SKU-report total_revenue == main P&L sales_delivered.fara_tva` for an overlapping store/date window. This is the highest-value test in the whole plan.

**Migration/data:** None. (Per-country VAT — Finding U — is the *next* layer, gated under decision H.)

### 3.6 — Finding F: SKU status mapping diverges from P&L (AWB_BUG)

**What's wrong:** `sku_profitability/endpoint.py:198-207` mis-buckets `customer_pickup`/`in_parcel_locker` (genuine deliveries) as in_transit/other and routes `returning_to_sender`/`incorrect_address`/`lost`/`refused` through the full-calc `other` branch with full revenue+COGS+fees.

**Exact fix:** Folded into 3.0 — replace lines 198-207 with the shared classifier.

**Verify:** Covered by 3.0 unit test + 3.5 reconciliation.

**Migration/data:** None.

### 3.7 — Finding E: in_transit counted as realized in per-SKU (AWB_BUG)

**What's wrong:** `endpoint.py:303-320` runs the full-calc branch for both `delivered` and `in_transit`, booking in_transit revenue+COGS+fees as realized and incrementing `orders_delivered`. The main P&L tracks in_transit as pending and reports realized profit from delivered only.

**Exact fix:** Restrict realized per-SKU contribution to `cat=='delivered'`. **Recommended default presentation:** add a separate `pending`/in_transit bucket (units_pending, revenue_pending) surfaced alongside, rather than dropping it silently — mirrors main P&L. (If the user instead prefers blending, that's the only presentation nuance — but the *correctness* baseline is delivered=realized.)

**Verify:** Reconciliation against main P&L `net_revenue` (delivered only).

**Migration/data:** None.

### 3.8 — Finding K: Per-order status mapping narrower than aggregate (AWB_BUG)

Folded into 3.0 (replace `profitability_orders.py:62-69` SQL filter and `:175-184` mapping with the shared classifier, including `cancelled/voided`). Verify: reconciliation test.

### 3.9 — Finding M: Per-SKU marketing over-attributed for partial-month windows (AWB_BUG)

**What's wrong:** Orders filtered by exact UTC date (`endpoint.py:53-61`) but marketing queried/summed by **whole month** (`:64-74, 94-101, 105-109`). A 6-day window subtracts a full month of SKU marketing; a default 30-day window spanning two partial months counts both full months.

**Exact fix:** Pro-rate each `SkuMarketingCost` entry by `days_of_that_month_in_window / days_in_month`, mirroring main P&L marketing date logic (`profitability.py:494-500`). (Alternatively force month-aligned ranges, but pro-rating is the non-breaking fix.)

**Verify:** Unit test: a half-month window attributes ~50% of that month's SKU marketing.

**Migration/data:** None.

### 3.10 — Finding N: Product per-store delivery_rate denominator inconsistent (AWB_BUG)

**What's wrong:** `product_deliverability.py:282` (by_store ZERO lambda) and `:323-325` (accumulation) omit `in_transit`/`out_for_delivery`, so per-store `s_shipped` (line 364) = delivered+returned+refused — smaller than the group-level shipped (line 352), inflating every product's per-store delivery_rate.

**Exact fix:** Add `in_transit` and `out_for_delivery` keys to the by_store ZERO lambda (line 282), extend the accumulation guard (line 324), and set `s_shipped = delivered + in_transit + out_for_delivery + returned + refused` (line 364) to match the group/store-level definition (`deliverability.py:93`).

**Verify:** Unit test: per-store delivery_rate for a SKU equals its overall delivery_rate when the SKU sells in one store.

**Migration/data:** None.

### 3.11 — Finding O: Per-product denominator counts line-items not distinct orders (AWB_BUG)

**What's wrong:** `product_deliverability.py:300-325` does `total_orders += 1` per raw line-item. When a SKU repeats on an order, or two sibling variant-SKUs collapse into one barcode group, that order is counted 2+× into the same group — inflating numerator and denominator and skewing the `min_orders=5` cutoff. Scripturi counts each order once per distinct product.

**Exact fix:** In the order loop, resolve each line item to its `group_key`, build the **set of distinct group_keys for this order**, then increment `total_orders`/status bucket/by_store **once per distinct group_key**. Keep `total_units` as the qty sum (units are genuinely per-line). Rename `total_orders` → `order_appearances` for clarity. Apply *on top of* the existing (correct) barcode grouping.

**Verify:** Unit test with an order containing the same SKU twice and an order with two sibling variants sharing a barcode → group counted once each.

**Migration/data:** None.

### 3.12 — Finding I: Velocity not first-sale-aware (AWB_WEAKER, but clear)

**What's wrong:** `sales_velocity/endpoint.py:733,789,807,922` divide every SKU by one global `period_days`. A SKU first sold on day 20 of a 30-day window is divided by ~30, halving-to-fifthing its velocity and over-stating `days_left_of_stock` — causing under-ordering of fresh winners (34% of selling SKUs in the proxy window are new).

**Exact fix:** Track the earliest sale date per `group_key` (during the order loop or a `MIN(date)` query). For each product/variant: `eff_days = clamp((to_bucharest_date(dt_to) - max(from_date, first_sale_date)).days + 1, 1, period_days)`; divide units by `eff_days` for velocity, gross_velocity, variant velocity (and prev_velocity at 738). Mirror Scripturi's `eff_from = max(window_start, first_sale_date)`.

**Verify:** Unit test reproducing Scripturi SKU 166 (qty=174, first=2026-05-15, 30-day window) → velocity 14.5, not 5.8.

**Migration/data:** None. **Apply together with Finding P** (they share the divisor).

### 3.13 — Finding P: velocity period_days off-by-one (AWB_BUG)

**What's wrong:** `endpoint.py:116` `period_days = max((dt_to - dt_from).days, 1)`; since `dt_to` is end-of-day 23:59:59, this yields N-1 for an N-day inclusive range. Velocities are over-stated ~N/(N-1) (~3.4% at 30d) and the chart loops (`:761,809,890`) using `range(period_days)` **drop the final calendar day** from sparklines while its sales are in the totals.

**Exact fix:** `period_days = (to_bucharest_date(dt_to) - to_bucharest_date(dt_from)).days + 1`. Make daily_series/trends/variant loops iterate all inclusive days so the last day renders and chart == totals. Apply with Finding I.

**Verify:** Unit test: `2026-05-01..2026-05-31` → period_days 31 and 31 sparkline points.

**Migration/data:** None.

### 3.14 — Finding AA: SKU orders_delivered per line-item, includes in_transit (AWB_BUG, conf MED)

**What's wrong:** `endpoint.py:306` `orders_delivered += 1` inside the per-line loop, so a SKU on multiple lines over-counts, and it includes in_transit.

**Exact fix:** Track delivered order membership per SKU via a `set()` of order ids (increment once per distinct delivered order); pairs naturally with Finding E (delivered-only). Rename/clarify the field.

**Verify:** Unit test: SKU on 2 lines of 1 delivered order → orders_count 1.

**Migration/data:** None.

---

## 4. Needs-User-Decision Items

Each is a crisp question with the trade-off and a recommended default. **None should be "fixed" without an answer — several could make numbers worse if intent differs.**

**D1 — Test-order identifier (Findings G, V; HIGH).**
*Question:* How are test orders identified in AWB's Frisbo-sourced data? AWB's `Order` model has **no `tags` column** and the Frisbo parser never ingests tags, so a literal `tag=test` filter (Scripturi's mechanism, ~2.4% of orders incl. 133 delivered with ~13.7k RON revenue) is impossible today.
*Options:* (a) Add `Order.tags` column + parser ingest from Frisbo payload + global config filter [most robust, needs migration]; (b) dedicated test `store_uid` exclusion; (c) `order_number` prefix/pattern; (d) customer_name/email heuristic [fragile].
*Trade-off:* (a) is the correct long-term fix and matches Scripturi but requires a schema migration + parser change + backfill. (b)/(c) are cheaper if test orders are isolated to a known store or numbering scheme.
*Recommended default:* (a) — add `Order.tags`, ingest from Frisbo, promote the dead `agency_commission_excluded_tags` config into a **global** report filter applied uniformly across **all** analytics endpoints (deliverability, profitability, per-order, product-deliverability, velocity, sku_risk) — consistency requires it be global, not per-report.

**D2 — Per-country VAT (Findings H, U; HIGH).**
*Question:* Implement per-country VAT now (RO/CZ 21%, PL 23%, BG 20%)? AWB has no `Store.country` field and a single scalar `vat_rate`; it structurally charges RO VAT to every store. Lifetime net-revenue distortion on the proxy: PL **+10,197 RON** overstated, BG **−5,411 RON** understated, CZ 0 (coincides with RO).
*Trade-off:* Real systematic bias (~1.6% PL / 0.8% BG of net revenue) that grows if non-RO stores scale; but only ~2.5% of revenue is affected today and CZ luckily matches RO. Needs a migration (`Store.country`) + config (`vat_rates` JSON) + per-store resolution in both `profitability.py` and `profitability_orders.py`.
*Recommended default:* **Yes, build the infrastructure** (`Store.country` + per-country `vat_rates` config), derive country from store TLD/currency as the migration backfill, keep the 2025-08-01 → 0.19 override **for RO only**. Sequence it right after the VAT-application fix (A) so SKU and aggregate share one VAT resolver.

**D3 — VAT period boundary basis (Findings R, S; MED/LOW).**
*Question:* Should VAT be computed per-order-date or once-per-report? Aggregate anchors to `date_to` (single rate for the whole period); per-order endpoint already uses per-order date. A report spanning 2025-08-01 makes the two irreconcilable.
*Trade-off:* Per-order-date is more correct but means the aggregate must accumulate fara_tva per order. Today all live periods are post-cutoff so both yield 21% and agree — impact is confined to cross-cutoff custom ranges.
*Recommended default:* **Adopt per-order-date VAT everywhere** (combine with D2's per-country resolver into one per-order VAT function). If the business only ever runs intra-month reports, the cheaper alternative is to document the single-rate limitation and force the per-order endpoint to the period rate — but per-order-date is the durable answer.

**D4 — Unconvertible-FX fallback (Finding Q; MED).**
*Question:* When a non-RON order has no BNR rate within the 30-day lookback, what should happen? Today the raw foreign number is summed 1:1 into RON totals (`profitability.py:223-227`, mirrored in per-order) — a clear bug; only the *remedy* is a business call.
*Options:* (a) skip the order's monetary contribution (still count/flag it); (b) configured fallback rate; (c) BNR last-known rate without the 30-day cap.
*Recommended default:* (a) skip from RON monetary sums while surfacing the order in the unconvertible flag — never add a face-value foreign number to RON. Optionally (c) as a softer fallback. Add a regression test that an unconvertible EUR order does not add its face value to RON revenue.

**D5 — Missing-COGS SKUs (Finding T; MED).**
*Question:* For SKUs with no cost record, keep COGS=0 (current, flagged `has_cost=false`) — which makes them look 100%-margin profitable — or null their contribution/margin?
*Recommended default:* Null contribution/margin when `has_cost=false` and exclude them from the avg_margin headline (surface them in a separate `missing_cost_skus` list, as Scripturi surfaces `cogs_missing`). Don't let an unknown cost read as profit.

**D6 — Packaging in the P&L (Finding Y; LOW).**
*Question:* Is the 3.7 RON/order packaging a real, not-yet-captured cost, or is it already inside CSV transport / business_costs? It's computed but zeroed out of the P&L today.
*Trade-off:* If real and uncaptured, excluding it overstates operating/net profit by 3.7 × delivered_count. If already captured elsewhere, including it double-counts.
*Recommended default:* Confirm with the user. If real → include `tva_split(d['packaging'])` in `total_operational` (and add to **both** per-order and aggregate together). If already captured → **delete** the dead computation to avoid confusion. **Do not** resolve Findings C/L in a way that pre-commits this.

**D7 — Headline velocity NET vs GROSS (Finding X; MED).**
*Question:* Should the headline velocity/sort/KPIs/alerts use gross (orders placed) or net (delivered-only)? AWB headlines net (~23% below gross) but already uses gross for `days_left` — internally inconsistent.
*Recommended default:* Switch headline/sort/KPIs/alerts to **gross** (matches Scripturi's replenishment semantics and AWB's own days_left basis); keep net as a secondary delivered-rate metric. For replenishment, demand = orders placed.

**D8 — DELIVERY_PROBLEM label unification (Finding W; LOW).**
*Question:* Surface `redirected`/`deferred_delivery`/`on_hold` as a distinct delivery-problem bucket on deliverability/P&L too, or keep them folded into În Tranzit? Financially all three mappings agree (shipped/active) — **no P&L number is wrong** either way; tiny volume (~138 orders).
*Recommended default:* Keep folded into În Tranzit on the financial tabs (no code change); document that SKU-risk intentionally uses the finer DELIVERY_PROBLEM label behind its `include_delivery_problems` flag.

**D9 — Multi-period division map coverage (Finding Z; LOW, conf LOW).**
*Question:* Does AWB actually have stores unmapped by `DIVISION_MAP` (e.g. a Nubra/NUB store exists in the shared business)? Unmapped stores fall to `OTHER` and are excluded from named subsidiaries while still in the consolidated total, so `Σ subsidiaries ≠ consolidated`.
*Recommended default:* Confirm the canonical store→division roster. If unmapped stores exist, add an explicit `OTHER` subsidiary bucket so rows reconcile to consolidated (cannot verify against AWB prod — needs the store list).

---

## 5. Confirmed NON-Issues (do NOT "fix")

These are correct or *more accurate* than Scripturi. Touching them would regress real numbers.

- **Real per-order CSV transport** (`profitability.py:236-258`, 5-step same-SKU/brand-avg/customer-paid fallback) — strictly more precise than Scripturi's fixed monthly `cost_per_parcel × plecate`. **Keep.**
- **Daily BNR FX** (`exchange_rates.py`, per-order Bucharest-date rate with prior-day fallback) — matches Romanian accounting; Scripturi uses one hardcoded monthly average. **Keep.** (Only the unconvertible-gap fallback, D4, is a separate bug.)
- **Returned-order loss = −transport, COGS recovered** (`profitability.py:305,342`; SKU `endpoint.py:294-302`) — correct economics (products resold), matches Scripturi. **Keep** (its benefit reaches refused parcels only after Finding B).
- **COGS=0 for returned/cancelled, kept for `other`** (`profitability.py:304-306`) — matches `PNL_KNOWLEDGE.md:530`. **Keep.**
- **`compute_final_outcome()`** (`computations.py:14-27`) — already matches the spec's *Corrected* table (verified: IN_TRANSIT includes in_transit/out_for_delivery, DELIVERY_PROBLEM includes deferred_delivery, NOT_SHIPPED includes generated_awb/on_hold/ready_for_picking). The documented "→OTHER" bug is **already fixed**. **Keep.**
- **Deliverability SQL buckets + rate formulas** (`deliverability.py:52-61, 93-152`) — spec-conformant; refused+returned split and absent Lipsa-awb are legitimate Frisbo-vs-courier data-source differences with arithmetically identical math. **Keep.**
- **Product-deliverability status bucket mapping** (`product_deliverability.py:45-76`) — identical to store-level; in_transit/ofd correctly placed (not the OTHER bug). **Keep.**
- **Barcode-group + Nubra isolation grouping** (`product_deliverability.py:155-268`, shared `product_grouping.py`) — stronger than Scripturi's raw-SKU keying. **Keep** (note: this grouping is what makes Finding O's dedupe necessary — fix O on top of it).
- **days_left includes incoming PO stock + gross-velocity fallback** (`sales_velocity/endpoint.py:778,789-798`) — more accurate than Scripturi's bare on-hand. **Keep.**
- **Per-store timezone bounds (CZ/PL)** in explicit-date mode — ahead of Scripturi's uniform Bucharest. **Keep** (optional consistency fix to apply in days-mode too is low priority).
- **Multi-period CM3 / operating_profit** (`multi_period_pnl.py:86-95`) — `CM3 = operating_profit − marketing`, fixed costs correctly excluded, consolidated row sourced from authoritative aggregate (reconciles by construction), quarter pct recomputed on totals. **Keep.**
- **SKU `exclude_from_stock`** (`profitability.py:130-138`) — functionally equivalent to Scripturi's SKU exclusion for COGS (semantics differ: AWB zeroes SKU COGS but keeps revenue; arguably better). **Keep.**

---

## 6. Implementation Roadmap

**Pre-flight (do first):** Stand up a unit-test harness that loads Scripturi's `profitability.db` (277,662 orders, same business) as ground truth and runs AWB's formula functions against it. The single most valuable assertion: **`SKU-report total_revenue == main P&L sales_delivered.fara_tva`** for an overlapping window. Boot the backend locally and run each touched endpoint after every phase. Extract pure formula functions where needed so they're testable without the DB.

### Phase 1 — Shared / systemic (no migration; fixes the most reports at once)
1. **Create `app/core/status_classification.py`** (Finding J) — canonical map = `profitability.py:293-302` **plus** refused/unsuccessful_delivery in `returned` (folds in **B**). Refactor `profitability.py`, `profitability_orders.py` (incl. SQL filter), `sku_profitability/endpoint.py`, `deliverability.py`, `product_deliverability.py` to consume it. Fold in **F**, **K**.
2. **SKU VAT application** (Finding **A**, CRITICAL) — add the `net` helper, divide revenue/COGS/transport/fees, leave marketing as no_tva.
3. **Per-order reconciliation fixes** (**C**, **D**, **L**) — zero COGS on returned/cancelled, returned loss = `-shipping`, drop agency + packaging from per-order profit.
4. **SKU realized-only + distinct-order counts** (**E**, **AA**) — delivered-only contribution + pending bucket; order-id sets.
5. **SKU marketing pro-ration** (**M**).
6. **Velocity divisor** (**I** + **P**) — first-sale clamp + inclusive period_days + chart loops, together.
7. **Product-deliverability** (**N** + **O**) — per-store shipped denominator + (order, group_key) dedupe.

*Verification gate:* status-classifier agreement test passes; per-order sum reconciles with aggregate `by_status`; SKU total_revenue matches P&L fara_tva; velocity reproduces Scripturi clamped numbers; backend boots and every touched endpoint returns 200 with expected keys.

### Phase 2 — Per-report fixes requiring config or remedy choice (light decisions)
8. **Unconvertible-FX handling** (**Q** / D4) — once remedy chosen, stop aggregating raw foreign as RON in both `profitability.py` and `profitability_orders.py`. **New config** if a fallback rate is chosen. Regression test included.
9. **Missing-COGS presentation** (**T** / D5) — null contribution/margin when `has_cost=false`.
10. **Velocity headline gross/net** (**X** / D7) — if gross chosen, switch sort/KPIs/alerts.

### Phase 3 — Decision-gated + migrations
11. **Test-order exclusion** (**G**, **V** / D1) — **DB migration** `ADD COLUMN tags` (idempotent `IF NOT EXISTS`; remember `Base.metadata.create_all()` will *not* add it — write the migration script per the global lesson) + **parser change** to ingest Frisbo tags + **backfill** + promote `excluded_tags` config to a **global** filter applied across all analytics endpoints. **New config:** global test-tag list.
12. **Per-country VAT** (**H**, **U** / D2) — **DB migration** `Store.country` + **new config** `vat_rates` JSON on `ProfitabilityConfig` + prefix/currency→country backfill map. Build one per-order VAT resolver shared by aggregate, per-order, and SKU.
13. **Per-order-date VAT basis** (**R**, **S** / D3) — fold into the same resolver; aggregate accumulates fara_tva per order.
14. **Packaging decision** (**Y** / D6) — include in both endpoints or delete dead computation.
15. **Multi-period division map** (**Z** / D9) — add unmapped stores or an explicit `OTHER` bucket once the roster is confirmed.
16. **Label unification** (**W** / D8) — documentation only unless the user wants a UI bucket.

**Migrations required:** Phase 3 only — `Order.tags` (D1), `Store.country` + `vat_rates` config (D2). Both idempotent `ADD COLUMN IF NOT EXISTS` scripts; neither relies on the ORM auto-creating columns.
**New config required:** global test-tag exclusion list (D1), per-country `vat_rates` + store→country map (D2), optional FX fallback rate (D4).

**Risk flag (financial code):** Phases 1–2 only make AWB *internally consistent* with its own authoritative aggregate engine and spec — they cannot make a currently-correct number worse, except where a user-intent question is open: **Finding Y (packaging)** must not be silently resolved by C/L, **Finding X (gross/net)** changes the headline meaning, and **Finding E** has a presentation choice. Phase 3's VAT and test-exclusion changes *will* move headline totals (correctly), so run them past the user and verify against the proxy DB before declaring done.