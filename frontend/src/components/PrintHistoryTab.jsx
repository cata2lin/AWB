/**
 * PrintHistoryTab — Full traceability dashboard for print batches.
 * 
 * Features:
 * - KPI cards (total printed, batches, avg/day, today, peak hour)
 * - Batch history table with expand/collapse
 * - Search, date range, status filtering
 * - Sortable columns
 * - Reprint batch / reprint individual order
 * - Daily volume chart + store distribution
 */
import { useState, useEffect, useCallback } from 'react'
import {
    Search, Calendar, Filter, ChevronDown, ChevronUp, Download,
    RefreshCw, Printer, Package, RotateCcw, FileText, Clock,
    ArrowUpDown, ChevronLeft, ChevronRight, Eye, X
} from 'lucide-react'
import { printApi } from '../services/api/print'
import { analyticsApi } from '../services/api'

const formatNumber = (n) => n == null ? '0' : Number(n).toLocaleString('ro-RO')
const formatBytes = (bytes) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
const formatDate = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
}

const STATUS_BADGES = {
    completed: { label: 'Completed', cls: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300' },
    failed: { label: 'Failed', cls: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' },
    regenerated: { label: 'Regenerated', cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' },
    pending: { label: 'Pending', cls: 'bg-zinc-100 dark:bg-zinc-500/20 text-zinc-700 dark:text-zinc-300' },
}

export default function PrintHistoryTab() {
    // KPIs
    const [kpis, setKpis] = useState(null)
    const [dailyData, setDailyData] = useState([])
    const [storeDistribution, setStoreDistribution] = useState([])

    // History table
    const [batches, setBatches] = useState([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(0)
    const [pageSize] = useState(15)
    const [loading, setLoading] = useState(false)

    // Filters
    const [search, setSearch] = useState('')
    const [searchDebounced, setSearchDebounced] = useState('')
    const [statusFilter, setStatusFilter] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')

    // Sorting
    const [sortBy, setSortBy] = useState('created_at')
    const [sortDir, setSortDir] = useState('desc')

    // Expanded batch details
    const [expandedId, setExpandedId] = useState(null)
    const [expandedData, setExpandedData] = useState(null)
    const [expandLoading, setExpandLoading] = useState(false)

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => setSearchDebounced(search), 400)
        return () => clearTimeout(t)
    }, [search])

    // Fetch KPIs
    useEffect(() => {
        const fetchKpis = async () => {
            try {
                const data = await analyticsApi.getAnalytics(30)
                setKpis(data?.kpis || null)
                setDailyData(data?.daily_data || [])
                setStoreDistribution(data?.store_distribution || [])
            } catch (err) {
                console.error('Failed to fetch print KPIs:', err)
            }
        }
        fetchKpis()
    }, [])

    // Fetch batch history
    const fetchHistory = useCallback(async () => {
        setLoading(true)
        try {
            const data = await printApi.getHistory({
                skip: page * pageSize,
                limit: pageSize,
                search: searchDebounced || undefined,
                status: statusFilter || undefined,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
                sort_by: sortBy,
                sort_dir: sortDir,
            })
            setBatches(data.batches || [])
            setTotal(data.total || 0)
        } catch (err) {
            console.error('Failed to fetch batch history:', err)
        } finally {
            setLoading(false)
        }
    }, [page, pageSize, searchDebounced, statusFilter, dateFrom, dateTo, sortBy, sortDir])

    useEffect(() => { fetchHistory() }, [fetchHistory])

    // Reset page on filter change
    useEffect(() => { setPage(0) }, [searchDebounced, statusFilter, dateFrom, dateTo, sortBy, sortDir])

    // Expand batch details
    const toggleExpand = async (batchId) => {
        if (expandedId === batchId) {
            setExpandedId(null)
            setExpandedData(null)
            return
        }
        setExpandedId(batchId)
        setExpandLoading(true)
        try {
            const data = await printApi.getBatchDetails(batchId)
            setExpandedData(data)
        } catch (err) {
            console.error('Failed to fetch batch details:', err)
        } finally {
            setExpandLoading(false)
        }
    }

    // Sort toggle
    const toggleSort = (col) => {
        if (sortBy === col) {
            setSortDir(d => d === 'desc' ? 'asc' : 'desc')
        } else {
            setSortBy(col)
            setSortDir('desc')
        }
    }

    const totalPages = Math.ceil(total / pageSize)

    const SortIcon = ({ col }) => (
        <ArrowUpDown className={`w-3 h-3 inline ml-1 ${sortBy === col ? 'text-indigo-400' : 'text-zinc-500'}`} />
    )

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                    { label: 'Total Printed', value: kpis?.total_printed, color: 'text-zinc-900 dark:text-white' },
                    { label: 'Total Batches', value: kpis?.total_batches, color: 'text-indigo-600 dark:text-indigo-400' },
                    { label: 'Avg/Day', value: kpis?.avg_per_day, color: 'text-green-600 dark:text-green-400' },
                    { label: 'Batches Today', value: kpis?.batches_today, color: 'text-purple-600 dark:text-purple-400' },
                    { label: 'Peak Hour', value: kpis?.peak_hour || '—', color: 'text-amber-600 dark:text-amber-400', raw: true },
                ].map((kpi, i) => (
                    <div key={i} className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
                        <div className="text-sm text-zinc-500 dark:text-zinc-400">{kpi.label}</div>
                        <div className={`text-2xl font-bold mt-1 ${kpi.color}`}>
                            {kpi.raw ? kpi.value : formatNumber(kpi.value || 0)}
                        </div>
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
                            placeholder="Search batch # or order #..."
                            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-zinc-50 dark:bg-zinc-700/50 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                        {search && (
                            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                                <X className="w-4 h-4 text-zinc-400 hover:text-zinc-600" />
                            </button>
                        )}
                    </div>

                    {/* Status filter */}
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="px-3 py-2 text-sm rounded-lg bg-zinc-50 dark:bg-zinc-700/50 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-600 cursor-pointer"
                    >
                        <option value="">All statuses</option>
                        <option value="completed">Completed</option>
                        <option value="failed">Failed</option>
                        <option value="regenerated">Regenerated</option>
                    </select>

                    {/* Date range */}
                    <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-zinc-400" />
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                            className="px-2 py-1.5 text-sm rounded-lg bg-zinc-50 dark:bg-zinc-700/50 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-600" />
                        <span className="text-zinc-400">→</span>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                            className="px-2 py-1.5 text-sm rounded-lg bg-zinc-50 dark:bg-zinc-700/50 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-600" />
                    </div>

                    {/* Refresh */}
                    <button onClick={fetchHistory} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" title="Refresh">
                        <RefreshCw className={`w-4 h-4 text-zinc-500 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {/* Results count */}
                <div className="mt-2 text-xs text-zinc-400">
                    {total} batch{total !== 1 ? 'es' : ''} found
                    {(searchDebounced || statusFilter || dateFrom || dateTo) && ' (filtered)'}
                </div>
            </div>

            {/* Batch History Table */}
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80">
                                <th className="px-4 py-3 w-8"></th>
                                <th className="px-4 py-3 font-medium cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => toggleSort('batch_number')}>
                                    Batch # <SortIcon col="batch_number" />
                                </th>
                                <th className="px-4 py-3 font-medium cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => toggleSort('created_at')}>
                                    Date <SortIcon col="created_at" />
                                </th>
                                <th className="px-4 py-3 font-medium cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200 text-right" onClick={() => toggleSort('order_count')}>
                                    Orders <SortIcon col="order_count" />
                                </th>
                                <th className="px-4 py-3 font-medium text-right">Groups</th>
                                <th className="px-4 py-3 font-medium cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200 text-right" onClick={() => toggleSort('file_size')}>
                                    Size <SortIcon col="file_size" />
                                </th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                            {loading && batches.length === 0 ? (
                                <tr><td colSpan={8} className="px-4 py-10 text-center text-zinc-400">
                                    <RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading...
                                </td></tr>
                            ) : batches.length === 0 ? (
                                <tr><td colSpan={8} className="px-4 py-10 text-center text-zinc-400">
                                    <Package className="w-6 h-6 inline mr-2 opacity-50" />No batches found
                                </td></tr>
                            ) : batches.map(batch => {
                                const isExpanded = expandedId === batch.id
                                const badge = STATUS_BADGES[batch.status] || STATUS_BADGES.pending
                                const isSingle = batch.batch_number?.startsWith('single_')
                                const isRegen = batch.batch_number?.startsWith('regen_')

                                return (
                                    <> 
                                        <tr
                                            key={batch.id}
                                            className={`hover:bg-zinc-50 dark:hover:bg-zinc-700/20 cursor-pointer transition-colors ${isExpanded ? 'bg-indigo-50/50 dark:bg-indigo-500/5' : ''}`}
                                            onClick={() => toggleExpand(batch.id)}
                                        >
                                            <td className="px-4 py-3">
                                                {isExpanded
                                                    ? <ChevronUp className="w-4 h-4 text-indigo-500" />
                                                    : <ChevronDown className="w-4 h-4 text-zinc-400" />
                                                }
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    {isSingle ? (
                                                        <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
                                                    ) : isRegen ? (
                                                        <RotateCcw className="w-4 h-4 text-amber-400 flex-shrink-0" />
                                                    ) : (
                                                        <Printer className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                                                    )}
                                                    <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]">
                                                        {batch.batch_number}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                                                {formatDate(batch.created_at)}
                                            </td>
                                            <td className="px-4 py-3 text-right font-semibold text-zinc-900 dark:text-white">
                                                {batch.order_count}
                                            </td>
                                            <td className="px-4 py-3 text-right text-zinc-500 dark:text-zinc-400">
                                                {batch.group_count}
                                            </td>
                                            <td className="px-4 py-3 text-right text-zinc-500 dark:text-zinc-400">
                                                {formatBytes(batch.file_size)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>
                                                    {badge.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center justify-end gap-1">
                                                    <a
                                                        href={printApi.getReprintUrl(batch.id)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-600 transition-colors"
                                                        title="Reprint / Download PDF"
                                                    >
                                                        <Download className="w-4 h-4 text-indigo-500" />
                                                    </a>
                                                    <button
                                                        onClick={() => toggleExpand(batch.id)}
                                                        className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-600 transition-colors"
                                                        title="View orders"
                                                    >
                                                        <Eye className="w-4 h-4 text-zinc-500" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>

                                        {/* Expanded detail row */}
                                        {isExpanded && (
                                            <tr key={`${batch.id}-detail`}>
                                                <td colSpan={8} className="px-0 py-0">
                                                    <div className="bg-zinc-50 dark:bg-zinc-800/80 border-t border-zinc-200 dark:border-zinc-700 px-6 py-4">
                                                        {expandLoading ? (
                                                            <div className="flex items-center gap-2 text-zinc-400 py-4">
                                                                <RefreshCw className="w-4 h-4 animate-spin" /> Loading order details...
                                                            </div>
                                                        ) : expandedData?.items?.length > 0 ? (
                                                            <>
                                                                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
                                                                    Orders in this batch ({expandedData.items.length})
                                                                </div>
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full text-xs">
                                                                        <thead>
                                                                            <tr className="text-left text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
                                                                                <th className="pb-2 pr-4">#</th>
                                                                                <th className="pb-2 pr-4">Group</th>
                                                                                <th className="pb-2 pr-4">Order</th>
                                                                                <th className="pb-2 pr-4">Customer</th>
                                                                                <th className="pb-2 pr-4">Courier</th>
                                                                                <th className="pb-2 pr-4">Tracking</th>
                                                                                <th className="pb-2 text-right">Reprint</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/40">
                                                                            {expandedData.items.map((item, idx) => (
                                                                                <tr key={item.order_uid} className="hover:bg-white dark:hover:bg-zinc-700/30">
                                                                                    <td className="py-2 pr-4 text-zinc-400">{idx + 1}</td>
                                                                                    <td className="py-2 pr-4">
                                                                                        <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[10px] font-medium">
                                                                                            {item.group_name}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td className="py-2 pr-4 font-semibold text-zinc-800 dark:text-zinc-200">
                                                                                        {item.order_number}
                                                                                    </td>
                                                                                    <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-300">
                                                                                        {item.customer_name || '—'}
                                                                                    </td>
                                                                                    <td className="py-2 pr-4 text-zinc-500 dark:text-zinc-400">
                                                                                        {item.courier_name || '—'}
                                                                                    </td>
                                                                                    <td className="py-2 pr-4 font-mono text-zinc-500 dark:text-zinc-400 text-[11px]">
                                                                                        {item.tracking_number || '—'}
                                                                                    </td>
                                                                                    <td className="py-2 text-right">
                                                                                        <button
                                                                                            onClick={() => printApi.reprintOrder(item.order_uid)}
                                                                                            className="p-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                                                                                            title={`Reprint ${item.order_number}`}
                                                                                        >
                                                                                            <Printer className="w-3.5 h-3.5 text-indigo-500" />
                                                                                        </button>
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="text-zinc-400 text-xs py-2">No order details available</div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
                        <div className="text-xs text-zinc-400">
                            Page {page + 1} of {totalPages} ({total} total)
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                                className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 transition-colors"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                const p = page < 3 ? i : page + i - 2
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

            {/* Daily Chart */}
            {dailyData.length > 0 && (
                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                    <h3 className="font-semibold text-zinc-900 dark:text-white mb-4">Daily Print Volume</h3>
                    <div className="h-48 flex items-end gap-1">
                        {dailyData.slice(-30).map((day) => {
                            const maxVal = Math.max(...dailyData.map(d => d.printed), 1)
                            return (
                                <div
                                    key={day.date}
                                    className="flex-1 bg-indigo-500 dark:bg-indigo-600 rounded-t hover:bg-indigo-600 dark:hover:bg-indigo-500 transition-colors cursor-pointer group relative"
                                    style={{ height: `${Math.max(4, (day.printed / maxVal) * 100)}%` }}
                                    title={`${day.dateLabel}: ${day.printed} orders`}
                                >
                                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                                        {day.dateLabel}: {day.printed}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Store Distribution */}
            {storeDistribution.length > 0 && (
                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                    <h3 className="font-semibold text-zinc-900 dark:text-white mb-4">Print by Store</h3>
                    <div className="space-y-2">
                        {storeDistribution.map(store => {
                            const tot = storeDistribution.reduce((a, b) => a + b.count, 0)
                            const pct = tot > 0 ? (store.count / tot * 100) : 0
                            return (
                                <div key={store.name} className="flex items-center gap-3">
                                    <span className="text-sm text-zinc-600 dark:text-zinc-300 w-32 truncate">{store.name}</span>
                                    <div className="flex-1 h-2 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="text-sm font-medium text-zinc-900 dark:text-white w-16 text-right">
                                        {formatNumber(store.count)}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
