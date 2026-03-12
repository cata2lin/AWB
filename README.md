# AWB Print Manager

**A full-stack logistics automation platform for managing e-commerce order fulfillment.**  
Synchronizes orders from the Frisbo 3PL API, groups them via a configurable rules engine, and generates merged AWB (Air Waybill) PDF batches optimized for A6 thermal printer workflows. Includes a comprehensive profitability analytics suite with BNR exchange rate integration, SKU risk analysis, and courier CSV cost import.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Architecture Overview](#architecture-overview)
4. [Data Flow: Order to Printed Batch](#data-flow-order-to-printed-batch)
5. [Database Schema (12 Models)](#database-schema-12-models)
6. [Backend: Services Layer](#backend-services-layer)
7. [Backend: API Endpoints (54+)](#backend-api-endpoints-54)
8. [Frontend: Pages & Components](#frontend-pages--components)
9. [Key Algorithms & Patterns](#key-algorithms--patterns)
10. [Configuration & Environment](#configuration--environment)
11. [Getting Started](#getting-started)
12. [Docker Deployment](#docker-deployment)
13. [Troubleshooting](#troubleshooting)
14. [Changelog](#changelog)

---

## Tech Stack

| Layer        | Technology                                                                 |
| ------------ | -------------------------------------------------------------------------- |
| **Backend**  | Python 3.10+, FastAPI 0.115, Uvicorn, SQLAlchemy 2.0 (async), Pydantic v2 |
| **Database** | PostgreSQL 16 (production) / SQLite (development fallback)                 |
| **Frontend** | React 19, Vite 7, Tailwind CSS 4, React Query 5, Zustand 5               |
| **PDF**      | pypdf 5 (merge), reportlab 4 (separator generation)                       |
| **HTTP**     | httpx (async Frisbo API client), Axios (frontend)                          |
| **Charts**   | Recharts 3, Leaflet + react-leaflet 5 (geographic maps)                   |
| **DnD**      | @hello-pangea/dnd 18 (drag-and-drop rule reordering)                       |
| **Scheduler**| APScheduler 3 (background sync jobs)                                       |
| **Infra**    | Docker Compose (3-service stack: backend, frontend, postgres)              |

---

## Project Structure

```
awb-print-manager/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI entry point & lifespan events
│   │   ├── __init__.py
│   │   ├── core/
│   │   │   ├── config.py              # Pydantic Settings (env vars)
│   │   │   └── database.py            # Async SQLAlchemy engine & session
│   │   ├── models/                    # 13 ORM models — each in its own file
│   │   │   ├── __init__.py            # Re-exports all models for backward compat
│   │   │   ├── store.py               # Store model
│   │   │   ├── order.py               # Order model (the main entity)
│   │   │   ├── order_awb.py           # OrderAwb model (per-AWB cost and type data)
│   │   │   ├── rule.py                # Rule + RulePreset models
│   │   │   ├── print_batch.py         # PrintBatch + PrintBatchItem models
│   │   │   ├── sku_cost.py            # SkuCost model
│   │   │   ├── sync_log.py            # SyncLog model
│   │   │   ├── courier_csv_import.py  # CourierCsvImport model
│   │   │   ├── business_cost.py       # BusinessCost model
│   │   │   ├── exchange_rate.py       # ExchangeRate model (BNR rates)
│   │   │   └── profitability_config.py # ProfitabilityConfig model
│   │   ├── schemas/
│   │   │   └── schemas.py             # Pydantic request/response schemas
│   │   ├── services/
│   │   │   ├── rules/                 # ← Rule engine package (split from rules_engine.py)
│   │   │   │   ├── __init__.py        # Re-exports RulesEngine, matches_rule, etc.
│   │   │   │   ├── engine.py          # Orchestrator class (~100 lines)
│   │   │   │   ├── matching.py        # Rule condition matching (add new conditions here)
│   │   │   │   ├── sorting.py         # Smart sort algorithm (edit sorting here)
│   │   │   │   └── helpers.py         # SKU extraction, date utilities
│   │   │   ├── frisbo/                # ← Frisbo client package (split from frisbo_client.py)
│   │   │   │   ├── __init__.py        # Re-exports FrisboClient, parse_order, etc.
│   │   │   │   ├── client.py          # HTTP operations only
│   │   │   │   ├── parser.py          # Order data transformation (edit field mapping here)
│   │   │   │   └── rate_limiter.py     # Token bucket rate limiter
│   │   │   ├── rules_engine.py        # Backward-compat shim → rules/
│   │   │   ├── frisbo_client.py       # Backward-compat shim → frisbo/
│   │   │   ├── sync_service.py        # Order sync (streaming batch save)
│   │   │   ├── pdf_service.py         # A6 PDF separator + AWB merge
│   │   │   ├── shipping_estimator.py  # Historical transport cost estimation
│   │   │   └── google_sheets.py       # Marketing costs from Google Sheets CPA
│   │   │   └── scheduler.py           # APScheduler background sync
│   │   └── api/                       # 13+ API routers (68 endpoints)
│   │       ├── analytics/             # ← Analytics package (split from analytics.py)
│   │       │   ├── __init__.py        # Barrel — registers all 6 endpoints
│   │       │   ├── summary.py         # Dashboard KPIs + quick summary
│   │       │   ├── geographic.py      # Country/city distribution
│   │       │   ├── deliverability.py  # Per-store delivery rates
│   │       │   ├── profitability.py   # Full P&L engine (edit financial formulas here)
│   │       │   └── profitability_orders.py # Per-order profitability audit
│   │       ├── courier_csv/           # ← Courier CSV package (split from courier_csv.py)
│   │       │   ├── __init__.py        # Exports router
│   │       │   ├── parsers.py         # Column mappings, courier presets (add new formats here)
│   │       │   ├── background.py      # Background processing, batch DB matching
│   │       │   └── endpoints.py       # HTTP upload/status endpoints
│   │       ├── sku_risk/              # ← SKU Risk package (split from sku_risk.py)
│   │       │   ├── __init__.py        # Exports router
│   │       │   ├── computations.py    # Constants, outcome mapping, helpers
│   │       │   └── endpoint.py        # Main analytics endpoint
│   │       ├── orders.py              # Order CRUD, filtering, search
│   │       ├── rules.py               # Rule CRUD + reorder + toggle
│   │       ├── presets.py             # Rule preset save/load/delete (snapshot)
│   │       ├── print_batch.py         # Preview → Generate → Download flow
│   │       ├── sync.py                # Manual/auto sync triggers + history
│   │       ├── stores.py              # Store CRUD + order counts
│   │       ├── sku_costs.py           # SKU cost CRUD + discovery + bulk upsert
│   │       ├── exchange_rates.py      # BNR rate sync + conversion utilities
│   │       ├── business_costs.py      # Business cost CRUD + month clone
│   │       └── profitability_config.py # Single-row config GET/PUT
│   ├── .env                           # API tokens & DB connection
│   ├── requirements.txt               # Python dependencies
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── main.jsx                   # React root + QueryClientProvider
│   │   ├── App.jsx                    # Router (6 routes) + Sidebar layout
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx          # KPI cards + store cards + print trigger
│   │   │   ├── Orders.jsx             # Full order table with advanced filters
│   │   │   ├── Rules.jsx              # Drag-and-drop rules + presets
│   │   │   ├── Analytics.jsx          # P&L, geographic, deliverability, SKU risk
│   │   │   ├── Settings.jsx           # Config, business costs, courier CSV, stores
│   │   │   └── History.jsx            # Print batch archive
│   │   ├── components/
│   │   │   ├── Sidebar.jsx            # Navigation sidebar with dark mode toggle
│   │   │   ├── PrintPreview.jsx       # Collapsible group verification modal
│   │   │   ├── AddRuleModal.jsx       # Rule creation form with all conditions
│   │   │   ├── MultiSelectFilter.jsx  # Reusable searchable multi-select dropdown
│   │   │   └── StoreCard.jsx          # Store metric card (unprinted/printable)
│   │   ├── services/api/              # ← API client package (split from api.js)
│   │   │   ├── index.js               # Barrel re-export (backward compat)
│   │   │   ├── client.js              # Shared Axios instance + config
│   │   │   ├── orders.js              # ordersApi + orderActionsApi
│   │   │   ├── stores.js              # storesApi
│   │   │   ├── rules.js               # rulesApi
│   │   │   ├── sync.js                # syncApi
│   │   │   ├── print.js               # printApi
│   │   │   ├── analytics.js           # analyticsApi
│   │   │   ├── skuCosts.js            # skuCostsApi
│   │   │   ├── presets.js             # presetsApi
│   │   │   ├── config.js              # profitabilityConfigApi + healthApi
│   │   │   ├── courierCsv.js          # courierCsvApi
│   │   │   └── businessCosts.js       # businessCostsApi
│   │   ├── hooks/useApi.js            # React Query hooks for all endpoints
│   │   ├── store/useAppStore.js       # Zustand state (dark mode, batch size, etc.)
│   │   └── data/                      # Static coordinate data for maps
│   │       ├── romaniaCoords.js        # Romanian county center coordinates
│   │       └── europeCoords.js         # European country center coordinates
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml                 # 3-service stack (backend + frontend + postgres)
└── docs/                              # Additional documentation
```

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React + Vite)                  │
│  ┌───────────┬──────────┬───────┬───────────┬─────────┬────────┐ │
│  │ Dashboard │  Orders  │ Rules │ Analytics │Settings │History │ │
│  └─────┬─────┴────┬─────┴───┬───┴─────┬─────┴────┬────┴───┬────┘ │
│        │          │         │         │          │        │       │
│  ┌─────┴──────────┴─────────┴─────────┴──────────┴────────┴──┐   │
│  │              React Query + Axios API Layer                 │   │
│  └────────────────────────────┬───────────────────────────────┘   │
└───────────────────────────────┼──────────────────────────────────┘
                                │ HTTP (JSON)
┌───────────────────────────────┼──────────────────────────────────┐
│                       BACKEND (FastAPI)                           │
│  ┌────────────────────────────┼───────────────────────────────┐   │
│  │                    13 API Routers                          │   │
│  │  orders │ rules │ print │ sync │ analytics │ sku-costs ... │   │
│  └─────────────────────┬─────────────────────────────────────┘   │
│                         │                                         │
│  ┌──────────────────────┴────────────────────────────────────┐   │
│  │                    SERVICES LAYER                          │   │
│  │  FrisboClient │ SyncService │ RulesEngine │ PDFService │...│   │
│  └──────────────────────┬────────────────────────────────────┘   │
│                         │                                         │
│  ┌──────────────────────┴────────────────────────────────────┐   │
│  │              SQLAlchemy 2.0 (Async) + Pydantic v2          │   │
│  │                    12 Database Models                      │   │
│  └──────────────────────┬────────────────────────────────────┘   │
└──────────────────────────┼──────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │     PostgreSQL 16       │
              └─────────────────────────┘
              
                    External APIs:
              ┌─────────────────────────┐
              │  Frisbo Store-View API  │ ← Order data, AWB PDFs
              │    BNR XML Feed         │ ← Exchange rates (RON→EUR etc.)
              └─────────────────────────┘
```

---

## Data Flow: Order to Printed Batch

```
1. SYNC          Frisbo API ──(paginated)──→ SyncService ──(batch 100)──→ DB
                 APScheduler triggers every 30 min or manual trigger via UI

2. RULES         DB orders ──→ RulesEngine (priority-based first-match) ──→ Groups
                 Unmatched orders → Default groups by item_count (1, 2, 3+)
                 Each group → SKU frequency sort (cluster identical SKUs)

3. PREVIEW       Frontend requests /api/print/preview
                 Returns grouped orders (regardless of AWB status)
                 Operator verifies grouping logic before printing

4. GENERATE      Frontend sends order UIDs to /api/print/generate
                 Only orders WITH awb_pdf_url are processed
                 PDFService downloads AWBs, creates A6 separators
                 pypdf merges all into single PDF → saved to storage/

5. MARK PRINTED  Orders flagged is_printed=True, printed_at=now()
                 PrintBatch + PrintBatchItem records created
                 Frisbo notified via update_orders_printed_batch()

6. DOWNLOAD      User downloads merged PDF for one-click A6 thermal printing
```

---

## Database Schema (13 Models)

### Core Models (`models/` package — one file per model)

#### `Store`
Represents a connected selling channel (Shopify store) synced from Frisbo.

| Column       | Type       | Description                                |
| ------------ | ---------- | ------------------------------------------ |
| `uid`        | String     | Unique Frisbo store identifier             |
| `name`       | String     | Display name                               |
| `color_code` | String(7)  | Hex color for UI branding (#6366f1)        |
| `is_active`  | Boolean    | Toggles visibility in dashboard            |

**Computed fields** (via API): `unprinted_count`, `printable_count` (unprinted + has AWB URL).

#### `Order`
Cached order data from the Frisbo API. Primary entity of the system.

| Column              | Type     | Description                                          |
| ------------------- | -------- | ---------------------------------------------------- |
| `uid`               | String   | Unique Frisbo order ID                               |
| `order_number`      | String   | Public reference (e.g., #EST74670)                   |
| `store_uid`         | FK       | References `stores.uid`                              |
| `customer_name`     | String   | Resolved from shipping_address → customer fallback   |
| `customer_email`    | String?  | From shipping_address.email                          |
| `shipping_address`  | JSON     | Full address (city, province, country_code, etc.)    |
| `line_items`        | JSON     | Full product array from Frisbo                       |
| `item_count`        | Integer  | Total quantity (sum of line item quantities)          |
| `unique_sku_count`  | Integer  | Distinct SKU count                                   |
| `tracking_number`   | String?  | Courier tracking ID                                  |
| `courier_name`      | String?  | Courier name (DPD, Sameday, etc.)                    |
| `awb_pdf_url`       | Text?    | URL to downloadable AWB PDF                          |
| `shipment_uid`      | String?  | Frisbo shipment reference                            |
| `fulfillment_status`| String   | Warehouse status (not_fulfilled / fulfilled)         |
| `financial_status`  | String   | Payment status (paid / pending)                      |
| `payment_gateway`   | String?  | Payment method (e.g., "Plată ramburs" for COD)       |
| `shipment_status`   | String?  | Courier journey (not_created, in_transit, delivered)  |
| `aggregated_status` | String?  | Normalized workflow status                           |
| `is_printed`        | Boolean  | Excludes from future batches once True               |
| `awb_count`         | Integer  | Multi-AWB support (1-10 labels per order)            |
| `awb_count_manual`  | Boolean  | Prevents auto-override of AWB count                  |
| `package_count`     | Integer? | Packages in shipment (from CSV import)               |
| `package_weight`    | Float?   | Weight in kg (from CSV import)                       |
| `transport_cost`    | Float?   | Actual shipping cost (from CSV import)               |
| `shipping_data_source` | String? | `csv_import` / `historical_match` / `manual`     |
| `shipping_data_manual` | Boolean | Prevents CSV overwrite when True                 |
| `total_price`       | Float?   | Order total revenue                                  |
| `subtotal_price`    | Float?   | Product total (net of discounts; shipping = total - subtotal) |
| `total_discounts`   | Float?   | Total discount amount                                |
| `currency`          | String   | ISO currency code (default: RON)                     |
| `frisbo_created_at` | DateTime?| Original order creation timestamp                    |
| `fulfilled_at`      | DateTime?| When fulfillment was completed                       |
| `synced_at`         | DateTime | Last sync timestamp                                  |
| `printed_at`        | DateTime?| When AWB was printed                                 |

#### `Rule`
Dynamic grouping logic for batch printing.

| Column        | Type    | Description                                      |
| ------------- | ------- | ------------------------------------------------ |
| `name`        | String  | Human-readable rule name                         |
| `priority`    | Integer | Lower = higher priority (first-match evaluation) |
| `is_active`   | Boolean | Toggle without deleting                          |
| `conditions`  | JSON    | Filter criteria (see Rules Engine section)        |
| `group_config`| JSON    | Target group UI config (`{name, color}`)         |

#### `RulePreset`
Snapshot-based rule set management (save/load named configurations).

| Column           | Type    | Description                          |
| ---------------- | ------- | ------------------------------------ |
| `name`           | String  | Unique preset name                   |
| `description`    | Text?   | Optional description                 |
| `rules_snapshot` | JSON    | Serialized array of all rule configs |
| `is_active`      | Boolean | Currently loaded preset              |

#### `PrintBatch` / `PrintBatchItem`
Archive of generated PDF batches with order-to-batch join table.

- `PrintBatch`: `batch_number` (formatted `batch_YYYYMMDD_HHMMSS`), `file_path`, `order_count`, `group_count`, `status`
- `PrintBatchItem`: `batch_id` (FK), `order_uid` (FK), `group_name`, `group_position` (preserved at time of print)

#### `SyncLog`
Audit trail for Frisbo API synchronization runs.

| Column           | Type     | Description                           |
| ---------------- | -------- | ------------------------------------- |
| `status`         | String   | running / completed / failed          |
| `orders_fetched` | Integer  | Total API records processed           |
| `orders_new`     | Integer  | New records created                   |
| `orders_updated` | Integer  | Existing records updated              |
| `error_message`  | Text?    | Exception details on failure          |

#### `SkuCost`
Financial baseline for product margin calculations.

| Column   | Type   | Description                              |
| -------- | ------ | ---------------------------------------- |
| `sku`    | String | Unique product SKU                       |
| `name`   | String?| Display name                             |
| `cost`   | Float  | Production/procurement cost (default RON)|
| `currency`| String| Cost currency                            |

#### `OrderAwb` (`models/order_awb.py`)
Per-AWB cost and type tracking. Each order may have multiple AWBs (outbound + returns). Created by Frisbo sync or CSV import.

| Column                  | Type    | Description                                         |
| ----------------------- | ------- | --------------------------------------------------- |
| `order_id`              | FK      | References `orders.id`                              |
| `tracking_number`       | String  | AWB tracking number (indexed)                       |
| `courier_name`          | String? | Courier name (DPD, Sameday, etc.)                   |
| `awb_type`              | String  | `outbound` or `return` (default: outbound)          |
| `transport_cost`        | Float?  | Shipping cost cu TVA (from CSV import)              |
| `transport_cost_fara_tva`| Float? | Net cost without VAT (DPD Total fara TVA)           |
| `transport_cost_tva`    | Float?  | VAT amount on transport                             |
| `currency`              | String? | Cost currency (RON, BGN, etc.)                      |
| `order_ref`             | String? | Order reference from CSV (indexed, for Tier 3 match)|
| `original_awb`          | String? | Original outbound AWB for return shipments          |
| `package_count`         | Integer?| Number of packages                                  |
| `package_weight`        | Float?  | Weight in kg                                        |
| `data_source`           | String  | `frisbo_sync` or `csv_import`                       |

`Order.transport_cost` is automatically recalculated as the SUM of outbound `OrderAwb.transport_cost` after CSV import.

#### `CourierCsvImport`
Log of courier CSV file imports for transport cost tracking.

| Column         | Type    | Description                    |
| -------------- | ------- | ------------------------------ |
| `filename`     | String  | Original CSV filename          |
| `courier_name` | String  | DPD / Sameday / Packeta / Speedy |
| `total_rows`   | Integer | Total CSV rows processed       |
| `matched_rows` | Integer | Orders matched by AWB          |
| `unmatched_rows`| Integer| Rows without matching orders   |

### Extended Models

#### `ExchangeRate` (`models/exchange_rate.py`)
Daily BNR (Banca Națională a României) exchange rates.

| Column       | Type    | Description                                      |
| ------------ | ------- | ------------------------------------------------ |
| `rate_date`  | Date    | Date of the rate                                 |
| `currency`   | String  | Currency code (EUR, USD, HUF, etc.)              |
| `rate`       | Float   | RON per unit (or per `multiplier` units)         |
| `multiplier` | Integer | BNR multiplier (e.g., 100 for HUF)              |

Unique constraint on `(rate_date, currency)`.

#### `BusinessCost` (`models/business_cost.py`)
Monthly business costs with store-level scoping and P&L section assignment.

| Column         | Type    | Description                                         |
| -------------- | ------- | --------------------------------------------------- |
| `category`     | String  | salary / utility / subscription / marketing / rent / other |
| `label`        | String  | User-defined label                                  |
| `amount`       | Float   | Cost in RON                                         |
| `month`        | String  | Month (YYYY-MM format)                              |
| `cost_type`    | String  | `fixed` (recurring, clonable) or `seasonal` (one-off) |
| `scope`        | String  | `all` (business-wide) or `stores` (specific stores) |
| `store_uids`   | JSON?   | Store UIDs this cost applies to                     |
| `has_tva`      | Boolean | Whether amount includes Romanian TVA (default: true)|
| `pnl_section`  | String  | P&L section: `cogs` / `operational` / `marketing` / `fixed` |
| `display_order`| Integer | Sort order within section (lower = higher position) |

#### `ProfitabilityConfig` (`models/profitability_config.py`)
Single-row configuration table for profit calculation parameters.

| Parameter                       | Default | Description                               |
| ------------------------------- | ------- | ----------------------------------------- |
| `packaging_cost_per_order`      | 3.7 RON | Per-order packaging cost                  |
| `agency_commission_pct`         | 2.5%    | Agency commission on total_price          |
| `gt_commission_pct`             | 5.0%    | George Talent commission (store-specific) |
| `payment_processing_pct`        | 1.9%    | Card processing percentage                |
| `payment_processing_fixed`      | 1.25 RON| Card processing fixed fee                 |
| `frisbo_fee_per_order`          | 0.0     | 3PL fulfillment fee                       |
| `vat_rate`                      | 0.21    | VAT rate (21%)                            |
| `warehouse_salary_per_package`  | 0.0     | Warehouse labor cost per package          |

---

## Backend: Services Layer

### 1. FrisboClient (`services/frisbo/` package)

Async HTTP client for the Frisbo Store-View API, split into 3 focused files:
- **`client.py`** — HTTP operations (search, fetch, download, update)
- **`parser.py`** — Order data transformation (edit this when Frisbo API format changes)
- **`rate_limiter.py`** — Token bucket rate limiter (20 req/sec)

Key features:
- **Rate Limiter**: Token bucket algorithm via `asyncio.Lock` — 20 req/sec (per Frisbo docs)
- **`search_orders()`**: Paginated search with filters (store_uids, aggregated_status_keys, date ranges)
- **`fetch_orders()`**: Iterates `search_orders()` until all matching records are fetched (100 per page)
- **`parse_order()`**: Transforms raw Frisbo JSON into normalized internal format:
  - Customer name: `shipping_address.name` → `first_name + last_name` → fallback to `customer` object
  - Status mapping: Handles `fulfillment_status`, `shipment_status`, `aggregated_status` as either dict or string
  - Pricing: Extracts from `prices` object (`total_price`, `subtotal_price`, `total_discounts`)
  - Payment: Extracts `currency` and `payment_gateway` from `payment.gateway_names`
- **`download_awb_pdf()`**: Downloads AWB PDF bytes from CDN URL
- **`update_order_fulfillment()`**: Pushes status updates back to Frisbo after printing
- **`update_orders_printed_batch()`**: Batch status update with error tolerance

### 2. SyncService (`services/sync_service.py`)

Handles persistent order storage with streaming batch commits.

- **Smart Sync** (default): Fetches orders created in the last **45 days**
- **Full Sync**: Fetches all available orders
- **Streaming Batch Save**: Commits to DB after every batch of **100 orders** (not at the end). Ensures progress is preserved if the process is interrupted.
- **Upsert Logic**: Checks by `uid`. Existing orders update tracking/status/pricing while preserving sync timestamps.
- **Auto Store Creation**: Creates `Store` records on-the-fly with deterministic color generation from `uid` hash.
- Validated with batches exceeding **97,000+ orders**.

### 3. RulesEngine (`services/rules/` package)

Priority-based order grouping with smart default sorting, split into 4 files:
- **`engine.py`** — Orchestrator class (~100 lines, delegates to matching + sorting)
- **`matching.py`** — Rule condition matching (edit this to add new rule conditions)
- **`sorting.py`** — Smart sort algorithm (edit this for sorting changes)
- **`helpers.py`** — SKU extraction, date utilities

#### Rule Evaluation
- Rules sorted by `priority` (ascending, lower = higher priority)
- **First-Match Logic**: Order assigned to the first matching rule — no duplicate group assignments
- Empty conditions = matches everything

#### Supported Conditions (AND logic — all must pass)

| Group       | Condition            | Logic                                       |
| ----------- | -------------------- | ------------------------------------------- |
| Order Size  | `min_items`          | item_count >= value                         |
|             | `max_items`          | item_count <= value                         |
|             | `item_count`         | item_count == value (exact, legacy)         |
|             | `min_line_items`     | unique_sku_count >= value                   |
|             | `max_line_items`     | unique_sku_count <= value                   |
| SKU         | `sku_contains`       | Case-insensitive substring match in any SKU |
|             | `sku_exact`          | At least one SKU exactly matches            |
|             | `sku_excludes`       | No SKU may contain this substring           |
| Logistics   | `store_uids`         | Order's store_uid must be in list           |
|             | `courier_name`       | Case-insensitive partial match              |
|             | `payment_gateway`    | Partial match (e.g., "ramburs" for COD)     |
| Location    | `city_contains`      | Substring match in shipping city            |
|             | `county_contains`    | Substring in province/county                |
|             | `country_code`       | Exact country code match                    |
| Price       | `min_total_price`    | total_price >= value                        |
|             | `max_total_price`    | total_price <= value                        |

#### SKU Extraction Safety
All code uses prioritized fallback: `item["sku"]` → `item["inventory_item"]["sku"]` to handle both flat and nested Frisbo structures.

#### Smart Sorting Algorithm (within groups)
Orders within each group are sorted to optimize warehouse picking:

**For single-item orders (k=1):**
1. Primary SKU frequency (descending) — clusters identical products together
2. SKU name (alphabetical) — deterministic tie-breaking
3. Created date (ascending) → UID fallback

**For multi-item orders (k>1):**
1. Determines `topSku` (highest frequency SKU in the group, with earliest-order tie-breaking)
2. `hasTopSku` (descending) → `topSkuCount` (descending) → dominant SKU frequency → created date

**Default groups (unmatched orders):**
Split by `item_count` into sub-groups (1 article, 2 articles, 3+ articles) with color-coded names, each independently sorted using the algorithm above.

### 4. PDFService (`services/pdf_service.py`)

Generates print-ready A6 document batches.

1. **Separator Pages**: A6 page with color-coded band (group color), group name, and order count — generated via `reportlab`
2. **AWB Assembly**: Downloads individual AWB PDFs from Frisbo CDN via `FrisboClient`
3. **Error Resilience**: If a download fails, inserts a red "AWB DOWNLOAD FAILED" error page with order number and error details
4. **Merge**: Uses `pypdf.PdfWriter` to combine all separators + AWBs into a single PDF file
5. **Output**: Saved to `./storage/{batch_number}.pdf`

### 5. ShippingEstimator (`services/shipping_estimator.py`)

Estimates transport costs for orders without CSV data by matching against historical orders.

- **Fingerprinting**: Creates a normalized string from line items (`sku:qty` pairs, sorted and pipe-delimited)
- **Matching Priority**: Same items + same store → Same items + any store
- **Batch Processing**: Processes 500 orders per page with periodic commits — designed for 100k+ datasets
- **Source Tagging**: Matched orders are tagged with `shipping_data_source = 'historical_match'`

### 6. Scheduler (`services/scheduler.py`)

APScheduler `AsyncIOScheduler` that triggers `sync_orders()` every 30 minutes (configurable via `SYNC_INTERVAL_MINUTES`).

---

## Backend: API Endpoints (54+)

### `/api/orders` — Order Management

| Method | Endpoint               | Description                                          |
| ------ | ---------------------- | ---------------------------------------------------- |
| GET    | `/`                    | Paginated orders with 17+ filter parameters          |
| GET    | `/couriers`            | Distinct courier names for dropdown                  |
| GET    | `/filter-options`      | Dynamic unique values for all filter fields            |
| GET    | `/count`               | Total count with same filters as main endpoint       |
| GET    | `/stats`               | Dashboard KPI statistics                             |
| POST   | `/mark-all-printed`    | Bulk mark all unprinted orders as printed            |
| GET    | `/{order_uid}`         | Single order by UID                                  |
| GET    | `/{order_uid}/awbs`    | All AWB records for an order (tracking, type, costs, source) |
| PUT    | `/{order_uid}/awb-count` | Set multi-AWB count (1-10)                         |
| PUT    | `/{order_uid}/shipping`| Manual shipping data update (marks as manual)        |

**Filter parameters**: `store_uids`, `is_printed`, `has_awb`, `has_tracking`, `has_shipping_cost`, `search` (ILIKE across name/uid/reference), `min_items`, `max_items`, `fulfillment_status`, `shipment_status`, `aggregated_status`, `courier_names`, `date_from`, `date_to`, `sort_field` (including `transport_cost`), `sort_direction`.

### `/api/rules` — Rule Configuration

| Method | Endpoint        | Description                              |
| ------ | --------------- | ---------------------------------------- |
| GET    | `/`             | All rules ordered by priority            |
| GET    | `/{rule_id}`    | Single rule                              |
| POST   | `/`             | Create rule (auto-appends to end)        |
| PATCH  | `/{rule_id}`    | Partial update                           |
| DELETE | `/{rule_id}`    | Delete rule                              |
| POST   | `/reorder`      | Batch priority update from ordered ID list |
| POST   | `/{rule_id}/toggle` | Toggle active/inactive               |

### `/api/presets` — Rule Preset Management

| Method | Endpoint              | Description                              |
| ------ | --------------------- | ---------------------------------------- |
| GET    | `/`                   | List all presets                         |
| GET    | `/active`             | Get currently loaded preset              |
| GET    | `/{preset_id}`        | Preset with full rules snapshot          |
| POST   | `/`                   | Save current rules as new preset         |
| POST   | `/{preset_id}/load`   | Truncate & hydrate rules from snapshot   |
| DELETE | `/{preset_id}`        | Delete preset                            |

### `/api/print` — Print Workflow

| Method | Endpoint              | Description                              |
| ------ | --------------------- | ---------------------------------------- |
| POST   | `/preview`            | Group preview (all unprinted, any AWB status) |
| POST   | `/generate`           | Generate batch PDF (requires awb_pdf_url)|
| GET    | `/batch/{batch_id}/download` | Download generated PDF            |
| GET    | `/history`            | Paginated batch archive                  |
| GET    | `/batch/{batch_id}`   | Batch details with order list            |

### `/api/sync` — Synchronization

| Method | Endpoint      | Description                                    |
| ------ | ------------- | ---------------------------------------------- |
| GET    | `/status`     | Current sync state (idle/running) + next sync  |
| POST   | `/trigger`    | Manual sync (param: `full_sync` boolean)       |
| GET    | `/history`    | Sync run history with metrics                  |

### `/api/stores` — Store Management

| Method | Endpoint          | Description                             |
| ------ | ----------------- | --------------------------------------- |
| GET    | `/`               | All stores with order/unprinted/printable counts |
| GET    | `/stats`          | Active store statistics                 |
| POST   | `/`               | Create store                            |
| PATCH  | `/{store_uid}`    | Update store (name, color, active)      |

### `/api/analytics` — Analytics Suite

| Method | Endpoint                          | Description                            |
| ------ | --------------------------------- | -------------------------------------- |
| GET    | `/analytics`                      | Full analytics (30-day default)        |
| GET    | `/analytics/summary`              | Quick dashboard summary                |
| GET    | `/analytics/geographic`           | Order distribution by country/region   |
| GET    | `/analytics/deliverability`       | Per-store deliverability rates         |
| GET    | `/analytics/profitability`        | P&L with VAT split, per-store breakdown|
| GET    | `/analytics/profitability/orders` | Order-level profitability audit        |

### `/api/sku-costs` — SKU Cost Management

| Method | Endpoint       | Description                              |
| ------ | -------------- | ---------------------------------------- |
| GET    | `/`            | List with search and cost filter         |
| POST   | `/`            | Create SKU cost entry                    |
| PUT    | `/{sku}`       | Update cost/name/currency                |
| DELETE | `/{sku}`       | Delete entry                             |
| POST   | `/bulk`        | Bulk create/update                       |
| GET    | `/discover`    | Find SKUs in orders without cost entries |

### `/api/sku-risk` — SKU Risk & Anomaly Analytics

| Method | Endpoint    | Description                                     |
| ------ | ----------- | ----------------------------------------------- |
| GET    | `/sku-risk` | SKU-level risk metrics, shipping anomalies, store KPIs |

Computes risk scores from problem orders (returned/refused/cancelled) with proportional allocation for multi-item orders. Detects shipping cost anomalies using z-score analysis.

### `/api/courier-csv` — Courier CSV Import

| Method | Endpoint          | Description                              |
| ------ | ----------------- | ---------------------------------------- |
| POST   | `/import`         | Upload courier CSV (background processing)|
| GET    | `/import/{id}`    | Import progress/status                   |
| GET    | `/history`        | Import history                           |
| POST   | `/estimate-missing` | Trigger historical shipping estimation |

Supports **DPD, Sameday, Packeta, Speedy** CSV formats with auto-detection of delimiter, encoding, and column mapping. Background processing for 100k-200k+ row files with batch DB commits.

### `/api/exchange-rates` — BNR Exchange Rates

| Method | Endpoint              | Description                          |
| ------ | --------------------- | ------------------------------------ |
| POST   | `/exchange-rates/sync` | Manual BNR rate sync (current day)  |
| POST   | `/exchange-rates/sync/{year}` | Backfill entire year         |
| GET    | `/exchange-rates/rate` | Lookup rate for currency + date     |

Auto-syncs on application startup. Provides batch `preload_rates()` and `convert_to_ron_cached()` utilities for N+1 query avoidance in analytics.

### `/api/business-costs` — Business Cost Management

| Method | Endpoint              | Description                          |
| ------ | --------------------- | ------------------------------------ |
| GET    | `/`                   | List costs (filter: month, category, store) |
| POST   | `/`                   | Create cost entry (with has_tva, pnl_section) |
| PUT    | `/{cost_id}`          | Update cost (partial update)         |
| DELETE | `/{cost_id}`          | Delete cost                          |
| POST   | `/clone-month`        | Clone fixed costs to another month   |
| GET    | `/categories`         | Available categories                 |
| GET    | `/months`             | Months with cost entries             |
| POST   | `/reorder`            | Batch update display_order and pnl_section |
| GET    | `/pnl-sections`       | Available P&L sections for dropdown  |

### `/api/profitability-config` — Configuration

| Method | Endpoint                  | Description                      |
| ------ | ------------------------- | -------------------------------- |
| GET    | `/profitability-config`    | Get current config               |
| PUT    | `/profitability-config`    | Partial update config            |

---

## Frontend: Pages & Components

### Pages

#### 1. Dashboard (`Dashboard.jsx`)
- **KPI Cards**: Total orders, unprinted orders, active stores, active rules, today's batches, today's printed count
- **Store Cards**: Per-store unprinted and printable counts with color branding
- **Sync Status**: Last sync time, next sync countdown, manual trigger button
- **Print Flow**: "Preview" button → PrintPreview modal → "Print" button → PDF generation + download

#### 2. Orders (`Orders.jsx`)
- **1000-line component** with comprehensive data table
- **Advanced Filtering**: Multi-select for stores, couriers, fulfillment status, shipment status, workflow status; boolean toggles for printed/AWB/tracking/shipping cost; date range pickers; free-text search
- **Server-Side Pagination & Sorting**: All filtering happens via API queries (designed for 100k+ orders)
- **Dynamic Filter Options**: Fetched from `/filter-options` endpoint — prevents hardcoded label drift
- **Expandable Row Details**: Shows customer info, shipping address, status details, line items, and AWB breakdown panel
- **AWB Breakdown Panel**: Lazy-loaded on expand via `GET /orders/{uid}/awbs`. Shows per-AWB table with tracking number, type badge (📦 Outbound / ↩ Return), cost cu TVA, fara TVA, TVA amount, order reference, and data source badge (CSV = green, Sync = blue). Multi-AWB orders show a summary footer with totals. Return AWBs are highlighted with a red background.
- **Multi-AWB Badge**: Purple `×N` badge next to courier name for orders with more than one AWB
- **Shipping Cost Filter**: Dropdown to filter orders by "Has Cost" / "No Cost"
- **Manual Data Entry**: Compact manual override section for cost, weight, and package count (locked after manual entry)
- **Sort Controls**: Clickable column headers including Transport Cost with ascending/descending toggle

#### 3. Rules (`Rules.jsx`)
- **Drag-and-Drop Reordering**: `@hello-pangea/dnd` with real-time priority recalculation
- **Rule Cards**: Display rule name, priority, conditions summary (store names, item ranges, SKU filters, courier, location)
- **Toggle & Delete**: Inline actions with confirmation
- **Preset Management**: Save/Load/Delete presets with active preset indicator
- **Add Rule Modal**: `AddRuleModal.jsx` component with grouped condition inputs (Order Size, SKU Filters, Logistics, Location, Price Range)

#### 4. Analytics (`Analytics.jsx`)
- **2,360-line mega-component** — the most complex frontend page
- **Tabs**: Print Analytics, Geographic, Deliverability, Profitability, P&L Tables, SKU Costs, SKU Risk
- **Print Analytics**: Charts showing order volume, print batch statistics over time
- **Geographic Distribution**: Interactive Leaflet map with SVG markers showing order density by country and Romanian county
- **Deliverability Report**: Per-store tables with delivered/returned/cancelled rates, color-coded by performance
- **Profitability Dashboard**: Revenue, costs, margins with store-level breakdown
- **P&L Tables**: Full financial statements with cu TVA (with VAT) and fără TVA (without VAT) columns, percentage breakdowns
- **SKU Cost Manager**: Inline editing, bulk discovery from orders, cost assignment
- **SKU Risk Analysis**: Risk scoring, shipping anomaly detection with z-score thresholds

#### 5. Settings (`Settings.jsx`)
- **Profitability Config**: Editable fields for all ProfitabilityConfig parameters (packaging costs, commissions, VAT, etc.)
- **Store Management**: Color picker for each store's branding color
- **Business Costs**: Monthly cost CRUD with month navigation, clone-month functionality, category icons
- **Courier CSV Import**: File upload for DPD/Sameday/Packeta/Speedy CSVs with progress tracking and historical estimation trigger
- **Data Export**: Export all settings as JSON

#### 6. History (`History.jsx`)
- **Batch Archive**: Paginated list of generated print batches
- **Details View**: Expandable batch showing grouped orders at time of printing
- **Download**: Re-download previously generated PDFs

### Shared Components

| Component              | Description                                                     |
| ---------------------- | --------------------------------------------------------------- |
| `Sidebar.jsx`          | Navigation with icons (lucide-react), active route highlighting, dark mode toggle, collapsible |
| `PrintPreview.jsx`     | Two-tier collapsible hierarchy (groups → orders → SKU details), SKU frequency breakdown, inline "Print" action |
| `AddRuleModal.jsx`     | Full rule creation form with 5 condition groups, store multi-select, color picker |
| `MultiSelectFilter.jsx`| Reusable dropdown with search, select all/deselect all, outside-click close, label fallback formatting |
| `StoreCard.jsx`        | Compact card showing store name, color, unprinted count, printable count |

### Frontend Architecture Patterns

- **React Query**: All data fetching uses `@tanstack/react-query` with automatic cache invalidation on mutations
- **Axios Params Serializer**: Custom serializer using `URLSearchParams` to handle FastAPI's array parameter format (repeated keys without brackets)
- **Zustand Store**: Persists `darkMode`, `selectedStoreIds`, `rules`, `presets`, `batchSize` to `localStorage` under key `awb-print-storage`
- **API Service** (`services/api/`): 75+ functions split into 12 domain modules with a barrel re-export in `index.js`. Each module can be edited independently. Import paths unchanged: `import { ordersApi, storesApi } from '../services/api'`

---

## Key Algorithms & Patterns

### Rule Preset Snapshot Pattern
Save: fetch all `Rule` rows → serialize to JSON array → store as `rules_snapshot` in `RulePreset`.  
Load: delete all `Rule` rows → create new rows from snapshot → mark preset as active.  
Benefit: `RulesEngine` always reads a flat `Rule` table — no complex relational joins.

### SKU Frequency Sorting (Dominant SKU Clustering)
Within each group, orders are sorted so that orders containing the most common SKU are printed first and clustered together. This optimizes warehouse picking by grouping identical packing tasks.

### Shipping Cost Derivation
`shipping_cost = max(0, total_price - subtotal_price)`  
Note: In the Frisbo API, `subtotal_price` is already net of discounts.

### Profitability Calculation Pipeline

> **Detailed documentation**: See [`docs/PNL_KNOWLEDGE.md`](docs/PNL_KNOWLEDGE.md) for the complete P&L formula, TVA handling rules, API response structure, and migration notes.

For each order:
1. Match line items to `SkuCost` records — `sku_cost = Σ(qty × unit_cost)`
2. Apply smart transport cost fallback chain: CSV import → same-SKU → brand avg → customer-paid → zero
3. Apply operational costs: GT commission (store-specific %), payment processing (card only), fulfillment fee, warehouse salary
4. Convert non-RON currencies via BNR exchange rates (with batch preloading)
5. Classify by delivery status: delivered (realized), returned (loss), in_transit (potential), cancelled (zero)
6. Aggregate per-store with status breakdown for unrealized gains

P&L structure (total and per-store):
1. **Gross Sales** — revenue from all orders (cu_tva / fara_tva)
2. **(-) Unrealized Gains** — non-delivered revenue, broken down by status (in_transit, returned, cancelled, other)
3. **Revenue (Delivered)** — net delivered revenue
4. **(-) TVA** — deductible VAT (configurable rate, default 19%)
5. **Revenue net fără TVA** — base for all % calculations
6. **(-) COGS** — SKU costs (delivered only, returned/cancelled = 0)
7. **(-) Transport** — shipping costs with smart fallback
8. **(-) Comisioane & Operațional** — GT commission, payment fees, fulfillment, warehouse salary
9. **(-) Marketing** — Facebook, TikTok, Google Ads (from Google Sheets, no TVA)
10. **(-) Fixed & Seasonal Costs** — from business_costs table (per-item TVA flag)
11. **Total Costuri** — sum of all costs (fara_tva values)
12. **PROFIT NET** — revenue_fara_tva - total_costs_fara_tva (with margin %)

TVA handling: All values are split into `cu_tva` (with VAT) and `fara_tva` (without VAT). Marketing costs (foreign services) use `no_tva_split()` where both values are identical. Business costs use a per-item `has_tva` flag.

### Courier CSV Background Import
1. Upload returns immediately with import ID
2. Background task processes CSV in streaming fashion (500 AWBs per DB batch, 400 max per SQL IN clause)
3. Auto-detects delimiter, encoding (UTF-8/Latin-1), and column names via fuzzy matching
4. Supports DPD, Sameday, Packeta (barcode transformation), Speedy (price parsing with `leu` suffix)
5. **3-Tier AWB Matching**:
   - **Tier 1**: Match tracking_number → `order_awbs.tracking_number` (update existing AWB with cost data)
   - **Tier 2**: Match tracking_number → `orders.tracking_number` (create new OrderAwb)
   - **Tier 3**: Match order_ref from CSV → `orders.order_number` (create new OrderAwb)
6. **Data Extraction per Courier**:
   - **DPD**: AWB from `Expediere`, order ref from `Ref 1`, type from `Tip` (Normal/Retur), costs with/without TVA from `Total`/`Total fara TVA`, return AWB linkage from `Expediere primara`
   - **Sameday**: AWB from `AWB`, cost from `Total`, type from `Tip expediere`
   - **Packeta**: AWB from `Barcode` (Z-prefix cleaning), order ref from `Order`, cost from `COD`
   - **Speedy**: AWB from `barcode`, order ref regex from `description`, cost from `total price`
7. Recalculates `Order.transport_cost` = SUM(outbound AWB costs), excluding returns
8. Respects `shipping_data_manual` flag (does not overwrite manual entries)
9. Sub-batching prevents SQL parameter overflow with large datasets (tested with 53K+ rows, 99% match rate)

### Route Order Precedence (FastAPI)
Static endpoints (e.g., `/couriers`, `/mark-all-printed`) are declared before dynamic routes (`/{order_uid}`) to prevent the dynamic parameter from catching literal path strings.

---

## Configuration & Environment

### Environment Variables (`.env`)

```env
# Frisbo API
FRISBO_API_TOKEN=<JWT token>
FRISBO_API_URL=https://ingest.apis.store-view.frisbo.dev  # default

# Database
DATABASE_URL=postgresql://postgres:123@localhost:5432/awbprint

# PDF Storage
PDF_STORAGE_PATH=./storage

# Sync
SYNC_INTERVAL_MINUTES=30  # default

# Rate Limiting
FRISBO_RATE_LIMIT=20  # requests per second, default
```

### Frontend Environment

```env
VITE_API_URL=http://localhost:8000/api  # Dev mode
# In production (Docker), uses nginx proxy at /api
```

---

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+
- PostgreSQL 16 (or use Docker)

### Backend Setup

```powershell
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt

# Create .env with your Frisbo API token and DB connection
# Start the server
uvicorn app.main:app --reload --port 8000
```

The database tables are created automatically on startup via SQLAlchemy `create_all()`.

### Frontend Setup

```powershell
cd frontend
npm install
npm run dev
```

The frontend will be available at `http://localhost:5173`.

---

## Docker Deployment

```powershell
# Set your Frisbo token
$env:FRISBO_API_TOKEN = "your-token"

# Start all services
docker-compose up -d
```

| Service    | Port  | Description                           |
| ---------- | ----- | ------------------------------------- |
| `backend`  | 8000  | FastAPI server                        |
| `frontend` | 3000  | Nginx serving React build (proxies /api → backend) |
| `db`       | 5432  | PostgreSQL 16 Alpine                  |

Volumes: `postgres_data` (DB persistence), `pdf_storage` (generated PDFs).

---

## Troubleshooting

### PowerShell Execution Policy
If `.ps1` scripts are blocked, use command-through wrappers:
```powershell
# For npm
cmd /c "npm run dev"
# For uvicorn without venv activation
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

### Port Conflicts (Zombie Processes)
Uvicorn/Vite child processes may survive parent termination:
```powershell
taskkill /F /IM python.exe /T   # Kill all Python (including Uvicorn children)
taskkill /F /IM node.exe /T     # Kill all Node (including Vite children)
```

### Stale Cache / Route Not Found
Delete Python bytecode cache if routes seem stale:
```powershell
Get-ChildItem -Path 'backend' -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
```

### Axios Array Serialization
The frontend uses a custom `paramsSerializer` to handle FastAPI's array format (repeated keys without brackets). This is configured in `services/api/client.js`.

### PowerShell `curl` Alias
Use `curl.exe` instead of `curl` to avoid the PowerShell `Invoke-WebRequest` alias.

---

## Changelog

### 2026-03-12 — Orders Page Fixes

**Files changed:** `frontend/src/components/MultiSelectFilter.jsx`, `frontend/src/pages/Orders.jsx`, `backend/app/schemas/schemas.py`

| Fix | Description | Details |
| --- | ----------- | ------- |
| **Dark mode search text** | Search input in MultiSelectFilter dropdowns (All Stores, All Couriers) was invisible in dark mode (black text on black background) | Added `text-zinc-900 dark:text-white placeholder:text-zinc-400` to the `<input>` element |
| **Date filter refresh bug** | Selecting dates from different months caused the page to refresh mid-navigation when switching months in the native date picker | Introduced `effectiveDateFrom`/`effectiveDateTo` computed values that only propagate to the API call when **both** dates are set (or both empty). The `useEffect` skips fetching when only one date is filled. Also added `dark:[color-scheme:dark]` to date inputs for proper dark mode rendering. |
| **Line item currency** | Expanded order line items hardcoded `$` as currency | Changed to use `order.currency` (fallback: `RON`) with `ro-RO` locale number formatting |
| **AOV display** | No Average Order Value shown in expanded orders | Added AOV row below line items computed from `Σ(price × quantity)` for all line items. Also added `total_price`, `subtotal_price`, `currency` fields to `OrderResponse` Pydantic schema in the backend. |

### 2026-03-12 — Stores Filter Reliability

**Files changed:** `backend/app/api/stores.py`, `frontend/src/hooks/useApi.js`

| Fix | Description | Details |
| --- | ----------- | ------- |
| **N+1 query elimination** | `GET /stores` ran 3 separate COUNT queries per store, causing timeouts during sync | Replaced with a single aggregated `GROUP BY` query using `case()` expressions — from O(3N) DB calls to O(2) |
| **React Query retry** | Transient failures got cached as empty results for 60 seconds | Added `retry: 3` with exponential backoff (1s → 2s → 4s) to the `useStores` hook |

### 2026-03-12 — Packeta CSV Import Fix

**Files changed:** `backend/app/api/courier_csv/parsers.py`

| Fix | Description | Details |
| --- | ----------- | ------- |
| **Romanian column names** | Packeta CSV import failed with HTTP 400 because the parser expected English headers (`Barcode`, `Packet price`, `Order`) but the Packeta portal exports Romanian (`Cod de bare`, `pretul coletelor`, `Comanda`) | Updated Packeta preset column mappings and added Romanian aliases to global `COLUMN_MAPPINGS` for auto-detection fallback |

### 2026-03-12 — Settings Dark Mode Text Fix

**Files changed:** `frontend/src/pages/Settings.jsx`

| Fix | Description | Details |
| --- | ----------- | ------- |
| **CSV import history text** | Import history table rows were invisible (black on black) in dark mode | Added `dark:text-zinc-200`/`dark:text-zinc-300`/`dark:text-zinc-400` to all table cells (date, filename, courier, rows, matched) |
| **Courier select** | Courier select dropdown text invisible in dark mode | Added `text-zinc-900 dark:text-white` to the select element |

### 2026-03-12 — P&L Comparativ Tab Overhaul & Geografie Removal

**Files changed:** `frontend/src/pages/Analytics.jsx`

| Change | Description | Details |
| ------ | ----------- | ------- |
| **Date filter added** | P&L Comparativ had no date filter — user couldn't change the period | Added full Profitabilitate-matching filter bar: thisMonth, lastMonth, 30d, 90d, month dropdown (18 months), custom range |
| **Marketing section** | Comparativ table was missing marketing costs entirely | Added COSTURI MARKETING section with Facebook, TikTok, Google, and Total rows |
| **Dynamic fixed costs** | Used hardcoded category paths (salary, utility, etc.) that no longer mapped to data | Now uses `business_costs_by_section.fixed[]` entries dynamically — individual labeled rows |
| **Geografie tab removed** | Tab and rendering section removed per user request | Removed tab button and ~180 lines of Geographic rendering (Countries, Cities, Counties) |

### 2026-03-12 — Multi-Currency Fix: BNR Rate Gaps & Orders API

**Files changed:** `backend/app/api/orders.py`, `backend/app/api/exchange_rates.py`, `frontend/src/pages/Orders.jsx`, `frontend/src/pages/Analytics.jsx`

**Root cause:** The `exchange_rates` table had a 21-day gap for 2026 (Feb 17 → Mar 9) because the yearly BNR sync had never been run for 2026 — only the daily auto-sync on server startup populated individual days. When `profitability.py` processed orders from gap dates, `get_rate_from_cache()` returned `None` (10-day fallback wasn't enough), causing EUR values to be treated as RON at 1:1. For bonhaus.bg, 946/1,350 orders (70%) in the last 30 days were **not converted**, massively understating revenue (e.g., 15.98 EUR counted as 15.98 RON instead of ~81.34 RON).

**Foreign-currency stores:**
| Store | Currencies | Order Count |
| ----- | ---------- | ----------- |
| bonhaus.bg | BGN (4,634) + EUR (3,974) | 8,608 |
| bonhaus.cz | CZK (39,182) | 39,182 |
| bonhaus.pl | PLN (15,183) | 15,183 |
| nocturna.bg | BGN (2,593) + EUR (2,365) | 4,958 |

**What gets converted to RON (and what doesn't):**
| Data | Source | Converted? | Reason |
| ---- | ------ | ---------- | ------ |
| Revenue (`total_price`) | Frisbo (EUR/CZK/PLN/BGN) | ✅ Yes — per-order using BNR rate on order date | Original currency from store |
| Subtotal (`subtotal_price`) | Frisbo | ✅ Yes — same method | Same |
| COGS (SKU costs) | `sku_costs` table | ❌ No — already in RON | Products costed in RON |
| Shipping (transport) | CSV imports | ❌ No — already in RON | Courier invoices in RON |
| Marketing | Google Sheets | ❌ No — already in RON | Ad spend reported in RON |
| GT Commission | % of converted revenue | Derived | Computed from RON revenue |
| Payment Fee | % of converted revenue | Derived | Computed from RON revenue |

| Change | Description | Details |
| ------ | ----------- | ------- |
| **BNR 2026 rates synced** | 21-day gap in exchange rates | Ran `sync-year/2026` → 481 new rates inserted, filling Feb–Mar gap |
| **Fallback window increased** | `get_rate_from_cache()` and `get_rate()` only looked 10 days back | Increased to 30 days in `exchange_rates.py` (`preload_rates`, `get_rate`, `get_rate_from_cache`) |
| **Orders API: missing fields** | `orders.py` response dict omitted `total_price`, `subtotal_price`, `currency` | Added all 3 fields to the manual serialization dict (lines 175-180) |
| **Orders API: sort by Total** | `total_price` not in sort column map | Added `total_price` to `sort_column_map` |
| **Total column added** | Orders table had no price column | Added sortable "Total" column showing `total_price` with correct currency per order |
| **Transport label** | Transport cost showed "lei" | Changed to "RON" for consistency |
| **colSpan fix** | Expanded order row width | Updated colSpan from 8 to 9 for new column |
| **RON conversion indicator** | P&L showed no indication of conversion | Added "💱 Toate valorile convertite în RON (curs BNR istoric)" badge to P&L Comparativ |
| **Unconvertible warning** | No warning when BNR rate is missing | Shows amber warning listing currencies that couldn't be converted |

