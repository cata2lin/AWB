import { useCallback, useRef } from 'react'

/**
 * Segmented Tabs control.
 *
 * Two variants:
 *  - "underline" (default): inline pills with a primary underline on active
 *  - "pills": rounded button group (single connected segment)
 *
 * Controlled component — caller owns the active value and onChange. Pair with
 * `useSearchParams` for URL-synced tabs (see existing Analytics.jsx pattern).
 *
 * Keyboard: ArrowLeft / ArrowRight cycle through tabs. Home / End jump to ends.
 */
export default function Tabs({
    value,
    onChange,
    items = [],
    variant = 'underline',
    className = '',
    size = 'md',
    fitContent = false,
}) {
    const tabRefs = useRef({})

    const indexOf = useCallback(
        (v) => items.findIndex((t) => t.value === v),
        [items]
    )

    const moveFocus = (nextIndex) => {
        const next = items[nextIndex]
        if (next && tabRefs.current[next.value]?.focus) {
            tabRefs.current[next.value].focus()
            onChange?.(next.value)
        }
    }

    const handleKey = (e) => {
        const idx = indexOf(value)
        if (e.key === 'ArrowRight') {
            e.preventDefault()
            moveFocus((idx + 1) % items.length)
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            moveFocus((idx - 1 + items.length) % items.length)
        } else if (e.key === 'Home') {
            e.preventDefault()
            moveFocus(0)
        } else if (e.key === 'End') {
            e.preventDefault()
            moveFocus(items.length - 1)
        }
    }

    const padding = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'

    if (variant === 'pills') {
        return (
            <div
                role="tablist"
                aria-orientation="horizontal"
                onKeyDown={handleKey}
                className={`inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden ${fitContent ? '' : 'w-fit'} ${className}`}
            >
                {items.map((item) => {
                    const active = item.value === value
                    return (
                        <button
                            key={item.value}
                            ref={(el) => { tabRefs.current[item.value] = el }}
                            role="tab"
                            aria-selected={active}
                            tabIndex={active ? 0 : -1}
                            onClick={() => onChange?.(item.value)}
                            disabled={item.disabled}
                            className={`${padding} font-medium transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${active
                                ? 'bg-primary-600 text-white'
                                : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                                }`}
                        >
                            {item.icon ? <item.icon className="w-3.5 h-3.5" /> : null}
                            <span>{item.label}</span>
                            {item.badge != null && (
                                <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${active ? 'bg-white/20 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'}`}>
                                    {item.badge}
                                </span>
                            )}
                        </button>
                    )
                })}
            </div>
        )
    }

    // underline variant
    return (
        <div
            role="tablist"
            aria-orientation="horizontal"
            onKeyDown={handleKey}
            className={`flex items-end gap-1 border-b border-zinc-200 dark:border-zinc-700 overflow-x-auto ${className}`}
        >
            {items.map((item) => {
                const active = item.value === value
                return (
                    <button
                        key={item.value}
                        ref={(el) => { tabRefs.current[item.value] = el }}
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange?.(item.value)}
                        disabled={item.disabled}
                        className={`relative ${padding} font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${active
                            ? 'text-primary-700 dark:text-primary-300'
                            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                            }`}
                    >
                        {item.icon ? <item.icon className="w-3.5 h-3.5" /> : null}
                        <span>{item.label}</span>
                        {item.badge != null && (
                            <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                                {item.badge}
                            </span>
                        )}
                        {active && (
                            <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary-600 rounded-full" />
                        )}
                    </button>
                )
            })}
        </div>
    )
}

