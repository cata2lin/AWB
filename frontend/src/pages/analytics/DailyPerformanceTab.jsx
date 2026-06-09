import { useEffect, useState, useCallback, useMemo } from 'react'
import {
    ChevronLeft, ChevronRight, CalendarDays, TrendingUp, TrendingDown,
    Truck, ShoppingCart, Wallet, Target, Store as StoreIcon, X, Package, Award,
} from 'lucide-react'
import {
    ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
    Tooltip,
} from 'recharts'
import { authFetch, API_URL } from '../../utils/authFetch'
import { toastError } from '../../utils/toast'
import { formatNumber, getRateColor, getRateBgColor } from '../../utils/analyticsHelpers'
import MultiSelectFilter from '../../components/MultiSelectFilter'

// Format a local Date as YYYY-MM-DD without UTC shift (mirrors DeliverabilityTab).
const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const ron = (n) => `${formatNumber(Math.round(n || 0))} lei`

const addDays = (dateStr, n) => {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    dt.setDate(dt.getDate() + n)
    return fmtLocal(dt)
}

// Percentage delta between two numbers. Returns null when there's no baseline.
const pctDelta = (cur, prev) => {
    if (prev === 0 || prev == null) return cur > 0 ? null : 0
    return ((cur - prev) / Math.abs(prev)) * 100
}

