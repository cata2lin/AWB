import { useState } from 'react'
import {
    Wallet, AlertTriangle, Truck, Percent, Package, TrendingUp, TrendingDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { authFetch, API_URL } from '../../utils/authFetch'
import { formatMoney, formatNumber } from '../../utils/analyticsHelpers'

const fmtLocal = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function defaultRange() {
    const now = new Date()
    const from = new Date(now)
    from.setDate(from.getDate() - 30)
    return { from: fmtLocal(from), to: fmtLocal(now) }
}

const ron = (n) => `${formatMoney(n || 0)} lei`

export default function TrendyolProfitabilityTab() {
    const init = defaultRange()
    const [dateFrom, setDateFrom] = useState(init.from)
    const [dateTo, setDateTo] = useState(init.to)
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)

    const handleAnaliza = async () => {
        if (!dateFrom || !dateTo) {
            toast.error('Selectează intervalul de date')
            return
        }
        setLoading(true)
        try {
            const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
            const res = await authFetch(`${API_URL}/analytics/trendyol-profitability?${params}`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setData(json)
            if (json.configured === false) {
                toast.error('Trendyol nu este configurat')
            } else {
                toast.success('Raport Trendyol actualizat')
            }
        } catch (err) {
            toast.error('Eroare la încărcare: ' + (err.message || 'necunoscut'))
        } finally {
            setLoading(false)
        }
    }

    const s = data?.summary || {}
    const products = data?.products || []
    const inert = data && data.configured === false
    const hasData = data && data.configured !== false && (s.sales_count || 0) >= 0

    const cards = [
        { label: 'Încasări (net)', value: ron(s.incasari_net), icon: Wallet, tone: 'text-emerald-600 dark:text-emerald-400' },
        { label: 'COGS', value: ron(s.cogs), icon: Package, tone: 'text-zinc-700 dark:text-zinc-300' },
        { label: 'Comisioane', value: ron(s.comisioane), icon: Percent, tone: 'text-amber-600 dark:text-amber-400' },
        { label: 'Transport', value: ron(s.transport), icon: Truck, tone: 'text-sky-600 dark:text-sky-400' },
        { label: 'Profit brut', value: ron(s.profit_brut), icon: TrendingUp, tone: (s.profit_brut || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400' },
        { label: 'Profit net', value: ron(s.profit_net), icon: (s.profit_net || 0) >= 0 ? TrendingUp : TrendingDown, tone: (s.profit_net || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400' },
    ]

    return (
        <div className="space-y-5 mt-4">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-rose-600 flex items-center justify-center shadow-lg shadow-orange-500/20 flex-shrink-0">
                    <Wallet className="w-4 h-4 text-white" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Profitabilitate Trendyol</h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Vânzări și decontări (settlements) din API-ul Trendyol — încasări, comisioane, transport, profit
                    </p>
                </div>
            </div>

            {/* Date range + Analizează */}
            <div className="flex flex-wrap items-end gap-3">
                <div>
                    <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">De la</label>
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white dark:[color-scheme:dark]"
                    />
                </div>
                <div>
                    <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Până la</label>
                    <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white dark:[color-scheme:dark]"
                    />
                </div>
                <button
                    onClick={handleAnaliza}
                    disabled={loading}
                    className="px-4 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-medium transition-all"
                >
                    {loading ? 'Se analizează…' : 'Analizează'}
                </button>
            </div>

            {/* Inert banner — needs TRENDYOL_* creds */}
            {inert && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800 dark:text-amber-200">
                        <div className="font-semibold">Trendyol nu este configurat</div>
                        <p className="mt-1 text-amber-700 dark:text-amber-300/90">{data.data_note}</p>
                    </div>
                </div>
            )}

            {/* Data note (missing costs / currency) */}
            {!inert && data?.data_note && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800 dark:text-amber-200">{data.data_note}</p>
                </div>
            )}

            {!data && !loading && (
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    Selectează un interval și apasă „Analizează" pentru a încărca raportul.
                </div>
            )}

            {hasData && !inert && (
                <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        {cards.map((c) => {
                            const Icon = c.icon
                            return (
                                <div key={c.label} className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-4">
                                    <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                        <Icon className="w-3.5 h-3.5" />
                                        {c.label}
                                    </div>
                                    <div className={`mt-1.5 font-semibold ${c.tone}`}>{c.value}</div>
                                </div>
                            )
                        })}
                    </div>

                    {/* Secondary metrics */}
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 px-4 py-3 text-sm flex flex-wrap gap-x-8 gap-y-1">
                        <span className="text-zinc-600 dark:text-zinc-300">Vânzări: <strong className="text-zinc-900 dark:text-white">{formatNumber(s.sales_count)}</strong></span>
                        <span className="text-zinc-600 dark:text-zinc-300">Returnări: <strong className="text-zinc-900 dark:text-white">{formatNumber(s.returns_count)}</strong> ({ron(s.returnari)})</span>
                        <span className="text-zinc-600 dark:text-zinc-300">TVA de plată: <strong className="text-zinc-900 dark:text-white">{ron(s.tva_de_plata)}</strong></span>
                        <span className="text-zinc-600 dark:text-zinc-300">Marjă netă: <strong className="text-zinc-900 dark:text-white">{(s.margin || 0).toFixed(1)}%</strong></span>
                        <span className="text-zinc-600 dark:text-zinc-300">TVA: <strong className="text-zinc-900 dark:text-white">{Math.round((s.vat_rate || 0) * 100)}%</strong></span>
                    </div>

                    {/* Per-barcode breakdown */}
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 overflow-hidden">
                        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
                            <h3 className="font-semibold text-zinc-900 dark:text-white text-sm">Detaliu pe produs (barcode)</h3>
                        </div>
                        {products.length === 0 ? (
                            <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                                Nicio tranzacție în perioada selectată.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-700/60">
                                            <th className="px-4 py-2 font-medium">Barcode</th>
                                            <th className="px-4 py-2 font-medium text-right">Vânzări</th>
                                            <th className="px-4 py-2 font-medium text-right">Încasări</th>
                                            <th className="px-4 py-2 font-medium text-right">COGS</th>
                                            <th className="px-4 py-2 font-medium text-right">Comision</th>
                                            <th className="px-4 py-2 font-medium text-right">Profit</th>
                                            <th className="px-4 py-2 font-medium text-right">Marjă</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {products.map((p) => (
                                            <tr key={p.barcode} className="border-b border-zinc-50 dark:border-zinc-700/40">
                                                <td className="px-4 py-2 text-zinc-900 dark:text-white font-mono text-xs">
                                                    {p.barcode}
                                                    {!p.cost_matched && p.sales_count > 0 && (
                                                        <span className="ml-2 text-amber-500 dark:text-amber-400" title="Fără cost SKU în catalog">⚠</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">{formatNumber(p.sales_count)}</td>
                                                <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">{ron(p.incasari)}</td>
                                                <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">{ron(p.cogs)}</td>
                                                <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">{ron(p.commission)}</td>
                                                <td className={`px-4 py-2 text-right font-medium ${p.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{ron(p.profit)}</td>
                                                <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">{(p.margin || 0).toFixed(1)}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
