import { useEffect, useState } from 'react'
import {
    Truck, XCircle, RotateCcw, TrendingUp, Store, Settings2, ArrowUpDown,
} from 'lucide-react'
import { authFetch, API_URL } from '../../utils/authFetch'
import {
    getRateColor, getRateBgColor, formatNumber, getLastCompleteMonth,
} from '../../utils/analyticsHelpers'

const COL_LABELS = {
    total: 'Total', delivered: 'Livrate', cancelled: 'Anulate',
    returned: 'Ret. / Ref.', in_transit: 'În Tranzit', shipped: 'Expediate',
    delivery_rate: 'Rată Livrare', expedition_rate: 'Rată Expediție',
    cancelled_rate: 'Rată Anulare', deliverability: 'Livrabilitate',
}

const QUICK_PERIODS = [
    { key: '30d', label: '30 zile' },
    { key: '90d', label: '90 zile' },
    { key: 'thisMonth', label: 'Luna curentă' },
    { key: 'lastMonth', label: 'Luna trecută' },
]

// Format a local Date as YYYY-MM-DD without UTC shift.
const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function resolvePeriod(period, customFrom, customTo) {
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
    if (period === 'lastMonth') {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0)
        return { dateFrom: fmtLocal(lm), dateTo: fmtLocal(lmEnd) }
    }
    if (period === 'custom') {
        if (!customFrom || !customTo) return { dateFrom: null, dateTo: null }
        return { dateFrom: customFrom, dateTo: customTo }
    }
    if (/^\d{4}-\d{2}$/.test(period)) {
        const [y, m] = period.split('-').map(Number)
        const lastDay = new Date(y, m, 0).getDate()
        return {
            dateFrom: `${y}-${String(m).padStart(2, '0')}-01`,
            dateTo: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
        }
    }
    return { dateFrom: null, dateTo: null }
}

