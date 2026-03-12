import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useStores, useSyncStatus, useTriggerSync, useOrderStats } from '../hooks/useApi'
import { printApi } from '../services/api'
import StoreCard from '../components/StoreCard'
import PrintPreview from '../components/PrintPreview'
import { Package, Printer, TrendingUp, RefreshCw, Clock, Download, Eye, AlertCircle, CheckCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export default function Dashboard() {
    const { selectedStoreIds, batchSize } = useAppStore()
    const [isPrinting, setIsPrinting] = useState(false)
    const [printResult, setPrintResult] = useState(null)
    const [printError, setPrintError] = useState(null)
    const [previewData, setPreviewData] = useState(null)
    const [showPreview, setShowPreview] = useState(false)

    // Fetch data from API
    const { data: stores = [], isLoading: storesLoading, error: storesError } = useStores()
    const { data: stats, isLoading: statsLoading } = useOrderStats()
    const { data: syncStatus } = useSyncStatus()
    const triggerSync = useTriggerSync()

    const totalUnfulfilled = stats?.unprinted_orders ?? stores.reduce((sum, s) => sum + (s.unprinted_count || 0), 0)

    // Count orders that can actually be printed (have AWB PDFs)
    const totalPrintable = stores.reduce((sum, s) => sum + (s.printable_count || 0), 0)
    const selectedPrintable = selectedStoreIds.length > 0
        ? stores.filter(s => selectedStoreIds.includes(s.uid)).reduce((sum, s) => sum + (s.printable_count || 0), 0)
        : 0

    // Also track unprinted without AWB for user info
    const selectedUnprinted = selectedStoreIds.length > 0
        ? stores.filter(s => selectedStoreIds.includes(s.uid)).reduce((sum, s) => sum + (s.unprinted_count || 0), 0)
        : 0

    const handleSync = () => {
        triggerSync.mutate()
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
        } catch (err) {
            setPrintError(`Print failed: ${err.message}`)
        } finally {
            setIsPrinting(false)
        }
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

                {/* Sync Button */}
                <div className="flex items-center gap-3">
                    {syncStatus?.last_sync && (
                        <span className="text-xs text-zinc-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Last sync: {formatDistanceToNow(new Date(syncStatus.last_sync), { addSuffix: true })}
                        </span>
                    )}
                    <button
                        onClick={handleSync}
                        disabled={triggerSync.isPending || syncStatus?.status === 'running'}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-all flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-indigo-500/20"
                    >
                        <RefreshCw className={`w-4 h-4 ${(triggerSync.isPending || syncStatus?.status === 'running') ? 'animate-spin' : ''}`} />
                        Sync Orders
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-zinc-900 rounded-xl p-5 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-500/30 transition-colors">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-500/10 flex items-center justify-center">
                            <Package className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Total Unfulfilled</span>
                    </div>
                    <p className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight mt-2">{statsLoading ? '...' : totalUnfulfilled.toLocaleString()}</p>
                </div>

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
                            ({selectedUnprinted - selectedPrintable} without AWB)
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

                            // Auto-download the PDF
                            if (result.batch_id) {
                                const downloadUrl = printApi.getDownloadUrl(result.batch_id)
                                window.open(downloadUrl, '_blank')
                            }
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
                        onClick={handleSync}
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
                                unfulfilledCount: store.unprinted_count || 0
                            }} />
                        ))}
                    </div>
                </div>
            )}

            {/* Floating Bottom Action Bar */}
            {(selectedStoreIds.length > 0 || totalUnfulfilled > 0) && (
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
                                <span className="text-zinc-500 dark:text-zinc-400 font-medium">AVAILABLE ORDERS</span>
                                <p className="text-zinc-900 dark:text-white font-semibold">
                                    {selectedUnprinted > 0 ? selectedUnprinted.toLocaleString() : totalUnfulfilled.toLocaleString()} orders
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
                                        Generate Print Batch ({selectedUnprinted > 0 ? Math.min(selectedUnprinted, batchSize) : Math.min(totalUnfulfilled, batchSize)} orders)
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
