/**
 * Skeleton loaders — perceived-performance placeholders shown while data loads,
 * instead of a bare spinner. Dark-mode aware. Use TableSkeleton in DataTable's
 * loading branch and CardSkeleton for KPI grids.
 */

export function Skeleton({ className = '' }) {
    return (
        <div
            className={`animate-pulse rounded bg-zinc-200/70 dark:bg-zinc-700/50 ${className}`}
        />
    )
}

/** Placeholder rows for a table body while it loads. */
export function TableSkeleton({ rows = 8, cols = 5 }) {
    return (
        <div className="space-y-2 p-2" aria-hidden>
            {Array.from({ length: rows }).map((_, r) => (
                <div key={r} className="flex gap-3">
                    {Array.from({ length: cols }).map((_, c) => (
                        <Skeleton
                            key={c}
                            className={`h-5 ${c === 0 ? 'w-40' : 'flex-1'}`}
                        />
                    ))}
                </div>
            ))}
        </div>
    )
}

/** Placeholder card for a KPI grid cell. */
export function CardSkeleton() {
    return (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800/50 p-4 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-20" />
        </div>
    )
}

export default Skeleton
