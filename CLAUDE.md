# AWB Print Manager — Working Conventions

This file is loaded into every Claude Code session. Keep entries dense, scannable, and corrective. Don't restate what the codebase already documents — link to it.

Long-form references:
- [README.md](./README.md) — architecture, schema, endpoint catalog, changelog
- [docs/PNL_KNOWLEDGE.md](./docs/PNL_KNOWLEDGE.md) — P&L formula, TVA rules, BNR conversion
- [../debug/Livrabilitate_Metodologie.md](../debug/Livrabilitate_Metodologie.md) — deliverability statuses
- [../deliverability_calculation_reference.md](../deliverability_calculation_reference.md) — status mapping (live data, 2026-04-22)
- [../debug/DB_Reference.md](../debug/DB_Reference.md) — production DB schema & connection

---

## Tier 0 — Safety rails (what the harness will refuse no matter what)

This session runs in `bypassPermissions` mode for speed, so almost nothing prompts. To keep that safe, two layers actively *block* operations even though prompts are off:

- **Static `permissions.deny` rules** in `.claude/settings.json` cover prefix-pattern blocks: `rm -rf /`, `git push --force *main*`, `git reset --hard origin*`, `pip uninstall fastapi*`, etc.
- **`PreToolUse` hook** `.claude/hooks/safety-rails.sh` catches what static patterns can't (e.g., `--force` appearing anywhere in a command, not just as a prefix).

**Things that are blocked:**

| Category | Examples |
|---|---|
| Filesystem catastrophe | `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`, flag-order variants |
| Force-push to protected branches | `git push --force * main`, `git push origin main --force`, also master/production/prod/release |
| Hard reset against remote | `git reset --hard origin/main`, `git reset --hard upstream/*` |
| Branch deletion | `git branch -D main`, `git branch -D master`, `git branch -D release` |
| Production DB | Any command containing `38.242.226.83` |
| Core dep removal | `pip uninstall fastapi`/`sqlalchemy`/`pydantic`/`uvicorn`, `npm uninstall react`/`vite`/`sonner` |
| Git identity tampering | `git config user.*`, `git config credential.*`, `git config core.hooksPath` |
| Secrets / credentials | Editing or writing `.env`, `.env.*`, `*credentials.json`, `*.pem`, `*.key`, `.npmrc`, `.pypirc` |
| CI workflow edits | Editing `.github/workflows/*` (deliberate human review required) |
| Self-tampering | Editing `.claude/settings.json` (ask the user explicitly) |

Blocked attempts are logged to `.claude/safety-rails.log` (gitignored) with timestamp, tool, reason, and target.

