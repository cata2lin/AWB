import { Calendar, Layers } from 'lucide-react'

/**
 * PeriodFilter — extracts the pattern used by ContributionMarginPnl: a mode
 * toggle (Trimestru / Lună) + a row of period chips + an optional "Analizează"
 * action button.
 *
 * Caller supplies:
 *   mode:    'quarter' | 'month'
 *   onModeChange(next)
 *   items:   [{ key, label }, ...]            (the chips to render)
 *   value:   selected item key (or null)
 *   onChange(item)                            (called on chip click)
 *   onAnalyze:  optional callback for the right-side action button
 *   analyzing:  boolean → spinner on the button
 */
export default function PeriodFilter({
    mode,
    onModeChange,
    items = [],
    value,
    onChange,
    onAnalyze,
    analyzing = false,
    analyzeLabel = 'Analizează',
    className = '',
}) {
    return (
        <div className={`bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 ${className}`}>
            <div className="flex flex-wrap items-center gap-2">
                {/* Mode toggle */}
                {onModeChange && (
                    <>
                        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden mr-1">
                            <button
                                type="button"
                                onClick={() => onModeChange('quarter')}
                                className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${mode === 'quarter'
                                    ? 'bg-primary-600 text-white'
                                    : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                                    }`}
                            >
                                <Layers size={13} /> Trimestru
                            </button>
                            <button
                                type="button"
                                onClick={() => onModeChange('month')}
                                className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${mode === 'month'
                                    ? 'bg-primary-600 text-white'
                                    : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                                    }`}
                            >
                                <Calendar size={13} /> Lună
                            </button>
                        </div>
                        <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700 mx-1 hidden sm:block" />
                    </>
                )}

                {/* Period chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                    {items.map((item) => {
                        const active = value === item.key
                        return (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => onChange?.(item)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${active
                                    ? 'bg-primary-600 text-white shadow-sm'
                                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                                    }`}
                            >
                                {item.label}
                            </button>
                        )
                    })}
                </div>

                {/* Action button on the right */}
                {onAnalyze && (
                    <>
                        <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700 mx-1 ml-auto hidden sm:block" />
                        <button
                            type="button"
                            onClick={onAnalyze}
                            disabled={analyzing || !value}
                            className="px-4 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-1.5"
                        >
                            {analyzing && (
                                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                                    <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                </svg>
                            )}
                            {analyzeLabel}
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}
