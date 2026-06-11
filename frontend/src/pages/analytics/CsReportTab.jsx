import { useEffect, useState } from 'react'
import { Headset, Truck, AlertTriangle, Store } from 'lucide-react'
import { authFetch, API_URL } from '../../utils/authFetch'
import { formatNumber } from '../../utils/analyticsHelpers'

const QUICK_PERIODS = [
    { key: '30d', label: '30 zile' },
    { key: '90d', label: '90 zile' },
    { key: 'thisMonth', label: 'Luna curentă' },
    { key: 'lastMonth', label: 'Luna trecută' },
]

const fmtLocal = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function resolvePeriod(period) {
    const now = new Date()
    if (period === '30d') {
        const d = new Date(now); d.setDate(d.getDate() - 30)
        return { dateFrom: fmtLocal(d), dateTo: fmtLocal(now) }
    }
    if (period === '90d') {
        const d = new Date(now); d.setDate(d.getDate() - 90)
        return { dateFrom: fmtLocal(d), dateTo: fmtLocal(now) }
    }
    if (period === 'thisMonth') {
        return {
            dateFrom: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
            dateTo: fmtLocal(now),
        }
    }
    // lastMonth
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    return { dateFrom: fmtLocal(lm), dateTo: fmtLocal(lmEnd) }
}

const ron = (n) => `${formatNumber(Math.round(n || 0))} lei`

// Mutually-exclusive status buckets (sum = total), matching the backend / Scripturi.
const BUCKETS = [
    { key: 'livrate', label: 'Livrate', cls: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'in_curs', label: 'În curs', cls: 'text-blue-600 dark:text-blue-400' },
    { key: 'neexpediate', label: 'Neexpediate', cls: 'text-zinc-500 dark:text-zinc-400' },
    { key: 'refuzate', label: 'Refuzate', cls: 'text-red-600 dark:text-red-400' },
    { key: 'anulate', label: 'Anulate', cls: 'text-amber-600 dark:text-amber-400' },
]

export default function CsReportTab({ selectedStores = [] }) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [period, setPeriod] = useState('lastMonth')

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            setLoading(true); setError(null)
            try {
                const { dateFrom, dateTo } = resolvePeriod(period)
                const params = new URLSearchParams()
                if (dateFrom && dateTo) { params.set('date_from', dateFrom); params.set('date_to', dateTo) }
                if (selectedStores.length) params.set('store_uids', selectedStores.join(','))
                const res = await authFetch(`${API_URL}/analytics/cs-report?${params}`)
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const json = await res.json()
                if (!cancelled) setData(json)
            } catch (e) {
                if (!cancelled) setError(e.message || 'Eroare la încărcare')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [period, selectedStores])

    const agents = data?.agents || []
    const totals = data?.totals || {}
    const isEmpty = !loading && (totals.orders || 0) === 0

    return (
        <div className="space-y-5 mt-4">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20 flex-shrink-0">
                    <Headset className="w-4 h-4 text-white" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Raport Agenți (Customer Service)</h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Comenzi și încasări per agent, identificat prin eticheta comenzii (tag)
                    </p>
                </div>
            </div>

            {/* Period selector */}
            <div className="flex flex-wrap gap-2">
                {QUICK_PERIODS.map((p) => (
                    <button
                        key={p.key}
                        onClick={() => setPeriod(p.key)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${period === p.key
                            ? 'bg-violet-600 text-white shadow-sm'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                            }`}
                    >
                        {p.label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Empty-state — explains a near-empty report instead of looking broken */}
            {isEmpty && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800 dark:text-amber-200">
                        <div className="font-semibold">Niciun agent etichetat în această perioadă</div>
                        <p className="mt-1 text-amber-700 dark:text-amber-300/90">
                            Se numără doar comenzile care poartă eticheta unui agent (din tag-urile Shopify, via Frisbo).
                        </p>
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                            Comenzi scanate: {formatNumber(data?.orders_scanned || 0)} · Etichete: {(data?.cs_tags || []).join(', ')}
                        </p>
                    </div>
                </div>
            )}

            {/* Frisbo tag-coverage caveat — shown whenever there IS data, so the
                Frisbo-limited counts aren't mistaken for the full CS workload. */}
            {!loading && !isEmpty && data?.data_note && (
                <div className="rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-4 py-2.5 flex gap-2.5 text-xs text-sky-800 dark:text-sky-300">
                    <AlertTriangle className="w-4 h-4 text-sky-500 flex-shrink-0 mt-0.5" />
                    <span>{data.data_note}</span>
                </div>
            )}

            {loading && (
                <div className="text-sm text-zinc-500 dark:text-zinc-400">Se încarcă…</div>
            )}

            {!loading && !isEmpty && (
                <>
                    {/* Per-agent summary cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {agents.filter((a) => a.total_orders > 0).map((a) => {
                            const rate = a.total_orders ? (a.delivered_orders / a.total_orders) * 100 : 0
                            return (
                                <div key={a.tag} className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-4">
                                    <div className="flex items-center justify-between">
                                        <span className="font-semibold text-zinc-900 dark:text-white">{a.tag}</span>
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatNumber(a.total_orders)} comenzi</span>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                        <div>
                                            <div className="text-xs text-zinc-500 dark:text-zinc-400">Livrate</div>
                                            <div className="font-medium text-zinc-900 dark:text-white flex items-center gap-1">
                                                <Truck className="w-3.5 h-3.5 text-emerald-500" />
                                                {formatNumber(a.delivered_orders)} ({rate.toFixed(0)}%)
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-zinc-500 dark:text-zinc-400">Încasări livrate</div>
                                            <div className="font-medium text-zinc-900 dark:text-white">{ron(a.delivered_revenue_ron)}</div>
                                        </div>
                                    </div>
                                    {a.buckets && (
                                        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                                            {BUCKETS.map((b) => (
                                                <span key={b.key} className={b.cls}>
                                                    {b.label}: <strong>{formatNumber(a.buckets[b.key] || 0)}</strong>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {a.by_store.length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-700/60 space-y-1">
                                            {a.by_store.map((s) => (
                                                <div key={s.store} className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                                                    <span className="flex items-center gap-1"><Store className="w-3 h-3" />{s.store}</span>
                                                    <span>{formatNumber(s.orders)} · {ron(s.revenue_ron)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>

                    {/* Totals */}
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 px-4 py-3 text-sm flex flex-wrap gap-x-8 gap-y-1">
                        <span className="text-zinc-600 dark:text-zinc-300">Total comenzi etichetate: <strong className="text-zinc-900 dark:text-white">{formatNumber(totals.orders)}</strong></span>
                        <span className="text-zinc-600 dark:text-zinc-300">Livrate: <strong className="text-zinc-900 dark:text-white">{formatNumber(totals.delivered)}</strong></span>
                        <span className="text-zinc-600 dark:text-zinc-300">Încasări livrate: <strong className="text-zinc-900 dark:text-white">{ron(totals.delivered_revenue_ron)}</strong></span>
                        {totals.buckets && BUCKETS.map((b) => (
                            <span key={b.key} className="text-zinc-600 dark:text-zinc-300">{b.label}: <strong className={b.cls}>{formatNumber(totals.buckets[b.key] || 0)}</strong></span>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}
