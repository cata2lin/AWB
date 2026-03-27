/**
 * PurchaseOrdersTab — Inventory replenishment planning dashboard.
 *
 * Performance: Fetches data ONCE per period change, then filters/sorts/
 * paginates entirely client-side for instant interactions.
 *
 * Features:
 * - KPI cards (urgent, warning, ok, overstock, slow, stock value)
 * - Multi-select store filter dropdown
 * - Category quick-filters + search
 * - Client-side column sorting (instant)
 * - Client-side pagination (instant)
 * - Excel export
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
    Search, RefreshCw, Download, ArrowUpDown, Package, AlertTriangle,
    Clock, TrendingUp, X, ShoppingCart, ChevronLeft, ChevronRight, Info,
    ChevronDown, Check, Store
} from 'lucide-react'
import { analyticsApi } from '../services/api'
import { exportPurchaseOrdersToExcel } from '../utils/purchaseOrdersExport'

const formatNumber = (n) => n == null ? '0' : Number(n).toLocaleString('ro-RO')
const formatCurrency = (n) => n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON`

const URGENCY_CONFIG = {
    urgent:    { label: 'Urgent',    cls: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',       icon: '🔴' },
    warning:   { label: 'Warning',   cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300', icon: '🟡' },
    ok:        { label: 'OK',        cls: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300',  icon: '🟢' },
    overstock: { label: 'Overstock', cls: 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300', icon: '🟣' },
    slow:      { label: 'Slow',      cls: 'bg-zinc-100 dark:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400',     icon: '⚪' },
}

const PAGE_SIZE = 30

/** Multi-select dropdown for store filtering. */
function StoreFilterDropdown({ allStores, selectedStores, onChange }) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    // Close on outside click
    useEffect(() => {
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    const toggle = (store) => {
        onChange(prev =>
            prev.includes(store) ? prev.filter(s => s !== store) : [...prev, store]
        )
    }

    const label = selectedStores.length === 0
        ? 'All Stores'
        : selectedStores.length === 1
            ? selectedStores[0]
            : `${selectedStores.length} stores`

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700/50 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors min-w-[140px]"
            >
                <Store className="w-3.5 h-3.5 text-zinc-400" />
                <span className="truncate max-w-[120px]">{label}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 w-64 max-h-72 overflow-y-auto bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xl z-50">
                    {/* Select All / Clear */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-700">
                        <button
                            onClick={() => onChange([])}
                            className="text-[10px] text-indigo-500 hover:text-indigo-400 font-medium"
                        >
                            Clear All
                        </button>
                        <button
                            onClick={() => onChange([...allStores])}
                            className="text-[10px] text-indigo-500 hover:text-indigo-400 font-medium"
                        >
                            Select All
                        </button>
                    </div>
                    {allStores.map(store => (
                        <button
                            key={store}
                            onClick={() => toggle(store)}
                            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors"
                        >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                                selectedStores.includes(store)
                                    ? 'bg-indigo-500 border-indigo-500'
                                    : 'border-zinc-300 dark:border-zinc-600'
                            }`}>
                                {selectedStores.includes(store) && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <span className="text-zinc-700 dark:text-zinc-200 truncate">{store}</span>
                        </button>
                    ))}
                    {allStores.length === 0 && (
                        <div className="px-3 py-4 text-xs text-zinc-400 text-center">No stores found</div>
                    )}
                </div>
            )}
        </div>
    )
}

export default function PurchaseOrdersTab() {
    // Raw data from backend (fetched once per period change)
    const [rawData, setRawData] = useState(null)
    const [loading, setLoading] = useState(false)

    // Filters (client-side — instant)
    const [days, setDays] = useState(30)
    const [search, setSearch] = useState('')
    const [category, setCategory] = useState('')
    const [selectedStores, setSelectedStores] = useState([])

    // Sorting (client-side — instant)
    const [sortBy, setSortBy] = useState('days_of_stock')
    const [sortDir, setSortDir] = useState('asc')

    // Pagination (client-side — instant)
    const [page, setPage] = useState(0)

    // Fetch data ONLY when period changes (heavy backend query)
    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const result = await analyticsApi.getPurchaseOrders({ days })
            setRawData(result)
        } catch (err) {
            console.error('Failed to fetch purchase orders:', err)
        } finally {
            setLoading(false)
        }
    }, [days])

    useEffect(() => { fetchData() }, [fetchData])

    // Extract all unique store names from raw data
    const allStores = useMemo(() => {
        if (!rawData?.products) return []
        const storeSet = new Set()
        rawData.products.forEach(p => (p.stores || []).forEach(s => storeSet.add(s)))
        return Array.from(storeSet).sort()
    }, [rawData])

    // ── Client-side filter → sort → paginate pipeline ────────────────────
    const { filteredProducts, kpis } = useMemo(() => {
        const allProducts = rawData?.products || []
        const searchLower = search.toLowerCase().trim()

        // 1. Filter
        let filtered = allProducts

        // Store filter
        if (selectedStores.length > 0) {
            filtered = filtered.filter(p =>
                (p.stores || []).some(s => selectedStores.includes(s))
            )
        }

        // Category filter
        if (category) {
            filtered = filtered.filter(p => p.urgency === category)
        }

        // Search
        if (searchLower) {
            filtered = filtered.filter(p =>
                (p.sku || '').toLowerCase().includes(searchLower) ||
                (p.product_name || '').toLowerCase().includes(searchLower) ||
                (p.barcode || '').toLowerCase().includes(searchLower)
            )
        }

        // 2. Sort
        const sorted = [...filtered].sort((a, b) => {
            let va = a[sortBy]
            let vb = b[sortBy]

            // Nulls to end
            if (va == null && vb == null) return 0
            if (va == null) return sortDir === 'asc' ? 1 : -1
            if (vb == null) return sortDir === 'asc' ? -1 : 1

            // String comparison
            if (typeof va === 'string') {
                va = va.toLowerCase()
                vb = (vb || '').toLowerCase()
                return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
            }

            // Numeric
            return sortDir === 'asc' ? va - vb : vb - va
        })

        // Recompute KPIs from filtered set
        const urgent = sorted.filter(p => p.urgency === 'urgent').length
        const warning = sorted.filter(p => p.urgency === 'warning').length
        const overstock = sorted.filter(p => p.urgency === 'overstock').length
        const slow = sorted.filter(p => p.urgency === 'slow').length
        const ok = sorted.length - urgent - warning - overstock - slow
        const totalStockValue = sorted.reduce((s, p) => s + (p.stock_value || 0), 0)

        return {
            filteredProducts: sorted,
            kpis: {
                total_skus: sorted.length,
                urgent_reorders: urgent,
                warning_reorders: warning,
                ok_count: ok,
                overstock,
                slow_moving: slow,
                total_stock_value: totalStockValue,
            },
        }
    }, [rawData, search, category, selectedStores, sortBy, sortDir])

    // Reset page on any filter/sort change
    useEffect(() => { setPage(0) }, [search, category, selectedStores, sortBy, sortDir])

    const meta = rawData?.meta || {}
    const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE)
    const pageProducts = filteredProducts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

    // Sort toggle
    const toggleSort = (col) => {
        if (sortBy === col) {
            setSortDir(d => d === 'desc' ? 'asc' : 'desc')
        } else {
            setSortBy(col)
            setSortDir(col === 'days_of_stock' || col === 'stock_available' ? 'asc' : 'desc')
        }
    }

    const SortIcon = ({ col }) => (
        <ArrowUpDown className={`w-3 h-3 inline ml-1 ${sortBy === col ? 'text-indigo-400' : 'text-zinc-500'}`} />
    )

    return (
        <div className="space-y-6">
            {/* Lead time info banner */}
            <div className="flex items-start gap-3 px-4 py-3 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl border border-indigo-200 dark:border-indigo-500/20">
                <Info className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-indigo-700 dark:text-indigo-300">
                    <span className="font-semibold">Lead Time:</span> Esteban & GT — self-produced (0 days) | All others — 90-day average supplier lead time.
                    Reorder qty includes a 30-day buffer beyond lead time.
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                {[
                    { label: 'Total SKUs', value: formatNumber(kpis.total_skus), color: 'text-zinc-900 dark:text-white' },
                    { label: 'Urgent', value: formatNumber(kpis.urgent_reorders), color: 'text-red-600 dark:text-red-400', bg: kpis.urgent_reorders > 0 ? 'ring-2 ring-red-300 dark:ring-red-500/40' : '' },
                    { label: 'Warning', value: formatNumber(kpis.warning_reorders), color: 'text-amber-600 dark:text-amber-400' },
                    { label: 'OK', value: formatNumber(kpis.ok_count), color: 'text-green-600 dark:text-green-400' },
                    { label: 'Overstock', value: formatNumber(kpis.overstock), color: 'text-purple-600 dark:text-purple-400' },
                    { label: 'Slow Moving', value: formatNumber(kpis.slow_moving), color: 'text-zinc-500' },
                    { label: 'Stock Value', value: formatCurrency(kpis.total_stock_value), color: 'text-indigo-600 dark:text-indigo-400', wide: true },
                ].map((kpi, i) => (
                    <div key={i} className={`bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700 ${kpi.bg || ''} ${kpi.wide ? 'col-span-2 md:col-span-1' : ''}`}>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{kpi.label}</div>
                        <div className={`text-xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</div>
                    </div>
                ))}
            </div>

            {/* Filters Bar */}
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-4">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search SKU, product, barcode..."
                            className="w-full pl-9 pr-8 py-2 text-sm rounded-lg bg-zinc-50 dark:bg-zinc-700/50 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                        {search && (
                            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                                <X className="w-4 h-4 text-zinc-400 hover:text-zinc-600" />
                            </button>
                        )}
                    </div>

                    {/* Store filter */}
                    <StoreFilterDropdown
                        allStores={allStores}
                        selectedStores={selectedStores}
                        onChange={setSelectedStores}
                    />

                    {/* Velocity period */}
                    <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-1">
                        {[30, 60, 90].map(d => (
                            <button
                                key={d}
                                onClick={() => setDays(d)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${days === d
                                    ? 'bg-white dark:bg-zinc-600 text-indigo-600 dark:text-indigo-300 shadow-sm'
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                                }`}
                            >
                                {d}d
                            </button>
                        ))}
                    </div>

                    {/* Category quick-filter */}
                    <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-1">
                        <button
                            onClick={() => setCategory('')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${!category
                                ? 'bg-white dark:bg-zinc-600 text-zinc-900 dark:text-white shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                        >
                            All
                        </button>
                        {Object.entries(URGENCY_CONFIG).map(([key, cfg]) => (
                            <button
                                key={key}
                                onClick={() => setCategory(key === category ? '' : key)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${category === key
                                    ? 'bg-white dark:bg-zinc-600 shadow-sm ' + cfg.cls
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                                }`}
                            >
                                {cfg.icon} {cfg.label}
                            </button>
                        ))}
                    </div>

                    {/* Export & Refresh */}
                    <button
                        onClick={() => exportPurchaseOrdersToExcel(filteredProducts, meta)}
                        disabled={filteredProducts.length === 0}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-40"
                    >
                        <Download className="w-4 h-4" /> Export
                    </button>
                    <button onClick={fetchData} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" title="Refresh">
                        <RefreshCw className={`w-4 h-4 text-zinc-500 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                <div className="mt-2 text-xs text-zinc-400">
                    {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''} | Velocity based on last {meta.period_days || days} days
                    {category && ` | Filtered: ${category}`}
                    {selectedStores.length > 0 && ` | Stores: ${selectedStores.join(', ')}`}
                </div>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 overflow-hidden">
                {/* Loading overlay — only show on initial load or period change */}
                {loading && (
                    <div className="absolute inset-0 bg-white/60 dark:bg-zinc-900/60 z-10 flex items-center justify-center rounded-xl">
                        <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                    </div>
                )}

                <div className="overflow-x-auto relative">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80">
                                <th className="px-3 py-3 font-medium w-8">#</th>
                                <th className="px-3 py-3 font-medium cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => toggleSort('product_name')}>
                                    Product <SortIcon col="product_name" />
                                </th>
                                <th className="px-3 py-3 font-medium cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => toggleSort('sku')}>
                                    SKU <SortIcon col="sku" />
                                </th>
                                <th className="px-3 py-3 font-medium text-right cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => toggleSort('stock_available')}>
                                    Stock <SortIcon col="stock_available" />
                                </th>
                                <th className="px-3 py-3 font-medium text-right">Committed</th>
                                <th className="px-3 py-3 font-medium text-right">Incoming</th>
                                <th className="px-3 py-3 font-medium text-right cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => toggleSort('units_sold')}>
                                    Sold <SortIcon col="units_sold" />
                                </th>
                                <th className="px-3 py-3 font-medium text-right cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => toggleSort('velocity')}>
                                    Vel. (u/d) <SortIcon col="velocity" />
                                </th>
                                <th className="px-3 py-3 font-medium text-right cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => toggleSort('days_of_stock')}>
                                    Days Left <SortIcon col="days_of_stock" />
                                </th>
                                <th className="px-3 py-3 font-medium text-right">Lead Time</th>
                                <th className="px-3 py-3 font-medium text-right cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => toggleSort('suggested_qty')}>
                                    Reorder Qty <SortIcon col="suggested_qty" />
                                </th>
                                <th className="px-3 py-3 font-medium text-right cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => toggleSort('stock_value')}>
                                    Value <SortIcon col="stock_value" />
                                </th>
                                <th className="px-3 py-3 font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                            {!loading && filteredProducts.length === 0 ? (
                                <tr><td colSpan={13} className="px-4 py-12 text-center text-zinc-400">
                                    <Package className="w-6 h-6 inline mr-2 opacity-50" />No products found
                                </td></tr>
                            ) : loading && filteredProducts.length === 0 ? (
                                <tr><td colSpan={13} className="px-4 py-12 text-center text-zinc-400">
                                    <RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading...
                                </td></tr>
                            ) : pageProducts.map((p, idx) => {
                                const urgency = URGENCY_CONFIG[p.urgency] || URGENCY_CONFIG.ok
                                const rowBg = p.urgency === 'urgent'
                                    ? 'bg-red-50/50 dark:bg-red-500/5'
                                    : p.urgency === 'warning'
                                    ? 'bg-amber-50/30 dark:bg-amber-500/5'
                                    : ''
                                const imgSrc = p.images?.[0]?.src || null

                                return (
                                    <tr key={p.uid || p.sku + idx} className={`hover:bg-zinc-50 dark:hover:bg-zinc-700/20 transition-colors ${rowBg}`}>
                                        <td className="px-3 py-2.5 text-zinc-400 text-xs">
                                            {page * PAGE_SIZE + idx + 1}
                                        </td>
                                        <td className="px-3 py-2.5 max-w-[250px]">
                                            <div className="flex items-center gap-2">
                                                {imgSrc ? (
                                                    <img src={imgSrc} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0 border border-zinc-200 dark:border-zinc-600" />
                                                ) : (
                                                    <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0">
                                                        <Package className="w-4 h-4 text-zinc-400" />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="font-medium text-zinc-800 dark:text-zinc-200 truncate text-xs">
                                                        {p.product_name || '—'}
                                                    </div>
                                                    <div className="text-[10px] text-zinc-400 truncate">
                                                        {p.stores?.join(', ') || '—'}
                                                        {p.is_self_produced && <span className="ml-1 text-indigo-500">★ self</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                                            {p.sku || '—'}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-semibold text-zinc-900 dark:text-white">
                                            {formatNumber(p.stock_available)}
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-zinc-500 dark:text-zinc-400 text-xs">
                                            {p.stock_committed || 0}
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-zinc-500 dark:text-zinc-400 text-xs">
                                            {p.stock_incoming || 0}
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-xs text-zinc-600 dark:text-zinc-300">
                                            {formatNumber(p.units_sold)}
                                        </td>
                                        <td className="px-3 py-2.5 text-right">
                                            <span className={`font-medium ${p.velocity > 1 ? 'text-green-600 dark:text-green-400' : p.velocity > 0 ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400'}`}>
                                                {p.velocity?.toFixed(2) || '0'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right">
                                            <span className={`font-bold ${
                                                p.days_of_stock === null ? 'text-zinc-400'
                                                : p.days_of_stock < (p.lead_time || 90) ? 'text-red-600 dark:text-red-400'
                                                : p.days_of_stock < (p.lead_time || 90) * 1.5 ? 'text-amber-600 dark:text-amber-400'
                                                : 'text-zinc-700 dark:text-zinc-300'
                                            }`}>
                                                {p.days_of_stock != null ? formatNumber(p.days_of_stock) : '∞'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-xs text-zinc-500 dark:text-zinc-400">
                                            {p.lead_time === 0 ? <span className="text-indigo-500 font-medium">Self</span> : `${p.lead_time}d`}
                                        </td>
                                        <td className="px-3 py-2.5 text-right">
                                            {p.suggested_qty > 0 ? (
                                                <span className="font-bold text-red-600 dark:text-red-400">
                                                    +{formatNumber(p.suggested_qty)}
                                                </span>
                                            ) : (
                                                <span className="text-zinc-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-xs text-zinc-500 dark:text-zinc-400">
                                            {p.stock_value > 0 ? formatCurrency(p.stock_value) : '—'}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${urgency.cls}`}>
                                                {urgency.icon} {urgency.label}
                                            </span>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
                        <div className="text-xs text-zinc-400">
                            Page {page + 1} of {totalPages} ({filteredProducts.length} products)
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                                className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 transition-colors"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                                let p
                                if (totalPages <= 7) {
                                    p = i
                                } else if (page < 4) {
                                    p = i
                                } else if (page > totalPages - 5) {
                                    p = totalPages - 7 + i
                                } else {
                                    p = page - 3 + i
                                }
                                if (p < 0 || p >= totalPages) return null
                                return (
                                    <button
                                        key={p}
                                        onClick={() => setPage(p)}
                                        className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${p === page
                                            ? 'bg-indigo-500 text-white'
                                            : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                                        }`}
                                    >
                                        {p + 1}
                                    </button>
                                )
                            })}
                            <button
                                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1}
                                className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 transition-colors"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