function DeltaBadge({ delta, invert = false }) {
    if (delta === null || delta === undefined) {
        return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 dark:text-violet-400">nou</span>
    }
    if (Math.round(delta * 10) / 10 === 0) {
        return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">~ 0%</span>
    }
    const up = delta > 0
    const good = invert ? !up : up
    const cls = good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
    const Icon = up ? TrendingUp : TrendingDown
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${cls}`}>
            <Icon className="w-3 h-3" />{Math.abs(delta).toFixed(1)}%
        </span>
    )
}

function Sparkline({ data, dataKey, color }) {
    if (!data || data.length === 0) {
        return <div className="h-10" />
    }
    return (
        <div className="h-10 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    )
}

function KpiCard({ iconNode, label, value, delta, invertDelta, series, sparkKey, sparkColor, accent }) {
    return (
        <div className="relative bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4" style={{ borderLeftColor: accent }}>
            <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                    {iconNode} {label}
                </div>
                <DeltaBadge delta={delta} invert={invertDelta} />
            </div>
            <div className="text-2xl font-bold text-zinc-900 dark:text-white mt-1 tracking-tight">{value}</div>
            <Sparkline data={series} dataKey={sparkKey} color={sparkColor} />
        </div>
    )
}

export default function DailyPerformanceTab({ stores = [] }) {
    const [date, setDate] = useState(() => fmtLocal(new Date()))
    const [selectedBrands, setSelectedBrands] = useState([])
    const [today, setToday] = useState(null)
    const [yesterday, setYesterday] = useState(null)
    const [range, setRange] = useState(null)
    const [loading, setLoading] = useState(false)
    const [expanded, setExpanded] = useState({})
    const [modal, setModal] = useState(null) // { store_uid, brand }
    const [modalData, setModalData] = useState(null)
    const [modalLoading, setModalLoading] = useState(false)

    const storeOptions = useMemo(
        () => (stores || []).map((s) => ({ value: s.uid, label: s.name })),
        [stores],
    )

    const buildParams = useCallback((d) => {
        const params = new URLSearchParams()
        params.set('date', d)
        if (selectedBrands.length > 0) params.set('store_uids', selectedBrands.join(','))
        return params
    }, [selectedBrands])

    const fetchAll = useCallback(async () => {
        setLoading(true)
        try {
            const prevDate = addDays(date, -1)
            const rangeParams = new URLSearchParams()
            rangeParams.set('date_from', addDays(date, -6))
            rangeParams.set('date_to', date)
            if (selectedBrands.length > 0) rangeParams.set('store_uids', selectedBrands.join(','))

            const [tRes, yRes, rRes] = await Promise.all([
                authFetch(`${API_URL}/analytics/daily-perf?${buildParams(date)}`),
                authFetch(`${API_URL}/analytics/daily-perf?${buildParams(prevDate)}`),
                authFetch(`${API_URL}/analytics/daily-perf/range?${rangeParams}`),
            ])
            if (!tRes.ok) throw new Error(`HTTP ${tRes.status}`)
            setToday(await tRes.json())
            setYesterday(yRes.ok ? await yRes.json() : null)
            setRange(rRes.ok ? await rRes.json() : null)
        } catch (err) {
            toastError(err)
            console.error('Failed to fetch daily performance:', err)
        } finally {
            setLoading(false)
        }
    }, [date, selectedBrands, buildParams])

    useEffect(() => { fetchAll() }, [fetchAll])

    // ── Date navigation (named handlers, no inline mutations) ──
    const handlePrevDay = () => setDate((d) => addDays(d, -1))
    const handleNextDay = () => setDate((d) => addDays(d, 1))
    const handleToday = () => setDate(fmtLocal(new Date()))
    const handleDateInput = (e) => { if (e.target.value) setDate(e.target.value) }

    const handleToggleExpand = (uid) => setExpanded((p) => ({ ...p, [uid]: !p[uid] }))

    const handleOpenTopProducts = async (store_uid, brand) => {
        setModal({ store_uid, brand })
        setModalData(null)
        setModalLoading(true)
        try {
            const params = new URLSearchParams()
            params.set('date', date)
            params.set('store_uid', store_uid)
            const res = await authFetch(`${API_URL}/analytics/daily-perf/top-products?${params}`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            setModalData(await res.json())
        } catch (err) {
            toastError(err)
        } finally {
            setModalLoading(false)
        }
    }
    const handleCloseModal = () => { setModal(null); setModalData(null) }

    const tTotals = today?.totals || {}
    const yTotals = yesterday?.totals || {}
    const series = range?.series || []
    const brands = today?.brands || []
    const isToday = date === fmtLocal(new Date())
    const isEmpty = !loading && (tTotals.comenzi || 0) === 0

    const dateLabel = useMemo(() => {
        try {
            const [y, m, d] = date.split('-').map(Number)
            return new Date(y, m - 1, d).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
        } catch { return date }
    }, [date])

    const revenueBarData = brands.slice(0, 12).map((b) => ({ name: b.brand, incasari: b.incasari }))

    // Top / bottom by delivered-rate (only brands with shipped volume).
    const ranked = [...brands].filter((b) => b.comenzi > 0).sort((a, b) => b.delivered_rate - a.delivered_rate)
    const topBrands = ranked.slice(0, 3)
    const bottomBrands = ranked.slice(-3).reverse()

    return (
        <div className="space-y-6 mt-4">
            {/* ── Date navigator + brand filter ── */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1">
                    <button onClick={handlePrevDay}
                        className="p-1.5 rounded-md text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        title="Ziua anterioară">
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-2 px-2">
                        <CalendarDays className="w-4 h-4 text-primary-500" />
                        <input type="date" value={date} onChange={handleDateInput}
                            className="bg-transparent text-sm text-zinc-900 dark:text-white dark:[color-scheme:dark] border-0 focus:outline-none cursor-pointer" />
                    </div>
                    <button onClick={handleNextDay}
                        className="p-1.5 rounded-md text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        title="Ziua următoare">
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
                <button onClick={handleToday} disabled={isToday}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${isToday
                        ? 'bg-primary-50 dark:bg-primary-500/20 border-primary-300 dark:border-primary-500 text-primary-700 dark:text-primary-300 cursor-default'
                        : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'}`}>
                    Azi
                </button>

                <span className="text-sm text-zinc-500 dark:text-zinc-400 capitalize">{dateLabel}</span>

                <div className="ml-auto flex items-center gap-2">
                    <MultiSelectFilter
                        label="Magazine"
                        options={storeOptions}
                        selected={selectedBrands}
                        onChange={setSelectedBrands}
                        icon={StoreIcon}
                        searchable
                        allLabel="Toate magazinele"
                    />
                    {loading && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-500" />}
                </div>
            </div>

            {isEmpty && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 px-6 py-12 text-center">
                    <CalendarDays className="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-600" />
                    <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                        Nicio comandă în {dateLabel}. Alege altă zi sau apasă pe ◀.
                    </p>
                </div>
            )}

            {!isEmpty && (
                <>
                    {/* ── KPI cards ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <KpiCard iconNode={<Wallet className="w-4 h-4 text-emerald-500" />} label="Încasări" accent="#10b981"
                            value={ron(tTotals.incasari)}
                            delta={pctDelta(tTotals.incasari || 0, yTotals.incasari || 0)}
                            series={series} sparkKey="incasari" sparkColor="#10b981" />
                        <KpiCard iconNode={<ShoppingCart className="w-4 h-4 text-indigo-500" />} label="Comenzi" accent="#6366f1"
                            value={formatNumber(tTotals.comenzi || 0)}
                            delta={pctDelta(tTotals.comenzi || 0, yTotals.comenzi || 0)}
                            series={series} sparkKey="comenzi" sparkColor="#6366f1" />
                        <KpiCard iconNode={<Truck className="w-4 h-4 text-blue-500" />} label="Livrate" accent="#3b82f6"
                            value={formatNumber(tTotals.livrate || 0)}
                            delta={pctDelta(tTotals.livrate || 0, yTotals.livrate || 0)}
                            series={series} sparkKey="livrate" sparkColor="#3b82f6" />
                        <KpiCard iconNode={<Target className="w-4 h-4 text-amber-500" />} label="AOV" accent="#f59e0b"
                            value={ron(tTotals.aov)}
                            delta={pctDelta(tTotals.aov || 0, yTotals.aov || 0)}
                            series={series.map(d => ({ ...d, aov: d.livrate > 0 ? d.incasari / d.livrate : 0 }))}
                            sparkKey="aov" sparkColor="#f59e0b" />
                    </div>

                    {/* ── Charts: revenue-by-brand bar + delivered-rate + top/bottom ── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Revenue by brand */}
                        <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
                            <h3 className="font-semibold text-zinc-900 dark:text-white text-sm mb-3 flex items-center gap-2">
                                <Wallet className="w-4 h-4 text-emerald-500" /> Încasări per Magazin
                            </h3>
                            {revenueBarData.length === 0 ? (
                                <p className="text-sm text-zinc-400 py-8 text-center">Fără date</p>
                            ) : (
                                <div style={{ height: Math.max(180, revenueBarData.length * 28) }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={revenueBarData} layout="vertical" margin={{ left: 10, right: 16, top: 0, bottom: 0 }}>
                                            <XAxis type="number" tick={{ fontSize: 11, fill: '#a1a1aa' }} tickFormatter={(v) => formatNumber(Math.round(v))} />
                                            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: '#a1a1aa' }} />
                                            <Tooltip
                                                formatter={(v) => [ron(v), 'Încasări']}
                                                contentStyle={{ background: '#27272a', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12, color: '#fff' }}
                                            />
                                            <Bar dataKey="incasari" radius={[0, 4, 4, 0]} fill="#10b981" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>

                        {/* Delivered-rate bars + top/bottom cards */}
                        <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 space-y-4">
                            <div>
                                <h3 className="font-semibold text-zinc-900 dark:text-white text-sm mb-3 flex items-center gap-2">
                                    <Truck className="w-4 h-4 text-blue-500" /> Rată Livrare per Magazin
                                </h3>
                                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                                    {ranked.map((b) => (
                                        <div key={b.store_uid} className="flex items-center gap-2 text-xs">
                                            <span className="w-28 truncate text-zinc-700 dark:text-zinc-200">{b.brand}</span>
                                            <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-600 rounded-full overflow-hidden">
                                                <div className={`h-full ${getRateBgColor(b.delivered_rate)}`}
                                                    style={{ width: `${Math.min(b.delivered_rate, 100)}%` }} />
                                            </div>
                                            <span className={`w-10 text-right font-medium ${getRateColor(b.delivered_rate)}`}>{b.delivered_rate}%</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-700">
                                <div>
                                    <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mb-1">
                                        <Award className="w-3.5 h-3.5" /> Top livrare
                                    </div>
                                    {topBrands.map((b) => (
                                        <div key={b.store_uid} className="flex justify-between text-xs text-zinc-600 dark:text-zinc-300">
                                            <span className="truncate">{b.brand}</span>
                                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{b.delivered_rate}%</span>
                                        </div>
                                    ))}
                                </div>
                                <div>
                                    <div className="text-[11px] font-semibold text-red-600 dark:text-red-400 flex items-center gap-1 mb-1">
                                        <TrendingDown className="w-3.5 h-3.5" /> De urmărit
                                    </div>
                                    {bottomBrands.map((b) => (
                                        <div key={b.store_uid} className="flex justify-between text-xs text-zinc-600 dark:text-zinc-300">
                                            <span className="truncate">{b.brand}</span>
                                            <span className="text-red-600 dark:text-red-400 font-medium">{b.delivered_rate}%</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Brand table (expandable) ── */}
                    <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden shadow-sm">
                        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
                            <h3 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2 tracking-tight">
                                <StoreIcon className="w-5 h-5 text-primary-500" /> Performanță per Magazin
                            </h3>
                        </div>
                        <div className="overflow-auto max-h-[70vh]">
                            <table className="w-full">
                                <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                    <tr>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Magazin</th>
                                        <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Încasări</th>
                                        <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Comenzi</th>
                                        <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Livrate</th>
                                        <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">AOV</th>
                                        <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase" title="Cheltuieli reclame (FB+TikTok+Google) — sursa AWB">Marketing</th>
                                        <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase" title="Return on ad spend (încasări / marketing)">ROAS</th>
                                        <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase" title="Cost pe livrare (marketing / livrate)">CPA</th>
                                        <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Rată Livrare</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                                    {brands.map((b) => (
                                        <tr key={b.store_uid} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30">
                                            <td className="px-4 py-3 text-sm font-medium text-zinc-900 dark:text-white">
                                                <button onClick={() => handleToggleExpand(b.store_uid)}
                                                    className="inline-flex items-center gap-1.5 hover:text-primary-600 dark:hover:text-primary-400">
                                                    {expanded[b.store_uid] ? <ChevronRight className="w-3.5 h-3.5 rotate-90 transition-transform" /> : <ChevronRight className="w-3.5 h-3.5 transition-transform" />}
                                                    {b.brand}
                                                </button>
                                            </td>
                                            <td className="px-3 py-3 text-sm text-right text-emerald-600 dark:text-emerald-400 font-medium">{ron(b.incasari)}</td>
                                            <td className="px-3 py-3 text-sm text-right">
                                                <button onClick={() => handleOpenTopProducts(b.store_uid, b.brand)}
                                                    className="text-zinc-700 dark:text-zinc-100 border-b border-dashed border-primary-400 hover:text-primary-600 dark:hover:text-primary-400"
                                                    title="Vezi top produse">
                                                    {formatNumber(b.comenzi)}
                                                </button>
                                            </td>
                                            <td className="px-3 py-3 text-sm text-right text-blue-600 dark:text-blue-400">{formatNumber(b.livrate)}</td>
                                            <td className="px-3 py-3 text-sm text-right text-zinc-700 dark:text-zinc-100">{ron(b.aov)}</td>
                                            <td className="px-3 py-3 text-sm text-right text-blue-600 dark:text-blue-400" title={b.total_spend ? `FB ${ron(b.fb_spend || 0)} · TikTok ${ron(b.tk_spend || 0)}` : undefined}>{b.total_spend ? ron(b.total_spend) : '—'}</td>
                                            <td className="px-3 py-3 text-sm text-right">
                                                {b.roas != null
                                                    ? <span className={b.roas >= 3 ? 'text-emerald-600 dark:text-emerald-400 font-medium' : b.roas >= 1.5 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400 font-medium'}>{b.roas.toFixed(1)}×</span>
                                                    : <span className="text-zinc-400">—</span>}
                                            </td>
                                            <td className="px-3 py-3 text-sm text-right text-zinc-700 dark:text-zinc-100">{b.cpa != null ? ron(b.cpa) : '—'}</td>
                                            <td className="px-3 py-3 text-sm text-right">
                                                <span className={getRateColor(b.delivered_rate)}>{b.delivered_rate}%</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-zinc-50 dark:bg-zinc-900 font-semibold border-t-2 border-zinc-200 dark:border-zinc-700">
                                        <td className="px-4 py-3 text-sm text-zinc-900 dark:text-white">TOTAL</td>
                                        <td className="px-3 py-3 text-sm text-right text-emerald-600 dark:text-emerald-400">{ron(tTotals.incasari)}</td>
                                        <td className="px-3 py-3 text-sm text-right text-zinc-900 dark:text-white">{formatNumber(tTotals.comenzi || 0)}</td>
                                        <td className="px-3 py-3 text-sm text-right text-blue-600 dark:text-blue-400">{formatNumber(tTotals.livrate || 0)}</td>
                                        <td className="px-3 py-3 text-sm text-right text-zinc-900 dark:text-white">{ron(tTotals.aov)}</td>
                                        <td className="px-3 py-3 text-sm text-right text-blue-600 dark:text-blue-400">{tTotals.total_spend ? ron(tTotals.total_spend) : '—'}</td>
                                        <td className="px-3 py-3 text-sm text-right text-zinc-900 dark:text-white">{tTotals.roas != null ? `${tTotals.roas.toFixed(1)}×` : '—'}</td>
                                        <td className="px-3 py-3 text-sm text-right text-zinc-900 dark:text-white">{tTotals.cpa != null ? ron(tTotals.cpa) : '—'}</td>
                                        <td className="px-3 py-3 text-sm text-right">
                                            <span className={getRateColor(tTotals.delivered_rate || 0)}>{tTotals.delivered_rate || 0}%</span>
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* ── Top-products modal ── */}
            {modal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={handleCloseModal}>
                    <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
                        onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
                            <h3 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                                <Package className="w-4 h-4 text-primary-500" />
                                Top Produse — <span className="text-primary-600 dark:text-primary-400">{modal.brand}</span>
                            </h3>
                            <button onClick={handleCloseModal} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto">
                            {modalLoading && <div className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-6">Se încarcă…</div>}
                            {!modalLoading && (!modalData?.products || modalData.products.length === 0) && (
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-6">Niciun produs livrat în această zi.</p>
                            )}
                            {!modalLoading && modalData?.products?.length > 0 && (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-700">
                                            <th className="text-left pb-2 font-medium">Produs</th>
                                            <th className="text-right pb-2 font-medium">Buc</th>
                                            <th className="text-right pb-2 font-medium">Încasări</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/60">
                                        {modalData.products.map((p) => (
                                            <tr key={p.sku}>
                                                <td className="py-2.5 text-zinc-800 dark:text-zinc-100">
                                                    <div className="font-medium leading-tight">{p.name || p.sku}</div>
                                                    <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{p.sku}</div>
                                                </td>
                                                <td className="py-2.5 text-right font-semibold text-primary-600 dark:text-primary-400">{formatNumber(p.units)}</td>
                                                <td className="py-2.5 text-right text-zinc-700 dark:text-zinc-200">{ron(p.revenue)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
