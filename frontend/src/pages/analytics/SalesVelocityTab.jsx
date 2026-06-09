import { useState, useEffect, useCallback, useMemo } from 'react'
import {
    TrendingUp, Package, Truck, ChevronDown, ChevronUp, RefreshCw, Filter,
    BarChart3, Store, ArrowRight, ArrowUpRight, ArrowDownRight, DollarSign,
    Tag, Plus, Trash2, Search, AlertTriangle, Bookmark, Download, X,
} from 'lucide-react'
import { analyticsApi, purchaseOrdersMgmtApi, settingsApi } from '../../services/api'
import VelocityRow from '../../components/VelocityRow'
import MultiSelectFilter from '../../components/MultiSelectFilter'
import SkuPickerModal from '../../components/SkuPickerModal'
import { toastError, toastSuccess } from '../../utils/toast'
import { toast } from 'sonner'

// Country emoji flags for display (copied from Analytics — used by VelocityRow)
const COUNTRY_FLAGS = {
    'RO': '🇷🇴', 'BG': '🇧🇬', 'HU': '🇭🇺', 'DE': '🇩🇪', 'FR': '🇫🇷',
    'IT': '🇮🇹', 'ES': '🇪🇸', 'PL': '🇵🇱', 'AT': '🇦🇹', 'GR': '🇬🇷',
    'NL': '🇳🇱', 'BE': '🇧🇪', 'PT': '🇵🇹', 'SE': '🇸🇪', 'GB': '🇬🇧',
    'CZ': '🇨🇿', 'SK': '🇸🇰', 'HR': '🇭🇷', 'SI': '🇸🇮', 'MD': '🇲🇩',
    'UA': '🇺🇦', 'RS': '🇷🇸', 'IE': '🇮🇪'
}

