import { useEffect, useState, useCallback } from 'react'
import { ShoppingBag, Package, AlertTriangle, RefreshCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { authFetch, API_URL } from '../../utils/authFetch'
import { formatNumber } from '../../utils/analyticsHelpers'
import MultiSelectFilter from '../../components/MultiSelectFilter'

const QUICK_PERIODS = [
    { key: '30d', label: '30 zile' },
    { key: '90d', label: '90 zile' },
    { key: 'thisMonth', label: 'Luna curentă' },
    { key: 'lastMonth', label: 'Luna trecută' },
]

const MARKETPLACE_OPTIONS = [
    { value: 'RO', label: '🇷🇴 România (RON)' },
    { value: 'BG', label: '🇧🇬 Bulgaria (BGN)' },
    { value: 'HU', label: '🇭🇺 Ungaria (HUF)' },
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
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    return { dateFrom: fmtLocal(lm), dateTo: fmtLocal(lmEnd) }
}

const money = (n, currency) => `${formatNumber(Math.round(n || 0))} ${currency || ''}`.trim()

export default function EmagReportTab() {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [syncing, setSyncing] = useState(false)
    const [period, setPeriod] = useState('lastMonth')
    const [emagMarketplaces, setEmagMarketplaces] = useState([])

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const { dateFrom, dateTo } = resolvePeriod(period)
            const params = new URLSearchParams()
            if (dateFrom && dateTo) { params.set('date_from', dateFrom); params.set('date_to', dateTo) }
            if (emagMarketplaces.length) params.set('marketplaces', emagMarketplaces.join(','))
            const res = await authFetch(`${API_URL}/analytics/emag-report?${params}`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setData(json)
        } catch (e) {
            setError(e.message || 'Eroare la încărcare')
        } finally {
            setLoading(false)
        }
    }, [period, emagMarketplaces])

    useEffect(() => {
        let cancelled = false
        const run = async () => {
            if (!cancelled) await load()
        }
        run()
        return () => { cancelled = true }
    }, [load])

    const handleSyncEmag = async () => {
        setSyncing(true)
        try {
            const res = await authFetch(`${API_URL}/analytics/emag-report/sync`, { method: 'POST' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            if (json.note) {
                toast.warning(`Sincronizare inertă: ${json.note}`)
            } else {
                toast.success(`Sincronizare eMAG: ${formatNumber(json.synced || 0)} comenzi actualizate`)
                await load()
            }
        } catch (e) {
            toast.error('Eroare la sincronizare eMAG: ' + (e.message || 'necunoscută'))
        } finally {
            setSyncing(false)
        }
    }

    const marketplaces = data?.marketplaces || []
    const totals = data?.totals || {}
    const isEmpty = !loading && (totals.orders || 0) === 0
    const configured = data?.configured_marketplaces || []

    return (
        <div className="space-y-5 mt-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-lg shadow-orange-500/20 flex-shrink-0">
                        <ShoppingBag className="w-4 h-4 text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Raport eMAG (Marketplace)</h2>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Comenzi, unități și GMV per marketplace (RO / BG / HU)
                        </p>
                    </div>
                </div>
                <button
                    onClick={handleSyncEmag}
                    disabled={syncing}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                    <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? 'Se sincronizează…' : 'Sincronizează eMAG'}
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
                {QUICK_PERIODS.map((p) => (
                    <button
                        key={p.key}
                        onClick={() => setPeriod(p.key)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${period === p.key
                            ? 'bg-orange-600 text-white shadow-sm'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                            }`}
                    >
                        {p.label}
                    </button>
                ))}
                <MultiSelectFilter
                    label="Marketplace"
                    options={MARKETPLACE_OPTIONS}
                    selected={emagMarketplaces}
                    onChange={setEmagMarketplaces}
                    icon={ShoppingBag}
                    allLabel="Toate marketplace-urile"
                />
            </div>

            {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Prominent amber banner — explains the inert/empty state */}
            {isEmpty && data?.data_note && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800 dark:text-amber-200">
                        <div className="font-semibold">Raportul eMAG este gol</div>
                        <p className="mt-1 text-amber-700 dark:text-amber-300/90">{data.data_note}</p>
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                            Marketplace-uri configurate: {configured.length ? configured.join(', ') : 'niciunul (lipsesc credențialele)'}
                        </p>
                    </div>
                </div>
            )}

            {loading && (
                <div className="text-sm text-zinc-500 dark:text-zinc-400">Se încarcă…</div>
            )}

            {!loading && !isEmpty && (
                <>
                    {/* Per-marketplace cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {marketplaces.filter((m) => m.orders > 0).map((m) => (
                            <div key={m.marketplace} className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-4">
                                <div className="flex items-center justify-between">
                                    <span className="font-semibold text-zinc-900 dark:text-white">
                                        {m.flag} {m.name}
                                    </span>
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatNumber(m.orders)} comenzi</span>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                    <div>
                                        <div className="text-xs text-zinc-500 dark:text-zinc-400">Unități</div>
                                        <div className="font-medium text-zinc-900 dark:text-white flex items-center gap-1">
                                            <Package className="w-3.5 h-3.5 text-orange-500" />
                                            {formatNumber(m.units)}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-zinc-500 dark:text-zinc-400">GMV ({m.currency})</div>
                                        <div className="font-medium text-zinc-900 dark:text-white">{money(m.gmv, m.currency)}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-zinc-500 dark:text-zinc-400">Colete (est.)</div>
                                        <div className="font-medium text-zinc-900 dark:text-white">{formatNumber(m.total_colete)}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-zinc-500 dark:text-zinc-400">Rată anulare</div>
                                        <div className="font-medium text-zinc-900 dark:text-white flex items-center gap-1">
                                            <XCircle className="w-3.5 h-3.5 text-red-500" />
                                            {(m.cancellation_rate || 0).toFixed(1)}%
                                        </div>
                                    </div>
                                </div>
                                {Object.keys(m.status_breakdown || {}).length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-700/60 space-y-1">
                                        {Object.entries(m.status_breakdown).map(([status, count]) => (
                                            <div key={status} className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                                                <span>Status {status}</span>
                                                <span>{formatNumber(count)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Totals */}
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 px-4 py-3 text-sm flex flex-wrap gap-x-8 gap-y-1">
                        <span className="text-zinc-600 dark:text-zinc-300">Total comenzi: <strong className="text-zinc-900 dark:text-white">{formatNumber(totals.orders)}</strong></span>
                        <span className="text-zinc-600 dark:text-zinc-300">Total unități: <strong className="text-zinc-900 dark:text-white">{formatNumber(totals.units)}</strong></span>
                        <span className="text-zinc-600 dark:text-zinc-300">Cereri anulare: <strong className="text-zinc-900 dark:text-white">{formatNumber(totals.cancellation_requests)}</strong></span>
                        <span className="text-xs text-zinc-400 dark:text-zinc-500 self-center">GMV per marketplace este în moneda nativă (RON / BGN / HUF), neconvertit.</span>
                    </div>
                </>
            )}
        </div>
    )
}
