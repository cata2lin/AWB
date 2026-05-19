import Spinner from './Spinner'

/**
 * Section-level loading overlay. Renders `children` underneath a translucent
 * scrim with a centered spinner when `loading` is true. Keeps the surrounding
 * dimensions stable — no "blank then data appears" flicker.
 *
 * Use this for analytics tables and KPI grids; for full-page loads use the
 * `loading` prop on `DataTable` directly.
 */
export default function LoadingOverlay({
    loading,
    label,
    children,
    minHeight = 'auto',
    className = '',
}) {
    return (
        <div className={`relative ${className}`} style={{ minHeight }}>
            {children}
            {loading && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/70 dark:bg-zinc-900/60 backdrop-blur-[1px] rounded-xl">
                    <Spinner size="lg" className="text-primary-500" />
                    {label && (
                        <span className="text-sm text-zinc-600 dark:text-zinc-300 font-medium">
                            {label}
                        </span>
                    )}
                </div>
            )}
        </div>
    )
}
