import { useEffect, useState } from 'react'
import {
    Truck, XCircle, RotateCcw, TrendingUp, Store, ArrowUpDown, Download,
} from 'lucide-react'
import { authFetch, API_URL } from '../../utils/authFetch'
import {
    getRateColor, getRateBgColor, formatNumber, getLastCompleteMonth,
} from '../../utils/analyticsHelpers'
import ColumnsMenu from '../../components/ui/ColumnsMenu'
import { useColumnVisibility } from '../../hooks/useColumnVisibility'
import { exportCsv } from '../../utils/csvExport'

// Order also drives ColumnsMenu list order — store_name is always visible.
const DELIVERABILITY_COLUMNS = [
    { key: 'store_name',         header: 'Magazin', alwaysVisible: true, align: 'left' },
    { key: 'total',              header: 'Total',         align: 'right' },
    { key: 'delivered',          header: 'Livrate',       align: 'right' },
    { key: 'cancelled',          header: 'Anulate',       align: 'right' },
    { key: 'returned',           header: 'Ret. / Ref.',   align: 'right' },
    { key: 'in_transit',         header: 'În Tranzit',    align: 'right' },
    { key: 'shipped',            header: 'Expediate',     align: 'right' },
    { key: 'delivery_rate',      header: 'Rată Livrare',  align: 'right' },
    { key: 'expedition_rate',    header: 'Rată Expediție',align: 'right' },
    { key: 'cancelled_rate',     header: 'Rată Anulare',  align: 'right' },
    { key: 'deliverability_rate',header: 'Livrabilitate', align: 'right' },
]

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
    const [showComparison, setShowComparison] = useState(false)
    const {
        visibleKeys,
        setVisibleKeys,
        defaultVisibleKeys,
    } = useColumnVisibility('livrabilitate', DELIVERABILITY_COLUMNS)
    const colVisible = (key) => visibleKeys.includes(key) || DELIVERABILITY_COLUMNS.find(c => c.key === key)?.alwaysVisible

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

    const columns = DELIVERABILITY_COLUMNS
        .filter(c => colVisible(c.key))
        .map(c => ({ field: c.key, label: c.header, align: c.align, show: true }))

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
                            ? 'bg-primary-50 dark:bg-primary-500/20 border-primary-300 dark:border-primary-500 text-primary-700 dark:text-primary-300'
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
                        ? 'bg-primary-50 dark:bg-primary-500/20 border-primary-300 dark:border-primary-500 text-primary-700 dark:text-primary-300'
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
                        className="w-3.5 h-3.5 rounded border-zinc-300 text-primary-600 focus:ring-primary-500" />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Exclude ultimele 3 zile</span>
                </label>

                {loading && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-500" />}
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
                        <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-primary-500">
                            <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                <TrendingUp className="w-4 h-4 text-primary-500" /> Livrabilitate
                            </div>
                            <div className={`text-2xl font-bold mt-1 tracking-tight ${getRateColor(data.totals?.deliverability_rate || 0)}`}>
                                {data.totals?.deliverability_rate || 0}%
                            </div>
                        </div>
                    </div>

                    {/* Per-Store Table */}
                    <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden shadow-sm">
                        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between gap-2">
                            <h3 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2 tracking-tight">
                                <Store className="w-5 h-5 text-primary-500" />
                                Livrabilitate per Magazin
                            </h3>
                            <div className="flex items-center gap-2">
                                <ColumnsMenu
                                    columns={DELIVERABILITY_COLUMNS}
                                    visibleKeys={visibleKeys}
                                    onChange={setVisibleKeys}
                                    defaultVisibleKeys={defaultVisibleKeys}
                                />
                                <button
                                    onClick={() => {
                                        const cols = DELIVERABILITY_COLUMNS.filter(c => colVisible(c.key)).map(c => ({
                                            key: c.key, label: c.header,
                                            accessor: (s) => {
                                                if (c.key === 'returned') return (s.returned || 0) + (s.refused || 0)
                                                if (c.key === 'in_transit') return (s.in_transit || 0) + (s.out_for_delivery || 0)
                                                if (c.key.endsWith('_rate')) return `${s[c.key] || 0}%`
                                                return s[c.key] ?? ''
                                            },
                                        }))
                                        exportCsv({ filename: `livrabilitate_${period}`, columns: cols, rows: sortedStores })
                                    }}
                                    title="Export CSV"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700">
                                    <Download className="w-4 h-4" /> CSV
                                </button>
                            </div>
                        </div>
                        <div className="overflow-auto max-h-[75vh]">
                            <table className="w-full">
                                <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                    <tr>
                                        {columns.filter(c => c.show).map(c => (
                                            <th key={c.field}
                                                className={`${c.align === 'left' ? 'text-left px-4' : 'text-right px-3'} py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase cursor-pointer select-none hover:text-primary-600 dark:hover:text-primary-400 transition-colors`}
                                                onClick={() => toggleSort(c.field)}>
                                                <span className="inline-flex items-center gap-1">
                                                    {c.label}
                                                    <ArrowUpDown className={`w-3 h-3 ${sort.col === c.field ? 'text-primary-500' : 'opacity-40'}`} />
                                                    {sort.col === c.field && (
                                                        <span className="text-[9px] text-primary-500">{sort.dir === 'asc' ? '↑' : '↓'}</span>
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
                                            {colVisible('total') && <td className="px-3 py-3 text-sm text-right text-zinc-700 dark:text-zinc-100">
                                                {formatNumber(store.total)}
                                            </td>}
                                            {colVisible('delivered') && <td className="px-3 py-3 text-sm text-right text-green-600 dark:text-green-400 font-medium">
                                                {formatNumber(store.delivered)}
                                            </td>}
                                            {colVisible('cancelled') && <td className="px-3 py-3 text-sm text-right text-red-600 dark:text-red-400">
                                                {formatNumber(store.cancelled)}
                                            </td>}
                                            {colVisible('returned') && <td className="px-3 py-3 text-sm text-right text-orange-600 dark:text-orange-400">
                                                {formatNumber((store.returned || 0) + (store.refused || 0))}
                                            </td>}
                                            {colVisible('in_transit') && <td className="px-3 py-3 text-sm text-right text-blue-600 dark:text-blue-400">
                                                {formatNumber((store.in_transit || 0) + (store.out_for_delivery || 0))}
                                            </td>}
                                            {colVisible('shipped') && <td className="px-3 py-3 text-sm text-right text-primary-600 dark:text-primary-400 font-medium">
                                                {formatNumber(store.shipped || 0)}
                                            </td>}
                                            {colVisible('delivery_rate') && <td className="px-3 py-3 text-sm text-right">
                                                <span className={getRateColor(store.delivery_rate || 0)}>{store.delivery_rate || 0}%</span>
                                            </td>}
                                            {colVisible('expedition_rate') && <td className="px-3 py-3 text-sm text-right">
                                                <span className="text-primary-600 dark:text-primary-400">{store.expedition_rate || 0}%</span>
                                            </td>}
                                            {colVisible('cancelled_rate') && <td className="px-3 py-3 text-sm text-right">
                                                <span className="text-red-600 dark:text-red-400">{store.cancelled_rate || 0}%</span>
                                            </td>}
                                            {colVisible('deliverability_rate') && <td className="px-3 py-3 text-sm text-right">
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
