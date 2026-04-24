/**
 * ContributionMarginPnl — Production-grade Contribution Margin P&L component.
 *
 * Features:
 * - Multi-period (quarterly) + single-month view modes
 * - Full dark mode support
 * - European number formatting (ro-RO)
 * - Aligned status mapping with deliverability tab
 * - KPI scorecards with trend indicators
 * - Per-subsidiary breakdowns (COVORIA, MAGDEAL, BONHAUS)
 */
import React, { useState, useCallback, useMemo } from 'react'
import { BarChart3, RefreshCw, Calendar, Layers, TrendingUp, TrendingDown, Download, Info, Search, X } from 'lucide-react'

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmt = (v) => {
    if (v === null || v === undefined || v === '') return ''
    const num = typeof v === 'string' ? parseFloat(v) : v
    if (isNaN(num)) return ''
    return new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(Math.round(num))
}

const fmtPct = (v) => {
    if (v === null || v === undefined || v === '') return ''
    const num = typeof v === 'number' ? v : parseFloat(v)
    if (isNaN(num)) return ''
    return `${Math.round(num)}%`
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
const KpiCard = ({ label, value, trend, trendLabel, color = 'blue', format = 'currency' }) => {
    const themes = {
        blue:   { light: 'border-blue-200 bg-blue-50/60',   dark: 'dark:border-blue-800 dark:bg-blue-950/40',   text: 'text-blue-700 dark:text-blue-300' },
        green:  { light: 'border-green-200 bg-green-50/60',  dark: 'dark:border-green-800 dark:bg-green-950/40',  text: 'text-green-700 dark:text-green-300' },
        violet: { light: 'border-violet-200 bg-violet-50/60',dark: 'dark:border-violet-800 dark:bg-violet-950/40',text: 'text-violet-700 dark:text-violet-300' },
        red:    { light: 'border-red-200 bg-red-50/60',     dark: 'dark:border-red-800 dark:bg-red-950/40',     text: 'text-red-600 dark:text-red-400' },
        amber:  { light: 'border-amber-200 bg-amber-50/60', dark: 'dark:border-amber-800 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300' },
    }
    const t = themes[color] || themes.blue
    const isNeg = typeof value === 'number' && value < 0

    let displayValue = value
    if (format === 'currency' && typeof value === 'number') displayValue = fmt(value)
    else if (format === 'number' && typeof value === 'number') displayValue = fmt(value)
    else if (format === 'percent') displayValue = typeof value === 'string' ? value : fmtPct(value)

    const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : null

    return (
        <div className={`rounded-xl border p-4 transition-colors ${t.light} ${t.dark}`}>
            <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">{label}</div>
            <div className={`text-xl font-bold ${isNeg ? 'text-red-600 dark:text-red-400' : t.text}`}>{displayValue}</div>
            {(trendLabel || TrendIcon) && (
                <div className={`flex items-center gap-1 mt-1.5 text-xs ${trend > 0 ? 'text-green-600 dark:text-green-400' : trend < 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                    {TrendIcon && <TrendIcon size={12} />}
                    <span>{trendLabel}</span>
                </div>
            )}
        </div>
    )
}

// ─── Table Row ───────────────────────────────────────────────────────────────
const CMRow = ({ type, label, values, colCount }) => {
    const cols = colCount || 4
    if (type === 'spacer') return <tr className="h-3"><td colSpan={cols + 1}></td></tr>

    if (type === 'header') {
        return (
            <tr className="bg-blue-600 dark:bg-blue-700">
                <td colSpan={cols + 1} className="text-white font-bold py-2 px-3 text-sm">{label}</td>
            </tr>
        )
    }
    if (type === 'section') {
        return (
            <tr className="bg-blue-50 dark:bg-blue-900/30">
                <td colSpan={cols + 1} className="text-blue-800 dark:text-blue-300 font-bold py-2 px-3 text-[13px] border-b border-blue-100 dark:border-blue-800">{label}</td>
            </tr>
        )
    }

    const isNeg = (v) => typeof v === 'number' && v < 0
    const fmtVal = type === 'percent' ? fmtPct : fmt

    const rowStyles = {
        subtotal: 'font-bold text-blue-700 dark:text-blue-300 border-t border-blue-200 dark:border-blue-700 border-b-2 border-b-blue-200 dark:border-b-blue-700',
        total: 'font-extrabold text-blue-800 dark:text-blue-200 border-t-2 border-t-blue-600 dark:border-t-blue-500 border-b-2 border-b-blue-600 dark:border-b-blue-500 text-sm',
        percent: 'italic text-blue-600 dark:text-blue-400 font-semibold text-xs',
        indent: '',
        normal: '',
    }
    const cls = rowStyles[type] || ''
    const pad = type === 'indent' ? 'pl-6' : type === 'subtotal' || type === 'total' ? 'pl-3 py-[7px]' : type === 'percent' ? 'pl-3 py-[3px]' : 'pl-3'

    return (
        <tr className={`hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors ${type === 'subtotal' || type === 'total' ? '' : 'border-b border-zinc-100 dark:border-zinc-800'}`}>
            <td className={`${pad} py-[5px] text-[13px] whitespace-nowrap min-w-[260px] text-zinc-700 dark:text-zinc-300 ${cls}`}>{label}</td>
            {(values || []).map((v, i) => (
                <td key={i} className={`px-3 py-[5px] text-[13px] text-right whitespace-nowrap ${cls} ${isNeg(v) && type !== 'percent' ? 'text-red-600 dark:text-red-400' : ''}`}>
                    {typeof v === 'string' ? v : fmtVal(v)}
                </td>
            ))}
        </tr>
    )
}

// ─── Section Builder ─────────────────────────────────────────────────────────
/** @param {object} entity - The store/group data object
 *  @param {string} [storeName] - Store name, used to conditionally show GT Commission */
const buildSectionRows = (entity, storeName = '') => {
    const { months = [], quarter, mom_growth = [] } = entity
    const vals = (key) => {
        const mv = months.map(m => m?.[key] ?? 0)
        if (quarter) mv.push(quarter[key] ?? 0)
        return mv
    }

    const isGTStore = storeName.toLowerCase().includes('georgetalent')

    const rows = []

    // Meta rows
    rows.push({ type: 'normal', label: 'FF Orders', values: vals('ff_orders') })

    // MoM Growth
    if (mom_growth.length > 0) {
        const momVals = [...mom_growth]
        if (quarter) {
            const firstRev = months[0]?.revenue_fara_tva || 0
            const lastRev = months[months.length - 1]?.revenue_fara_tva || 0
            momVals.push(firstRev > 0 ? Math.round((lastRev - firstRev) / firstRev * 100) : null)
        }
        rows.push({ type: 'normal', label: '% MoM Growth', values: momVals.map(v => v !== null && v !== undefined ? `${v}%` : '–') })
    }
    rows.push({ type: 'spacer' })

    // CM1
    rows.push({ type: 'section', label: 'CM1 — Product Margin' })
    rows.push({ type: 'subtotal', label: 'Revenue (fără TVA)', values: vals('revenue_fara_tva') })
    rows.push({ type: 'indent', label: 'COGS', values: vals('cogs_fara_tva').map(v => -Math.abs(v)) })
    rows.push({ type: 'subtotal', label: 'Gross Profit (CM1)', values: vals('gross_profit') })
    rows.push({ type: 'percent', label: 'GM %', values: vals('gm_pct') })
    rows.push({ type: 'spacer' })

    // CM2
    rows.push({ type: 'section', label: 'CM2 — Delivery Margin' })
    rows.push({ type: 'indent', label: 'Last Mile Delivery', values: vals('shipping_fara_tva').map(v => -Math.abs(v)) })
    rows.push({ type: 'indent', label: 'Payment Processing Fee', values: vals('payment_fee_fara_tva').map(v => -Math.abs(v)) })
    // GT Commission: only for georgetalent store — 5% of gross revenue cu TVA
    if (isGTStore) {
        rows.push({ type: 'indent', label: 'GT Commission (5%)', values: vals('gt_commission_fara_tva').map(v => { const a = Math.abs(v); return a > 0 ? -a : 0 }) })
    }
    rows.push({ type: 'subtotal', label: 'Operating Profit (CM2)', values: vals('operating_profit') })
    rows.push({ type: 'percent', label: 'OM %', values: vals('om_pct') })
    rows.push({ type: 'spacer' })

    // CM3
    rows.push({ type: 'section', label: 'CM3 — Fully Loaded Margin' })
    rows.push({ type: 'indent', label: 'Marketing', values: vals('marketing_fara_tva').map(v => -Math.abs(v)) })
    rows.push({ type: 'total', label: 'Contribution Margin (CM3)', values: vals('contribution_margin') })
    rows.push({ type: 'percent', label: 'NM %', values: vals('nm_pct') })
    rows.push({ type: 'spacer' })

    return rows
}

// ─── Period Selector ─────────────────────────────────────────────────────────
const PeriodSelector = ({ mode, setMode, selectedPeriod, onSelect, onFetch, loading }) => {
    const now = new Date()

    // Generate quarters
    const quarters = []
    for (let i = 0; i < 8; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1)
        const q = Math.ceil((d.getMonth() + 1) / 3)
        const y = d.getFullYear()
        const startMonth = (q - 1) * 3 + 1
        const months = [
            `${y}-${String(startMonth).padStart(2, '0')}`,
            `${y}-${String(startMonth + 1).padStart(2, '0')}`,
            `${y}-${String(startMonth + 2).padStart(2, '0')}`,
        ]
        quarters.push({ label: `Q${q} FY${y % 100}`, months: months.join(','), key: `${y}-Q${q}` })
    }

    // Generate individual months
    const monthsList = []
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const y = d.getFullYear()
        const m = d.getMonth() + 1
        const key = `${y}-${String(m).padStart(2, '0')}`
        const shortNames = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        monthsList.push({ label: `${shortNames[m - 1]} ${y}`, months: key, key })
    }

    const items = mode === 'quarter' ? quarters.slice(0, 6) : monthsList

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 transition-colors">
            <div className="flex flex-wrap items-center gap-2">
                {/* Mode toggle */}
                <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden mr-2">
                    <button onClick={() => setMode('quarter')}
                        className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${mode === 'quarter' ? 'bg-blue-600 text-white' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'}`}>
                        <Layers size={13} /> Trimestru
                    </button>
                    <button onClick={() => setMode('month')}
                        className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${mode === 'month' ? 'bg-blue-600 text-white' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'}`}>
                        <Calendar size={13} /> Lună
                    </button>
                </div>

                <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700 mx-1" />

                {/* Period buttons */}
                {items.map(p => (
                    <button key={p.key} onClick={() => onSelect(p)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${selectedPeriod?.key === p.key
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}>
                        {p.label}
                    </button>
                ))}

                <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700 mx-1" />

                <button onClick={onFetch} disabled={loading || !selectedPeriod}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5">
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                    Analizează
                </button>
            </div>
        </div>
    )
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function ContributionMarginPnl({ authFetch }) {
    const [mode, setMode] = useState('quarter')
    const [selectedPeriod, setSelectedPeriod] = useState(null)
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [storeSearch, setStoreSearch] = useState('')

    const API_URL = import.meta.env.VITE_API_URL || '/api'

    const fetchData = useCallback(async () => {
        if (!selectedPeriod) return
        setLoading(true)
        setError(null)
        try {
            const res = await authFetch(`${API_URL}/analytics/profitability/multi-period?months=${selectedPeriod.months}`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            if (json.error) throw new Error(json.error)
            setData(json)
        } catch (err) {
            console.error('Failed to fetch P&L:', err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [selectedPeriod, authFetch, API_URL])

    // Column headers
    const monthLabels = (data?.periods || []).map(m => {
        const fy = parseInt(m.substring(0, 4)) % 100
        const month = parseInt(m.substring(5, 7))
        return `M${month} FY${fy}`
    })
    const colHeaders = [...monthLabels]
    if (data?.consolidated?.quarter && (data?.periods?.length || 0) > 1) colHeaders.push(data.quarter_label || 'Quarter')
    const colCount = colHeaders.length

    // Latest month for KPI cards
    const latestMonth = data?.consolidated?.months?.[data.consolidated.months.length - 1]

    return (
        <div className="space-y-5">
            {/* Period Selector */}
            <PeriodSelector mode={mode} setMode={setMode} selectedPeriod={selectedPeriod}
                onSelect={p => { setSelectedPeriod(p); setData(null) }} onFetch={fetchData} loading={loading} />

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                    <span className="ml-3 text-zinc-500 dark:text-zinc-400">Se calculează profitabilitatea...</span>
                </div>
            )}

            {/* Error */}
            {error && !loading && (
                <div className="text-center py-10 text-red-500 dark:text-red-400">
                    <p className="font-medium">Eroare la încărcarea datelor</p>
                    <p className="text-sm mt-1">{error}</p>
                </div>
            )}

            {/* Empty */}
            {!data && !loading && !error && (
                <div className="text-center py-16 text-zinc-500 dark:text-zinc-400">
                    <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-lg font-medium">Selectează o perioadă și apasă Analizează</p>
                    <p className="text-sm mt-1">Raportul CM va fi generat pe baza perioadei selectate.</p>
                </div>
            )}

            {/* Data */}
            {data && !loading && (
                <>
                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">Contribution Margin P&L</h2>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                CM1 (Product) → CM2 (Delivery) → CM3 (Fully Loaded) • {mode === 'quarter' ? data.quarter_label : monthLabels[0]}
                            </p>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
                            <Info size={10} /> Valori în RON (Lei) • BGN/PLN/CZK convertite BNR
                        </div>
                    </div>

                    {/* KPI Cards */}
                    {latestMonth && (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            <KpiCard label="Net Revenue" value={latestMonth.revenue_fara_tva} color="blue"
                                trend={1} trendLabel={data.quarter_label} />
                            <KpiCard label="CM1 — Gross Profit" value={latestMonth.gross_profit} color="green"
                                trend={latestMonth.gm_pct > 0 ? 1 : -1} trendLabel={`GM ${fmtPct(latestMonth.gm_pct)}`} />
                            <KpiCard label="CM2 — Operating Profit" value={latestMonth.operating_profit} color="violet"
                                trend={latestMonth.om_pct > 0 ? 1 : -1} trendLabel={`OM ${fmtPct(latestMonth.om_pct)}`} />
                            <KpiCard label="CM3 — Net Profit" value={latestMonth.contribution_margin}
                                color={latestMonth.contribution_margin >= 0 ? 'green' : 'red'}
                                trend={latestMonth.contribution_margin >= 0 ? 1 : -1}
                                trendLabel={`NM ${fmtPct(latestMonth.nm_pct)}`} />
                            <KpiCard label="Delivered Orders" value={latestMonth.delivered_count} color="blue" format="number" />
                            <KpiCard label="Return Rate"
                                value={latestMonth.total_orders > 0
                                    ? `${Math.round((latestMonth.returned_count || 0) / latestMonth.total_orders * 100)}%`
                                    : '–'}
                                color="amber" format="percent" />
                        </div>
                    )}

                    {/* Store Search / Filter */}
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                            <input
                                type="text"
                                placeholder="Caută magazin..."
                                value={storeSearch}
                                onChange={e => setStoreSearch(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-colors"
                            />
                            {storeSearch && (
                                <button onClick={() => setStoreSearch('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">
                            {(() => {
                                const total = (data.subsidiaries || []).flatMap(s => s.stores || []).filter(s => s.months?.some(m => (m?.total_orders || 0) > 0)).length
                                const filtered = storeSearch
                                    ? (data.subsidiaries || []).flatMap(s => s.stores || []).filter(s => s.months?.some(m => (m?.total_orders || 0) > 0) && s.name.toLowerCase().includes(storeSearch.toLowerCase())).length
                                    : total
                                return storeSearch ? `${filtered} / ${total} magazine` : `${total} magazine`
                            })()}
                        </span>
                    </div>

                    {/* P&L Table */}
                    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden transition-colors">
                        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
                                Contribution Margin Statement — Lei / RON (fără TVA)
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-[13px]">
                                <thead>
                                    <tr>
                                        <th className="text-left py-1.5 px-3 font-semibold text-zinc-500 dark:text-zinc-400 border-b-2 border-zinc-200 dark:border-zinc-700 whitespace-nowrap min-w-[260px]"></th>
                                        {colHeaders.map((h, i) => (
                                            <th key={i} className="text-right py-1.5 px-3 font-semibold text-zinc-500 dark:text-zinc-400 border-b-2 border-zinc-200 dark:border-zinc-700 whitespace-nowrap min-w-[120px]">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* Flat list of all stores with blue headers */}
                                    {(data.subsidiaries || []).flatMap(sub =>
                                        (sub.stores || []).map(store => ({ ...store, subsidiary: sub.name }))
                                    )
                                    .filter(store => store.months?.some(m => (m?.total_orders || 0) > 0))
                                    .filter(store => !storeSearch || store.name.toLowerCase().includes(storeSearch.toLowerCase()))
                                    .map((store, storeIdx) => (
                                        <React.Fragment key={store.name}>
                                            {/* Delimiter between stores */}
                                            {storeIdx > 0 && (
                                                <tr><td colSpan={colCount + 1} className="h-2 bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200 dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-700"></td></tr>
                                            )}
                                            {/* Store blue header */}
                                            <CMRow type="header" label={store.name} colCount={colCount} />
                                            {buildSectionRows(store, store.name).map((row, i) => (
                                                <CMRow key={`${store.name}-${i}`} {...row} colCount={colCount} />
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Footnote */}
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-3">
                        * Margin % calculated on fără TVA (net) base. Marketing = NO_TVA. VAT: 19% pre-Aug 2025, 21% post-Aug 2025.
                        Status mapping aligned with deliverability tab (customer_pickup/in_parcel_locker = delivered).
                    </p>
                </>
            )}
        </div>
    )
}
