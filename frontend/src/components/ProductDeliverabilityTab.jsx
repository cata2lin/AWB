/**
 * ProductDeliverabilityTab — per-SKU delivery performance report.
 * Mirrors the Livrabilitate tab but at product granularity.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Search, RefreshCw, ChevronUp, ChevronDown, TrendingDown, Package, X, Download, SlidersHorizontal, EyeOff } from 'lucide-react'
import { analyticsApi } from '../services/api/analytics'
import { analyticsFilterPresetsApi } from '../services/api/analyticsFilterPresets'
import { useStores } from '../hooks/useApi'
import ColumnsMenu from './ui/ColumnsMenu'
import RangeDatePicker from './ui/RangeDatePicker'
import AdvancedFiltersDrawer from './ui/AdvancedFiltersDrawer'
import IncludeExcludeModal from './ui/IncludeExcludeModal'
import FilterPresetsBar from './ui/FilterPresetsBar'
import { useColumnVisibility } from '../hooks/useColumnVisibility'
import { exportCsv } from '../utils/csvExport'
import { skuMatches } from '../utils/skuMatch'

const REPORT_KEY = 'livrabilitate_produse'

const FILTER_FIELDS = [
  { key: 'stock_available', label: 'Stoc' },
  { key: 'total_orders', label: 'Comenzi', suffix: '(min = filtru zgomot, default 5)' },
  { key: 'total_units', label: 'Unități' },
  { key: 'delivered', label: 'Livrate' },
  { key: 'returned', label: 'Returnate' },
  { key: 'refused', label: 'Refuzate' },
  { key: 'cancelled', label: 'Anulate' },
  { key: 'in_transit', label: 'În Tranzit' },
  { key: 'delivery_rate', label: 'Rată Livrare', suffix: '(%)' },
  { key: 'return_rate', label: 'Rată Return', suffix: '(%)' },
  { key: 'cancellation_rate', label: 'Rată Anulare', suffix: '(%)' },
  { key: 'expedition_rate', label: 'Rată Expediție', suffix: '(%)' },
]

const EMPTY_INC_EXC = Object.freeze({
  included_skus: [],
  excluded_skus: [],
  included_stores: [],
  excluded_stores: [],
})

const fmt = n => n == null ? '0' : Number(n).toLocaleString('ro-RO')
const fmtPct = n => `${Number(n || 0).toFixed(1)}%`

const getLastCompleteMonth = () => {
  const now = new Date()
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}`
}

const fmtLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function periodToDates(period, customFrom, customTo) {
  const now = new Date()
  if (period === 'today') return [fmtLocal(now), fmtLocal(now)]
  if (period === '7d') { const d = new Date(now); d.setDate(d.getDate() - 6); return [fmtLocal(d), fmtLocal(now)] }
  if (period === '30d') { const d = new Date(now); d.setDate(d.getDate() - 29); return [fmtLocal(d), fmtLocal(now)] }
  if (period === '90d') { const d = new Date(now); d.setDate(d.getDate() - 89); return [fmtLocal(d), fmtLocal(now)] }
  if (period === 'thisMonth') return [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, fmtLocal(now)]
  if (period === 'lastMonth') {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const le = new Date(now.getFullYear(), now.getMonth(), 0)
    return [fmtLocal(lm), fmtLocal(le)]
  }
  if (period === 'custom') return customFrom && customTo ? [customFrom, customTo] : [null, null]
  // YYYY-MM month format
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    return [
      `${y}-${String(m).padStart(2, '0')}-01`,
      `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    ]
  }
  return [null, null]
}

// ≥75% = good (green), <75% = problem (red)
function rateColor(rate) {
  if (rate >= 88) return 'text-emerald-600 dark:text-emerald-400'
  if (rate >= 75) return 'text-green-600 dark:text-green-400'
  if (rate >= 60) return 'text-orange-600 dark:text-orange-400'
  return 'text-red-600 dark:text-red-400'
}

function rateBarColor(rate) {
  if (rate >= 75) return 'bg-emerald-500'
  return 'bg-red-500'
}

function DeliveryBadge({ rate }) {
  if (rate >= 75) return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">✓ Bun</span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">✕ Problemă</span>
  )
}

function returnRateColor(rate) {
  if (rate <= 5) return 'text-emerald-600 dark:text-emerald-400'
  if (rate <= 12) return 'text-amber-600 dark:text-amber-400'
  if (rate <= 20) return 'text-orange-600 dark:text-orange-400'
  return 'text-red-600 dark:text-red-400'
}

function MiniBar({ value, max, colorClass }) {
  const w = Math.min((value / Math.max(max, 1)) * 100, 100)
  return (
    <div className="h-1.5 bg-zinc-100 dark:bg-zinc-700 rounded-full mt-1 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: `${w}%` }} />
    </div>
  )
}

function SortIcon({ active, dir }) {
  if (!active) return <ChevronUp className="w-3 h-3 text-zinc-300 dark:text-zinc-600" />
  return dir === 'desc' ? <ChevronDown className="w-3 h-3 text-primary-500" /> : <ChevronUp className="w-3 h-3 text-primary-500" />
}

const COLS = [
  { key: 'product_name', label: 'Produs / SKU', align: 'left', sticky: true, alwaysVisible: true },
  { key: 'status_badge', label: 'Status', align: 'center' },
  { key: 'stock_available', label: 'Stoc', align: 'right' },
  { key: 'total_orders', label: 'Comenzi', align: 'right' },
  { key: 'total_units', label: 'Unități', align: 'right' },
  { key: 'delivered', label: 'Livrate', align: 'right' },
  { key: 'returned', label: 'Returnate', align: 'right' },
  { key: 'refused', label: 'Refuzate', align: 'right' },
  { key: 'cancelled', label: 'Anulate', align: 'right' },
  { key: 'in_transit', label: 'În Tranzit', align: 'right' },
  { key: 'delivery_rate', label: 'Rată Livrare', align: 'right' },
  { key: 'return_rate', label: 'Rată Return', align: 'right' },
  { key: 'cancellation_rate', label: 'Rată Anulare', align: 'right' },
  { key: 'expedition_rate', label: 'Rată Expediție', align: 'right' },
]

// `header` alias for the shared ColumnsMenu primitive — it reads `header`, not `label`.
const MENU_COLS = COLS.map((c) => ({ key: c.key, header: c.label, alwaysVisible: c.alwaysVisible }))

export default function ProductDeliverabilityTab({ selectedStores = [] }) {
  const [period, setPeriod] = useState(getLastCompleteMonth)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ col: 'total_orders', dir: 'desc' })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const {
    visibleKeys,
    setVisibleKeys,
    defaultVisibleKeys,
  } = useColumnVisibility('livrabilitate-produse', MENU_COLS)
  const visibleCols = useMemo(
    () => Object.fromEntries(COLS.map(c => [c.key, c.alwaysVisible || visibleKeys.includes(c.key)])),
    [visibleKeys],
  )
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'low_delivery' | 'high_return' | 'high_cancel'

  // Advanced filters (min/max per numeric column), include/exclude lists, and presets.
  const [valueFilters, setValueFilters] = useState({})
  const [includeExclude, setIncludeExclude] = useState({ ...EMPTY_INC_EXC })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const presetAppliedRef = useRef(false)

  const { data: storeList = [] } = useStores()
  const storeOptions = useMemo(
    () => (storeList || []).map(s => ({ uid: s.uid, name: s.name || s.uid })),
    [storeList],
  )

  // Apply default preset (if any) on first mount.
  useEffect(() => {
    if (presetAppliedRef.current) return
    presetAppliedRef.current = true
    let cancelled = false
    analyticsFilterPresetsApi.list(REPORT_KEY).then(list => {
      if (cancelled) return
      const def = list.find(p => p.is_default)
      if (def) applyPreset(def.filters)
    }).catch(() => { /* presets are best-effort; ignore failures */ })
    return () => { cancelled = true }
     
  }, [])

  // Compose effective store list: included_stores (if any) overrides the global
  // selection; excluded_stores is removed from whatever set we end up with.
  const effectiveStoreUids = useMemo(() => {
    const inc = includeExclude.included_stores || []
    const exc = new Set(includeExclude.excluded_stores || [])
    const base = inc.length > 0 ? inc : selectedStores
    return base.filter(uid => !exc.has(uid))
  }, [includeExclude.included_stores, includeExclude.excluded_stores, selectedStores])

  // Server-side noise filter. Driven by the Advanced Filters drawer:
  // `valueFilters.total_orders.min` becomes the backend's `min_orders` param.
  // Default 5 matches the prior dropdown default + the backend's own default,
  // so users see the same long-tail noise floor without an extra control.
  const serverMinOrders = useMemo(() => {
    const m = valueFilters?.total_orders?.min
    if (m == null) return 5
    return Math.max(1, Math.floor(m))
  }, [valueFilters?.total_orders?.min])

  const fetchData = useCallback(async (overridePeriod, overrideFrom, overrideTo) => {
    const p = overridePeriod ?? period
    const cf = overrideFrom ?? customFrom
    const ct = overrideTo ?? customTo
    const [dateFrom, dateTo] = periodToDates(p, cf, ct)
    if (!dateFrom || !dateTo) return
    setLoading(true)
    setError(null)
    try {
      const params = { min_orders: serverMinOrders, date_from: dateFrom, date_to: dateTo }
      if (effectiveStoreUids.length > 0) params.store_uids = effectiveStoreUids.join(',')
      const res = await analyticsApi.getProductDeliverability(params)
      setData(res)
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Eroare la încărcare')
    } finally { setLoading(false) }
  }, [period, customFrom, customTo, serverMinOrders, effectiveStoreUids])

  // Auto-fetch: fire immediately for all non-custom periods.
  // For custom, wait until both dates are set.
  useEffect(() => {
    if (period === 'custom') {
      if (customFrom && customTo) fetchData()
    } else {
      fetchData()
    }
  }, [period, customFrom, customTo, effectiveStoreUids, serverMinOrders])

  const toggleSort = col => setSort(prev => prev.col === col ? { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' })

  const displayedRows = useMemo(() => {
    if (!data?.products) return []
    let rows = [...data.products]

    // Filter mode
    if (filterMode === 'low_delivery') rows = rows.filter(r => r.delivery_rate < 75)
    else if (filterMode === 'high_return') rows = rows.filter(r => r.return_rate > 12)
    else if (filterMode === 'high_cancel') rows = rows.filter(r => r.cancellation_rate > 10)

    // Value-range filters from the Advanced drawer
    for (const [key, range] of Object.entries(valueFilters || {})) {
      if (range?.min != null) rows = rows.filter(r => (r[key] ?? 0) >= range.min)
      if (range?.max != null) rows = rows.filter(r => (r[key] ?? 0) <= range.max)
    }

    // SKU include/exclude lists (stores are handled at fetch time).
    // Patterns: case-insensitive PREFIX by default (so `ha-` matches every
    // SKU starting with `ha-`); `*` enables glob. See utils/skuMatch.
    const incSkus = includeExclude.included_skus || []
    const excSkus = includeExclude.excluded_skus || []
    if (incSkus.length > 0) {
      rows = rows.filter(r => skuMatches(r.sku, incSkus))
    }
    if (excSkus.length > 0) {
      rows = rows.filter(r => !skuMatches(r.sku, excSkus))
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r => (r.sku || '').toLowerCase().includes(q) || (r.product_name || '').toLowerCase().includes(q))
    }

    // Sort
    rows.sort((a, b) => {
      const va = a[sort.col] ?? 0; const vb = b[sort.col] ?? 0
      if (typeof va === 'string') return sort.dir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb)
      return sort.dir === 'desc' ? vb - va : va - vb
    })
    return rows
  }, [data, search, sort, filterMode, valueFilters, includeExclude.included_skus, includeExclude.excluded_skus])

  const valueFilterCount = Object.keys(valueFilters || {}).length
  const incExcCount =
    (includeExclude.included_skus?.length || 0) +
    (includeExclude.excluded_skus?.length || 0) +
    (includeExclude.included_stores?.length || 0) +
    (includeExclude.excluded_stores?.length || 0)

  // Snapshot of the full filter state — saved into a preset and restored on load.
  const currentFilters = useMemo(() => ({
    period,
    date_from: customFrom,
    date_to: customTo,
    search,
    sort,
    filter_mode: filterMode,
    value_filters: valueFilters,
    include_exclude: includeExclude,
    visible_columns: visibleKeys,
  }), [period, customFrom, customTo, search, sort, filterMode, valueFilters, includeExclude, visibleKeys])

  function applyPreset(filters) {
    if (!filters) return
    if (filters.period != null) setPeriod(filters.period)
    if (filters.date_from != null) setCustomFrom(filters.date_from)
    if (filters.date_to != null) setCustomTo(filters.date_to)
    if (filters.search != null) setSearch(filters.search)
    if (filters.sort) setSort(filters.sort)
    if (filters.filter_mode) setFilterMode(filters.filter_mode)
    // Backward compat for presets saved before min_orders was merged into
    // valueFilters.total_orders.min — promote the old top-level field if the
    // new field isn't already set.
    const vf = { ...(filters.value_filters || {}) }
    if (filters.min_orders != null && vf.total_orders?.min == null) {
      vf.total_orders = { ...(vf.total_orders || {}), min: Number(filters.min_orders) }
    }
    setValueFilters(vf)
    setIncludeExclude({ ...EMPTY_INC_EXC, ...(filters.include_exclude || {}) })
    if (Array.isArray(filters.visible_columns)) setVisibleKeys(filters.visible_columns)
  }

  const maxOrders = useMemo(() => Math.max(...(data?.products || []).map(r => r.total_orders), 1), [data])

  // CSV export — uses the shared util so format/quoting is consistent across reports.
  const handleExportCsv = () => {
    if (!displayedRows.length) return
    const cols = COLS.filter(c => visibleCols[c.key] && c.key !== 'status_badge').map(c => ({
      key: c.key,
      label: c.label,
      accessor: (r) => {
        if (c.key === 'product_name') return r.product_name || r.sku || ''
        if (['delivery_rate', 'return_rate', 'cancellation_rate', 'expedition_rate'].includes(c.key)) {
          return r[c.key] != null ? `${r[c.key]}%` : ''
        }
        return r[c.key] ?? ''
      },
    }))
    exportCsv({ filename: `livrabilitate_produse_${period}`, columns: cols, rows: displayedRows })
  }

  const totals = data?.totals || {}

  const PERIOD_OPTIONS = [
    { value: 'today', label: 'Azi' },
    { value: '7d', label: 'Ultimele 7 zile' },
    { value: '30d', label: 'Ultimele 30 zile' },
    { value: '90d', label: 'Ultimele 90 zile' },
    { value: 'thisMonth', label: 'Luna curentă' },
    { value: 'lastMonth', label: 'Luna trecută' },
    { value: 'custom', label: 'Interval personalizat' },
  ]

  // Generate last 12 months for picker
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return { value: key, label: d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' }) }
  })

  return (
    <div className="space-y-5">

      {/* ── Controls Bar ── */}
      <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
        {/* Period selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 font-medium">Perioadă:</span>
        <select value={period} onChange={e => { setPeriod(e.target.value); setCustomFrom(''); setCustomTo('') }}
            className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-primary-500/30">
            <optgroup label="Perioade rapide">
              {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
            <optgroup label="Luni">
              {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          </select>
        </div>

        {period === 'custom' && (
          <RangeDatePicker
            value={{ from: customFrom, to: customTo }}
            onChange={({ from, to }) => { setCustomFrom(from || ''); setCustomTo(to || '') }}
            showPresets={false}
          />
        )}

        <button onClick={fetchData} disabled={loading}
          className="flex items-center gap-2 px-4 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Actualizează
        </button>

        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          <button onClick={() => setDrawerOpen(true)} title="Filtre min/max pe coloane"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              valueFilterCount > 0
                ? 'border-primary-300 dark:border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300'
                : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700'
            }`}>
            <SlidersHorizontal className="w-4 h-4" />
            Filtre avansate
            {valueFilterCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0 rounded-full bg-primary-600 text-white text-[10px] font-bold">
                {valueFilterCount}
              </span>
            )}
          </button>
          <button onClick={() => setModalOpen(true)} title="Include / exclude SKU-uri și magazine"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              incExcCount > 0
                ? 'border-amber-300 dark:border-amber-500 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700'
            }`}>
            <EyeOff className="w-4 h-4" />
            Include / Exclude
            {incExcCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0 rounded-full bg-amber-600 text-white text-[10px] font-bold">
                {incExcCount}
              </span>
            )}
          </button>
          <FilterPresetsBar
            reportKey={REPORT_KEY}
            currentFilters={currentFilters}
            onLoad={applyPreset}
          />
          <ColumnsMenu
            columns={MENU_COLS}
            visibleKeys={visibleKeys}
            onChange={setVisibleKeys}
            defaultVisibleKeys={defaultVisibleKeys}
          />
          <button onClick={handleExportCsv} title="Export CSV"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700">
            <Download className="w-4 h-4" />
            CSV
          </button>
        </div>
      </div>

      {/* ── KPI Summary Cards ── */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Comenzi', value: fmt(totals.total_orders), sub: `${fmt(totals.total_units)} unități` },
            { label: 'Rată Livrare', value: fmtPct(totals.delivery_rate), cls: rateColor(totals.delivery_rate), sub: `${fmt(totals.delivered)} livrate` },
            { label: 'Rată Return+Refuz', value: fmtPct(totals.return_rate), cls: returnRateColor(totals.return_rate), sub: `${fmt((totals.returned || 0) + (totals.refused || 0))} comenzi` },
            { label: 'Rată Anulare', value: fmtPct(totals.cancellation_rate), cls: returnRateColor(totals.cancellation_rate), sub: `${fmt(totals.cancelled)} anulate` },
          ].map(card => (
            <div key={card.label} className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
              <p className="text-xs text-zinc-500 font-medium">{card.label}</p>
              <p className={`text-2xl font-bold mt-1 tracking-tight ${card.cls || 'text-zinc-800 dark:text-zinc-100'}`}>{card.value}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Filter chips + Search ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {[
            { key: 'all', label: 'Toate', count: data?.products?.length },
            { key: 'low_delivery', label: '⚠ Livrare < 75%', count: data?.products?.filter(r => r.delivery_rate < 75).length },
            { key: 'high_return', label: '↩ Return > 12%', count: data?.products?.filter(r => r.return_rate > 12).length },
            { key: 'high_cancel', label: '✕ Anulare > 10%', count: data?.products?.filter(r => r.cancellation_rate > 10).length },
          ].map(f => (
            <button key={f.key} onClick={() => setFilterMode(f.key)}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all border ${
                filterMode === f.key
                  ? 'bg-primary-50 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-500/30'
                  : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'
              }`}>
              {f.label} {f.count != null && <span className="ml-1 opacity-60">({f.count})</span>}
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Caută SKU sau produs…"
            className="pl-8 pr-8 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 w-64 focus:ring-2 focus:ring-primary-500/30" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {/* ── Active filter chips (one-click remove) ── */}
      {(valueFilterCount > 0 || incExcCount > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 mr-1">Filtre active:</span>
          {Object.entries(valueFilters).map(([key, range]) => {
            const field = FILTER_FIELDS.find(f => f.key === key)
            if (!field) return null
            const parts = []
            if (range?.min != null) parts.push(`≥ ${range.min}`)
            if (range?.max != null) parts.push(`≤ ${range.max}`)
            return (
              <span key={`vf-${key}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300">
                {field.label}: {parts.join(' și ')}
                <button onClick={() => setValueFilters(prev => { const n = { ...prev }; delete n[key]; return n })} className="hover:text-primary-900">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )
          })}
          {(includeExclude.included_skus || []).map(p => (
            <span key={`is-${p}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              ✓ {p}
              <button onClick={() => setIncludeExclude(prev => ({ ...prev, included_skus: (prev.included_skus || []).filter(x => x !== p) }))} className="hover:text-emerald-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {(includeExclude.excluded_skus || []).map(p => (
            <span key={`xs-${p}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">
              ✕ {p}
              <button onClick={() => setIncludeExclude(prev => ({ ...prev, excluded_skus: (prev.excluded_skus || []).filter(x => x !== p) }))} className="hover:text-red-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {(includeExclude.included_stores || []).map(uid => (
            <span key={`it-${uid}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              ✓ {uid}
              <button onClick={() => setIncludeExclude(prev => ({ ...prev, included_stores: (prev.included_stores || []).filter(x => x !== uid) }))} className="hover:text-emerald-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {(includeExclude.excluded_stores || []).map(uid => (
            <span key={`xt-${uid}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">
              ✕ {uid}
              <button onClick={() => setIncludeExclude(prev => ({ ...prev, excluded_stores: (prev.excluded_stores || []).filter(x => x !== uid) }))} className="hover:text-red-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            onClick={() => { setValueFilters({}); setIncludeExclude({ ...EMPTY_INC_EXC }) }}
            className="ml-1 text-[10px] text-zinc-400 hover:text-red-500 underline"
          >
            Șterge toate
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-16 text-zinc-400">
            <RefreshCw className="w-6 h-6 animate-spin mr-3 text-primary-400" />
            <span>Se încarcă datele…</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-16 text-red-400">
            <X className="w-10 h-10 mb-3 opacity-50" />
            <p className="font-medium">Eroare la încărcare</p>
            <p className="text-xs mt-1 text-red-300">{error}</p>
            <button onClick={() => fetchData()} className="mt-4 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg">
              Reîncarcă
            </button>
          </div>
        )}

        {!loading && !error && !data && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
            <TrendingDown className="w-10 h-10 mb-3 opacity-30" />
            <p>Se încarcă raportul…</p>
          </div>
        )}

        {!loading && !error && data && displayedRows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
            <Package className="w-10 h-10 mb-3 opacity-30" />
            <p>Nu s-au găsit produse</p>
            <p className="text-xs mt-1">Încearcă să reduci min. "Comenzi" din Filtre avansate sau să schimbi perioada</p>
          </div>
        )}

        {!loading && displayedRows.length > 0 && (
          <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                  {COLS.filter(c => visibleCols[c.key]).map(col => (
                    <th key={col.key}
                      onClick={() => col.key !== 'status_badge' && toggleSort(col.key)}
                      className={`px-3 py-3 text-xs font-semibold text-zinc-600 dark:text-zinc-200 uppercase tracking-wider whitespace-nowrap select-none
                        ${col.key !== 'status_badge' ? 'cursor-pointer hover:text-zinc-900 dark:hover:text-white' : 'cursor-default'}
                        ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'} ${col.sticky ? 'sticky left-0 bg-zinc-50 dark:bg-zinc-900 z-20' : ''}`}>
                      <span className="flex items-center gap-1 justify-end">
                        {col.align === 'right' && <SortIcon col={col.key} active={sort.col === col.key} dir={sort.dir} />}
                        {col.label}
                        {col.align === 'left' && <SortIcon col={col.key} active={sort.col === col.key} dir={sort.dir} />}
                      </span>
                    </th>
                  ))}
                </tr>
                {/* Totals row */}
                <tr className="border-b-2 border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 font-semibold">
                  {COLS.filter(c => visibleCols[c.key]).map(col => (
                    <td key={col.key} className={`px-3 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.sticky ? 'sticky left-0 bg-zinc-100 dark:bg-zinc-800 z-20' : ''}`}>
                      {col.key === 'product_name' && <span className="text-zinc-600 dark:text-zinc-300">TOTAL ({displayedRows.length} produse)</span>}
                      {col.key === 'status_badge' && <DeliveryBadge rate={totals.delivery_rate} />}
                      {col.key === 'stock_available' && <span className="text-zinc-500 dark:text-zinc-400">—</span>}
                      {col.key === 'total_orders' && fmt(totals.total_orders)}
                      {col.key === 'total_units' && fmt(totals.total_units)}
                      {col.key === 'delivered' && fmt(totals.delivered)}
                      {col.key === 'returned' && fmt(totals.returned)}
                      {col.key === 'refused' && fmt(totals.refused)}
                      {col.key === 'cancelled' && fmt(totals.cancelled)}
                      {col.key === 'in_transit' && fmt(totals.in_transit)}
                      {col.key === 'delivery_rate' && <span className={rateColor(totals.delivery_rate)}>{fmtPct(totals.delivery_rate)}</span>}
                      {col.key === 'return_rate' && <span className={returnRateColor(totals.return_rate)}>{fmtPct(totals.return_rate)}</span>}
                      {col.key === 'cancellation_rate' && <span className={returnRateColor(totals.cancellation_rate)}>{fmtPct(totals.cancellation_rate)}</span>}
                      {col.key === 'expedition_rate' && fmtPct(totals.expedition_rate)}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                {displayedRows.map((row, i) => (
                  <tr key={row.group_key || row.sku} className={`hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition-colors border-l-2 ${
                    row.delivery_rate >= 75
                      ? 'border-l-emerald-400 dark:border-l-emerald-500'
                      : 'border-l-red-400 dark:border-l-red-500'
                  } ${i % 2 === 0 ? '' : 'bg-zinc-50/30 dark:bg-zinc-800/30'}`}>
                    {visibleCols.product_name && (
                      <td className="px-3 py-2.5 sticky left-0 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 z-10 max-w-[240px]">
                        <div>
                          <p className="font-medium text-zinc-800 dark:text-zinc-200 truncate" title={row.product_name}>{row.product_name}</p>
                          <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500">{row.sku}</p>
                        </div>
                      </td>
                    )}
                    {visibleCols.status_badge && (
                      <td className="px-3 py-2.5 text-center">
                        <DeliveryBadge rate={row.delivery_rate} />
                      </td>
                    )}
                    {visibleCols.stock_available && (
                      <td className={`px-3 py-2.5 text-right text-xs font-semibold ${
                        row.stock_available == null ? 'text-zinc-400' :
                        row.stock_available < 10 ? 'text-red-600 dark:text-red-400' :
                        row.stock_available < 50 ? 'text-amber-600 dark:text-amber-400' :
                        'text-zinc-700 dark:text-zinc-300'
                      }`}>
                        {row.stock_available == null ? '—' : fmt(row.stock_available)}
                      </td>
                    )}
                    {visibleCols.total_orders && (
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">{fmt(row.total_orders)}</span>
                        <MiniBar value={row.total_orders} max={maxOrders} colorClass="bg-primary-400" />
                      </td>
                    )}
                    {visibleCols.total_units && <td className="px-3 py-2.5 text-right text-zinc-600 dark:text-zinc-400">{fmt(row.total_units)}</td>}
                    {visibleCols.delivered && <td className="px-3 py-2.5 text-right text-emerald-700 dark:text-emerald-400 font-medium">{fmt(row.delivered)}</td>}
                    {visibleCols.returned && <td className="px-3 py-2.5 text-right text-amber-600 dark:text-amber-400">{fmt(row.returned)}</td>}
                    {visibleCols.refused && <td className="px-3 py-2.5 text-right text-red-600 dark:text-red-400">{fmt(row.refused)}</td>}
                    {visibleCols.cancelled && <td className="px-3 py-2.5 text-right text-zinc-500 dark:text-zinc-400">{fmt(row.cancelled)}</td>}
                    {visibleCols.in_transit && <td className="px-3 py-2.5 text-right text-blue-600 dark:text-blue-400">{fmt(row.in_transit)}</td>}
                    {visibleCols.delivery_rate && (
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${rateBarColor(row.delivery_rate)}`}
                              style={{ width: `${Math.min(row.delivery_rate, 100)}%` }} />
                          </div>
                          <span className={`font-bold text-xs ${rateColor(row.delivery_rate)}`}>{fmtPct(row.delivery_rate)}</span>
                        </div>
                      </td>
                    )}
                    {visibleCols.return_rate && (
                      <td className="px-3 py-2.5 text-right">
                        <span className={`font-semibold text-xs ${returnRateColor(row.return_rate)}`}>{fmtPct(row.return_rate)}</span>
                      </td>
                    )}
                    {visibleCols.cancellation_rate && (
                      <td className="px-3 py-2.5 text-right">
                        <span className={`text-xs ${returnRateColor(row.cancellation_rate)}`}>{fmtPct(row.cancellation_rate)}</span>
                      </td>
                    )}
                    {visibleCols.expedition_rate && <td className="px-3 py-2.5 text-right text-zinc-600 dark:text-zinc-400 text-xs">{fmtPct(row.expedition_rate)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && displayedRows.length > 0 && (
          <div className="px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-700/50 text-xs text-zinc-400 flex justify-between">
            <span>{displayedRows.length} produse afișate</span>
            <span>Min. {serverMinOrders} comenzi per produs (din Filtre avansate)</span>
          </div>
        )}
      </div>

      <AdvancedFiltersDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        fields={FILTER_FIELDS}
        value={valueFilters}
        onChange={setValueFilters}
        onReset={() => setValueFilters({})}
      />

      <IncludeExcludeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        value={includeExclude}
        onChange={(next) => setIncludeExclude({ ...EMPTY_INC_EXC, ...next })}
        availableStores={storeOptions}
        availableSkus={data?.products || []}
      />
    </div>
  )
}
