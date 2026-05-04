/**
 * History Page — Full traceability dashboard for print batches.
 * 
 * Wraps PrintHistoryTab in a full-page layout with header.
 * Features: KPIs, batch table, search, filtering, daily chart, store distribution.
 */
import PrintHistoryTab from '../components/PrintHistoryTab'
import { Printer } from 'lucide-react'

export default function History() {
    return (
        <div className="p-6 space-y-6 animate-fade-in bg-zinc-50 dark:bg-zinc-950 min-h-screen">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/20">
                    <Printer className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Print History</h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Full traceability for all print batches, KPIs, and daily volume
                    </p>
                </div>
            </div>

            {/* Full PrintHistoryTab content */}
            <PrintHistoryTab />
        </div>
    )
}
