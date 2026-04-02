import { useState } from 'react'
import { Calendar, Download, FileText, AlertCircle, ChevronDown, ChevronRight, Package, Printer, Eye } from 'lucide-react'
import { usePrintHistory, useBatchDetails } from '../hooks/useApi'
import { printApi } from '../services/api'
import { formatDistanceToNow } from 'date-fns'

function BatchDetails({ batchId }) {
    const { data, isLoading } = useBatchDetails(batchId)

    if (isLoading) {
        return (
            <div className="px-6 py-3 flex items-center gap-2 text-sm text-zinc-400">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-500"></div>
                Loading orders...
            </div>
        )
    }

    const items = data?.items || []

    if (items.length === 0) {
        return (
            <div className="px-6 py-3 text-sm text-zinc-400">
                No order details available for this batch.
            </div>
        )
    }

    // Group items by group_name
    const groups = {}
    for (const item of items) {
        const gName = item.group_name || 'Ungrouped'
        if (!groups[gName]) groups[gName] = []
        groups[gName].push(item)
    }

    return (
        <div className="border-t border-zinc-200 dark:border-zinc-700/50">
            {Object.entries(groups).map(([groupName, groupItems]) => (
                <div key={groupName}>
                    <div className="px-6 py-2 bg-zinc-50 dark:bg-zinc-800/40 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                        <Package className="w-3.5 h-3.5" />
                        {groupName}
                        <span className="text-zinc-400 dark:text-zinc-500 font-normal">({groupItems.length} orders)</span>
                    </div>
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800/40">
                        {groupItems.map((item, idx) => (
                            <div key={idx} className="px-6 py-2.5 flex items-center gap-4 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                                <span className="w-6 text-center text-zinc-400 text-xs font-mono">
                                    {item.position + 1}
                                </span>
                                <span className="font-medium text-zinc-700 dark:text-zinc-200 min-w-[120px]">
                                    {item.order_number || '-'}
                                </span>
                                <span className="text-zinc-500 dark:text-zinc-400">
                                    {item.customer_name || '-'}
                                </span>
                                <span className="text-zinc-400 dark:text-zinc-500 text-xs font-mono ml-auto">
                                    {item.tracking_number || '-'}
                                </span>
                                {item.courier_name && (
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300">
                                        {item.courier_name}
                                    </span>
                                )}
                                <button
                                    onClick={() => printApi.reprintOrder(item.order_uid)}
                                    className="text-xs px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-600 dark:text-zinc-300 transition-colors flex items-center gap-1"
                                    title="Reprint this order's AWB"
                                >
                                    <Printer className="w-3 h-3" />
                                    Reprint
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

export default function History() {
    const { data: historyData, isLoading, error } = usePrintHistory()
    const [expandedBatch, setExpandedBatch] = useState(null)

    // Handle both array and {batches: [...]} response shapes
    const batches = Array.isArray(historyData)
        ? historyData
        : (historyData?.batches || [])

    const handleDownload = (batchId) => {
        window.open(printApi.getDownloadUrl(batchId), '_blank')
    }

    const toggleExpand = (batchId) => {
        setExpandedBatch(prev => prev === batchId ? null : batchId)
    }

    if (isLoading) {
        return (
            <div className="p-6 flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="p-6">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-red-600 dark:text-red-400 font-medium">Failed to load history</p>
                        <p className="text-sm text-red-500 mt-1">{error.message}</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6 animate-fade-in bg-zinc-50 dark:bg-zinc-950 min-h-screen">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Print History</h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                        View, expand, and re-download previous print batches
                    </p>
                </div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    {batches.length} batch{batches.length !== 1 ? 'es' : ''}
                </div>
            </div>

            {/* Empty State */}
            {batches.length === 0 && (
                <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800/60 rounded-xl p-10 text-center">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 flex items-center justify-center mb-4">
                        <FileText className="w-8 h-8 text-zinc-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-1">No print history</h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Generated print batches will appear here.
                    </p>
                </div>
            )}

            {/* History List */}
            {batches.length > 0 && (
                <div className="space-y-3">
                    {batches.map((batch) => (
                        <div
                            key={batch.id}
                            className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 shadow-sm hover:shadow-md transition-all overflow-hidden"
                        >
                            {/* Batch Header Row */}
                            <div className="p-4 flex items-center gap-4">
                                {/* Expand Toggle */}
                                <button
                                    onClick={() => toggleExpand(batch.id)}
                                    className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-700/60 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                                >
                                    {expandedBatch === batch.id ? (
                                        <ChevronDown className="w-4 h-4 text-zinc-500" />
                                    ) : (
                                        <ChevronRight className="w-4 h-4 text-zinc-500" />
                                    )}
                                </button>

                                {/* Icon */}
                                <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                                    <Printer className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-medium text-zinc-900 dark:text-white truncate">
                                        {batch.batch_number || `Batch #${batch.id}`}
                                    </h3>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                        {batch.order_count || 0} orders · {batch.group_count || 0} groups
                                        {batch.file_size ? ` · ${(batch.file_size / 1024).toFixed(0)} KB` : ''}
                                    </p>
                                </div>

                                {/* Status */}
                                <div>
                                    {batch.status === 'completed' || batch.status === 'regenerated' ? (
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300">
                                            {batch.status === 'regenerated' ? 'Regenerated' : 'Completed'}
                                        </span>
                                    ) : batch.status === 'failed' ? (
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">
                                            Failed
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
                                            {batch.status || 'Pending'}
                                        </span>
                                    )}
                                </div>

                                {/* Date */}
                                <div className="text-right min-w-[90px]">
                                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                        {batch.created_at ? new Date(batch.created_at).toLocaleDateString() : '-'}
                                    </p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        {batch.created_at
                                            ? formatDistanceToNow(new Date(batch.created_at), { addSuffix: true })
                                            : ''}
                                    </p>
                                </div>

                                {/* Download */}
                                {(batch.status === 'completed' || batch.status === 'regenerated') && (
                                    <button
                                        onClick={() => handleDownload(batch.id)}
                                        className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg text-sm font-medium transition-all shadow-sm flex items-center gap-2"
                                    >
                                        <Download className="w-4 h-4" />
                                        Download
                                    </button>
                                )}
                            </div>

                            {/* Expanded Batch Details */}
                            {expandedBatch === batch.id && (
                                <BatchDetails batchId={batch.id} />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
