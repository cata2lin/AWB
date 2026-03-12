import { Calendar, Download, FileText, AlertCircle } from 'lucide-react'
import { usePrintHistory } from '../hooks/useApi'
import { printApi } from '../services/api'

export default function History() {
    const { data: batches = [], isLoading, error } = usePrintHistory()

    const handleDownload = (batchId) => {
        window.open(printApi.getDownloadUrl(batchId), '_blank')
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
            <div>
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Print History</h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                    View and re-download previous print batches
                </p>
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
                            className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-all"
                        >
                            {/* Icon */}
                            <div className="w-12 h-12 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                                <Calendar className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                            </div>

                            {/* Info */}
                            <div className="flex-1">
                                <h3 className="font-medium text-zinc-900 dark:text-white">
                                    Batch #{batch.batch_number || batch.id}
                                </h3>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                    {batch.order_count || batch.items?.length || 0} orders
                                </p>
                            </div>

                            {/* Status */}
                            <div>
                                {batch.status === 'completed' ? (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300">
                                        Completed
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
                            <div className="text-right">
                                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                    {batch.created_at ? new Date(batch.created_at).toLocaleDateString() : '-'}
                                </p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    {batch.created_at ? new Date(batch.created_at).toLocaleTimeString() : ''}
                                </p>
                            </div>

                            {/* Download */}
                            {batch.status === 'completed' && batch.file_path && (
                                <button
                                    onClick={() => handleDownload(batch.id)}
                                    className="px-4 py-2 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                    <Download className="w-4 h-4" />
                                    Download
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
