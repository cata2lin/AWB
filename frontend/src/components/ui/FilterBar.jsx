import { Filter, X } from 'lucide-react'

export function FilterBar({ children, className = '', sticky = false }) {
    return (
        <div className={`${sticky ? 'sticky top-0 z-20' : ''} flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 ${className}`}>
            <Filter className="w-4 h-4 text-zinc-400 dark:text-zinc-500 ml-1 hidden sm:block" />
            {children}
        </div>
    )
}

export function FilterChip({
    label,
    onRemove,
    active = false,
    children,
    onClick,
    className = '',
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${active
                ? 'bg-blue-50 dark:bg-blue-500/15 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                } ${className}`}
        >
            <span>{children ?? label}</span>
            {onRemove && (
                <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onRemove() }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onRemove() } }}
                    className="rounded-full p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                    aria-label="Elimină filtru"
                >
                    <X className="w-3 h-3" />
                </span>
            )}
        </button>
    )
}

export function FilterDivider() {
    return <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1 hidden sm:block" />
}

export default FilterBar
