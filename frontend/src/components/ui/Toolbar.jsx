/**
 * Toolbar — generic horizontal action bar.
 *
 * Slots:
 *   start: content aligned to the left (filters, search, etc.)
 *   end:   content aligned to the right (actions, menus)
 *
 * Wraps gracefully on narrow viewports — every group is `flex-wrap`. The
 * `sticky` variant keeps the toolbar visible while the page scrolls.
 */
export default function Toolbar({
    start,
    end,
    children,
    sticky = false,
    className = '',
    bordered = true,
}) {
    return (
        <div
            className={`${sticky ? 'sticky top-0 z-10 backdrop-blur' : ''} ${bordered ? 'border border-zinc-200 dark:border-zinc-700' : ''} bg-white dark:bg-zinc-800 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 ${className}`}
        >
            {start && <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">{start}</div>}
            {children}
            {end && <div className="flex flex-wrap items-center gap-2 ml-auto">{end}</div>}
        </div>
    )
}

export function ToolbarDivider() {
    return <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5 hidden sm:block" />
}