export default function DeliverabilityTab({ selectedStores = [] }) {
    const [data, setData] = useState(null)
    const [period, setPeriod] = useState(getLastCompleteMonth)
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [loading, setLoading] = useState(false)
    const [sort, setSort] = useState({ col: 'total', dir: 'desc' })
    const [showColMenu, setShowColMenu] = useState(false)
    const [showComparison, setShowComparison] = useState(false)
    const [cols, setCols] = useState({
        total: true, delivered: true, cancelled: true, returned: true,
        in_transit: true, shipped: true, delivery_rate: true,
        expedition_rate: true, cancelled_rate: true, deliverability: true,
    })

    const toggleSort = (col) => {
        setSort(prev => prev.col === col ? { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' })
    }

    const fetchData = async (p, customFrom, customTo) => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (selectedStores.length > 0) params.set('store_uids', selectedStores.join(','))
            let { dateFrom: df, dateTo: dt } = resolvePeriod(p, customFrom, customTo)
            if (p === 'custom' && (!df || !dt)) { setLoading(false); return }
            // Optional 3-day shift to exclude still-in-transit orders.
            if (showComparison && df && dt) {
                const end = new Date(dt)
                end.setDate(end.getDate() - 3)
                dt = end.toISOString().split('T')[0]
            }
            if (df) params.set('date_from', df)
            if (dt) params.set('date_to', dt)

            const res = await authFetch(`${API_URL}/analytics/deliverability?${params}`)
            const json = await res.json()
            setData(json)
        } catch (err) {
            console.error('Failed to fetch deliverability:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (period === 'custom') {
            if (dateFrom && dateTo) fetchData('custom', dateFrom, dateTo)
        } else {
            fetchData(period)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [period, dateFrom, dateTo, selectedStores, showComparison])

    const columns = [
        { field: 'store_name', label: 'Magazin', align: 'left', show: true },
        { field: 'total', label: 'Total', show: cols.total },
        { field: 'delivered', label: 'Livrate', show: cols.delivered },
        { field: 'cancelled', label: 'Anulate', show: cols.cancelled },
        { field: 'returned', label: 'Ret. / Ref.', show: cols.returned },
        { field: 'in_transit', label: 'În Tranzit', show: cols.in_transit },
        { field: 'shipped', label: 'Expediate', show: cols.shipped },
        { field: 'delivery_rate', label: 'Rată Livrare', show: cols.delivery_rate },
        { field: 'expedition_rate', label: 'Rată Expediție', show: cols.expedition_rate },
        { field: 'cancelled_rate', label: 'Rată Anulare', show: cols.cancelled_rate },
        { field: 'deliverability_rate', label: 'Livrabilitate', show: cols.deliverability },
    ]

    const sortedStores = (() => {
        const stores = [...(data?.stores || [])]
        const getVal = (store, col) => {
            if (col === 'store_name') return store.store_name || ''
            if (col === 'returned') return (store.returned || 0) + (store.refused || 0)
            if (col === 'in_transit') return (store.in_transit || 0) + (store.out_for_delivery || 0)
            return store[col] || 0
        }
        stores.sort((a, b) => {
            const va = getVal(a, sort.col)
            const vb = getVal(b, sort.col)
            if (typeof va === 'string') return sort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
            return sort.dir === 'asc' ? va - vb : vb - va
        })
        return stores
    })()

    return (
        <div className="space-y-6">
            {/* Period Picker + Options */}
            <div className="flex flex-wrap items-center gap-3">
                {QUICK_PERIODS.map(p => (
                    <button key={p.key}
                        onClick={() => { setPeriod(p.key); setDateFrom(''); setDateTo('') }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${period === p.key
                            ? 'bg-indigo-50 dark:bg-indigo-500/20 border-indigo-300 dark:border-indigo-500 text-indigo-700 dark:text-indigo-300'
                            : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                            }`}
                    >{p.label}</button>
                ))}

                <select
                    value={/^\d{4}-\d{2}$/.test(period) ? period : ''}
                    onChange={(e) => { if (e.target.value) { setPeriod(e.target.value); setDateFrom(''); setDateTo('') } }}
                    className="px-3 py-1.5 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-700/50 text-zinc-600 dark:text-white border-0 cursor-pointer"
                >
                    <option value="">Lună specifică...</option>
                    {(() => {
                        const months = []
                        const now = new Date()
                        for (let i = 0; i < 18; i++) {
                            const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
                            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                            const label = d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })
                            months.push(<option key={key} value={key}>{label}</option>)
                        }
                        return months
                    })()}
                </select>

                <div className="h-6 w-px bg-zinc-300 dark:bg-zinc-600" />

                <button
                    onClick={() => setPeriod('custom')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${period === 'custom'
                        ? 'bg-indigo-50 dark:bg-indigo-500/20 border-indigo-300 dark:border-indigo-500 text-indigo-700 dark:text-indigo-300'
                        : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                        }`}
                >Perioadă custom</button>
                {period === 'custom' && (
                    <>
                        <input type="date" value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="px-2 py-1.5 text-xs bg-white dark:bg-zinc-800 dark:text-white dark:[color-scheme:dark] border border-zinc-200 dark:border-zinc-700 rounded-lg" />
                        <span className="text-zinc-400">→</span>
                        <input type="date" value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="px-2 py-1.5 text-xs bg-white dark:bg-zinc-800 dark:text-white dark:[color-scheme:dark] border border-zinc-200 dark:border-zinc-700 rounded-lg" />
                    </>
                )}

                <label className="flex items-center gap-2 cursor-pointer ml-auto">
                    <input type="checkbox" checked={showComparison} onChange={(e) => setShowComparison(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500" />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Exclude ultimele 3 zile</span>
                </label>

                {loading && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-500" />}
            </div>

            {data && (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-zinc-400">
                            <div className="text-sm text-zinc-500 dark:text-zinc-400">Total Comenzi</div>
                            <div className="text-2xl font-bold text-zinc-900 dark:text-white mt-1 tracking-tight">
                                {formatNumber(data.totals?.total || 0)}
                            </div>
                        </div>
                        <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-green-500">
                            <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                <Truck className="w-4 h-4 text-green-500" /> Livrate
                            </div>
                            <div className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1 tracking-tight">
                                {formatNumber(data.totals?.delivered || 0)}
                            </div>
                        </div>
                        <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-red-500">
                            <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                <XCircle className="w-4 h-4 text-red-500" /> Anulate
                            </div>
                            <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1 tracking-tight">
                                {formatNumber(data.totals?.cancelled || 0)}
                            </div>
                        </div>
                        <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-orange-500">
                            <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                <RotateCcw className="w-4 h-4 text-orange-500" /> Returnate / Refuzate
                            </div>
                            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400 mt-1 tracking-tight">
                                {formatNumber((data.totals?.returned || 0) + (data.totals?.refused || 0))}
                            </div>
                        </div>
                        <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-blue-500">
                            <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                📦 Expediate
                            </div>
                            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1 tracking-tight">
                                {formatNumber(data.totals?.shipped || 0)}
                            </div>
                        </div>
                        <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-indigo-500">
                            <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                <TrendingUp className="w-4 h-4 text-indigo-500" /> Livrabilitate
                            </div>
                            <div className={`text-2xl font-bold mt-1 tracking-tight ${getRateColor(data.totals?.deliverability_rate || 0)}`}>
                                {data.totals?.deliverability_rate || 0}%
                            </div>
                        </div>
                    </div>

                    {/* Per-Store Table */}
                    <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 overflow-clip shadow-sm">
                        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700/50 flex items-center justify-between">
                            <h3 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2 tracking-tight">
                                <Store className="w-5 h-5 text-indigo-500" />
                                Livrabilitate per Magazin
                            </h3>
                            <div className="relative">
                                <button onClick={() => setShowColMenu(!showColMenu)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors">
                                    <Settings2 className="w-3.5 h-3.5" /> Coloane
                                </button>
                                {showColMenu && (
                                    <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 p-2 space-y-0.5">
                                        {Object.entries(COL_LABELS).map(([key, label]) => (
                                            <label key={key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/50 text-zinc-700 dark:text-zinc-300">
                                                <input type="checkbox" checked={cols[key]}
                                                    onChange={() => setCols(prev => ({ ...prev, [key]: !prev[key] }))}
                                                    className="rounded border-zinc-300 dark:border-zinc-600 text-indigo-500 focus:ring-indigo-500" />
                                                {label}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="overflow-auto max-h-[75vh]">
                            <table className="w-full">
                                <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                    <tr>
                                        {columns.filter(c => c.show).map(c => (
                                            <th key={c.field}
                                                className={`${c.align === 'left' ? 'text-left px-4' : 'text-right px-3'} py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase cursor-pointer select-none hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors`}
                                                onClick={() => toggleSort(c.field)}>
                                                <span className="inline-flex items-center gap-1">
                                                    {c.label}
                                                    <ArrowUpDown className={`w-3 h-3 ${sort.col === c.field ? 'text-indigo-500' : 'opacity-40'}`} />
                                                    {sort.col === c.field && (
                                                        <span className="text-[9px] text-indigo-500">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                                                    )}
                                                </span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                                    {sortedStores.map((store) => (
                                        <tr key={store.store_uid} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30">
                                            <td className="px-4 py-3 text-sm font-medium text-zinc-900 dark:text-white">
                                                {store.store_name}
                                            </td>
                                            {cols.total && <td className="px-3 py-3 text-sm text-right text-zinc-600 dark:text-white">
                                                {formatNumber(store.total)}
                                            </td>}
                                            {cols.delivered && <td className="px-3 py-3 text-sm text-right text-green-600 dark:text-green-400 font-medium">
                                                {formatNumber(store.delivered)}
                                            </td>}
                                            {cols.cancelled && <td className="px-3 py-3 text-sm text-right text-red-600 dark:text-red-400">
                                                {formatNumber(store.cancelled)}
                                            </td>}
                                            {cols.returned && <td className="px-3 py-3 text-sm text-right text-orange-600 dark:text-orange-400">
                                                {formatNumber((store.returned || 0) + (store.refused || 0))}
                                            </td>}
                                            {cols.in_transit && <td className="px-3 py-3 text-sm text-right text-blue-600 dark:text-blue-400">
                                                {formatNumber((store.in_transit || 0) + (store.out_for_delivery || 0))}
                                            </td>}
                                            {cols.shipped && <td className="px-3 py-3 text-sm text-right text-indigo-600 dark:text-indigo-400 font-medium">
                                                {formatNumber(store.shipped || 0)}
                                            </td>}
                                            {cols.delivery_rate && <td className="px-3 py-3 text-sm text-right">
                                                <span className={getRateColor(store.delivery_rate || 0)}>{store.delivery_rate || 0}%</span>
                                            </td>}
                                            {cols.expedition_rate && <td className="px-3 py-3 text-sm text-right">
                                                <span className="text-indigo-600 dark:text-indigo-400">{store.expedition_rate || 0}%</span>
                                            </td>}
                                            {cols.cancelled_rate && <td className="px-3 py-3 text-sm text-right">
                                                <span className="text-red-600 dark:text-red-400">{store.cancelled_rate || 0}%</span>
                                            </td>}
                                            {cols.deliverability && <td className="px-3 py-3 text-sm text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <div className="w-16 h-2 bg-zinc-200 dark:bg-zinc-600 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full ${getRateBgColor(store.deliverability_rate)}`}
                                                            style={{ width: `${Math.min(store.deliverability_rate, 100)}%` }}
                                                        />
                                                    </div>
                                                    <span className={`font-bold ${getRateColor(store.deliverability_rate)}`}>
                                                        {store.deliverability_rate}%
                                                    </span>
                                                </div>
                                            </td>}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
