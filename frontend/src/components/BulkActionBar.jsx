import { Copy, Eye, X } from 'lucide-react'

/**
 * Floating bulk-action toolbar. Appears (fixed, bottom-center) when rows are
 * selected in a table. Ported from Scripturi's product-analytics bulk bar.
 *
 * @param {Object}   props
 * @param {number}   props.selectedCount    number of selected rows (bar hides when 0)
 * @param {Function} props.onCopySkus       copy selected SKUs to clipboard
 * @param {Function} props.onAddToWatchlist add selected SKUs to a watchlist
 * @param {Function} props.onClear          clear the current selection
 */
export default function BulkActionBar({
    selectedCount = 0,
    onCopySkus,
    onAddToWatchlist,
    onClear,
}) {
    if (!selectedCount) return null

    return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className="flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl shadow-black/10 dark:shadow-black/40 px-4 py-2.5">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200 whitespace-nowrap">
                    {selectedCount} selectate
                </span>

                <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

                <button
                    type="button"
                    onClick={onCopySkus}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-teal-100 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-500/25 transition-colors"
                >
                    <Copy className="w-3.5 h-3.5" />
                    Copiază SKU
                </button>

                <button
                    type="button"
                    onClick={onAddToWatchlist}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors"
                >
                    <Eye className="w-3.5 h-3.5" />
                    Adaugă în Watchlist
                </button>

                <button
                    type="button"
                    onClick={onClear}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                >
                    <X className="w-3.5 h-3.5" />
                    Deselectează
                </button>
            </div>
        </div>
    )
}