export default function SalesVelocityTab({ stores = [] }) {
    // Sales Velocity state
    const [velocityData, setVelocityData] = useState(null)
    const [velocityLoading, setVelocityLoading] = useState(false)
    const [velocityMetricsType] = useState('net')
    const [velocityDays, setVelocityDays] = useState(1)
    const [velocityDateFrom, setVelocityDateFrom] = useState('')
    const [velocityDateTo, setVelocityDateTo] = useState('')
    const [velocityStores, setVelocityStores] = useState([])
    const [velocityMinUnits, setVelocityMinUnits] = useState(1)
    const [velocitySearch, setVelocitySearch] = useState('')
    const [velocitySort, setVelocitySort] = useState({ col: 'velocity', dir: 'desc' })
    const [velocityExpanded, setVelocityExpanded] = useState(null)
    const [velocityView, setVelocityView] = useState('table') // 'table' | 'charts' | 'alerts'
    const [growthSearch, setGrowthSearch] = useState('')
    const [declineSearch, setDeclineSearch] = useState('')
    const [growthSort, setGrowthSort] = useState('velocity_change_pct')
    const [declineSort, setDeclineSort] = useState('velocity_change_pct')
    const [expandedStoreUid, setExpandedStoreUid] = useState(null)
    const [alertSearch, setAlertSearch] = useState('')
    const [hoveredTrendBar, setHoveredTrendBar] = useState(null)

    // Draft POs state
    const [draftPOs, setDraftPOs] = useState([])
    const [selectedDraftPo, setSelectedDraftPo] = useState('')
    const [poCategories, setPoCategories] = useState([])
    const [generatingPO, setGeneratingPO] = useState(false)

    // Advanced velocity filters
    const [velocityMaxUnits, setVelocityMaxUnits] = useState('')
    const [velocityMinRevenue, setVelocityMinRevenue] = useState('')
    const [velocityMaxRevenue, setVelocityMaxRevenue] = useState('')
    const [velocityMinStock, setVelocityMinStock] = useState('')
    const [velocityMaxStock, setVelocityMaxStock] = useState('')
    const [velocityMinPoIncoming, setVelocityMinPoIncoming] = useState('')
    const [velocityMaxPoIncoming, setVelocityMaxPoIncoming] = useState('')
    const [velocityTrendFilter, setVelocityTrendFilter] = useState('')
    const [velocityTrendMinPct, setVelocityTrendMinPct] = useState('')
    const [velocityTrendMaxPct, setVelocityTrendMaxPct] = useState('')
    const [velocityMinDaysLeft, setVelocityMinDaysLeft] = useState('')
    const [velocityMaxDaysLeft, setVelocityMaxDaysLeft] = useState('')
    const [velocityTargetCoverage, setVelocityTargetCoverage] = useState(30)
    const [velocityExcludeStores, setVelocityExcludeStores] = useState([])
    const [velocitySkuInclude, setVelocitySkuInclude] = useState([])
    const [velocitySkuExclude, setVelocitySkuExclude] = useState([])
    const [showSkuIncludePicker, setShowSkuIncludePicker] = useState(false)
    const [showSkuExcludePicker, setShowSkuExcludePicker] = useState(false)
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

    // Custom saved views
    const [savedViews, setSavedViews] = useState(() => {
        try { return JSON.parse(localStorage.getItem('velocityViews') || '[]') } catch { return [] }
    })
    const [activeViewName, setActiveViewName] = useState('')
    const [newViewName, setNewViewName] = useState('')
    const [showSaveViewInput, setShowSaveViewInput] = useState(false)

    // Product selection for PO generation
    const [velocitySelectedSkus, setVelocitySelectedSkus] = useState(new Set())
    // eslint-disable-next-line no-unused-vars
    const [restockDays, setRestockDays] = useState(30)
    const [selectedVariantOrders, setSelectedVariantOrders] = useState(null)

    // Helper: returns true for all columns (column visibility is always on)
    const isColVisible = useCallback(() => true, [])

    const handleToggleSelect = useCallback((rowKey, checked) => {
        setVelocitySelectedSkus(prev => {
            const next = new Set(prev)
            if (checked) next.add(rowKey)
            else next.delete(rowKey)
            return next
        })
    }, [])

    const handleToggleExpand = useCallback((rowKey) => {
        setVelocityExpanded(prev => prev === rowKey ? null : rowKey)
    }, [])

    // Fetch draft POs + PO categories on mount (tab won't render unless active)
    useEffect(() => {
        purchaseOrdersMgmtApi.list({ status: 'DRAFT' })
            .then(res => setDraftPOs(res.orders || []))
            .catch(err => console.error('Failed to fetch draft POs', err))
        settingsApi.getPoCategories()
            .then(r => setPoCategories(r.categories || []))
            .catch(() => {})
    }, [])

    /** Reload the draft PO list — called after create/append so the dropdown stays current. */
    const refreshDraftPOs = useCallback(async () => {
        try {
            const res = await purchaseOrdersMgmtApi.list({ status: 'DRAFT' })
            setDraftPOs(res.orders || [])
            return res.orders || []
        } catch (err) {
            console.error('Failed to refresh draft POs', err)
            return draftPOs
        }
    }, [draftPOs])

    // Auto-load velocity data on mount (with default 1-day / today period)
    useEffect(() => {
        const autoFetch = async () => {
            setVelocityLoading(true)
            try {
                const data = await analyticsApi.getSalesVelocity({ days: velocityDays, min_units: velocityMinUnits })
                setVelocityData(data)
            } catch (e) { console.error('Auto-load velocity error:', e) }
            finally { setVelocityLoading(false) }
        }
        autoFetch()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const fetchVelocity = async () => {
        setVelocityLoading(true)
        try {
            const params = { min_units: velocityMinUnits }
            if (velocityDateFrom && velocityDateTo) {
                params.date_from = velocityDateFrom
                params.date_to = velocityDateTo
            } else {
                params.days = velocityDays
            }
            if (velocityStores.length > 0) params.store_uids = velocityStores.join(',')
            const data = await analyticsApi.getSalesVelocity(params)
            setVelocityData(data)
        } catch (e) { console.error('Sales Velocity fetch error:', e) }
        finally { setVelocityLoading(false) }
    }

    const isCustomDate = velocityDateFrom && velocityDateTo

    const filteredProducts = useMemo(() => velocityData?.products
        ? velocityData.products.filter(p => {
            // Text search
            if (velocitySearch) {
                const q = velocitySearch.toLowerCase()
                const hasVariantMatch = p.by_variant?.some(v => v.sku.toLowerCase().includes(q))
                if (!p.sku.toLowerCase().includes(q) && !(p.product_name || '').toLowerCase().includes(q) && !hasVariantMatch) return false
            }
            // Min/Max units
            if (velocityMaxUnits !== '' && p.gross_units > Number(velocityMaxUnits)) return false
            // Revenue range
            if (velocityMinRevenue !== '' && p.revenue < Number(velocityMinRevenue)) return false
            if (velocityMaxRevenue !== '' && p.revenue > Number(velocityMaxRevenue)) return false
            // Stock range
            if (velocityMinStock !== '' && (p.stock_available ?? 0) < Number(velocityMinStock)) return false
            if (velocityMaxStock !== '' && (p.stock_available ?? 0) > Number(velocityMaxStock)) return false
            // PO Incoming range
            if (velocityMinPoIncoming !== '' && (p.po_incoming ?? 0) < Number(velocityMinPoIncoming)) return false
            if (velocityMaxPoIncoming !== '' && (p.po_incoming ?? 0) > Number(velocityMaxPoIncoming)) return false
            // Days Left range
            if (velocityMinDaysLeft !== '' && (p.days_left_of_stock ?? 9999) < Number(velocityMinDaysLeft)) return false
            if (velocityMaxDaysLeft !== '' && (p.days_left_of_stock ?? 0) > Number(velocityMaxDaysLeft)) return false
            // Trend direction
            if (velocityTrendFilter && p.velocity_trend !== velocityTrendFilter) return false
            // Trend % range
            if (velocityTrendMinPct !== '' && (p.velocity_change_pct ?? 0) < Number(velocityTrendMinPct)) return false
            if (velocityTrendMaxPct !== '' && (p.velocity_change_pct ?? 0) > Number(velocityTrendMaxPct)) return false
            // Exclude stores
            if (velocityExcludeStores.length > 0) {
                const productStoreUids = (p.store_uid || '').split('|').filter(Boolean)
                if (productStoreUids.some(uid => velocityExcludeStores.includes(uid))) return false
            }
            // SKU include list (exact SKU match from picker)
            if (velocitySkuInclude.length > 0) {
                if (!velocitySkuInclude.includes(p.sku)) return false
            }
            // SKU exclude list (exact SKU match from picker)
            if (velocitySkuExclude.length > 0) {
                if (velocitySkuExclude.includes(p.sku)) return false
            }
            return true
        })
        : [], [
        velocityData, velocitySearch, velocityMaxUnits, velocityMinRevenue, velocityMaxRevenue,
        velocityMinStock, velocityMaxStock, velocityMinPoIncoming, velocityMaxPoIncoming,
        velocityMinDaysLeft, velocityMaxDaysLeft, velocityTrendFilter, velocityTrendMinPct,
        velocityTrendMaxPct, velocityExcludeStores, velocitySkuInclude, velocitySkuExclude,
    ])

    const sortedProducts = useMemo(() => [...filteredProducts].map(p => ({
        ...p,
        necesar_recomandat: Math.max(0, Math.ceil((velocityTargetCoverage * (p.velocity || 0)) - ((p.stock_available || 0) + (p.po_incoming || 0))))
    })).sort((a, b) => {
        const col = velocitySort.col
        const av = a[col] ?? -1, bv = b[col] ?? -1
        if (typeof av === 'string') return velocitySort.dir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv)
        return velocitySort.dir === 'desc' ? bv - av : av - bv
    }), [filteredProducts, velocityTargetCoverage, velocitySort])

    const VSort = ({ col, label, tip }) => (
        <th
            className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200 select-none whitespace-nowrap bg-zinc-50 dark:bg-zinc-900"
            onClick={() => setVelocitySort(prev => ({ col, dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc' }))}
            title={tip || ''}
        >
            {label} {velocitySort.col === col ? (velocitySort.dir === 'desc' ? '↓' : '↑') : ''}
        </th>
    )

    // eslint-disable-next-line no-unused-vars
    const trendIcon = (t) => t === 'up' ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" /> : t === 'down' ? <ArrowDownRight className="w-3.5 h-3.5 text-red-500" /> : <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />

    // Simple SVG sparkline from daily_series
    const Sparkline = ({ data, width = 120, height = 28 }) => {
        if (!data || data.length === 0) return null
        const vals = data.map(d => d.units)
        const max = Math.max(...vals, 1)
        const points = vals.map((v, i) => `${(i / (vals.length - 1 || 1)) * width},${height - (v / max) * (height - 4) - 2}`).join(' ')
        return (
            <svg width={width} height={height} className="inline-block">
                <polyline fill="none" stroke="#10b981" strokeWidth="1.5" points={points} />
            </svg>
        )
    }

    // Interactive SVG bar chart with hover tooltips
    const TrendChart = ({ trends }) => {
        if (!trends || trends.length === 0) return null
        const maxUnits = Math.max(...trends.map(t => t.units), 1)
        const w = Math.max(700, trends.length * 16)
        const h = 260
        const barW = Math.max(4, Math.min(14, (w - 60) / trends.length - 2))
        return (
            <div className="relative">
                <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '300px' }}>
                    {/* Grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                        <g key={pct}>
                            <line x1={50} y1={h - 30 - pct * (h - 50)} x2={w - 10} y2={h - 30 - pct * (h - 50)} stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="4 4" opacity={0.3} />
                            <text x={4} y={h - 30 - pct * (h - 50) + 4} fontSize="9" fill="#a1a1aa" fontWeight="500">{Math.round(maxUnits * pct).toLocaleString()}</text>
                        </g>
                    ))}
                    {trends.map((t, i) => {
                        const barH = (t.units / maxUnits) * (h - 50)
                        const x = 55 + i * ((w - 70) / trends.length)
                        const isHovered = hoveredTrendBar === i
                        return (
                            <g key={t.date}
                                onMouseEnter={() => setHoveredTrendBar(i)}
                                onMouseLeave={() => setHoveredTrendBar(null)}
                                style={{ cursor: 'pointer' }}>
                                <rect x={x - 2} y={0} width={barW + 4} height={h} fill="transparent" />
                                <rect x={x} y={h - 30 - barH} width={barW} height={barH} rx={2}
                                    fill={isHovered ? '#34d399' : '#10b981'} opacity={isHovered ? 1 : 0.8} />
                                {(i % Math.max(1, Math.ceil(trends.length / 15)) === 0) && (
                                    <text x={x} y={h - 8} fontSize="8" fill="#a1a1aa" textAnchor="middle">{t.date.slice(5)}</text>
                                )}
                                {isHovered && (
                                    <g>
                                        <rect x={Math.min(x - 10, w - 140)} y={Math.max(5, h - 30 - barH - 68)} width={130} height={60} rx={6} fill="#18181b" stroke="#3f3f46" strokeWidth="1" />
                                        <text x={Math.min(x - 10, w - 140) + 8} y={Math.max(5, h - 30 - barH - 68) + 16} fontSize="10" fill="#e4e4e7" fontWeight="600">{t.date}</text>
                                        <text x={Math.min(x - 10, w - 140) + 8} y={Math.max(5, h - 30 - barH - 68) + 30} fontSize="9" fill="#10b981">📦 {t.units.toLocaleString()} unități</text>
                                        <text x={Math.min(x - 10, w - 140) + 8} y={Math.max(5, h - 30 - barH - 68) + 43} fontSize="9" fill="#60a5fa">💰 {t.revenue.toLocaleString()} RON</text>
                                        <text x={Math.min(x - 10, w - 140) + 8} y={Math.max(5, h - 30 - barH - 68) + 55} fontSize="9" fill="#fbbf24">📋 {t.orders} comenzi</text>
                                    </g>
                                )}
                            </g>
                        )
                    })}
                </svg>
            </div>
        )
    }

    // ── Custom Views helpers ──
    const saveCurrentView = () => {
        if (!newViewName.trim()) return
        const view = {
            name: newViewName.trim(),
            days: velocityDays, dateFrom: velocityDateFrom, dateTo: velocityDateTo,
            stores: velocityStores, excludeStores: velocityExcludeStores,
            minUnits: velocityMinUnits, maxUnits: velocityMaxUnits,
            minRevenue: velocityMinRevenue, maxRevenue: velocityMaxRevenue,
            minStock: velocityMinStock, maxStock: velocityMaxStock,
            minDaysLeft: velocityMinDaysLeft, maxDaysLeft: velocityMaxDaysLeft,
            targetCoverage: velocityTargetCoverage,
            trendFilter: velocityTrendFilter,
            trendMinPct: velocityTrendMinPct, trendMaxPct: velocityTrendMaxPct,
            search: velocitySearch,
            skuInclude: velocitySkuInclude, skuExclude: velocitySkuExclude,
        }
        const updated = [...savedViews.filter(v => v.name !== view.name), view]
        setSavedViews(updated)
        localStorage.setItem('velocityViews', JSON.stringify(updated))
        setNewViewName('')
        setShowSaveViewInput(false)
        setActiveViewName(view.name)
    }
    const loadView = (view) => {
        setVelocityDays(view.days ?? 30)
        setVelocityDateFrom(view.dateFrom ?? '')
        setVelocityDateTo(view.dateTo ?? '')
        setVelocityStores(view.stores ?? [])
        setVelocityExcludeStores(view.excludeStores ?? [])
        setVelocityMinUnits(view.minUnits ?? 1)
        setVelocityMaxUnits(view.maxUnits ?? '')
        setVelocityMinRevenue(view.minRevenue ?? '')
        setVelocityMaxRevenue(view.maxRevenue ?? '')
        setVelocityMinStock(view.minStock ?? '')
        setVelocityMaxStock(view.maxStock ?? '')
        setVelocityMinDaysLeft(view.minDaysLeft ?? '')
        setVelocityMaxDaysLeft(view.maxDaysLeft ?? '')
        setVelocityTargetCoverage(view.targetCoverage ?? 30)
        setVelocityTrendFilter(view.trendFilter ?? '')
        setVelocityTrendMinPct(view.trendMinPct ?? '')
        setVelocityTrendMaxPct(view.trendMaxPct ?? '')
        setVelocitySearch(view.search ?? '')
        setVelocitySkuInclude(view.skuInclude ?? [])
        setVelocitySkuExclude(view.skuExclude ?? [])
        setActiveViewName(view.name)
    }
    const deleteView = (name) => {
        const updated = savedViews.filter(v => v.name !== name)
        setSavedViews(updated)
        localStorage.setItem('velocityViews', JSON.stringify(updated))
        if (activeViewName === name) setActiveViewName('')
    }
    const hasActiveFilters = velocityMaxUnits !== '' || velocityMinRevenue !== '' || velocityMaxRevenue !== '' ||
        velocityMinStock !== '' || velocityMaxStock !== '' || velocityMinDaysLeft !== '' || velocityMaxDaysLeft !== '' || velocityTrendFilter !== '' ||
        velocityTrendMinPct !== '' || velocityTrendMaxPct !== '' || velocityExcludeStores.length > 0 ||
        velocitySkuInclude.length > 0 || velocitySkuExclude.length > 0
    const clearAdvancedFilters = () => {
        setVelocityMaxUnits(''); setVelocityMinRevenue(''); setVelocityMaxRevenue('')
        setVelocityMinStock(''); setVelocityMaxStock(''); setVelocityMinDaysLeft(''); setVelocityMaxDaysLeft(''); setVelocityTrendFilter('')
        setVelocityTrendMinPct(''); setVelocityTrendMaxPct(''); setVelocityExcludeStores([])
        setVelocitySkuInclude([]); setVelocitySkuExclude([])
        setActiveViewName('')
    }

    const advInput = 'w-20 px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white'

    return (
        <>
            <div className="space-y-6">
                {/* Saved Views Bar */}
                {savedViews.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Vederi:</span>
                        {savedViews.map(v => (
                            <div key={v.name} className={`group inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer transition-all ${
                                activeViewName === v.name
                                    ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-600 shadow-sm'
                                    : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                            }`}>
                                <span onClick={() => loadView(v)}>{v.name}</span>
                                <button onClick={(e) => { e.stopPropagation(); deleteView(v.name) }}
                                    className="ml-1 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">×</button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Section A: Controls */}
                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                    <div className="flex flex-wrap items-end gap-4">
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Perioadă</label>
                            <div className="flex gap-1">
                                {[1, 7, 30, 90, 180, 365].map(d => (
                                    <button key={d} onClick={() => { setVelocityDays(d); setVelocityDateFrom(''); setVelocityDateTo('') }}
                                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${!isCustomDate && velocityDays === d ? 'bg-emerald-600 text-white border-emerald-600' : 'border-zinc-200 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'}`}
                                    >{d === 1 ? 'Azi' : `${d}z`}</button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">De la</label>
                            <input type="date" value={velocityDateFrom} onChange={e => setVelocityDateFrom(e.target.value)}
                                className={`px-2 py-1.5 text-sm rounded-lg border bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white dark:[color-scheme:dark] ${isCustomDate ? 'border-emerald-500' : 'border-zinc-200 dark:border-zinc-600'}`} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Până la</label>
                            <input type="date" value={velocityDateTo} onChange={e => setVelocityDateTo(e.target.value)}
                                className={`px-2 py-1.5 text-sm rounded-lg border bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white dark:[color-scheme:dark] ${isCustomDate ? 'border-emerald-500' : 'border-zinc-200 dark:border-zinc-600'}`} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Magazine</label>
                            <MultiSelectFilter
                                label="Magazine"
                                options={stores.map(s => ({ value: s.uid, label: s.name }))}
                                selected={velocityStores}
                                onChange={setVelocityStores}
                                icon={Store}
                                searchable={stores.length > 5}
                                allLabel="Toate"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Min. unități</label>
                            <input type="number" value={velocityMinUnits} onChange={e => setVelocityMinUnits(Number(e.target.value) || 0)}
                                className="w-20 px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                        </div>
                        <button onClick={fetchVelocity} disabled={velocityLoading}
                            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5">
                            {velocityLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                            Analizează
                        </button>
                        <button onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${hasActiveFilters ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-600' : 'border-zinc-200 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700'}`}>
                            <Filter className="w-3.5 h-3.5" />
                            Filtre {hasActiveFilters ? '●' : ''} {showAdvancedFilters ? '▲' : '▼'}
                        </button>
                        {/* Save View button */}
                        {showSaveViewInput ? (
                            <div className="flex items-center gap-1.5">
                                <input value={newViewName} onChange={e => setNewViewName(e.target.value)} placeholder="Nume vedere..."
                                    onKeyDown={e => e.key === 'Enter' && saveCurrentView()}
                                    className="w-36 px-2 py-1.5 text-xs rounded-lg border border-emerald-300 dark:border-emerald-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" autoFocus />
                                <button onClick={saveCurrentView} className="px-2 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">✓</button>
                                <button onClick={() => { setShowSaveViewInput(false); setNewViewName('') }} className="px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-600">✕</button>
                            </div>
                        ) : (
                            <button onClick={() => setShowSaveViewInput(true)}
                                className="px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-1">
                                <Bookmark className="w-3.5 h-3.5" /> Salvează
                            </button>
                        )}
                    </div>

                    {/* Advanced Filters Panel — compact, collapsed by default */}
                    {showAdvancedFilters && (
                        <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Filtre Avansate</span>
                                {hasActiveFilters && (
                                    <button onClick={clearAdvancedFilters} className="text-[10px] text-red-500 hover:text-red-700 flex items-center gap-0.5">
                                        <X className="w-2.5 h-2.5" /> Reset
                                    </button>
                                )}
                            </div>
                            <div className="flex flex-wrap items-end gap-2">
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Max Unit.</label>
                                    <input type="number" value={velocityMaxUnits} onChange={e => setVelocityMaxUnits(e.target.value)} placeholder="∞" className={advInput} />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Min Rev.</label>
                                    <input type="number" value={velocityMinRevenue} onChange={e => setVelocityMinRevenue(e.target.value)} placeholder="0" className={advInput} />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Max Rev.</label>
                                    <input type="number" value={velocityMaxRevenue} onChange={e => setVelocityMaxRevenue(e.target.value)} placeholder="∞" className={advInput} />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Min Stoc</label>
                                    <input type="number" value={velocityMinStock} onChange={e => setVelocityMinStock(e.target.value)} placeholder="0" className={advInput} />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Max Stoc</label>
                                    <input type="number" value={velocityMaxStock} onChange={e => setVelocityMaxStock(e.target.value)} placeholder="∞" className={advInput} />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Min PO</label>
                                    <input type="number" value={velocityMinPoIncoming} onChange={e => setVelocityMinPoIncoming(e.target.value)} placeholder="0" className={advInput} />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Max PO</label>
                                    <input type="number" value={velocityMaxPoIncoming} onChange={e => setVelocityMaxPoIncoming(e.target.value)} placeholder="∞" className={advInput} />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Trend</label>
                                    <select value={velocityTrendFilter} onChange={e => setVelocityTrendFilter(e.target.value)} className={advInput}>
                                        <option value="">Toate</option>
                                        <option value="up">↑ Pozitiv</option>
                                        <option value="down">↓ Negativ</option>
                                        <option value="stable">→ Stabil</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Trend Min%</label>
                                    <input type="number" value={velocityTrendMinPct} onChange={e => setVelocityTrendMinPct(e.target.value)} placeholder="-∞" className={advInput} />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Trend Max%</label>
                                    <input type="number" value={velocityTrendMaxPct} onChange={e => setVelocityTrendMaxPct(e.target.value)} placeholder="+∞" className={advInput} />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Min Zile Stoc</label>
                                    <input type="number" value={velocityMinDaysLeft} onChange={e => setVelocityMinDaysLeft(e.target.value)} placeholder="0" className={advInput} />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Max Zile Stoc</label>
                                    <input type="number" value={velocityMaxDaysLeft} onChange={e => setVelocityMaxDaysLeft(e.target.value)} placeholder="∞" className={advInput} />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mb-0.5">Zile Acoperire Țintă</label>
                                    <input type="number" value={velocityTargetCoverage} onChange={e => setVelocityTargetCoverage(Number(e.target.value))} placeholder="30" className={`${advInput} border-emerald-200 dark:border-emerald-800 focus:border-emerald-500`} />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Include SKU</label>
                                    <button onClick={() => setShowSkuIncludePicker(true)}
                                        className={`${advInput} w-28 text-left truncate flex items-center gap-1 ${velocitySkuInclude.length > 0 ? 'border-emerald-400 dark:border-emerald-600' : ''}`}>
                                        <Search className="w-3 h-3 flex-shrink-0" />
                                        {velocitySkuInclude.length > 0 ? `${velocitySkuInclude.length} SKU` : 'Selectează'}
                                    </button>
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Exclude SKU</label>
                                    <button onClick={() => setShowSkuExcludePicker(true)}
                                        className={`${advInput} w-28 text-left truncate flex items-center gap-1 ${velocitySkuExclude.length > 0 ? 'border-red-400 dark:border-red-600' : ''}`}>
                                        <Search className="w-3 h-3 flex-shrink-0" />
                                        {velocitySkuExclude.length > 0 ? `${velocitySkuExclude.length} SKU` : 'Selectează'}
                                    </button>
                                </div>
                                <div>
                                    <label className="block text-[10px] text-zinc-400 mb-0.5">Exclude Magazine</label>
                                    <MultiSelectFilter
                                        label="Exclude"
                                        options={stores.map(s => ({ value: s.uid, label: s.name }))}
                                        selected={velocityExcludeStores}
                                        onChange={setVelocityExcludeStores}
                                        icon={Store}
                                        searchable={stores.length > 5}
                                        allLabel="Niciunul"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {velocityData?.meta && (
                        <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                            <span>📦 {velocityData.meta.total_orders?.toLocaleString()} comenzi totale</span>
                            <span>📅 {velocityData.meta.period_days} zile</span>
                            <span>🏷️ {velocityData.kpis?.unique_skus} SKU-uri active</span>
                            {hasActiveFilters && <span className="text-amber-600 dark:text-amber-400">🔍 {filteredProducts.length}/{velocityData.products.length} produse filtrate</span>}
                        </div>
                    )}
                </div>

                {/* SKU Include Picker Modal */}
                {showSkuIncludePicker && (
                    <SkuPickerModal
                        title="Include SKU — doar aceste produse"
                        accent="emerald"
                        selected={velocitySkuInclude}
                        onChange={setVelocitySkuInclude}
                        onClose={() => setShowSkuIncludePicker(false)}
                    />
                )}
                {/* SKU Exclude Picker Modal */}
                {showSkuExcludePicker && (
                    <SkuPickerModal
                        title="Exclude SKU — ascunde aceste produse"
                        accent="red"
                        selected={velocitySkuExclude}
                        onChange={setVelocitySkuExclude}
                        onClose={() => setShowSkuExcludePicker(false)}
                    />
                )}

                {velocityLoading && (
                    <div className="flex items-center justify-center py-12">
                        <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
                        <span className="ml-3 text-zinc-500 dark:text-white">Se analizează viteza vânzărilor...</span>
                    </div>
                )}

                {velocityData && !velocityLoading && (
                    <>
                        {/* Section B: KPI Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                            {[
                                { label: 'Brut Unități', value: (velocityData.kpis.total_gross_units || 0).toLocaleString(), icon: <Package className="w-5 h-5" />, color: 'text-zinc-600 dark:text-zinc-300', bg: 'bg-zinc-50 dark:bg-zinc-800/60' },
                                { label: 'Net Unități', value: velocityData.kpis.total_units.toLocaleString(), icon: <Package className="w-5 h-5" />, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                                { label: 'Brut Revenue', value: `${(velocityData.kpis.total_gross_revenue || 0).toLocaleString()} RON`, icon: <DollarSign className="w-5 h-5" />, color: 'text-zinc-600 dark:text-zinc-300', bg: 'bg-zinc-50 dark:bg-zinc-800/60' },
                                { label: 'Net Revenue', value: `${velocityData.kpis.total_revenue.toLocaleString()} RON`, icon: <DollarSign className="w-5 h-5" />, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                                { label: 'SKU-uri Active', value: velocityData.kpis.unique_skus, icon: <Tag className="w-5 h-5" />, color: 'text-primary-600 dark:text-primary-400', bg: 'bg-primary-50 dark:bg-primary-900/20' },
                                { label: 'Net U/Zi', value: velocityData.kpis.avg_units_per_day, icon: <TrendingUp className="w-5 h-5" />, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
                                { label: 'Avg Order Value', value: `${velocityData.kpis.avg_order_value} RON`, icon: <BarChart3 className="w-5 h-5" />, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                                { label: 'Comenzi Livrate', value: velocityData.kpis.delivered_orders?.toLocaleString(), icon: <Truck className="w-5 h-5" />, color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                            ].map(kpi => (
                                <div key={kpi.label} className={`${kpi.bg} rounded-xl border border-zinc-200 dark:border-zinc-700 p-3`}>
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <span className={kpi.color}>{kpi.icon}</span>
                                        <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{kpi.label}</span>
                                    </div>
                                    <div className={`text-lg font-bold ${kpi.color}`}>{kpi.value}</div>
                                </div>
                            ))}
                        </div>

                        {/* Sub-navigation: Table / Charts / Alerts */}
                        <div className="flex gap-2">
                            {[
                                { key: 'table', label: 'Tabel Produse', icon: <BarChart3 className="w-3.5 h-3.5" /> },
                                { key: 'charts', label: 'Grafice & Tendințe', icon: <TrendingUp className="w-3.5 h-3.5" /> },
                                { key: 'alerts', label: `Alerte (${velocityData.alerts?.length || 0})`, icon: <AlertTriangle className="w-3.5 h-3.5" /> },
                            ].map(v => (
                                <button key={v.key} onClick={() => setVelocityView(v.key)}
                                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${velocityView === v.key ? 'bg-emerald-600 text-white border-emerald-600' : 'border-zinc-200 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'}`}>
                                    {v.icon} {v.label}
                                </button>
                            ))}
                        </div>

                        {/* Sub-view: PRODUCT TABLE */}
                        {velocityView === 'table' && (
                            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-clip">
                                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-2">
                                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                                        Performanță Produse — {sortedProducts.length} SKU-uri
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <Search className="w-4 h-4 text-zinc-400" />
                                        <input
                                            type="text" value={velocitySearch} onChange={e => setVelocitySearch(e.target.value)}
                                            placeholder="Caută SKU..."
                                            className="w-48 px-2 py-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                                        />
                                        <button
                                            onClick={() => {
                                                const headers = ['SKU', 'Produs', 'Brut Unități', 'Brut Revenue', 'Net Unități', 'Net Revenue', 'Comenzi', 'Viteză Brut (u/zi)', 'Viteză Net (u/zi)', 'Trend %', 'Zile fără vânzare', 'Stoc', 'PO Incoming', 'Stoc Efectiv', 'Zile Stoc Rămas', 'Necesar Recomandat', 'Val. Inventar', 'Revenue Share %', 'Delivery Rate %']
                                                const rows = sortedProducts.map(p => [
                                                    p.sku, p.product_name || '',
                                                    p.gross_units || 0, p.gross_revenue || 0,
                                                    p.units_sold, p.revenue,
                                                    p.orders, p.gross_velocity || 0, p.velocity,
                                                    p.velocity_change_pct,
                                                    p.days_since_last_sale ?? '', p.stock_available || 0,
                                                    p.po_incoming || 0, p.effective_stock || 0,
                                                    p.days_left_of_stock === 9999 ? '∞' : p.days_left_of_stock,
                                                    p.necesar_recomandat || 0,
                                                    p.inventory_value || 0, p.revenue_share, p.delivery_rate
                                                ])
                                                const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
                                                const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
                                                const url = URL.createObjectURL(blob)
                                                const a = document.createElement('a')
                                                a.href = url
                                                const period = velocityData?.meta ? `${velocityData.meta.date_from?.slice(0,10)}_${velocityData.meta.date_to?.slice(0,10)}` : 'export'
                                                a.download = `viteza_vanzari_${period}.csv`
                                                a.click()
                                                URL.revokeObjectURL(url)
                                            }}
                                            className="px-3 py-1 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors flex items-center gap-1"
                                            title="Export CSV"
                                        >
                                            <Download className="w-3.5 h-3.5" /> CSV
                                        </button>
                                    </div>
                                </div>
                                <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
                                    <table className="w-full">
                                        <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                            <tr>
                                                <th className="px-2 py-2.5 w-8 bg-zinc-50 dark:bg-zinc-900">
                                                    <input type="checkbox"
                                                        checked={velocitySelectedSkus.size > 0 && velocitySelectedSkus.size === sortedProducts.length}
                                                        onChange={e => {
                                                            if (e.target.checked) setVelocitySelectedSkus(new Set(sortedProducts.map(p => `${p.sku}::${p.store_uid || ''}`)))
                                                            else setVelocitySelectedSkus(new Set())
                                                        }}
                                                        className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 text-emerald-600 focus:ring-emerald-500" />
                                                </th>
                                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-8 bg-zinc-50 dark:bg-zinc-900">#</th>
                                                <VSort col="sku" label="SKU" />

                                                <VSort col="gross_units" label="Brut" tip="Total unități comandate (toate outcome-urile)" />
                                                <VSort col="units_sold" label="Net" tip="Unități livrate (doar DELIVERED)" />
                                                <VSort col="gross_revenue" label="Rev. Brut" tip="Revenue din toate comenzile" />
                                                <VSort col="revenue" label="Rev. Net" tip="Revenue doar din livrări" />
                                                <VSort col="orders" label="Comenzi" />
                                                <VSort col="velocity" label="V. Net (u/zi)" tip="Unități livrate pe zi" />
                                                <VSort col="velocity_change_pct" label="Trend" tip="Schimbare față de perioada anterioară" />
                                                <VSort col="days_since_last_sale" label="Zile fără" tip="Zile de la ultima vânzare" />
                                                <VSort col="stock_available" label="Stoc" tip="Stoc disponibil curent" />
                                                <VSort col="po_incoming" label="PO Incoming" tip="Stoc în tranzit din Purchase Orders aprobate" />
                                                <VSort col="days_left_of_stock" label="Zile Stoc Rămas" tip="Acoperire stoc (curent + PO) bazat pe viteza de vânzare" />
                                                <VSort col="necesar_recomandat" label="Necesar Recomandat" tip="Zile Acoperire Țintă * Viteză - Stoc Efectiv" />
                                                <VSort col="revenue_share" label="Share %" tip="% din revenue total" />
                                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900">Sparkline</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                            {sortedProducts.length === 0 && (
                                                <tr><td colSpan={17} className="px-4 py-8 text-center text-zinc-400">Nu sunt date. Apasă "Analizează".</td></tr>
                                            )}
                                            {sortedProducts.map((p, i) => {
                                                const rowKey = `${p.sku}::${p.store_uid || ''}`
                                                const isSelected = velocitySelectedSkus.has(rowKey)
                                                const isExpanded = velocityExpanded === rowKey

                                                return (
                                                    <VelocityRow
                                                        key={rowKey}
                                                        p={p}
                                                        i={i}
                                                        rowKey={rowKey}
                                                        isSelected={isSelected}
                                                        isExpanded={isExpanded}
                                                        velocityMetricsType={velocityMetricsType}
                                                        velocityTargetCoverage={velocityTargetCoverage}
                                                        isColVisible={isColVisible}
                                                        onToggleSelect={handleToggleSelect}
                                                        onToggleExpand={handleToggleExpand}
                                                        COUNTRY_FLAGS={COUNTRY_FLAGS}
                                                        Sparkline={Sparkline}
                                                        setSelectedVariantOrders={setSelectedVariantOrders}
                                                    />
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                            </div>
                        )}

                        {/* Floating PO Generation Bar */}
                        {velocitySelectedSkus.size > 0 && (
                            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 dark:bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl px-6 py-3 flex items-center gap-5">
                                <span className="text-white text-sm font-medium">{velocitySelectedSkus.size} produse selectate</span>
                                <div className="flex items-center gap-2">
                                    <label className="text-xs text-zinc-400">Zile acoperire:</label>
                                    <span className="text-sm text-emerald-400 font-bold">{velocityTargetCoverage}</span>
                                </div>
                                <div className="flex items-center gap-2 ml-4">
                                    <select value={selectedDraftPo} onChange={e => setSelectedDraftPo(e.target.value)}
                                        className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 bg-zinc-800 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
                                        <option value="">-- Creare PO Nou --</option>
                                        {draftPOs.map(po => (
                                            <option key={po.id} value={po.id}>{po.po_number} {po.supplier_name ? `(${po.supplier_name})` : ''}</option>
                                        ))}
                                    </select>
                                    {selectedDraftPo && (
                                        <button
                                            onClick={async () => {
                                                if (!window.confirm("Ești sigur că vrei să ștergi acest PO?")) return;
                                                try {
                                                    await purchaseOrdersMgmtApi.delete(selectedDraftPo);
                                                    setDraftPOs(prev => prev.filter(p => p.id !== parseInt(selectedDraftPo)));
                                                    setSelectedDraftPo('');
                                                    toastSuccess('PO șters')
                                                } catch (e) {
                                                    console.error("Failed to delete PO", e);
                                                    toastError(e)
                                                }
                                            }}
                                            title="Șterge PO Selectat"
                                            className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded-lg transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                                <button
                                    disabled={generatingPO}
                                    onClick={async () => {
                                        setGeneratingPO(true)
                                        const items = sortedProducts
                                            .filter(p => velocitySelectedSkus.has(`${p.sku}::${p.store_uid || ''}`))
                                            .map(p => {
                                                const efectiveStock = p.effective_stock || ((p.stock_available || 0) + (p.po_incoming || 0))
                                                const necesarRecomandat = Math.max(0, Math.ceil((velocityTargetCoverage * (p.velocity || 0)) - efectiveStock))
                                                return {
                                                    sku: p.sku,
                                                    product_name: p.product_name || p.sku,
                                                    product_image: p.image_url || '',
                                                    unit_cost: p.unit_cost || 0,
                                                    quantity: necesarRecomandat > 0 ? necesarRecomandat : Math.max(1, Math.ceil((p.velocity || 0) * velocityTargetCoverage)),
                                                }
                                            })

                                        try {
                                            if (selectedDraftPo) {
                                                // ── Append-to-existing branch ──
                                                const targetPo = draftPOs.find(p => p.id === parseInt(selectedDraftPo))
                                                if (!targetPo) { setGeneratingPO(false); return }

                                                const poDetails = await purchaseOrdersMgmtApi.get(targetPo.id)
                                                const existingItems = poDetails.items || []

                                                const mergedMap = new Map()
                                                existingItems.forEach(i => mergedMap.set(i.sku, {
                                                    sku: i.sku,
                                                    product_name: i.product_name || '',
                                                    unit_cost: i.unit_cost || 0,
                                                    quantity: i.quantity || 0,
                                                    received_qty: i.received_qty || 0,
                                                    barcode: i.barcode || '',
                                                    product_uid: i.product_uid || '',
                                                    variant_title: i.variant_title || '',
                                                    product_image: i.product_image || '',
                                                }))

                                                items.forEach(newItem => {
                                                    if (mergedMap.has(newItem.sku)) {
                                                        const existing = mergedMap.get(newItem.sku)
                                                        existing.quantity += newItem.quantity
                                                        if (!existing.product_image && newItem.product_image) {
                                                            existing.product_image = newItem.product_image
                                                        }
                                                        mergedMap.set(newItem.sku, existing)
                                                    } else {
                                                        mergedMap.set(newItem.sku, {
                                                            sku: newItem.sku,
                                                            product_name: newItem.product_name,
                                                            product_image: newItem.product_image,
                                                            unit_cost: newItem.unit_cost,
                                                            quantity: newItem.quantity,
                                                            received_qty: 0,
                                                        })
                                                    }
                                                })

                                                const mergedItemsList = Array.from(mergedMap.values())
                                                await purchaseOrdersMgmtApi.updateItems(targetPo.id, mergedItemsList)
                                                toast.success(`${items.length} produs(e) adăugate la ${targetPo.po_number}`, {
                                                    action: { label: 'Vezi PO', onClick: () => window.open(`/purchase-orders/${targetPo.id}`, '_blank') },
                                                })
                                                setVelocitySelectedSkus(new Set())
                                                await refreshDraftPOs()
                                            } else {
                                                // ── Create-new branch: inline API call, no navigation ──
                                                const defaultCategory = poCategories[0]?.key || 'packaging'
                                                const periodLabel = velocityData?.meta?.date_from
                                                    ? `${velocityData.meta.date_from.slice(0, 10)} → ${velocityData.meta.date_to?.slice(0, 10) || 'today'}`
                                                    : `${velocityDays}z`
                                                const result = await purchaseOrdersMgmtApi.create({
                                                    title: `Restock din Viteză Vânzări (${periodLabel})`,
                                                    po_category: defaultCategory,
                                                    po_type: 'RESTOCK',
                                                    items,
                                                })
                                                const newPoId = result?.id
                                                const newPoNumber = result?.po_number || ''
                                                // Refresh draft list and auto-select the new one so the next
                                                // batch of products goes into the same PO instead of creating
                                                // another draft.
                                                const updatedDrafts = await refreshDraftPOs()
                                                if (newPoId && updatedDrafts.find(p => p.id === newPoId)) {
                                                    setSelectedDraftPo(String(newPoId))
                                                }
                                                setVelocitySelectedSkus(new Set())
                                                toast.success(`PO ${newPoNumber} creat cu ${items.length} produs(e). Continuă să adaugi în acest PO.`, {
                                                    duration: 6000,
                                                    action: newPoId ? {
                                                        label: 'Vezi PO',
                                                        onClick: () => window.open(`/purchase-orders/${newPoId}`, '_blank'),
                                                    } : undefined,
                                                })
                                            }
                                        } catch (e) {
                                            console.error('PO operation failed', e)
                                            toastError(e)
                                        } finally {
                                            setGeneratingPO(false)
                                        }
                                    }}
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5 ml-2 disabled:opacity-60 disabled:cursor-wait">
                                    {generatingPO
                                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                                        : <Plus className="w-4 h-4" />}
                                    {selectedDraftPo ? 'Adaugă la PO' : 'Generează PO'}
                                </button>
                                <button onClick={() => setVelocitySelectedSkus(new Set())}
                                    className="text-zinc-400 hover:text-white transition-colors">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        )}

                        {/* Sub-view: CHARTS & TRENDS */}
                        {velocityView === 'charts' && (
                            <div className="space-y-6">
                                {/* Daily Sales Trend */}
                                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-4 flex items-center gap-2">
                                        <BarChart3 className="w-4 h-4 text-emerald-500" />
                                        Trend Zilnic — Unități Vândute
                                    </h3>
                                    <TrendChart trends={velocityData.trends} />
                                </div>

                                {/* Top 10 Fastest-selling */}
                                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-4 flex items-center gap-2">
                                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                                        Top 10 — Cele mai rapide SKU-uri (u/zi)
                                    </h3>
                                    <div className="space-y-2">
                                        {filteredProducts.slice(0, 10).map((p, i) => {
                                            const maxV = filteredProducts[0]?.velocity || 1
                                            const pct = (p.velocity / maxV) * 100
                                            return (
                                                <div key={p.sku} className="flex items-center gap-3">
                                                    <span className="text-xs text-zinc-400 w-5 text-right">{i + 1}</span>
                                                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 w-40 truncate" title={p.sku}>{p.sku}</span>
                                                    <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                                                        <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                                    </div>
                                                    <span className="text-xs font-bold text-emerald-600 w-16 text-right">{p.velocity} u/zi</span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* Growth vs Decline — Full tables with search/sort */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Growing */}
                                    {(() => {
                                        const allGrowing = filteredProducts.filter(p => p.velocity_change_pct > 0 && p.prev_velocity > 0)
                                            .filter(p => !growthSearch || p.sku.toLowerCase().includes(growthSearch.toLowerCase()) || (p.product_name || '').toLowerCase().includes(growthSearch.toLowerCase()))
                                            .sort((a, b) => growthSort === 'velocity_change_pct' ? b.velocity_change_pct - a.velocity_change_pct : growthSort === 'velocity' ? b.velocity - a.velocity : a.sku.localeCompare(b.sku))
                                        return (
                                            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                                <h3 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-2">
                                                    <ArrowUpRight className="w-4 h-4" /> ðŸš€ Cele mai în creștere ({allGrowing.length})
                                                </h3>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <input type="text" value={growthSearch} onChange={e => setGrowthSearch(e.target.value)} placeholder="Caută SKU..."
                                                        className="flex-1 px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                                    <select value={growthSort} onChange={e => setGrowthSort(e.target.value)}
                                                        className="px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white">
                                                        <option value="velocity_change_pct">% Schimbare</option>
                                                        <option value="velocity">Viteză</option>
                                                        <option value="sku">SKU</option>
                                                    </select>
                                                </div>
                                                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                                                    {allGrowing.map(p => (
                                                        <div key={p.sku} className="flex items-center justify-between text-xs border-b border-zinc-100 dark:border-zinc-700/50 pb-1">
                                                            <span className="text-zinc-700 dark:text-zinc-300 truncate mr-2" title={p.product_name}>{p.sku}</span>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <span className="text-zinc-400">{p.prev_velocity} → {p.velocity}</span>
                                                                <span className="font-bold text-emerald-600">+{p.velocity_change_pct}%</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {allGrowing.length === 0 && <div className="text-xs text-zinc-400 text-center py-2">Niciun produs</div>}
                                                </div>
                                            </div>
                                        )
                                    })()}
                                    {/* Declining */}
                                    {(() => {
                                        const allDeclining = filteredProducts.filter(p => p.velocity_change_pct < 0 && p.prev_velocity > 0)
                                            .filter(p => !declineSearch || p.sku.toLowerCase().includes(declineSearch.toLowerCase()) || (p.product_name || '').toLowerCase().includes(declineSearch.toLowerCase()))
                                            .sort((a, b) => declineSort === 'velocity_change_pct' ? a.velocity_change_pct - b.velocity_change_pct : declineSort === 'velocity' ? b.velocity - a.velocity : a.sku.localeCompare(b.sku))
                                        return (
                                            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                                <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2 flex items-center gap-2">
                                                    <ArrowDownRight className="w-4 h-4" /> ðŸ“‰ Cele mai în scădere ({allDeclining.length})
                                                </h3>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <input type="text" value={declineSearch} onChange={e => setDeclineSearch(e.target.value)} placeholder="Caută SKU..."
                                                        className="flex-1 px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                                    <select value={declineSort} onChange={e => setDeclineSort(e.target.value)}
                                                        className="px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white">
                                                        <option value="velocity_change_pct">% Schimbare</option>
                                                        <option value="velocity">Viteză</option>
                                                        <option value="sku">SKU</option>
                                                    </select>
                                                </div>
                                                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                                                    {allDeclining.map(p => (
                                                        <div key={p.sku} className="flex items-center justify-between text-xs border-b border-zinc-100 dark:border-zinc-700/50 pb-1">
                                                            <span className="text-zinc-700 dark:text-zinc-300 truncate mr-2" title={p.product_name}>{p.sku}</span>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <span className="text-zinc-400">{p.prev_velocity} → {p.velocity}</span>
                                                                <span className="font-bold text-red-600">{p.velocity_change_pct}%</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {allDeclining.length === 0 && <div className="text-xs text-zinc-400 text-center py-2">Niciun produs</div>}
                                                </div>
                                            </div>
                                        )
                                    })()}
                                </div>

                                {/* Store Comparison — Expandable */}
                                {velocityData.store_comparison?.length > 0 && (
                                    <div>
                                        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3 flex items-center gap-2">
                                            <Store className="w-4 h-4" />
                                            Comparație per Magazin
                                        </h3>
                                        <div className="space-y-3">
                                            {velocityData.store_comparison.map(sc => {
                                                const isExpanded = expandedStoreUid === sc.store_uid
                                                const storeProducts = isExpanded ? filteredProducts
                                                    .filter(p => p.by_store.some(bs => bs.store_uid === sc.store_uid))
                                                    .map(p => {
                                                        const bs = p.by_store.find(b => b.store_uid === sc.store_uid)
                                                        return { ...p, store_units: bs?.units || 0, store_revenue: bs?.revenue || 0, store_orders: bs?.orders || 0 }
                                                    })
                                                    .sort((a, b) => b.store_units - a.store_units)
                                                    : []
                                                return (
                                                    <div key={sc.store_uid} className={`bg-white dark:bg-zinc-800 rounded-xl border ${isExpanded ? 'border-emerald-500' : 'border-zinc-200 dark:border-zinc-700'} overflow-hidden transition-all`}>
                                                        <div className="p-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/30" onClick={() => setExpandedStoreUid(isExpanded ? null : sc.store_uid)}>
                                                            <div className="flex items-center justify-between mb-3">
                                                                <h4 className="text-sm font-semibold text-zinc-800 dark:text-white flex items-center gap-2">
                                                                    {sc.store_name}
                                                                    {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                                                                </h4>
                                                                <span className="text-xs text-zinc-400">{sc.active_skus} SKU-uri</span>
                                                            </div>
                                                            <div className="grid grid-cols-4 gap-2 text-xs">
                                                                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2">
                                                                    <div className="text-zinc-500 dark:text-zinc-400">Unități</div>
                                                                    <div className="text-lg font-bold text-emerald-600">{sc.units.toLocaleString()}</div>
                                                                </div>
                                                                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2">
                                                                    <div className="text-zinc-500 dark:text-zinc-400">Revenue</div>
                                                                    <div className="text-lg font-bold text-blue-600">{sc.revenue.toLocaleString()}</div>
                                                                </div>
                                                                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
                                                                    <div className="text-zinc-500 dark:text-zinc-400">Viteză</div>
                                                                    <div className="text-lg font-bold text-amber-600">{sc.velocity} u/zi</div>
                                                                </div>
                                                                <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-2">
                                                                    <div className="text-zinc-500 dark:text-zinc-400">Comenzi</div>
                                                                    <div className="text-lg font-bold text-primary-600">{sc.orders.toLocaleString()}</div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {isExpanded && storeProducts.length > 0 && (
                                                            <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-3">
                                                                <div className="text-xs font-semibold text-zinc-400 uppercase mb-2">Toate produsele din {sc.store_name} ({storeProducts.length})</div>
                                                                <div className="max-h-[350px] overflow-y-auto">
                                                                    <table className="w-full text-xs">
                                                                        <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                                                            <tr className="text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
                                                                                <th className="py-1 text-left">SKU</th>
                                                                                <th className="py-1 text-right">Unități</th>
                                                                                <th className="py-1 text-right">Revenue</th>
                                                                                <th className="py-1 text-right">Comenzi</th>
                                                                                <th className="py-1 text-right">Viteză</th>
                                                                                <th className="py-1 text-right">Trend</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {storeProducts.map(p => (
                                                                                <tr key={p.sku} className="border-b border-zinc-100 dark:border-zinc-700/50 hover:bg-zinc-50 dark:hover:bg-zinc-700/20">
                                                                                    <td className="py-1.5 text-zinc-700 dark:text-zinc-300 font-medium">{p.sku}</td>
                                                                                    <td className="py-1.5 text-right text-zinc-600 dark:text-zinc-400">{p.store_units.toLocaleString()}</td>
                                                                                    <td className="py-1.5 text-right text-zinc-600 dark:text-zinc-400">{p.store_revenue.toLocaleString()} RON</td>
                                                                                    <td className="py-1.5 text-right text-zinc-600 dark:text-zinc-400">{p.store_orders}</td>
                                                                                    <td className="py-1.5 text-right font-bold text-emerald-600">{p.velocity}</td>
                                                                                    <td className={`py-1.5 text-right font-medium ${p.velocity_change_pct > 0 ? 'text-emerald-600' : p.velocity_change_pct < 0 ? 'text-red-600' : 'text-zinc-400'}`}>
                                                                                        {p.velocity_change_pct > 0 ? '+' : ''}{p.velocity_change_pct}%
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Sub-view: ALERTS */}
                        {velocityView === 'alerts' && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <Search className="w-4 h-4 text-zinc-400" />
                                    <input type="text" value={alertSearch} onChange={e => setAlertSearch(e.target.value)}
                                        placeholder="Caută în alerte (SKU)..."
                                        className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                </div>
                                {(!velocityData.alerts || velocityData.alerts.length === 0) && (
                                    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-8 text-center text-zinc-400">
                                        Nu sunt alerte pentru perioada selectată.
                                    </div>
                                )}
                                {['hot', 'new_star', 'declining', 'cold', 'dead_stock'].map(type => {
                                    const typeAlerts = (velocityData.alerts || []).filter(a => a.type === type)
                                        .filter(a => !alertSearch || a.sku.toLowerCase().includes(alertSearch.toLowerCase()))
                                    if (typeAlerts.length === 0) return null
                                    const config = {
                                        hot: { emoji: '🔥', title: 'Produse Fierbinți', desc: 'Viteză crescută >50% vs. perioada anterioară', bg: 'bg-orange-50 dark:bg-orange-900/10', border: 'border-orange-200 dark:border-orange-800' },
                                        new_star: { emoji: '🌟', title: 'Stele Noi', desc: 'Produse noi cu volum semnificativ de vânzări', bg: 'bg-yellow-50 dark:bg-yellow-900/10', border: 'border-yellow-200 dark:border-yellow-800' },
                                        declining: { emoji: '⚠️', title: 'În Declin Rapid', desc: 'Viteză scăzută >40% vs. perioada anterioară', bg: 'bg-red-50 dark:bg-red-900/10', border: 'border-red-200 dark:border-red-800' },
                                        cold: { emoji: '❄️', title: 'Produse Reci', desc: 'Fără vânzări în ultimele 14+ zile', bg: 'bg-blue-50 dark:bg-blue-900/10', border: 'border-blue-200 dark:border-blue-800' },
                                        dead_stock: { emoji: '💀', title: 'Stoc Mort', desc: 'Au cost dar zero vânzări în perioadă', bg: 'bg-zinc-50 dark:bg-zinc-900/30', border: 'border-zinc-300 dark:border-zinc-600' },
                                    }[type]
                                    return (
                                        <div key={type} className={`${config.bg} rounded-xl border ${config.border} p-4`}>
                                            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
                                                {config.emoji} {config.title} ({typeAlerts.length})
                                            </h3>
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">{config.desc}</p>
                                            <div className="space-y-1 max-h-[500px] overflow-y-auto">
                                                {typeAlerts.map((a, i) => (
                                                    <div key={`${a.sku}-${i}`} className="flex items-center justify-between text-xs bg-white/50 dark:bg-zinc-800/50 rounded-lg px-3 py-1.5">
                                                        <span className="font-medium text-zinc-700 dark:text-zinc-300">{a.sku}</span>
                                                        <span className="text-zinc-500 dark:text-zinc-400">{a.message}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Variant orders modal — triggered by VelocityRow */}
            {selectedVariantOrders && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col border border-zinc-200 dark:border-zinc-800">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
                            <h2 className="text-lg font-bold text-zinc-800 dark:text-white flex items-center gap-2">
                                <Package className="w-5 h-5 text-emerald-500" />
                                Comenzi pentru SKU: {selectedVariantOrders.sku}
                            </h2>
                            <button onClick={() => setSelectedVariantOrders(null)} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors text-zinc-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-6">
                            {selectedVariantOrders.orders.length === 0 ? (
                                <div className="text-center py-12 text-zinc-500">Nicio comandă găsită pentru acest SKU.</div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="bg-zinc-50 dark:bg-zinc-800/50 sticky top-0">
                                        <tr className="text-zinc-500 dark:text-zinc-400">
                                            <th className="text-left px-4 py-3 font-semibold">Comandă</th>
                                            <th className="text-left px-4 py-3 font-semibold">Dată</th>
                                            <th className="text-left px-4 py-3 font-semibold">Magazin</th>
                                            <th className="text-left px-4 py-3 font-semibold">Status</th>
                                            <th className="text-left px-4 py-3 font-semibold">Produs Line Item</th>
                                            <th className="text-right px-4 py-3 font-semibold">Cant.</th>
                                            <th className="text-right px-4 py-3 font-semibold">Preț</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                        {selectedVariantOrders.orders.map((o, i) => (
                                            <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                                <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">{o.order_number}</td>
                                                <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{o.date ? o.date.slice(0, 16).replace('T', ' ') : '—'}</td>
                                                <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{o.store_name}</td>
                                                <td className="px-4 py-2.5">
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                                                        {o.status}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400 max-w-[200px] truncate" title={o.item_name}>{o.item_name}</td>
                                                <td className="px-4 py-2.5 text-right font-medium text-zinc-900 dark:text-zinc-100">{o.qty}</td>
                                                <td className="px-4 py-2.5 text-right text-zinc-600 dark:text-zinc-400">{o.price.toLocaleString()} RON</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
