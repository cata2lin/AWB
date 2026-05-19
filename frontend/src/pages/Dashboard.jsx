import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../store/useAppStore'
import { useStores, useSyncStatus, useTriggerSync, useOrderStats, useSyncHistory } from '../hooks/useApi'
import { printApi } from '../services/api'
import { printBatchPdf } from '../utils/printUtils'
import StoreCard from '../components/StoreCard'
import PrintPreview from '../components/PrintPreview'
import { Package, Printer, TrendingUp, RefreshCw, Clock, Download, Eye, AlertCircle, CheckCircle, ChevronDown, Calendar, Store, Activity, Filter, Search, X, CheckSquare, Square } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { toastError, toastSuccess } from '../utils/toast'

export default function Dashboard() {
    const { selectedStoreIds, batchSize, printChunkSize, printChunkDelay } = useAppStore()
    const queryClient = useQueryClient()
    const [isPrinting, setIsPrinting] = useState(false)
    const [printResult, setPrintResult] = useState(null)
    const [printError, setPrintError] = useState(null)
    const [previewData, setPreviewData] = useState(null)
    const [showPreview, setShowPreview] = useState(false)
    const [printProgress, setPrintProgress] = useState(null) // { current, total }

    // Sync dropdown state
    const [showSyncMenu, setShowSyncMenu] = useState(false)
    const [showCustomSync, setShowCustomSync] = useState(false)
    const [customStoreUids, setCustomStoreUids] = useState([])
    const [customDateFrom, setCustomDateFrom] = useState('')
    const [customDateTo, setCustomDateTo] = useState('')
    const [customStoreSearch, setCustomStoreSearch] = useState('')

    // Print Date Filter state
    const [printDateFrom, setPrintDateFrom] = useState('')
    const [printDateTo, setPrintDateTo] = useState('')

    // Fetch data from API
    const { data: stores = [], isLoading: storesLoading, error: storesError } = useStores()
    const { data: stats, isLoading: statsLoading } = useOrderStats()
    const { data: syncStatus } = useSyncStatus()
    const triggerSync = useTriggerSync()
    const { data: syncHistory = [] } = useSyncHistory(15)

    // Group stores by country suffix (`.ro` / `.bg` / `.cz` / `.pl` / other)
    // and filter by the search box. Memoised so we don't recompute per render.
    // Must be declared AFTER `useStores()` — otherwise the `stores` reference in
    // the dependency array hits the TDZ and throws ReferenceError at render.
    const storeGroups = useMemo(() => {
        const q = customStoreSearch.trim().toLowerCase()
        const groups = { '.ro': [], '.bg': [], '.cz': [], '.pl': [], other: [] }
        for (const s of stores) {
            if (q && !(s.name || '').toLowerCase().includes(q)) continue
            const name = (s.name || '').toLowerCase()
            if (name.endsWith('.ro')) groups['.ro'].push(s)
            else if (name.endsWith('.bg')) groups['.bg'].push(s)
            else if (name.endsWith('.cz')) groups['.cz'].push(s)
            else if (name.endsWith('.pl')) groups['.pl'].push(s)
            else groups.other.push(s)
        }
        return groups
    }, [stores, customStoreSearch])

    const visibleStoreUids = useMemo(
        () => Object.values(storeGroups).flatMap(g => g.map(s => s.uid)),
        [storeGroups],
    )
    const allVisibleSelected = visibleStoreUids.length > 0 && visibleStoreUids.every(uid => customStoreUids.includes(uid))

    /** Quick-set the date range to the last N days (Romania-local, today inclusive). */
    const setQuickRange = (days) => {
        const today = new Date()
        const from = new Date(today)
        from.setDate(today.getDate() - (days - 1))
        const pad = (n) => String(n).padStart(2, '0')
        const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        setCustomDateFrom(fmt(from))
        setCustomDateTo(fmt(today))
    }

    const totalUnfulfilled = stats?.unprinted_orders ?? stores.reduce((sum, s) => sum + (s.unprinted_count || 0), 0)

    // Count orders that can actually be printed (have AWB PDFs)
    const totalPrintable = stores.reduce((sum, s) => sum + (s.printable_count || 0), 0)
    const selectedPrintable = selectedStoreIds.length > 0
        ? stores.filter(s => selectedStoreIds.includes(s.uid)).reduce((sum, s) => sum + (s.printable_count || 0), 0)
        : totalPrintable

    // Also track unprinted without AWB for user info
    const selectedUnprinted = selectedStoreIds.length > 0
        ? stores.filter(s => selectedStoreIds.includes(s.uid)).reduce((sum, s) => sum + (s.unprinted_count || 0), 0)
        : totalUnfulfilled

    const handleSync = (syncType = 'window_30d') => {
        setShowSyncMenu(false)
        triggerSync.mutate(
            { sync_type: syncType },
            {
                onSuccess: () => toastSuccess('Sincronizare pornită'),
                onError: (err) => toastError(err),
            }
        )
    }

    const handleCustomSync = () => {
        if (!customDateFrom) return
        // Normalise date strings to Romania-local plain ISO (no Z, no millis).
        // Frisbo's API accepts naive ISO datetimes — see app/services/frisbo/client.py.
        // Selecting all stores (or none) is equivalent → send null so the backend
        // can iterate all orgs without applying a Python-side filter at all.
        const localIso = (yyyymmdd, end = false) => {
            if (!yyyymmdd) return null
            return end ? `${yyyymmdd}T23:59:59` : `${yyyymmdd}T00:00:00`
        }
        const isAllStores = customStoreUids.length === 0 || customStoreUids.length === stores.length
        triggerSync.mutate(
            {
                sync_type: 'custom',
                store_uids: isAllStores ? null : customStoreUids,
                date_from: localIso(customDateFrom, false),
                date_to: localIso(customDateTo, true),
            },
            {
                onSuccess: () => toastSuccess(`Sincronizare personalizată pornită — ${isAllStores ? 'toate magazinele' : customStoreUids.length + ' magazine'}`),
                onError: (err) => toastError(err),
            }
        )
        setShowCustomSync(false)
        setShowSyncMenu(false)
    }

    const toggleCustomStore = (uid) => {
        setCustomStoreUids(prev =>
            prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid]
        )
    }

    // Get print preview
    const handlePreview = async () => {
        try {
            setPrintError(null)
            const storeUids = selectedStoreIds.length > 0 ? selectedStoreIds : null
            const preview = await printApi.getPreview(storeUids, null, batchSize, printDateFrom, printDateTo)
            setPreviewData(preview)
            setShowPreview(true)
        } catch (err) {
            setPrintError(`Failed to get preview: ${err.message}`)
            toastError(err)
        }
    }

    /**
     * Opens the native print dialog for a batch PDF.
     * Uses blob-based fetching (avoids CORS) and chunked splitting
     * to protect low-RAM printers from spooler overload.
     */
    const openPrintDialog = (batchId) => {
        setPrintProgress({ current: 0, total: 1 })
        printBatchPdf(batchId, {
            chunkSize: printChunkSize,
            delayBetweenMs: printChunkDelay,
            onProgress: (progress) => setPrintProgress(progress),
            onComplete: () => setPrintProgress(null),
            onError: (err) => {
                setPrintProgress(null)
                setPrintError(`Print failed: ${err.message}`)
            },
        })
    }

    // Generate print batch with batch size limit
    const handlePrint = async () => {
        if (isPrinting) return

        setIsPrinting(true)
        setPrintError(null)
        setPrintResult(null)

        try {
            // First get the preview to get all order UIDs
            const storeUids = selectedStoreIds.length > 0 ? selectedStoreIds : null
            const preview = await printApi.getPreview(storeUids, null, batchSize, printDateFrom, printDateTo)

            if (!preview.total_orders || preview.total_orders === 0) {
                setPrintError('No orders available to print')
                setIsPrinting(false)
                return
            }

            // Collect all order UIDs from groups (respect batch size)
            const allOrderUids = []
            for (const group of preview.groups) {
                for (const order of group.orders) {
                    if (allOrderUids.length < batchSize) {
                        allOrderUids.push(order.uid)
                    }
                }
            }

            if (allOrderUids.length === 0) {
                setPrintError('No orders with AWB labels available')
                setIsPrinting(false)
                return
            }

            // Generate the batch
            const result = await printApi.generateBatch(allOrderUids)
            setPrintResult(result)
            toastSuccess(`Batch generat: ${result.printed_orders ?? allOrderUids.length} comenzi`)

            // Open native print dialog
            if (result.batch_id) {
                openPrintDialog(result.batch_id)
            }

            // Immediately refresh dashboard data so printed orders disappear
            queryClient.invalidateQueries({ queryKey: ['stores'] })
            queryClient.invalidateQueries({ queryKey: ['orders'] })
            queryClient.invalidateQueries({ queryKey: ['print', 'history'] })
            setPreviewData(null)
        } catch (err) {
            const detail = err.response?.data?.detail || err.message
            setPrintError(`Print failed: ${detail}`)
            toastError(detail)
        } finally {
            setIsPrinting(false)
        }
    }

    // Sync type badge config — covers the new 4-tier strategy plus legacy keys
    // and product/custom/full syncs.
    const getSyncTypeBadge = (syncType) => {
        const config = {
            'incremental': { label: 'Incremental', className: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' },
            'recent_7d': { label: '7 Days', className: 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300' },
            'window_30d': { label: '30 Days', className: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' },
            'deep_90d': { label: '90 Days', className: 'bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300' },
            'full': { label: 'Full', className: 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300' },
            'custom': { label: 'Custom', className: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' },
            'product': { label: 'Products', className: 'bg-teal-100 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300' },
            // Legacy keys (kept so historic SyncLog rows still render correctly)
            '3_day': { label: '3 Days (legacy)', className: 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300' },
            '45_day': { label: '45 Days (legacy)', className: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' },
        }
        return config[syncType] || { label: syncType || '—', className: 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300' }
    }

    const getStatusBadge = (status) => {
        const config = {
            'running': { label: 'Running', className: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 animate-pulse' },
            'completed': { label: 'Completed', className: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300' },
            'failed': { label: 'Failed', className: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' },
        }
        return config[status] || { label: status, className: 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300' }
    }

    const formatDuration = (start, end) => {
        if (!start || !end) return '-'
        const ms = new Date(end) - new Date(start)
        if (ms < 1000) return '<1s'
        const secs = Math.floor(ms / 1000)
        if (secs < 60) return `${secs}s`
        const mins = Math.floor(secs / 60)
        const remSecs = secs % 60
        return `${mins}m ${remSecs}s`
    }

    if (storesLoading) {
        return (
            <div className="p-6 flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        )
    }

    if (storesError) {
        return (
            <div className="p-6">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                    <p className="text-red-600 dark:text-red-400">
                        Failed to load stores. Make sure the backend is running.
                    </p>
                    <p className="text-sm text-red-500 dark:text-red-500 mt-1">
                        {storesError.message}
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="p-6 pb-28 space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Dashboard</h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                        Privire de ansamblu asupra magazinelor și comenzilor în așteptare
                    </p>
                </div>

                {/* Last-sync badge + custom-sync trigger. Tier syncs live in the
                    topbar SyncMenu now. */}
                <div className="flex items-center gap-3">
                    {syncStatus?.last_sync && (
                        <span className="text-xs text-zinc-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Ultima sincronizare: {formatDistanceToNow(new Date(syncStatus.last_sync), { addSuffix: true })}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => setShowCustomSync((v) => !v)}
                        disabled={triggerSync.isPending || syncStatus?.status === 'running'}
                        className="px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-500/50 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Filter className="w-3.5 h-3.5" />
                        Custom sync
                    </button>
                    {/* Legacy inline menu kept hidden to preserve handler bindings during the
                        Phase 2 refactor — sync tiers now live in the topbar SyncMenu. */}
                    <div className="relative hidden">
                        <div className="flex">
                            <button
                                onClick={() => handleSync('window_30d')}
                                disabled={triggerSync.isPending || syncStatus?.status === 'running'}
                                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-l-lg text-sm font-medium transition-all flex items-center gap-2 disabled:opacity-50 "
                            >
                                <RefreshCw className={`w-4 h-4 ${(triggerSync.isPending || syncStatus?.status === 'running') ? 'animate-spin' : ''}`} />
                                Sync 30 Days
                            </button>
                            <button
                                onClick={() => setShowSyncMenu(!showSyncMenu)}
                                disabled={triggerSync.isPending || syncStatus?.status === 'running'}
                                className="px-2 py-2 bg-primary-700 hover:bg-primary-800 text-white rounded-r-lg border-l border-primary-500/50 disabled:opacity-50 transition-all "
                            >
                                <ChevronDown className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Dropdown Menu */}
                        {showSyncMenu && (
                            <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xl z-50 py-1 animate-fade-in">
                                <button
                                    onClick={() => handleSync('incremental')}
                                    className="w-full px-4 py-2.5 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 flex items-center gap-3 transition-colors"
                                >
                                    <Activity className="w-4 h-4 text-emerald-500" />
                                    <div>
                                        <div className="font-medium">Quick refresh</div>
                                        <div className="text-xs text-zinc-400">Only orders changed since last sync</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => handleSync('recent_7d')}
                                    className="w-full px-4 py-2.5 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 flex items-center gap-3 transition-colors"
                                >
                                    <Clock className="w-4 h-4 text-sky-500" />
                                    <div>
                                        <div className="font-medium">Sync 7 days</div>
                                        <div className="text-xs text-zinc-400">Last 7 days, updated_at window</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => handleSync('window_30d')}
                                    className="w-full px-4 py-2.5 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 flex items-center gap-3 transition-colors"
                                >
                                    <Clock className="w-4 h-4 text-blue-500" />
                                    <div>
                                        <div className="font-medium">Sync 30 days</div>
                                        <div className="text-xs text-zinc-400">Last 30 days, catches late status changes</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => handleSync('deep_90d')}
                                    className="w-full px-4 py-2.5 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 flex items-center gap-3 transition-colors"
                                >
                                    <Clock className="w-4 h-4 text-primary-500" />
                                    <div>
                                        <div className="font-medium">Deep sync (90 days)</div>
                                        <div className="text-xs text-zinc-400">Long-tail catch-up</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => handleSync('full')}
                                    className="w-full px-4 py-2.5 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 flex items-center gap-3 transition-colors"
                                >
                                    <RefreshCw className="w-4 h-4 text-purple-500" />
                                    <div>
                                        <div className="font-medium">Full Sync</div>
                                        <div className="text-xs text-zinc-400">All orders, all time</div>
                                    </div>
                                </button>
                                <hr className="border-zinc-200 dark:border-zinc-700 my-1" />
                                <button
                                    onClick={() => { setShowCustomSync(!showCustomSync); setShowSyncMenu(false) }}
                                    className="w-full px-4 py-2.5 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 flex items-center gap-3 transition-colors"
                                >
                                    <Filter className="w-4 h-4 text-amber-500" />
                                    <div>
                                        <div className="font-medium">Custom Sync</div>
                                        <div className="text-xs text-zinc-400">Choose stores & date range</div>
                                    </div>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Close dropdown when clicking outside */}
            {showSyncMenu && (
                <div className="fixed inset-0 z-40" onClick={() => setShowSyncMenu(false)} />
            )}

            {/* Custom Sync Panel */}
            {showCustomSync && (
                <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-amber-300 dark:border-amber-500/30 p-5 shadow-sm animate-fade-in">
                    <div className="flex items-center gap-2 mb-4">
                        <Filter className="w-5 h-5 text-amber-500" />
                        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">Custom Sync</h2>
                        <button
                            onClick={() => setShowCustomSync(false)}
                            className="ml-auto text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-sm"
                        >
                            Cancel
                        </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1.4fr] gap-4">
                        {/* Date Range — manual + quick presets */}
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                    <Calendar className="w-3 h-3" /> Date From <span className="text-amber-500">*</span>
                                </label>
                                <input
                                    type="date"
                                    value={customDateFrom}
                                    onChange={(e) => setCustomDateFrom(e.target.value)}
                                    className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white dark:[color-scheme:dark] text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                    <Calendar className="w-3 h-3" /> Date To
                                </label>
                                <input
                                    type="date"
                                    value={customDateTo}
                                    onChange={(e) => setCustomDateTo(e.target.value)}
                                    className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white dark:[color-scheme:dark] text-sm"
                                />
                            </div>
                        </div>

                        {/* Quick-period buttons */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                <Clock className="w-3 h-3" /> Quick periods
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    { label: 'Azi', days: 1 },
                                    { label: 'Ultimele 2 zile', days: 2 },
                                    { label: 'Ultimele 7 zile', days: 7 },
                                    { label: 'Ultimele 30 zile', days: 30 },
                                ].map(p => (
                                    <button
                                        key={p.days}
                                        onClick={() => setQuickRange(p.days)}
                                        className="px-3 py-2 text-xs font-medium rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:border-amber-300 dark:hover:border-amber-500/50 hover:bg-amber-50 dark:hover:bg-amber-500/5 transition-colors"
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Store Selection — with search, Select all, country grouping */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                    <Store className="w-3 h-3" />
                                    Stores
                                    <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${customStoreUids.length === 0 ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'}`}>
                                        {customStoreUids.length === 0 ? 'toate' : `${customStoreUids.length} / ${stores.length}`}
                                    </span>
                                </label>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setCustomStoreUids(allVisibleSelected ? [] : visibleStoreUids)}
                                        className="text-[11px] font-medium text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
                                    >
                                        {allVisibleSelected ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                                        {allVisibleSelected ? 'Niciunul' : 'Toate'}
                                    </button>
                                    {customStoreUids.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setCustomStoreUids([])}
                                            className="text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                            title="Resetează la TOATE"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="relative mb-2">
                                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                                <input
                                    type="text"
                                    value={customStoreSearch}
                                    onChange={(e) => setCustomStoreSearch(e.target.value)}
                                    placeholder="Caută magazin..."
                                    className="w-full pl-7 pr-7 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-xs"
                                />
                                {customStoreSearch && (
                                    <button onClick={() => setCustomStoreSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                            <div className="max-h-[180px] overflow-y-auto space-y-2 pr-1">
                                {Object.entries(storeGroups).filter(([, list]) => list.length > 0).map(([country, list]) => (
                                    <div key={country}>
                                        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500 mb-1">
                                            <span>{country === 'other' ? 'Alte' : country.replace('.', '').toUpperCase()}</span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const groupUids = list.map(s => s.uid)
                                                    const allInGroupSelected = groupUids.every(uid => customStoreUids.includes(uid))
                                                    if (allInGroupSelected) {
                                                        setCustomStoreUids(prev => prev.filter(uid => !groupUids.includes(uid)))
                                                    } else {
                                                        setCustomStoreUids(prev => [...new Set([...prev, ...groupUids])])
                                                    }
                                                }}
                                                className="normal-case font-normal text-[10px] text-primary-600 dark:text-primary-400 hover:underline"
                                            >
                                                {list.every(s => customStoreUids.includes(s.uid)) ? 'des.' : `+${list.length}`}
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {list.map(s => {
                                                const selected = customStoreUids.includes(s.uid)
                                                return (
                                                    <button
                                                        key={s.uid}
                                                        type="button"
                                                        onClick={() => toggleCustomStore(s.uid)}
                                                        className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition-colors ${selected
                                                            ? 'bg-primary-50 dark:bg-primary-500/15 border-primary-300 dark:border-primary-500/50 text-primary-700 dark:text-primary-300'
                                                            : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600'}`}
                                                    >
                                                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color_code || '#6B7280' }} />
                                                        {s.name}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                ))}
                                {visibleStoreUids.length === 0 && (
                                    <div className="text-xs text-zinc-400 text-center py-4">Niciun magazin găsit</div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 mt-4 flex-wrap">
                        <button
                            onClick={handleCustomSync}
                            disabled={!customDateFrom || triggerSync.isPending}
                            className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2"
                        >
                            <RefreshCw className={`w-4 h-4 ${triggerSync.isPending ? 'animate-spin' : ''}`} />
                            Start Custom Sync
                        </button>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {customStoreUids.length === 0
                                ? <span className="font-medium text-primary-600 dark:text-primary-400">Toate magazinele</span>
                                : customStoreUids.length === stores.length
                                    ? <span className="font-medium text-primary-600 dark:text-primary-400">Toate magazinele ({stores.length})</span>
                                    : <span className="font-medium">{customStoreUids.length} magazine</span>}
                            {customDateFrom && <> · de la <strong>{customDateFrom}</strong></>}
                            {customDateTo && <> până la <strong>{customDateTo}</strong></>}
                        </span>
                    </div>
                </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-zinc-900 rounded-xl p-5 border border-zinc-200 dark:border-zinc-800 hover:border-emerald-500/30 transition-colors">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
                            <Printer className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Ready to Print</span>
                    </div>
                    <p className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mt-2">{selectedPrintable.toLocaleString()}</p>
                    {selectedUnprinted > selectedPrintable && (
                        <p className="text-xs text-zinc-400 mt-1">
                            ({selectedUnprinted - selectedPrintable} not ready)
                        </p>
                    )}
                </div>

                <div className="bg-white dark:bg-zinc-900 rounded-xl p-5 border border-zinc-200 dark:border-zinc-800 hover:border-amber-500/30 transition-colors">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center">
                            <TrendingUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        </div>
                        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Active Stores</span>
                    </div>
                    <p className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mt-2">{stores.length}</p>
                </div>

                <div className="bg-white dark:bg-zinc-900 rounded-xl p-5 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/30 transition-colors">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center">
                            <Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Batch Size</span>
                    </div>
                    <p className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mt-2">{batchSize}</p>
                    <p className="text-xs text-zinc-400 mt-1">max orders per batch</p>
                </div>
            </div>

            {/* Print Status Messages */}
            {printError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-red-600 dark:text-red-400 font-medium">Print Error</p>
                        <p className="text-sm text-red-500">{printError}</p>
                    </div>
                </div>
            )}

            {printResult && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-green-600 dark:text-green-400 font-medium">Batch Generated Successfully</p>
                        <p className="text-sm text-green-600 dark:text-green-500">
                            Batch #{printResult.batch_number}: {printResult.order_count} orders in {printResult.group_count} groups
                        </p>
                        {printResult.held_duplicates > 0 && (
                            <p className="text-sm text-amber-600 dark:text-amber-400 mt-1 font-medium">
                                ⚠️ {printResult.held_duplicates} duplicate order(s) were put on hold — review in Duplicates tab
                            </p>
                        )}
                        {printResult.skipped_count > 0 && (
                            <div className="mt-1">
                                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                                    ⚠️ {printResult.skipped_count} order(s) skipped — AWB label unavailable from Frisbo
                                </p>
                                <p className="text-xs text-amber-500 dark:text-amber-500 mt-0.5">
                                    Skipped: {printResult.skipped_orders?.map(o => o.order_number).join(', ')}
                                </p>
                            </div>
                        )}
                        <button
                            onClick={() => openPrintDialog(printResult.batch_id)}
                            className="inline-flex items-center gap-1 text-sm text-green-700 dark:text-green-400 hover:underline mt-1 bg-transparent border-none cursor-pointer p-0"
                        >
                            <Printer className="w-4 h-4" />
                            Print Again
                        </button>
                    </div>
                </div>
            )}

            {/* Print Progress — shown during chunked printing */}
            {printProgress && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex items-center gap-3 animate-pulse">
                    <RefreshCw className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-blue-700 dark:text-blue-300 font-medium">
                            Printing chunk {printProgress.current} of {printProgress.total}
                        </p>
                        <p className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">
                            Close the print dialog to continue to the next chunk
                        </p>
                        <div className="mt-2 h-1.5 bg-blue-100 dark:bg-blue-900/40 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                style={{ width: `${(printProgress.current / printProgress.total) * 100}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Print Preview Modal */}
            {showPreview && previewData && (
                <PrintPreview
                    previewData={previewData}
                    onClose={() => setShowPreview(false)}
                    onPrint={async () => {
                        setIsPrinting(true)
                        try {
                            // Collect all order UIDs from groups (respect batch size)
                            const allOrderUids = []
                            for (const group of previewData.groups) {
                                for (const order of group.orders) {
                                    if (allOrderUids.length < batchSize) {
                                        allOrderUids.push(order.uid)
                                    }
                                }
                            }

                            if (allOrderUids.length === 0) {
                                setPrintError('No orders with AWB labels available')
                                return
                            }

                            // Generate the batch
                            const result = await printApi.generateBatch(allOrderUids)
                            setPrintResult(result)
                            setShowPreview(false)
                            setPreviewData(null)
                            toastSuccess(`Batch generat: ${result.printed_orders ?? allOrderUids.length} comenzi`)

                            // Open native print dialog
                            if (result.batch_id) {
                                openPrintDialog(result.batch_id)
                            }

                            // Immediately refresh dashboard data so printed orders disappear
                            queryClient.invalidateQueries({ queryKey: ['stores'] })
                            queryClient.invalidateQueries({ queryKey: ['orders'] })
                            queryClient.invalidateQueries({ queryKey: ['print', 'history'] })
                        } catch (err) {
                            const detail = err.response?.data?.detail || err.message
                            setPrintError(`Print failed: ${detail}`)
                            toastError(detail)
                        } finally {
                            setIsPrinting(false)
                        }
                    }}
                    isPrinting={isPrinting}
                />
            )}

            {/* Empty State */}
            {stores.length === 0 && (
                <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800/60 rounded-xl p-10 text-center">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 flex items-center justify-center mb-4">
                        <Package className="w-8 h-8 text-zinc-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-1">No stores yet</h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">
                        Stores will appear here after syncing orders from Frisbo.
                    </p>
                    <button
                        onClick={() => handleSync('window_30d')}
                        disabled={triggerSync.isPending}
                        className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-all "
                    >
                        Sync Now
                    </button>
                </div>
            )}

            {/* Store Selection */}
            {stores.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4 tracking-tight">
                        Select Stores to Print
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                        {stores.map((store) => (
                            <StoreCard key={store.uid} store={{
                                id: store.uid,
                                name: store.name,
                                color: store.color_code,
                                unfulfilledCount: store.printable_count || 0
                            }} />
                        ))}
                    </div>
                </div>
            )}

            {/* ═══════════════════ System Monitoring ═══════════════════ */}
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-5 h-5 text-primary-500" />
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">System Monitoring</h2>
                    <span className="text-xs text-zinc-400 ml-auto">Last {syncHistory.length} syncs</span>
                </div>

                {syncHistory.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-6">No sync history yet. Trigger a sync to see results here.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
                                    <th className="pb-2 font-medium">Type</th>
                                    <th className="pb-2 font-medium">Status</th>
                                    <th className="pb-2 font-medium">Started</th>
                                    <th className="pb-2 font-medium">Duration</th>
                                    <th className="pb-2 font-medium text-right">Fetched</th>
                                    <th className="pb-2 font-medium text-right">New</th>
                                    <th className="pb-2 font-medium text-right">Updated</th>
                                    <th className="pb-2 font-medium">Filters</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                {syncHistory.map((log) => {
                                    const typeBadge = getSyncTypeBadge(log.sync_type)
                                    const statusBadge = getStatusBadge(log.status)
                                    const storeNames = log.store_uids
                                        ? log.store_uids.map(uid => stores.find(s => s.uid === uid)?.name || uid.slice(0, 8)).join(', ')
                                        : null
                                    return (
                                        <tr key={log.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/20">
                                            <td className="py-2.5 pr-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeBadge.className}`}>
                                                    {typeBadge.label}
                                                </span>
                                            </td>
                                            <td className="py-2.5 pr-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge.className}`}>
                                                    {statusBadge.label}
                                                </span>
                                            </td>
                                            <td className="py-2.5 pr-3 text-zinc-600 dark:text-zinc-400">
                                                {log.started_at
                                                    ? format(new Date(log.started_at), 'MMM d, HH:mm')
                                                    : '-'}
                                            </td>
                                            <td className="py-2.5 pr-3 text-zinc-600 dark:text-zinc-400 font-mono text-xs">
                                                {formatDuration(log.started_at, log.completed_at)}
                                            </td>
                                            <td className="py-2.5 pr-3 text-right font-medium text-zinc-900 dark:text-white">
                                                {(log.orders_fetched || 0).toLocaleString()}
                                            </td>
                                            <td className="py-2.5 pr-3 text-right text-emerald-600 dark:text-emerald-400">
                                                +{log.orders_new || 0}
                                            </td>
                                            <td className="py-2.5 pr-3 text-right text-blue-600 dark:text-blue-400">
                                                {log.orders_updated || 0}
                                            </td>
                                            <td className="py-2.5 text-xs text-zinc-500 dark:text-zinc-400 max-w-[200px] truncate">
                                                {log.sync_type === 'custom' ? (
                                                    <span>
                                                        {storeNames && <span title={storeNames}>{storeNames}</span>}
                                                        {log.date_from && (
                                                            <span className="ml-1">
                                                                {format(new Date(log.date_from), 'MM/dd')}
                                                                {log.date_to && ` - ${format(new Date(log.date_to), 'MM/dd')}`}
                                                            </span>
                                                        )}
                                                    </span>
                                                ) : log.error_message ? (
                                                    <span className="text-red-500 dark:text-red-400" title={log.error_message}>
                                                        {log.error_message.slice(0, 40)}...
                                                    </span>
                                                ) : (
                                                    <span className="text-zinc-400">-</span>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Floating Bottom Action Bar */}
            {(selectedPrintable > 0 || totalPrintable > 0) && (
                <div className="fixed bottom-0 left-64 right-0 z-30 bg-white/80 dark:bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-200 dark:border-zinc-800 px-6 py-4">
                    <div className="flex items-center justify-between max-w-full">
                        <div className="flex items-center gap-6 text-sm">
                            <div>
                                <span className="text-zinc-500 dark:text-zinc-400 font-medium">BATCH SELECTION</span>
                                <p className="text-zinc-900 dark:text-white font-semibold">
                                    {selectedStoreIds.length > 0 ? `${selectedStoreIds.length} Store${selectedStoreIds.length > 1 ? 's' : ''} selected for printing` : 'All stores'}
                                </p>
                            </div>
                            <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-700" />
                            <div>
                                <span className="text-zinc-500 dark:text-zinc-400 font-medium">READY TO PRINT</span>
                                <p className="text-zinc-900 dark:text-white font-semibold">
                                    {selectedPrintable.toLocaleString()} orders
                                    {selectedUnprinted > selectedPrintable && <span className="text-xs text-zinc-400 font-normal ml-1">({selectedUnprinted - selectedPrintable} without AWB)</span>}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg px-3 py-2 mr-2 border border-zinc-200 dark:border-zinc-700">
                                <Calendar className="w-4 h-4 text-zinc-400" />
                                <input
                                    type="date"
                                    value={printDateFrom}
                                    onChange={(e) => setPrintDateFrom(e.target.value)}
                                    className="bg-transparent text-sm text-zinc-700 dark:text-zinc-300 outline-none w-32 dark:[color-scheme:dark]"
                                />
                                <span className="text-zinc-400">-</span>
                                <input
                                    type="date"
                                    value={printDateTo}
                                    onChange={(e) => setPrintDateTo(e.target.value)}
                                    className="bg-transparent text-sm text-zinc-700 dark:text-zinc-300 outline-none w-32 dark:[color-scheme:dark]"
                                />
                            </div>
                            <button
                                onClick={handlePreview}
                                className="px-5 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-all flex items-center gap-2 border border-zinc-200 dark:border-zinc-700"
                            >
                                <Eye className="w-4 h-4" />
                                Preview Batch
                            </button>
                            <button
                                onClick={handlePrint}
                                disabled={isPrinting}
                                className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium transition-all flex items-center gap-2 "
                            >
                                {isPrinting ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        Generating...
                                    </>
                                ) : (
                                    <>
                                        <Printer className="w-4 h-4" />
                                        Generate Print Batch ({Math.min(selectedPrintable, batchSize)} orders)
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