**If a rail blocks something the user truly wants done**: tell them, explain which rail fired, and let them either run the command themselves OR ask me to edit the rail (which itself triggers the "settings.json blocked" rail — they'll need to edit it manually).

**Branch protection nuance**: normal pushes to `main` are allowed (it's the dev branch); only force-pushes are blocked. Once a CI pipeline is in place, switch to a PR workflow and the rails can tighten.

---

## Tier 1 — Domain rules you cannot break

These have caused outages or wrong financial numbers. Re-read before touching anything in `backend/app/api/analytics/`, `services/google_sheets.py`, or any P&L UI.

- **TVA is 19%** but stored as `0.19`. Some old code defaults to `0.21` — always read `ProfitabilityConfig.vat_rate` rather than hardcoding.
- **TVA split**: every domestic cost uses `tva_split(val)` → `{cu_tva, fara_tva}`. Foreign services (Facebook/TikTok/Google Ads) use `no_tva_split(val)` where both halves are equal. Business costs use `biz_tva_split(val, has_tva)` per the `has_tva` flag on the row. All percentage calculations must use `fara_tva`.
- **COGS is 0 for non-delivered orders** — returned/cancelled products come back to inventory. Only `aggregated_status == 'delivered'` orders contribute to COGS.
- **Currency conversion**: orders may be EUR/CZK/PLN/BGN. Use `convert_to_ron_cached(amount, currency, date, cache)` with a preloaded BNR rate cache. **Never assume RON**. SKU costs, transport, marketing are already RON — do NOT re-convert them.
- **BNR rate fallback window is 30 days** (was 10, see 2026-03-12 changelog). If a rate isn't found within that window the currency is flagged in `unconvertible_currencies` — surface that to the UI, don't silently drop the order.
- **Payment fee only applies to card orders**. COD detection: `payment_gateway` starting with `"plat"` (case-insensitive, Romanian "plată") = COD, no card fee.
- **GT commission only applies to one store** — the one whose UID matches `ProfitabilityConfig.gt_commission_store_uid`. Don't apply it globally.
- **DB stores UTC, CSV stores Romania-local (UTC+2 winter, UTC+3 summer)**. When querying for a Romanian month, shift bounds by 2-3h. Standard pattern: `frisbo_created_at >= '2026-01-31 22:00:00' AND <= '2026-02-28 21:59:59'` for Feb 2026.
- **`Base.metadata.create_all()` only creates new tables, not new columns.** When adding columns to existing models, write a migration script in `backend/migrate_*.py`. Provide both `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` SQL.
- **Deliverability formula**: `delivered / shipped × 100` where `shipped = delivered + in_transit + out_for_delivery + back_to_sender + refused`. Cancelled is NOT in shipped. See `deliverability_calculation_reference.md`.

---

## Tier 2 — Project conventions

### File layout

| Concern | Lives in |
|---|---|
| Per-tab analytics components | `frontend/src/pages/analytics/<Name>Tab.jsx` |
| Shared analytics helpers | `frontend/src/utils/analyticsHelpers.js` |
| Auth-aware fetch | `frontend/src/utils/authFetch.js` (use `authFetch + API_URL`) |
| Backend routers | `backend/app/api/<domain>.py` or `<domain>/<feature>.py` |
| ORM models | `backend/app/models/<name>.py` (one per file) |
| Services | `backend/app/services/<name>.py` or `<name>/<file>.py` |
| One-off scripts | `backend/scratch/` (committed, not runtime) |
| Migration scripts | `backend/migrate_<topic>.py` |

### Naming

- **Components**: `PascalCase.jsx`. Tab components end in `Tab.jsx`.
- **Hooks/utils/services**: `camelCase.js` for frontend, `snake_case.py` for backend.
- **API endpoints**: kebab-case URL segments (`/api/sku-risk`), snake_case query params (`store_uids`, `date_from`).
- **DB columns**: snake_case (`frisbo_created_at`, `aggregated_status`).
- **Romanian UI labels are intentional** — keep `Livrabilitate`, `Profitabilitate`, `Comenzi`, etc. Don't translate to English.
- **State that crosses tabs**: prefix with the owning concept (`profitStores`, not `selectedStores`). State that's truly global stays unprefixed (`stores`, `activeTab`).

### Reuse over duplication

- Before writing a formatter, color helper, or period-resolver, check `utils/analyticsHelpers.js`. If something close exists, extend it; do not parallel-implement.
- For raw `fetch` against the API, use `authFetch(url)` from `utils/authFetch.js`. Never inline `localStorage.getItem('awb_token')` again.
- For multi-select store filters, use `<MultiSelectFilter />` from `components/`. Don't build another dropdown.
- For per-tab structure, mirror `pages/analytics/DeliverabilityTab.jsx` — it's the cleanest pattern.
- Backend: per-order processing helpers live in `profitability.py`. If you find yourself recomputing TVA split or shipping fallback elsewhere, extract.

### Edge cases to always handle

- Empty array / null data from API — every chart and table must render an empty state, not a crash.
- Foreign-currency stores (`bonhaus.bg`, `bonhaus.cz`, `bonhaus.pl`, `nocturna.bg`) — confirm BNR conversion path.
- Orders with `aggregated_status` you've never seen — they exist (17+ distinct values per `deliverability_calculation_reference.md`). Default to `OTHER` rather than crashing.
- Orders with empty `line_items` — happens after migrations. `item_count` may be 0; don't divide by it.
- Multi-AWB orders — outbound + return rows. Cost calculations sum outbound only; UI must indicate when total ≠ first-AWB.
- Manual entries (`shipping_data_manual=true`) — CSV imports must NOT overwrite these.

### Error handling

- API endpoints: return 4xx with a `detail` field. Frontend reads `error.response?.data?.detail` first, falls back to `error.message`.
- Background tasks (sync, CSV import): never let an exception kill the worker. Log + mark the run failed + continue.
- Never silently swallow errors. If you catch one to keep working, surface it via a toast and a console.error.

### Comments

Default: no comments. Add one only when the *why* is non-obvious — a hidden invariant, a workaround, a reason the code looks wrong but is right. Don't comment what the code does. Don't reference the current PR/issue inside the file.

---

## Tier 3 — UI / UX standards

These apply to every new screen, table, and form. If you're adding something and not following one of these, justify in the PR or skip.

### Toasts on every state-changing action

**Library: [sonner](https://sonner.emilkowal.ski/)**. Mounted at the React root in `frontend/src/main.jsx` with `richColors`, `closeButton`, `theme="system"`. Use it like this:

```jsx
import { toast } from 'sonner'

toast.success('Cost SKU actualizat')
toast.error('Eroare la salvare: ' + (err.response?.data?.detail || err.message))
toast.promise(skuCostsApi.update(...), {
  loading: 'Se salvează...',
  success: 'Salvat',
  error: (e) => `Eroare: ${e.message}`,
})
```

- Every button that mutates state (create / update / delete / sync / print / import) shows a toast on success AND on failure. Success: green via `toast.success`, ~3.5s (default). Failure: red via `toast.error`, persistent until dismissed via the close button, with the error detail.
- Read-only operations (filter changes, sort, expand row) get no toast — silence is success.
- Long operations (CSV import, bulk sync) → use `toast.promise(...)` for a single updating toast, not a chain of new ones.
- Romanian copy preferred to match the rest of the UI ("Salvat", "Șters", "Eroare la încărcare").

### Buttons are traceable

- Every button has a stable identifier in its `onClick` handler name OR a `data-action` attribute. Generic `onClick={() => doStuff()}` is banned. Use `onClick={handleDeleteSkuCost}` so it's greppable.
- Destructive actions (delete, cancel, mark-printed-all) require explicit confirmation. Use `confirm(...)` or a modal — never one-click destruction.
- Buttons that fire API calls show a loading state (spinner / disabled) while in flight. Don't let users double-click and double-submit.

### Search / filter / sort

- Server-side pagination for any table that can exceed 1,000 rows (orders, products, line items). Cap client-side tables at 5,000 rows max with `.slice()` and a visible "showing first N" notice.
- Search input: `placeholder="Caută..."`, debounced 300ms before firing the API call, Enter forces immediate fire.
- Filters: persist to URL query string for shareable links — `useSearchParams` from react-router. The Analytics tab nav already does this with `?tab=`.
- Sort: every numeric column is sortable. Click toggles asc → desc → off. Show `↑/↓` indicator on the active column. Use `<ArrowUpDown />` icon on inactive columns.
- Column visibility: tables with >6 columns get a "⚙ Coloane" dropdown to toggle column visibility. Persist preference to Zustand (`useAppStore`).
- Multi-select dropdowns: use `<MultiSelectFilter />`. Always include "Select all" / "Deselect all" affordances.

### Loading and empty states

- Every async-loaded table shows: skeleton or spinner while loading, then either data OR an empty state with a clear action (e.g., "No SKUs configured. [Add first SKU]"). Never just "no data".
- Buttons that fetch large datasets (Profitabilitate, P&L Comparativ) require explicit "Analizează" click — don't auto-fetch on filter change. Pattern set 2026-03-16.

### Dark mode

- Tailwind: every text element needs an explicit dark variant. Black-on-black is a real, recurring bug — see Feb–Mar 2026 changelog entries.
- Inputs need `dark:[color-scheme:dark]` for date pickers to render correctly.
- Background opacity (`/50`, `/60`) on sticky columns causes data bleed-through on horizontal scroll. Use fully opaque (`bg-zinc-800`, not `bg-zinc-800/60`).

### System logs (audit trail)

- Sync runs: every run creates a `SyncLog` row (running → completed | failed). Track `orders_fetched`, `orders_new`, `orders_updated`, `error_message`.
- CSV imports: every import creates a `CourierCsvImport` row. Track matched / unmatched counts.
- Print batches: every batch creates a `PrintBatch` + per-order `PrintBatchItem` rows.
- When adding a new long-running action, follow this pattern. The user wants traceability and a history view, always.

---

## Tier 4 — Workflow rules

### Changelog (mandatory after every change)

After ANY code change — bug fix, feature, refactor, dep bump — append to `## Changelog` in [README.md](./README.md):

```markdown
### YYYY-MM-DD — [Brief Title]

**Files changed:** `path/one.py`, `path/two.jsx`

| Fix | Description | Details |
| --- | ----------- | ------- |
| **Short label** | What was wrong | What I did and why |
```

This is the original rule from `.agent/workflows/document-changes.md`. Honored across the README. **No exception** — if you forget, the next person debugging won't know what changed when.

### Commits

- One commit per logical change. Don't bundle "feat: X" with "chore: rename Y" — split.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`. Add scope: `feat(analytics): ...`.
- Body explains the WHY, not the what. Two-line minimum for non-trivial commits.
- End with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` if I authored.
- Never `--no-verify`, never `--no-gpg-sign`, never `--amend` published commits.

### Schema migrations

`Base.metadata.create_all()` does NOT add columns. When adding a column:
1. Update the model in `backend/app/models/<x>.py`
2. Write `backend/migrate_<topic>.py` with the `ALTER TABLE` (and `IF NOT EXISTS`).
3. Run it once locally; mention in the README changelog that prod still needs the migration.

### Testing

- **No mocks of the production database.** Integration tests hit a real DB. The 2026-Q1 migration that broke prod because mocks passed is the reason.
- **Backend smoke tests live in `backend/tests/`** (the legacy `test_*.py` at backend/ root are ad-hoc urllib scripts — pytest is configured via `pytest.ini` to ignore them).
- **Run fast tests**: `cd backend && ./venv/Scripts/pytest.exe` — runs everything not marked `@pytest.mark.slow` (~13s including app boot). Default for every change.
- **Run slow tests**: `cd backend && ./venv/Scripts/pytest.exe -m slow` — includes endpoints that crunch the whole orders table (~2 min). Run before merging anything that touches P&L or sync logic.
- **The smoke suite asserts shape, not values** — that an endpoint returns 200 with the expected JSON keys. It will NOT catch a wrong number in the P&L; that's what unit tests on the formula functions would catch (none yet). Add them when you fix a calculation bug.
- **The TestClient fixture uses the bootstrap admin** (admin/admin123, created by the lifespan). Override via `AWB_TEST_ADMIN_USER` / `AWB_TEST_ADMIN_PASSWORD` env vars if you've rotated the password.
- Frontend has no test suite yet; if you add one, Vitest matches Vite.

### Build verification

Before reporting a refactor as done:
1. `cd frontend && npx eslint <files> 2>&1 | tail -5` — 0 errors on the files you touched.
2. `cd frontend && npm run build` — 2,000+ modules transformed, no errors. Catches cross-file import problems eslint misses.
3. Backend: try starting uvicorn against the local DB. If it crashes on startup, the issue is yours.

---

## Tier 5 — Lessons learned (auto-updated)

This section is appended to whenever the user catches me in an error, or I discover a non-obvious gotcha. Format: one date, one rule, one "why" linking to a commit or PR if applicable.

Use the `/learn` slash command (in `.claude/commands/learn.md`) to add an entry — it's just a shortcut for "append this to CLAUDE.md".

### Active lessons

- **2026-05-18** — When extracting a tab from a mega-component, the `selectedVariantOrders` modal can be triggered from the tab but rendered as a sibling outside it. Move the modal into the tab during extraction, not after, or state gets stranded. (Discovered during SalesVelocity extraction.)
- **2026-05-18** — `Base.metadata.create_all()` does NOT add columns to existing tables. Adding `has_tva`, `pnl_section`, `display_order` to `business_costs` required an explicit migration. Always write a migration script for column additions.
- **2026-05-18** — The git repo is rooted at `awb-print-manager/`, not the parent `AWB Print` working directory. Environment may report "not a git repo" misleadingly — `cd awb-print-manager` first.

---

## How to use this file

- **Read this when** you start a session, when you're about to touch P&L / deliverability / currency code, or when something feels off.
- **Update this when** you fix a bug that wasn't obvious from the code, when the user corrects an approach, when you find a non-obvious gotcha.
- **Don't update this for** things already documented in README.md or PNL_KNOWLEDGE.md — link instead.
- **Tone**: terse, corrective, no fluff. Every line should change a future decision. Filler costs context tokens every session.
