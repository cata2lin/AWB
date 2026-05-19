import { Rows3, Rows4 } from 'lucide-react'

/**
 * Two-state segmented toggle for table density.
 *  - comfortable: roomier rows (default Profitabilitate density)
 *  - compact:    tighter rows for >50-row tables
 */
export default function DensityToggle({ density, onChange, className = '' }) {
    const isCompact = density === 'compact'
    return (
        <div
            role="group"
            aria-label="Densitate rânduri"
            className={`inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden ${className}`}
        >
            <button
                type="button"
                onClick={() => onChange('comfortable')}
                aria-pressed={!isCompact}
                title="Densitate confortabilă"
                className={`p-1.5 transition-colors ${!isCompact
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                    }`}
            >
                <Rows3 className="w-4 h-4" />
            </button>
            <button
                type="button"
                onClick={() => onChange('compact')}
                aria-pressed={isCompact}
                title="Densitate compactă"
                className={`p-1.5 transition-colors ${isCompact
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                    }`}
            >
                <Rows4 className="w-4 h-4" />
            </button>
        </div>
    )
}
