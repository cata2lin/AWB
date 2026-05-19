/**
 * DetailedPnl — Per-store detailed P&L with granular cost breakdowns.
 * Shows every available metric per store: income splits, COGS, operational
 * line items, marketing channels, fixed costs, status breakdown, and margins.
 */
import React, { useState, useCallback, useMemo } from 'react'
import { BarChart3, RefreshCw, Search, X, ChevronDown, ChevronRight, Info, Download } from 'lucide-react'
import { exportCsv } from '../utils/csvExport'

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmt = (v) => {
    if (v === null || v === undefined || v === '') return ''
    const num = typeof v === 'string' ? parseFloat(v) : v
    if (isNaN(num)) return ''
    return new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(Math.round(num))
}
const fmtDec = (v) => {
    if (v === null || v === undefined || v === '') return ''
    const num = typeof v === 'string' ? parseFloat(v) : v
    if (isNaN(num)) return ''
    return new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num)
}
const fmtPct = (v) => {
    if (v === null || v === undefined || v === '') return ''
    const num = typeof v === 'number' ? v : parseFloat(v)
    if (isNaN(num)) return ''
    return `${num.toFixed(1)}%`
}

// ─── Metric Row ──────────────────────────────────────────────────────────────
const MetricRow = ({ label, cuTva, faraTva, indent = false, bold = false, negative = false, highlight = false, pct }) => {
    const valClass = negative ? 'text-red-600 dark:text-red-400' : highlight ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-800 dark:text-zinc-200'
    const labelClass = bold ? 'font-semibold text-zinc-800 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400'
    return (
        <tr className={`border-b border-zinc-100 dark:border-zinc-800 ${bold ? 'bg-zinc-50/50 dark:bg-zinc-800/30' : ''} hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors`}>
            <td className={`py-1.5 px-3 text-[13px] ${labelClass} ${indent ? 'pl-8' : ''}`}>{label}</td>
            <td className={`py-1.5 px-3 text-right text-[13px] ${valClass} font-mono`}>{cuTva !== undefined ? fmtDec(cuTva) : ''}</td>
            <td className={`py-1.5 px-3 text-right text-[13px] ${valClass} font-mono`}>{faraTva !== undefined ? fmtDec(faraTva) : ''}</td>
            {pct !== undefined ? (
                <td className={`py-1.5 px-3 text-right text-[13px] font-medium ${highlight ? 'text-emerald-600 dark:text-emerald-400' : negative ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>{fmtPct(pct)}</td>
            ) : (
                <td className="py-1.5 px-3"></td>
            )}
        </tr>
    )
}

const SectionHeader = ({ label, icon }) => (
    <tr className="bg-blue-600 dark:bg-blue-700">
        <td colSpan={4} className="text-white font-bold py-2 px-3 text-sm">{icon} {label}</td>
    </tr>
)

const Spacer = () => <tr className="h-2"><td colSpan={4}></td></tr>

// ─── Store Card ──────────────────────────────────────────────────────────────
const StoreCard = ({ store }) => {
    const [expanded, setExpanded] = useState(true)
    const inc = store.income || {}
    const cogs = store.cogs || {}
    const op = store.operational || {}
    const mkt = store.marketing || {}
    const fc = store.fixed_costs || {}
    const sb = store.status_breakdown || {}
    const gp = store.gross_profit || {}
    const opProfit = store.operating_profit || {}
    const netProfit = store.net_profit || {}

    const delivered = inc.delivered_count || 0
    const totalOrders = store.total_orders || 0
    const returnedCount = (sb.returned?.count || 0)
    const returnRate = totalOrders > 0 ? (returnedCount / totalOrders * 100) : 0
    const deliveryRate = totalOrders > 0 ? (delivered / totalOrders * 100) : 0
    const avgOrderValue = delivered > 0 ? ((inc.sales_delivered?.cu_tva || 0) / delivered) : 0

    const isGT = store.store_name?.toLowerCase().includes('georgetalent')

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden transition-colors">
            {/* Store Header */}
            <button onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-700 dark:to-blue-800 text-white hover:from-blue-700 hover:to-blue-800 transition-all">
                <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="font-bold text-sm">{store.store_name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-blue-100">
                    <span>{fmt(delivered)} livrate</span>
                    <span>•</span>
                    <span>Revenue: {fmt(inc.sales_delivered?.cu_tva || 0)} RON</span>
                    <span>•</span>
                    <span className={`font-semibold ${(netProfit?.fara_tva || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                        Net: {fmt(netProfit?.fara_tva || 0)} RON
                    </span>
                </div>
            </button>

            {expanded && (
                <div className="p-0">
                    {/* KPI Summary Bar */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-px bg-zinc-200 dark:bg-zinc-700 border-b border-zinc-200 dark:border-zinc-700">
                        {[
                            { label: 'Total Comenzi', value: fmt(totalOrders), color: 'text-zinc-800 dark:text-zinc-200' },
                            { label: 'Livrate', value: fmt(delivered), color: 'text-emerald-600 dark:text-emerald-400' },
                            { label: 'Returnate', value: fmt(returnedCount), color: 'text-red-600 dark:text-red-400' },
                            { label: 'Rată Returnare', value: fmtPct(returnRate), color: returnRate > 20 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400' },
                            { label: 'Rată Livrare', value: fmtPct(deliveryRate), color: 'text-blue-600 dark:text-blue-400' },
                            { label: 'AOV (cu TVA)', value: `${fmtDec(avgOrderValue)} RON`, color: 'text-violet-600 dark:text-violet-400' },
                            { label: 'Net Margin', value: fmtPct(store.net_margin_pct || 0), color: (store.net_margin_pct || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400' },
                        ].map((kpi, i) => (
                            <div key={i} className="bg-white dark:bg-zinc-900 px-3 py-2.5 text-center">
                                <div className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">{kpi.label}</div>
                                <div className={`text-sm font-bold ${kpi.color} mt-0.5`}>{kpi.value}</div>
                            </div>
                        ))}
                    </div>

                    {/* Detailed Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-[13px]">
                            <thead>
                                <tr className="bg-zinc-50 dark:bg-zinc-800/60">
                                    <th className="text-left py-1.5 px-3 font-semibold text-zinc-500 dark:text-zinc-400 border-b-2 border-zinc-200 dark:border-zinc-700 min-w-[280px]">Metric</th>
                                    <th className="text-right py-1.5 px-3 font-semibold text-zinc-500 dark:text-zinc-400 border-b-2 border-zinc-200 dark:border-zinc-700 min-w-[130px]">Cu TVA (RON)</th>
                                    <th className="text-right py-1.5 px-3 font-semibold text-zinc-500 dark:text-zinc-400 border-b-2 border-zinc-200 dark:border-zinc-700 min-w-[130px]">Fără TVA (RON)</th>
                                    <th className="text-right py-1.5 px-3 font-semibold text-zinc-500 dark:text-zinc-400 border-b-2 border-zinc-200 dark:border-zinc-700 min-w-[80px]">%</th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* INCOME */}
                                <SectionHeader label="VENITURI" icon="📈" />
                                <MetricRow label="Vânzări Brute (toate comenzile)" cuTva={inc.gross_sales?.cu_tva} faraTva={inc.gross_sales?.fara_tva} />
                                <MetricRow label="(-) Returnate / Anulate" cuTva={-(inc.returns_cancelled?.cu_tva || 0)} faraTva={-(inc.returns_cancelled?.fara_tva || 0)} negative indent />
                                <MetricRow label="Revenue Livrat" cuTva={inc.sales_delivered?.cu_tva} faraTva={inc.sales_delivered?.fara_tva} bold highlight />
                                <Spacer />

                                {/* COGS */}
                                <SectionHeader label="COGS (Cost of Goods Sold)" icon="📦" />
                                <MetricRow label="Cost Produse (SKU)" cuTva={-(cogs.sku_costs?.cu_tva || 0)} faraTva={-(cogs.sku_costs?.fara_tva || 0)} negative indent />
                                <MetricRow label="Total COGS" cuTva={-(cogs.total_cogs?.cu_tva || 0)} faraTva={-(cogs.total_cogs?.fara_tva || 0)} bold negative />
                                <Spacer />

                                {/* GROSS PROFIT */}
                                <SectionHeader label="PROFIT BRUT" icon="💰" />
                                <MetricRow label="Gross Profit" cuTva={gp.cu_tva} faraTva={gp.fara_tva} bold highlight={(gp.fara_tva || 0) >= 0} negative={(gp.fara_tva || 0) < 0} pct={store.gross_margin_pct} />
                                <Spacer />

                                {/* OPERATIONAL */}
                                <SectionHeader label="COSTURI OPERAȚIONALE" icon="🏢" />
                                <MetricRow label="Transport (Last Mile)" cuTva={-(op.shipping?.cu_tva || 0)} faraTva={-(op.shipping?.fara_tva || 0)} negative indent />
                                <MetricRow label="Procesare Plăți" cuTva={-(op.payment_fee?.cu_tva || 0)} faraTva={-(op.payment_fee?.fara_tva || 0)} negative indent />
                                {isGT && <MetricRow label="GT Commission (5%)" cuTva={-(op.gt_commission?.cu_tva || 0)} faraTva={-(op.gt_commission?.fara_tva || 0)} negative indent />}
                                <MetricRow label="Total Operațional" cuTva={-(op.total_operational?.cu_tva || 0)} faraTva={-(op.total_operational?.fara_tva || 0)} bold negative />
                                <Spacer />

                                {/* OPERATING PROFIT */}
                                <SectionHeader label="PROFIT OPERAȚIONAL" icon="📊" />
                                <MetricRow label="Operating Profit" cuTva={opProfit.cu_tva} faraTva={opProfit.fara_tva} bold highlight={(opProfit.fara_tva || 0) >= 0} negative={(opProfit.fara_tva || 0) < 0} pct={store.operating_margin_pct} />
                                <Spacer />

                                {/* MARKETING */}
                                <SectionHeader label="MARKETING" icon="📣" />
                                <MetricRow label="Facebook Ads" cuTva={-(mkt.facebook?.cu_tva || 0)} faraTva={-(mkt.facebook?.fara_tva || 0)} negative indent />
                                <MetricRow label="TikTok Ads" cuTva={-(mkt.tiktok?.cu_tva || 0)} faraTva={-(mkt.tiktok?.fara_tva || 0)} negative indent />
                                <MetricRow label="Google Ads" cuTva={-(mkt.google?.cu_tva || 0)} faraTva={-(mkt.google?.fara_tva || 0)} negative indent />
                                <MetricRow label="Total Marketing" cuTva={-(mkt.total?.cu_tva || 0)} faraTva={-(mkt.total?.fara_tva || 0)} bold negative />
                                <Spacer />

                                {/* FIXED COSTS */}
                                {(fc.total?.cu_tva || 0) > 0 && (
                                    <>
                                        <SectionHeader label="COSTURI FIXE" icon="🏠" />
                                        <MetricRow label="Total Costuri Fixe" cuTva={-(fc.total?.cu_tva || 0)} faraTva={-(fc.total?.fara_tva || 0)} bold negative />
                                        <Spacer />
                                    </>
                                )}

                                {/* NET PROFIT */}
                                <tr className="bg-gradient-to-r from-emerald-50 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20 border-y-2 border-emerald-200 dark:border-emerald-800">
                                    <td className="py-2.5 px-3 text-sm font-bold text-emerald-800 dark:text-emerald-300">🏆 PROFIT NET</td>
                                    <td className={`py-2.5 px-3 text-right text-sm font-bold font-mono ${(netProfit.cu_tva || 0) >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>{fmtDec(netProfit.cu_tva)}</td>
                                    <td className={`py-2.5 px-3 text-right text-sm font-bold font-mono ${(netProfit.fara_tva || 0) >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>{fmtDec(netProfit.fara_tva)}</td>
                                    <td className={`py-2.5 px-3 text-right text-sm font-bold ${(store.net_margin_pct || 0) >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>{fmtPct(store.net_margin_pct)}</td>
                                </tr>

                                {/* STATUS BREAKDOWN */}
                                {Object.keys(sb).length > 0 && (
                                    <>
                                        <Spacer />
                                        <SectionHeader label="STATUS COMENZI" icon="📋" />
                                        {sb.in_transit && <MetricRow label={`În Tranzit (${sb.in_transit.count})`} cuTva={sb.in_transit.revenue?.cu_tva} faraTva={sb.in_transit.revenue?.fara_tva} indent />}
                                        {sb.returned && <MetricRow label={`Returnate (${sb.returned.count})`} cuTva={sb.returned.revenue?.cu_tva} faraTva={sb.returned.revenue?.fara_tva} indent negative />}
                                        {sb.cancelled && <MetricRow label={`Anulate (${sb.cancelled.count})`} cuTva={sb.cancelled.revenue?.cu_tva} faraTva={sb.cancelled.revenue?.fara_tva} indent negative />}
                                        {sb.other && <MetricRow label={`Altele (${sb.other.count})`} cuTva={sb.other.revenue?.cu_tva} faraTva={sb.other.revenue?.fara_tva} indent />}
                                    </>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function DetailedPnl({ authFetch }) {
    const [period, setPeriod] = useState('lastMonth')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [storeSearch, setStoreSearch] = useState('')

    const API_URL = import.meta.env.VITE_API_URL || '/api'

    /** Build date params from the selected period. */
    const getDateParams = useCallback(() => {
        const now = new Date()
        const pad = (n) => String(n).padStart(2, '0')
        if (period === 'thisMonth') {
            const y = now.getFullYear(), m = now.getMonth() + 1
            return `date_from=${y}-${pad(m)}-01&date_to=${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`
        }
        if (period === 'lastMonth') {
            const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
            const y = d.getFullYear(), m = d.getMonth() + 1
            return `date_from=${y}-${pad(m)}-01&date_to=${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`
        }
        if (period === '30d') return `days=30`
        if (period === '90d') return `days=90`
        if (period === 'custom' && dateFrom && dateTo) return `date_from=${dateFrom}&date_to=${dateTo}`
        return `days=30`
    }, [period, dateFrom, dateTo])

    const fetchData = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await authFetch(`${API_URL}/analytics/profitability?${getDateParams()}`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setData(json)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [authFetch, API_URL, getDateParams])

    const stores = useMemo(() => {
        if (!data?.pnl_by_store) return []
        let list = data.pnl_by_store.filter(s => (s.total_orders || s.income?.delivered_count || 0) > 0)
        if (storeSearch) {
            list = list.filter(s => s.store_name?.toLowerCase().includes(storeSearch.toLowerCase()))
        }
        return list
    }, [data, storeSearch])

    const totalStores = data?.pnl_by_store?.filter(s => (s.total_orders || s.income?.delivered_count || 0) > 0).length || 0

    return (
        <div className="space-y-5">
            {/* Period Selector */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 transition-colors">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mr-1">Perioadă:</span>
                    {[
                        { key: 'thisMonth', label: 'Luna curentă' },
                        { key: 'lastMonth', label: 'Luna trecută' },
                        { key: '30d', label: '30 zile' },
                        { key: '90d', label: '90 zile' },
                    ].map(p => (
                        <button key={p.key} onClick={() => { setPeriod(p.key); setDateFrom(''); setDateTo('') }}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${period === p.key
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}>
                            {p.label}
                        </button>
                    ))}

                    <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700 mx-1" />

                    <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPeriod('custom') }}
                        className="px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 dark:[color-scheme:dark]" />
                    <span className="text-zinc-400">→</span>
                    <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPeriod('custom') }}
                        className="px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 dark:[color-scheme:dark]" />

                    <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700 mx-1" />

                    <button onClick={fetchData} disabled={loading}
                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5">
                        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                        Analizează
                    </button>
                </div>
            </div>

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                    <span className="ml-3 text-zinc-500 dark:text-zinc-400">Se încarcă datele detaliate...</span>
                </div>
            )}

            {/* Error */}
            {error && !loading && (
                <div className="text-center py-10 text-red-500 dark:text-red-400">
                    <p className="font-medium">Eroare</p>
                    <p className="text-sm mt-1">{error}</p>
                </div>
            )}

            {/* Empty */}
            {!data && !loading && !error && (
                <div className="text-center py-16 text-zinc-500 dark:text-zinc-400">
                    <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-lg font-medium">Selectează o perioadă și apasă Analizează</p>
                    <p className="text-sm mt-1">P&L detaliat per magazin va fi generat.</p>
                </div>
            )}

            {/* Data */}
            {data && !loading && (
                <>
                    {/* Search + count */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                            <input type="text" placeholder="Caută magazin..."
                                value={storeSearch} onChange={e => setStoreSearch(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-colors" />
                            {storeSearch && (
                                <button onClick={() => setStoreSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {storeSearch ? `${stores.length} / ${totalStores} magazine` : `${totalStores} magazine`}
                        </span>
                        <button
                            onClick={() => {
                                const rows = stores.flatMap((s) => {
                                    const inc = s.income || {}, cogs = s.cogs || {}, op = s.operational || {}, mkt = s.marketing || {}, gp = s.gross_profit || {}, opp = s.operating_profit || {}, net = s.net_profit || {}
                                    const m = (label, cu, fara) => ({ store: s.store_name, metric: label, cu_tva: cu, fara_tva: fara })
                                    return [
                                        m('Vânzări Brute',         inc.gross_sales?.cu_tva,        inc.gross_sales?.fara_tva),
                                        m('Returnate / Anulate',   -(inc.returns_cancelled?.cu_tva || 0), -(inc.returns_cancelled?.fara_tva || 0)),
                                        m('Revenue Livrat',        inc.sales_delivered?.cu_tva,    inc.sales_delivered?.fara_tva),
                                        m('Cost Produse (COGS)',   -(cogs.total_cogs?.cu_tva || 0), -(cogs.total_cogs?.fara_tva || 0)),
                                        m('Gross Profit',          gp.cu_tva,                       gp.fara_tva),
                                        m('Transport',             -(op.shipping?.cu_tva || 0),    -(op.shipping?.fara_tva || 0)),
                                        m('Procesare Plăți',       -(op.payment_fee?.cu_tva || 0), -(op.payment_fee?.fara_tva || 0)),
                                        m('Operating Profit',      opp.cu_tva,                      opp.fara_tva),
                                        m('Total Marketing',       -(mkt.total?.cu_tva || 0),       -(mkt.total?.fara_tva || 0)),
                                        m('Profit Net',            net.cu_tva,                      net.fara_tva),
                                    ]
                                })
                                exportCsv({
                                    filename: 'pnl_detaliat',
                                    columns: [
                                        { key: 'store',    label: 'Magazin' },
                                        { key: 'metric',   label: 'Indicator' },
                                        { key: 'cu_tva',   label: 'Cu TVA (RON)',   format: (v) => v == null ? '' : Math.round(v) },
                                        { key: 'fara_tva', label: 'Fără TVA (RON)', format: (v) => v == null ? '' : Math.round(v) },
                                    ],
                                    rows,
                                })
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                            title="Descarcă CSV cu P&L pentru toate magazinele">
                            <Download className="w-4 h-4" /> CSV
                        </button>
                        <div className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded ml-auto">
                            <Info size={10} /> Valori în RON • Cu TVA + Fără TVA
                        </div>
                    </div>

                    {/* Store Cards */}
                    <div className="space-y-4">
                        {stores.map(store => (
                            <StoreCard key={store.store_uid} store={store} />
                        ))}
                    </div>

                    {stores.length === 0 && (
                        <div className="text-center py-10 text-zinc-400 dark:text-zinc-500">
                            <p>Niciun magazin găsit{storeSearch ? ` pentru "${storeSearch}"` : ''}.</p>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
