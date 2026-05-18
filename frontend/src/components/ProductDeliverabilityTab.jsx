/**
 * ProductDeliverabilityTab — per-SKU delivery performance report.
 * Mirrors the Livrabilitate tab but at product granularity.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, RefreshCw, ChevronUp, ChevronDown, TrendingDown, Package, X, Download } from 'lucide-react'
import { analyticsApi } from '../services/api/analytics'

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

function SortIcon({ col, active, dir }) {
  if (!active) return <ChevronUp className="w-3 h-3 text-zinc-300 dark:text-zinc-600" />
  return dir === 'desc' ? <ChevronDown className="w-3 h-3 text-indigo-500" /> : <ChevronUp className="w-3 h-3 text-indigo-500" />
}

const COLS = [
  { key: 'product_name', label: 'Produs / SKU', align: 'left', sticky: true },
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

export default function ProductDeliverabilityTab({ selectedStores = [] }) {
  const [period, setPeriod] = useState(getLastCompleteMonth)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [minOrders, setMinOrders] = useState(5)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ col: 'total_orders', dir: 'desc' })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [visibleCols, setVisibleCols] = useState(() =>
    Object.fromEntries(COLS.map(c => [c.key, true]))
  )
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'low_delivery' | 'high_return' | 'high_cancel'

  const fetchData = useCallback(async (overridePeriod, overrideFrom, overrideTo) => {
    const p = overridePeriod ?? period
    const cf = overrideFrom ?? customFrom
    const ct = overrideTo ?? customTo
    const [dateFrom, dateTo] = periodToDates(p, cf, ct)
    if (!dateFrom || !dateTo) return
    setLoading(true)
    setError(null)
    try {
      const params = { min_orders: minOrders, date_from: dateFrom, date_to: dateTo }
      if (selectedStores.length > 0) params.store_uids = selectedStores.join(',')
      const res = await analyticsApi.getProductDeliverability(params)
      setData(res)
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Eroare la încărcare')
    } finally { setLoading(false) }
  }, [period, customFrom, customTo, minOrders, selectedStores])

  // Auto-fetch: fire immediately for all non-custom periods.
  // For custom, wait until both dates are set.
  useEffect(() => {
    if (period === 'custom') {
      if (customFrom && customTo) fetchData()
    } else {
      fetchData()
    }
  }, [period, customFrom, customTo, selectedStores, minOrders])

  const toggleSort = col => setSort(prev => prev.col === col ? { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' })

  const displayedRows = useMemo(() => {
    if (!data?.products) return []
    let rows = [...data.products]

    // Filter mode
    if (filterMode === 'low_delivery') rows = rows.filter(r => r.delivery_rate < 75)
    else if (filterMode === 'high_return') rows = rows.filter(r => r.return_rate > 12)
    else if (filterMode === 'high_cancel') rows = rows.filter(r => r.cancellation_rate > 10)

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
  }, [data, search, sort, filterMode])

  const maxOrders = useMemo(() => Math.max(...(data?.products || []).map(r => r.total_orders), 1), [data])

  // CSV export
  const exportCsv = () => {
    if (!displayedRows.length) return
    const headers = COLS.filter(c => visibleCols[c.key]).map(c => c.label)
    const rows = displayedRows.map(r => COLS.filter(c => visibleCols[c.key]).map(c => {
      const v = r[c.key]
      if (['delivery_rate', 'return_rate', 'cancellation_rate', 'expedition_rate'].includes(c.key)) return `${v}%`
      return v
    }))
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `livrabilitate_produse_${period}.csv`; a.click()
    URL.revokeObjectURL(url)
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
            className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500/30">
            <optgroup label="Perioade rapide">
              {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
            <optgroup label="Luni">
              {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          </select>
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200" />
            <span className="text-zinc-400">→</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200" />
          </div>
        )}

        {/* Min orders */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 font-medium">Min. comenzi:</span>
          <select value={minOrders} onChange={e => setMinOrders(Number(e.target.value))}
            className="px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200">
            {[1, 3, 5, 10, 20, 50].map(n => <option key={n} value={n}>{n}+</option>)}
          </select>
        </div>

        <button onClick={fetchData} disabled={loading}
          className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Actualizează
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={exportCsv} title="Export CSV"
            className="p-2 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors">
            <Download className="w-4 h-4" />
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
                  ? 'bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30'
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
            className="pl-8 pr-8 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 w-64 focus:ring-2 focus:ring-indigo-500/30" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-16 text-zinc-400">
            <RefreshCw className="w-6 h-6 animate-spin mr-3 text-indigo-400" />
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
            <p className="text-xs mt-1">Încearcă să reduci filtrul "Min. comenzi" sau să schimbi perioada</p>
          </div>
        )}

        {!loading && displayedRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80">
                  {COLS.filter(c => visibleCols[c.key]).map(col => (
                    <th key={col.key}
                      onClick={() => col.key !== 'status_badge' && toggleSort(col.key)}
                      className={`px-3 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap select-none
                        ${col.key !== 'status_badge' ? 'cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200' : 'cursor-default'}
                        ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'} ${col.sticky ? 'sticky left-0 bg-zinc-50 dark:bg-zinc-800/80 z-10' : ''}`}>
                      <span className="flex items-center gap-1 justify-end">
                        {col.align === 'right' && <SortIcon col={col.key} active={sort.col === col.key} dir={sort.dir} />}
                        {col.label}
                        {col.align === 'left' && <SortIcon col={col.key} active={sort.col === col.key} dir={sort.dir} />}
                      </span>
                    </th>
                  ))}
                </tr>
                {/* Totals row */}
                <tr className="border-b-2 border-zinc-300 dark:border-zinc-600 bg-zinc-100/80 dark:bg-zinc-700/40 font-semibold">
                  {COLS.filter(c => visibleCols[c.key]).map(col => (
                    <td key={col.key} className={`px-3 py-2.5 text-xs ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.sticky ? 'sticky left-0 bg-zinc-100 dark:bg-zinc-700 z-10' : ''}`}>
                      {col.key === 'product_name' && <span className="text-zinc-500 dark:text-zinc-400">TOTAL ({displayedRows.length} produse)</span>}
                      {col.key === 'status_badge' && <DeliveryBadge rate={totals.delivery_rate} />}
                      {col.key === 'stock_available' && '—'}
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
                        <MiniBar value={row.total_orders} max={maxOrders} colorClass="bg-indigo-400" />
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
            <span>Min. {minOrders} comenzi per produs</span>
          </div>
        )}
      </div>
    </div>
  )
}
