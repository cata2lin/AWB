import { useState } from 'react'

/**
 * Minimal CSS tooltip — no portal, no JS positioning lib. Renders a small
 * dark bubble on hover/focus of the wrapped element.
 *
 * Limitations: the tooltip can be clipped by `overflow: hidden` ancestors.
 * That's acceptable for icon-only buttons inside toolbars; for portal-needing
 * cases (e.g., tooltip inside a sticky table cell that scrolls horizontally)
 * fall back to the lucide `title` attribute.
 */
export default function Tooltip({
    label,
    children,
    side = 'top',
    delay = 200,
    className = '',
}) {
    const [open, setOpen] = useState(false)
    const [timer, setTimer] = useState(null)

    if (!label) return children

    const show = () => {
        if (timer) clearTimeout(timer)
        setTimer(setTimeout(() => setOpen(true), delay))
    }
    const hide = () => {
        if (timer) { clearTimeout(timer); setTimer(null) }
        setOpen(false)
    }

    const SIDE = {
        top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
        bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
        left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
        right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
    }

    return (
        <span
            className={`relative inline-flex ${className}`}
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
        >
            {children}
            {open && (
                <span
                    role="tooltip"
                    className={`pointer-events-none absolute ${SIDE[side]} z-50 whitespace-nowrap rounded-md bg-zinc-900 dark:bg-zinc-100 px-2 py-1 text-[11px] font-medium text-white dark:text-zinc-900 shadow-lg`}
                >
                    {label}
                </span>
            )}
        </span>
    )
}
