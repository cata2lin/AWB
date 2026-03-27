import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../store/useAppStore'
import { useStores, useSyncStatus, useTriggerSync, useOrderStats, useSyncHistory } from '../hooks/useApi'
import { printApi } from '../services/api'
import StoreCard from '../components/StoreCard'
import PrintPreview from '../components/PrintPreview'
import { Package, Printer, TrendingUp, RefreshCw, Clock, Download, Eye, AlertCircle, CheckCircle, ChevronDown, Calendar, Store, Activity, Filter } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'

export default function Dashboard() {
    const { selectedStoreIds, batchSize } = useAppStore()
    const queryClient = useQueryClient()
    const [isPrinting, setIsPrinting] = useState(false)
    const [printResult, setPrintResult] = useState(null)
    const [printError, setPrintError] = useState(null)
    const [previewData, setPreviewData] = useState(null)
    const [showPreview, setShowPreview] = useState(false)

    // Sync dropdown state
    const [showSyncMenu, setShowSyncMenu] = useState(false)
    const [showCustomSync, setShowCustomSync] = useState(false)
    const [customStoreUids, setCustomStoreUids] = useState([])
    const [customDateFrom, setCustomDateFrom] = useState('')
    const [customDateTo, setCustomDateTo] = useState('')

    // Fetch data from API
    const { data: stores = [], isLoading: storesLoading, error: storesError } = useStores()
    const { data: stats, isLoading: statsLoading } = useOrderStats()
    const { data: syncStatus } = useSyncStatus()
    const triggerSync = useTriggerSync()
    const { data: syncHistory = [] } = useSyncHistory(15)

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

    const handleSync = (syncType = '45_day') => {
        setShowSyncMenu(false)
        triggerSync.mutate({ sync_type: syncType })
    }

    const handleCustomSync = () => {
        if (!customDateFrom) return
        triggerSync.mutate({
            sync_type: 'custom',
            store_uids: customStoreUids.length > 0 ? customStoreUids : null,
            date_from: customDateFrom ? new Date(customDateFrom).toISOString() : null,
            date_to: customDateTo ? new Date(customDateTo + 'T23:59:59').toISOString() : null,
        })
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
            const preview = await printApi.getPreview(storeUids, null, batchSize)
            setPreviewData(preview)
            setShowPreview(true)
        } catch (err) {
            setPrintError(`Failed to get preview: ${err.message}`)
        }
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
            const preview = await printApi.getPreview(storeUids)

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

            // Auto-download the PDF
            if (result.batch_id) {
                const downloadUrl = printApi.getDownloadUrl(result.batch_id)
                window.open(downloadUrl, '_blank')
            }

            // Immediately refresh dashboard data so printed orders disappear
            queryClient.invalidateQueries({ queryKey: ['stores'] })
            queryClient.invalidateQueries({ queryKey: ['orders'] })
            queryClient.invalidateQueries({ queryKey: ['print', 'history'] })
            setPreviewData(null)
        } catch (err) {
            setPrintError(`Print failed: ${err.message}`)
        } finally {
            setIsPrinting(false)
        }
    }

    // Sync type badge config
    const getSyncTypeBadge = (syncType) => {
        const config = {
            '45_day': { label: '45 Days', className: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' },
            'full': { label: 'Full', className: 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300' },
            'custom': { label: 'Custom', className: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' },
            'product': { label: 'Products', className: 'bg-teal-100 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300' },
        }
        return config[syncType] || { label: syncType || '45 Days', className: 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300' }
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
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
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
        <div className="p-6 pb-28 space-y-6 animate-fade-in bg-zinc-50 dark:bg-zinc-950 min-h-screen">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Dashboard</h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                        Overview of all stores and pending orders
                    </p>
                </div>

                {/* Sync Button with Dropdown */}
                <div className="flex items-center gap-3">
                    {syncStatus?.last_sync && (
                        <span className="text-xs text-zinc-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Last sync: {formatDistanceToNow(new Date(syncStatus.last_sync), { addSuffix: true })}
                        </span>
                    )}
                    <div className="relative">
                        <div className="flex">
                            <button
                                onClick={() => handleSync('45_day')}
                                disabled={triggerSync.isPending || syncStatus?.status === 'running'}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-l-lg text-sm font-medium transition-all flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-indigo-500/20"
                            >
                                <RefreshCw className={`w-4 h-4 ${(triggerSync.isPending || syncStatus?.status === 'running') ? 'animate-spin' : ''}`} />
                                Sync 45 Days
                            </button>
                            <button
                                onClick={() => setShowSyncMenu(!showSyncMenu)}
                                disabled={triggerSync.isPending || syncStatus?.status === 'running'}
                                className="px-2 py-2 bg-indigo-700 hover:bg-indigo-800 text-white rounded-r-lg border-l border-indigo-500/50 disabled:opacity-50 transition-all shadow-lg shadow-indigo-500/20"
                            >
                                <ChevronDown className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Dropdown Menu */}
                        {showSyncMenu && (
                            <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xl z-50 py-1 animate-fade-in">
                                <button
                                    onClick={() => handleSync('45_day')}
                                    className="w-full px-4 py-2.5 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 flex items-center gap-3 transition-colors"
                                >
                                    <Clock className="w-4 h-4 text-blue-500" />
                                    <div>
                                        <div className="font-medium">Sync 45 Days</div>
                                        <div className="text-xs text-zinc-400">Last 45 days of orders</div>
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

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Date Range */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> Date From *
                            </label>
                            <input
                                type="date"
                                value={customDateFrom}
                                onChange={(e) => setCustomDateFrom(e.target.value)}
                                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white dark:[color-scheme:dark] text-sm"
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
                                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white dark:[color-scheme:dark] text-sm"
                            />
                        </div>

                        {/* Store Selection */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                <Store className="w-3 h-3" /> Stores {customStoreUids.length > 0 ? `(${customStoreUids.length})` : '(all)'}
                            </label>
                            <div className="flex flex-wrap gap-1.5 max-h-[72px] overflow-auto">
                                {stores.map(s => (
                                    <label
                                        key={s.uid}
                                        className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg cursor-pointer border transition-colors ${
                                            customStoreUids.includes(s.uid)
                                                ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/50 text-indigo-700 dark:text-indigo-300'
                                                : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={customStoreUids.includes(s.uid)}
                                            onChange={() => toggleCustomStore(s.uid)}
                                            className="hidden"
                                        />
                                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color_code || '#6B7280' }} />
                                        {s.name}
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 mt-4">
                        <button
                            onClick={handleCustomSync}
                            disabled={!customDateFrom || triggerSync.isPending}
                            className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2"
                        >
                            <RefreshCw className={`w-4 h-4 ${triggerSync.isPending ? 'animate-spin' : ''}`} />
                            Start Custom Sync
                        </button>
                        <span className="text-xs text-zinc-400">
                            {customStoreUids.length > 0
                                ? `${customStoreUids.length} store(s) selected`
                                : 'All stores'}
                            {customDateFrom && ` · From ${customDateFrom}`}
                            {customDateTo && ` to ${customDateTo}`}
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
                        <a
                            href={printApi.getDownloadUrl(printResult.batch_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-green-700 dark:text-green-400 hover:underline mt-1"
                        >
                            <Download className="w-4 h-4" />
                            Download PDF
                        </a>
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

                            // Auto-download the PDF
                            if (result.batch_id) {
                                const downloadUrl = printApi.getDownloadUrl(result.batch_id)
                                window.open(downloadUrl, '_blank')
                            }

                            // Immediately refresh dashboard data so printed orders disappear
                            queryClient.invalidateQueries({ queryKey: ['stores'] })
                            queryClient.invalidateQueries({ queryKey: ['orders'] })
                            queryClient.invalidateQueries({ queryKey: ['print', 'history'] })
                        } catch (err) {
                            setPrintError(`Print failed: ${err.message}`)
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
                        onClick={() => handleSync('45_day')}
                        disabled={triggerSync.isPending}
                        className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-indigo-500/25 glow-btn"
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
                    <Activity className="w-5 h-5 text-indigo-500" />
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
                                className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white rounded-lg font-medium transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/25"
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
