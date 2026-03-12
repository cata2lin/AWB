# P&L (Profit & Loss) System — Complete Knowledge Base

> **Purpose**: This document contains everything needed to understand, modify, or extend the P&L reporting system. Use it as context when working in a new chat session.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [P&L Formula: Line-by-Line](#pl-formula-line-by-line)
3. [TVA (VAT) Handling](#tva-vat-handling)
4. [Data Flow: Order → P&L](#data-flow-order--pl)
5. [Backend Files Reference](#backend-files-reference)
6. [Frontend Files Reference](#frontend-files-reference)
7. [Database Schema](#database-schema)
8. [API Response Structure](#api-response-structure)
9. [Marketing Costs (Google Sheets)](#marketing-costs-google-sheets)
10. [Business Costs (DB-Managed)](#business-costs-db-managed)
11. [Configuration Parameters](#configuration-parameters)
12. [Order Status Classification](#order-status-classification)
13. [Transport Cost Fallback Chain](#transport-cost-fallback-chain)
14. [Currency Conversion](#currency-conversion)
15. [Known Gotchas & Migration Notes](#known-gotchas--migration-notes)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  Frontend (React)                    │
│  Analytics.jsx → renderStorePnl() function           │
│  Settings.jsx → Business Cost CRUD (TVA + section)   │
└────────────────────────┬────────────────────────────┘
                         │ GET /api/analytics/profitability
┌────────────────────────┼────────────────────────────┐
│         Backend: profitability.py (785 lines)        │
│                                                      │
│  Orders ──→ For each order:                          │
│    1. Classify by status (delivered/returned/etc.)    │
│    2. Calculate SKU costs, shipping, commissions     │
│    3. Convert currencies via BNR rates               │
│    4. Aggregate per-store + global totals             │
│                                                      │
│  Google Sheets ──→ Marketing costs (FB/TT/Google)    │
│  BusinessCost ──→ Fixed/operational costs from DB    │
│                                                      │
│  Output: { pnl, pnl_by_store, summary, by_status }  │
└──────────────────────────────────────────────────────┘
```

**Key files:**

| File | Purpose |
|------|---------|
| `backend/app/api/analytics/profitability.py` | **Core P&L engine** — all formulas live here |
| `backend/app/models/business_cost.py` | Business cost ORM model (has_tva, pnl_section) |
| `backend/app/api/business_costs.py` | CRUD API for business costs |
| `backend/app/api/profitability_config.py` | Config API (packaging, commissions, VAT rate) |
| `backend/app/models/profitability_config.py` | Config ORM model |
| `backend/app/services/google_sheets.py` | Marketing cost fetcher (Google Sheets → DB cache) |
| `frontend/src/pages/Analytics.jsx` | Frontend P&L display (`renderStorePnl` function) |
| `frontend/src/pages/Settings.jsx` | Business cost management UI |
| `frontend/src/services/api/businessCosts.js` | Frontend API client for business costs |

---

## P&L Formula: Line-by-Line

The P&L mirrors the Apps Script layout used for manual reporting. This is the **exact order** used in both backend and frontend:

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. VÂNZĂRI BRUTE (Gross Sales)                                     │
│     = Total revenue from ALL orders (delivered + returned + etc.)    │
│     Displayed: cu_tva and fara_tva                                  │
│                                                                     │
│  2. (-) CÂȘTIGURI NEREALIZATE (Unrealized Gains)                    │
│     = Revenue from non-delivered orders, broken down by status:     │
│       - În Tranzit: count, cu_tva, fara_tva                        │
│       - Returnate: count, cu_tva, fara_tva                         │
│       - Anulate: count, cu_tva, fara_tva                           │
│       - Altele: count, cu_tva, fara_tva                            │
│     Total unrealized with % of gross                                │
│                                                                     │
│  3. VÂNZĂRI (Revenue = Delivered Only)                               │
│     = Revenue from delivered orders only                            │
│     Displayed: count, cu_tva, fara_tva                              │
│                                                                     │
│  4. (-) TVA (19%)                                                   │
│     = tva_amount = cu_tva - fara_tva (from delivered revenue)       │
│                                                                     │
│  5. REVENUE NET (fără TVA)                                          │
│     = Delivered revenue / 1.19                                      │
│                                                                     │
│  6. (-) COGS (Cost of Goods Sold)                                   │
│     = Sum of (qty × unit_cost) for delivered orders ONLY            │
│     Returned/cancelled: COGS = 0 (products come back)              │
│     Displayed: cu_tva and fara_tva                                  │
│     % = cogs_fara_tva / revenue_fara_tva                           │
│                                                                     │
│  7. (-) TRANSPORT                                                   │
│     = Shipping costs for delivered orders                           │
│     Source: CSV import → same-SKU fallback → brand avg → customer   │
│     Displayed: cu_tva and fara_tva                                  │
│     % = transport_fara_tva / revenue_fara_tva                      │
│                                                                     │
│  8. (-) COMISIOANE & OPERAȚIONAL                                    │
│     - Comision GT: gt_commission_pct % of revenue (GT store only)   │
│     - Procesare plăți: payment_processing_pct% + fixed fee          │
│       (only for card payments, NOT for COD/"Plată ramburs")         │
│     - Fulfillment Frisbo: frisbo_fee_per_order × delivered count    │
│     - Salariu depozit: warehouse_salary_per_package × shipped count │
│     Each: cu_tva and fara_tva                                       │
│                                                                     │
│  9. (-) MARKETING                                                   │
│     - Facebook Ads: from Google Sheets (no TVA — foreign service)   │
│     - TikTok Ads: from Google Sheets (no TVA)                       │
│     - Google Ads: from Google Sheets (no TVA)                       │
│     Total Marketing                                                 │
│     % = marketing_total / revenue_fara_tva                         │
│                                                                     │
│ 10. (-) COSTURI FIXE & SEZONIERE                                    │
│     = From business_costs table, grouped by P&L section             │
│     Each cost has has_tva flag:                                     │
│       has_tva=true → fara_tva = amount / 1.19                     │
│       has_tva=false → fara_tva = amount (e.g. foreign services)   │
│     Categories: salary, utility, subscription, marketing, rent, other│
│                                                                     │
│ 11. TOTAL COSTURI                                                   │
│     = COGS + Transport + Comisioane + Marketing + Fixed Costs       │
│     (all fara_tva values used for the main total)                   │
│     % = total_costs_fara_tva / revenue_fara_tva                   │
│                                                                     │
│ 12. PROFIT NET                                                      │
│     = Revenue_fara_tva - Total_Costs_fara_tva                      │
│     Displayed: cu_tva, fara_tva, and margin %                      │
│     Margin % = profit_fara_tva / revenue_fara_tva × 100            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## TVA (VAT) Handling

Romanian VAT (TVA) rate: **19%** (stored as `0.19` in config, but currently set to `0.21` as default — check `vat_rate` in ProfitabilityConfig).

### Core Helper Functions (in `profitability.py`)

```python
# For values that INCLUDE Romanian TVA (sales revenue, domestic costs)
def tva_split(val):
    return {
        'cu_tva': round(val, 2),                                    # Original value
        'fara_tva': round(val / (1 + vat_rate), 2) if vat_rate > 0 else round(val, 2),
    }

# For values WITHOUT TVA (foreign services like Facebook/TikTok ads)
def no_tva_split(val):
    return {'cu_tva': round(val, 2), 'fara_tva': round(val, 2)}    # Same value for both

# For business costs with per-item TVA flag
def biz_tva_split(val, has_tva_flag):
    if has_tva_flag:
        return tva_split(val)    # Amount includes TVA → divide to remove
    return no_tva_split(val)     # Amount has no TVA → keep as-is
```

### TVA Rules by Cost Type

| Cost Type | Has TVA? | Reason |
|-----------|----------|--------|
| Sales Revenue | ✅ Yes | Romanian retail prices include TVA |
| COGS (SKU costs) | ✅ Yes | Domestic product costs include TVA |
| Transport/Shipping | ✅ Yes | Domestic courier costs include TVA |
| GT Commission | ✅ Yes | Domestic agency fee |
| Payment Processing | ✅ Yes | Domestic payment processor |
| Frisbo Fulfillment Fee | ✅ Yes | Domestic 3PL service |
| Facebook Ads | ❌ No | Foreign service (Ireland), no Romanian TVA |
| TikTok Ads | ❌ No | Foreign service, no Romanian TVA |
| Google Ads | ❌ No | Foreign service (Ireland), no Romanian TVA |
| Business Costs | ⚙️ Configurable | Per-item `has_tva` flag in DB |

**Key principle**: TVA is **deductible** — so the "real cost" is always the `fara_tva` value. All percentage calculations use `fara_tva` values.

---

## Data Flow: Order → P&L

### Step 1: Load Orders
- Query all orders matching `store_uids`, `date_from`/`date_to`, or `days` filter
- Load `SkuCost` table as lookup map (`sku → cost`)
- Load `Store` names
- Preload BNR exchange rates for non-RON currencies

### Step 2: Per-Order Processing
For each order in the result set:

1. **Currency conversion**: If not RON, convert `total_price` and `subtotal_price` using BNR rates
2. **Status classification**: Map `aggregated_status` → `delivered` / `returned` / `cancelled` / `in_transit` / `other`
3. **Transport cost**: Apply the 4-step fallback chain (see below)
4. **SKU cost**: Sum `qty × unit_cost` from `sku_costs` table (0 for returned/cancelled)
5. **Operational costs**: Calculate packaging, GT commission, payment fee, frisbo fee (0 for cancelled)
6. **Profit**: `revenue - total_costs` (delivered), `-shipping` (returned), 0 (cancelled)
7. **Aggregate**: Add to `stats[status_category]` and `per_store[store_uid]`

### Step 3: Post-Processing
1. Fetch marketing costs from Google Sheets (cached in DB)
2. Load business costs from `business_costs` table for the relevant month
3. Calculate warehouse salary (`shipped_count × per_package_rate`)
4. Build P&L JSON response with all `tva_split()`/`no_tva_split()` values

---

## Backend Files Reference

### `profitability.py` — The Core Engine (785 lines)

**Sections by line range:**

| Lines | Content |
|-------|---------|
| 1-28 | Imports and router setup |
| 30-45 | `_sku_hash()` — deterministic hash for SKU-based transport fallback |
| 48-100 | `get_profitability_stats()` — endpoint definition, query building |
| 100-155 | Exchange rate preloading, transport cost fallback caches |
| 156-166 | Stats initialization (5 status categories × 11 metrics each) |
| 168-376 | **Per-order processing loop** — the core computation |
| 377-391 | Per-store rounding, top SKUs |
| 392-410 | Summary totals (realized vs pending) |
| 410-420 | `tva_split()` / `no_tva_split()` helpers |
| 422-430 | P&L structure: gross sales, net revenue, COGS |
| 430-466 | Operational costs, marketing costs fetch |
| 468-557 | Business costs loading, per-section aggregation |
| 558-626 | Margins, P&L JSON construction (the `pnl` dict) |
| 628-716 | Per-store P&L enhancement (each store gets its own `pnl` dict) |
| 718-785 | Final return: `{ pnl, pnl_by_store, summary, by_status, by_store, ... }` |

### `business_costs.py` — CRUD API (362 lines)

**P&L Sections** (also available via `GET /api/business-costs/pnl-sections`):
```python
PNL_SECTIONS = [
    {"key": "cogs", "label": "Costuri Directe (COGS)"},
    {"key": "operational", "label": "Costuri Operaționale"},
    {"key": "marketing", "label": "Costuri Marketing"},
    {"key": "fixed", "label": "Costuri Fixe"},
]
```

**Key endpoints:**
- `POST /reorder` — batch update `display_order` and `pnl_section` for drag-and-drop reordering
- `POST /clone-month` — clone fixed costs from one month to another (seasonal costs excluded)

### `google_sheets.py` — Marketing Costs (310 lines)

- Reads from CPA spreadsheet `1IVg0fI-_Rm7IptmOl3BmGrqtyyzn3auf0ZPuftr9vQo`
- Sheets: `"Raport Zilnic 2"`, `"Grandia"`
- Parses Facebook, TikTok, Google Ads costs per brand per day
- Caches in `marketing_daily_costs` DB table
- Returns `{ store_name: {facebook, tiktok, google, total}, "__total__": {...} }`

**Brand mapping** (CPA sheet brand name → DB store name):
```python
BRAND_TO_STORE = {
    "esteban": "esteban.ro",
    "gt parfumuri": "georgetalent.ro",
    "grandia": "grandia.ro",
    "rossi nails": "rossinails.ro",
    "nocturna": "nocturna.ro",
    # ... (15+ brands)
}
```

---

## Frontend Files Reference

### `Analytics.jsx` — P&L Display

The P&L table is rendered by the `renderStorePnl(storePnl, label)` function. It takes a P&L object (from `pnl` or `pnl_by_store[i]`) and renders a complete financial statement table.

**Table structure** (each row has: Label | cu TVA | fără TVA | %):
1. Vânzări Brute header
2. Unrealized Gains breakdown (per-status rows)
3. Revenue (delivered) row
4. TVA deduction row
5. Revenue net fără TVA row
6. COGS row
7. Transport row
8. Commission rows (GT, Payment, Frisbo, Warehouse)
9. Marketing rows (Facebook, TikTok, Google)
10. Fixed costs section
11. Total Costs summary
12. NET PROFIT with margin %

### `Settings.jsx` — Business Cost Management

The Settings page has a "Costuri Fixe & Sezoniere" section that allows:
- Adding/editing business costs with **TVA toggle** (Include TVA checkbox)
- **P&L Section picker** dropdown (COGS / Operațional / Marketing / Costuri Fixe)
- Display order management
- Monthly navigation and clone-month functionality

---

## Database Schema

### `business_costs` Table

```sql
CREATE TABLE business_costs (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL,     -- salary | utility | subscription | marketing | rent | other
    label VARCHAR(255) NOT NULL,        -- User-defined label
    amount FLOAT DEFAULT 0.0,           -- Cost in RON
    month VARCHAR(7) NOT NULL,          -- "YYYY-MM"
    cost_type VARCHAR(20) DEFAULT 'fixed',  -- "fixed" | "seasonal"
    scope VARCHAR(20) DEFAULT 'all',    -- "all" | "store" | "stores"
    store_uids JSON,                    -- Store UIDs (null for scope="all")
    notes TEXT,
    -- P&L Configuration (added via migration):
    has_tva BOOLEAN DEFAULT TRUE,       -- Whether amount includes Romanian TVA
    pnl_section VARCHAR(50) DEFAULT 'fixed',  -- "cogs" | "operational" | "marketing" | "fixed"
    display_order INTEGER DEFAULT 0,    -- Sort order within section
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

### `profitability_config` Table (single row)

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `packaging_cost_per_order` | Float | 3.7 | Per-order packaging cost (RON) |
| `agency_commission_pct` | Float | 2.5 | Agency commission % (deprecated from per-order calc) |
| `gt_commission_pct` | Float | 5.0 | GT store commission % |
| `gt_commission_store_uid` | String | null | Which store gets GT commission |
| `payment_processing_pct` | Float | 1.9 | Card processing % |
| `payment_processing_fixed` | Float | 1.25 | Card processing fixed fee (RON) |
| `frisbo_fee_per_order` | Float | 0.0 | 3PL fulfillment fee per order |
| `vat_rate` | Float | 0.21 | VAT rate (e.g., 0.19 for 19%) |
| `warehouse_salary_per_package` | Float | 0.0 | Labor cost per shipped package |

### `marketing_daily_costs` Table (cache)

| Column | Type | Description |
|--------|------|-------------|
| `cost_date` | Date | Day of the cost |
| `store_name` | String | Matched store name |
| `platform` | String | facebook / tiktok / google |
| `amount` | Float | Cost in RON |
| `brand_raw` | String | Original brand name from sheet |

Unique constraint: `(cost_date, store_name, platform)`.

---

## API Response Structure

### `GET /api/analytics/profitability`

**Query params**: `store_uids`, `days`, `date_from`, `date_to`

```json
{
  "pnl": {
    "income": {
      "gross_sales": {"cu_tva": 100000, "fara_tva": 84034},
      "returns_cancelled": {"cu_tva": 5000, "fara_tva": 4202},
      "returns_cancelled_count": 50,
      "sales_delivered": {"cu_tva": 95000, "fara_tva": 79832},
      "total_realized": {"cu_tva": 95000, "fara_tva": 79832},
      "delivered_count": 500
    },
    "cogs": {
      "sku_costs": {"cu_tva": 30000, "fara_tva": 25210},
      "total_cogs": {"cu_tva": 30000, "fara_tva": 25210}
    },
    "gross_profit": {"cu_tva": 65000, "fara_tva": 54622},
    "gross_margin_pct": 68.4,
    "operational": {
      "shipping": {"cu_tva": 8000, "fara_tva": 6723},
      "frisbo_fee": {"cu_tva": 0, "fara_tva": 0},
      "gt_commission": {"cu_tva": 4750, "fara_tva": 3992},
      "payment_fee": {"cu_tva": 2100, "fara_tva": 1765},
      "warehouse_salary": {"cu_tva": 1500, "fara_tva": 1261},
      "warehouse_salary_per_package": 2.5,
      "shipped_count": 600,
      "total_operational": {"cu_tva": 16350, "fara_tva": 13741}
    },
    "operating_profit": {"cu_tva": 48650, "fara_tva": 40882},
    "operating_margin_pct": 51.2,
    "marketing": {
      "facebook": {"cu_tva": 5000, "fara_tva": 5000},
      "tiktok": {"cu_tva": 2000, "fara_tva": 2000},
      "google": {"cu_tva": 1000, "fara_tva": 1000},
      "total": {"cu_tva": 8000, "fara_tva": 8000}
    },
    "fixed_costs": { "salary": {"cu_tva": ..., "fara_tva": ...}, ... },
    "fixed_costs_entries": [ { "id": 1, "label": "...", "has_tva": true, ... } ],
    "fixed_costs_month": "2026-03",
    "business_costs_by_section": {
      "cogs": [ ... ],
      "operational": [ ... ],
      "marketing": [ ... ],
      "fixed": [ ... ]
    },
    "net_profit": {"cu_tva": 30000, "fara_tva": 25210},
    "net_margin_pct": 31.6,
    "cancelled_count": 20,
    "returned_count": 30,
    "status_breakdown": {
      "in_transit": {"count": 100, "revenue": {"cu_tva": 15000, "fara_tva": 12605}},
      "returned": {"count": 30, "revenue": {"cu_tva": 4000, "fara_tva": 3361}},
      "cancelled": {"count": 20, "revenue": {"cu_tva": 1000, "fara_tva": 840}}
    }
  },
  "pnl_by_store": [
    {
      "store_name": "esteban.ro",
      "income": { /* same structure as pnl.income */ },
      "cogs": { /* ... */ },
      "operational": { /* ... */ },
      "marketing": { /* per-store marketing from Google Sheets */ },
      "fixed_costs": { /* per-store fixed costs */ },
      "net_profit": {"cu_tva": ..., "fara_tva": ...},
      "net_margin_pct": 28.5,
      "status_breakdown": { /* per-store status breakdown */ }
    }
  ],
  "summary": { /* backward-compatible summary */ },
  "by_status": { "delivered": {...}, "returned": {...}, "in_transit": {...}, "cancelled": {...} },
  "by_store": [ /* raw per-store aggregation data */ ],
  "top_skus": [ /* top 20 SKUs by profit */ ],
  "config": { /* current profitability config values */ },
  "transport_fallback_stats": { "csv_import": 300, "same_sku": 50, "brand_avg": 100, ... }
}
```

---

## Marketing Costs (Google Sheets)

**Spreadsheet**: `CPA si financiar 2025`  
**ID**: `1IVg0fI-_Rm7IptmOl3BmGrqtyyzn3auf0ZPuftr9vQo`

The system reads daily marketing costs from two sheets:
- `"Raport Zilnic 2"` — Main brands (Esteban, GT, Rossi Nails, etc.)
- `"Grandia"` — Grandia brand

**Column structure** (CSV export format):
- Column A: Date
- Column B: Brand name
- Column C: Facebook Ads cost
- Column D: TikTok Ads cost
- Column E: Google Ads cost

**European number format**: Uses comma as decimal separator (`1.234,56`).

**Caching**: First request fetches live from Google Sheets, then upserts into `marketing_daily_costs` table. Subsequent requests read from DB cache.

---

## Business Costs (DB-Managed)

Business costs are user-created entries in the Settings page, stored per-month.

### Cost Categories
`salary`, `utility`, `subscription`, `marketing`, `rent`, `other`

### Scoping
- `scope="all"` — Applied to total P&L and split across all stores
- `scope="store"` or `scope="stores"` — Applied only to specific stores (by `store_uids` JSON array)

### P&L Section Assignment
Each business cost can be assigned to a P&L section:
- `cogs` — Appears in the COGS section
- `operational` — Appears in Comisioane & Operațional
- `marketing` — Appears in Marketing
- `fixed` — Appears in Costuri Fixe (default)

### Clone Month
Fixed costs can be cloned from one month to another. Seasonal costs are NOT cloned.

---

## Configuration Parameters

Managed via `GET/PUT /api/profitability-config`. Single row in DB.

| Parameter | Default | Where Used |
|-----------|---------|------------|
| `packaging_cost_per_order` | 3.7 | Per-order cost (not currently in P&L display) |
| `gt_commission_pct` | 5.0% | Line 284-286: `revenue × pct / 100` (GT store only) |
| `gt_commission_store_uid` | null | Must match `order.store_uid` for commission to apply |
| `payment_processing_pct` | 1.9% | Line 291: card payment fee (NOT for COD orders) |
| `payment_processing_fixed` | 1.25 RON | Added to payment fee per card order |
| `frisbo_fee_per_order` | 0.0 | Per-order 3PL fulfillment fee |
| `vat_rate` | 0.21 | Used in `tva_split()`: `fara_tva = val / (1 + vat_rate)` |
| `warehouse_salary_per_package` | 0.0 | `shipped_count × per_package` |

**COD detection**: `payment_gateway` starting with `"plat"` (case-insensitive) = COD = no card processing fee.

---

## Order Status Classification

The P&L engine maps `order.aggregated_status` to 5 categories:

```python
if status == 'delivered':       cat = 'delivered'
elif status in ['returned_to_sender', 'returned', 'refused']:
                                cat = 'returned'
elif status in ['cancelled', 'voided']:
                                cat = 'cancelled'
elif status in ['in_transit', 'out_for_delivery', 'customer_pickup']:
                                cat = 'in_transit'
else:                           cat = 'other'
```

### Cost Rules by Status

| Status | Revenue | COGS | Shipping | Operational | Profit |
|--------|---------|------|----------|-------------|--------|
| **delivered** | ✅ | ✅ | ✅ | ✅ | revenue - costs |
| **returned** | tracked | 0 | ✅ | ✅ | -shipping (loss) |
| **cancelled** | tracked | 0 | 0 | 0 | 0 |
| **in_transit** | ✅ | ✅ | ✅ | ✅ | revenue - costs (expected) |
| **other** | tracked | ✅ | ✅ | ✅ | 0 |

---

## Transport Cost Fallback Chain

For each order, shipping cost is determined by this priority chain:

1. **CSV Import** (`order.transport_cost > 0`): Real cost from courier CSV file import, summed across all AWBs
2. **Same-SKU Match**: Find a recent delivered order with the exact same SKU set (via MD5 hash) that has a mapped cost
3. **Brand Average**: Average transport cost per store in the last 30 days (delivered orders with CSV costs)
4. **Customer-Paid**: `max(0, total_price - subtotal_price)` — the shipping the customer paid
5. **Zero**: If all fallbacks fail, `shipping_cost = 0`

Diagnostic stats are returned in `transport_fallback_stats`.

---

## Currency Conversion

- Orders can be in any currency (RON, EUR, HUF, etc.)
- **BNR rates** are synced on startup and daily from `https://www.bnr.ro/nbrfxrates.xml`
- Rates are batch-preloaded into memory for the order date range
- `convert_to_ron_cached(amount, currency, date, cache)` finds the nearest available rate
- If no rate found, the original value is used and the currency is flagged in `unconvertible_currencies`

---

## Known Gotchas & Migration Notes

### Database Migrations
`Base.metadata.create_all()` only creates **new tables** — it does NOT add new columns to existing tables. When adding new columns to existing models, you must run ALTER TABLE manually:

```sql
-- Example: adding has_tva, pnl_section, display_order to business_costs
ALTER TABLE business_costs ADD COLUMN IF NOT EXISTS has_tva BOOLEAN DEFAULT TRUE;
ALTER TABLE business_costs ADD COLUMN IF NOT EXISTS pnl_section VARCHAR(50) DEFAULT 'fixed';
ALTER TABLE business_costs ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
```

Or use the provided migration script: `backend/migrate_biz_costs.py`

### Agency Commission
Agency commission was **removed** from per-order calculation (was `agency_commission_pct × revenue`). It's now handled as a monthly business cost entry in the `business_costs` table. The config field still exists for backward compatibility but is not used in the P&L formula.

### Packaging Cost
`packaging_cost_per_order` is calculated but NOT currently subtracted in the main P&L display — it's included in the operational costs section of the raw data but the frontend may not display it as a separate line.

### Marketing Costs Have No TVA
Facebook, TikTok, and Google Ads costs use `no_tva_split()` because they are foreign services billed without Romanian VAT. This means `cu_tva === fara_tva` for these costs.

### Per-Store Marketing
Marketing costs are matched to stores via the `BRAND_TO_STORE` mapping in `google_sheets.py`. If a brand in the CPA spreadsheet doesn't have a mapping, its costs go to `__total__` but not to any specific store.

### Status Breakdown
The `status_breakdown` dict is only populated for statuses with `count > 0`. The frontend should handle missing keys gracefully.
