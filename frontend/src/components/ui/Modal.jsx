import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const SIZE_CLASS = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
    full: 'max-w-[95vw]',
}

/**
 * Base Modal — single canonical implementation. Every dialog in the app
 * should compose this.
 *
 * Features:
 *  - Backdrop-blur overlay, click-outside closes (configurable)
 *  - ESC closes
 *  - Focus trap (Tab/Shift+Tab cycle inside the dialog)
 *  - Body-scroll lock while open
 *  - Three slots: header (title + close X), body, footer
 *  - Size variants: sm / md / lg / xl / full
 *  - z-index = modal layer (50/51), confirm dialogs go on z-70
 */
export default function Modal({
    open,
    onClose,
    title,
    description,
    icon: IconComp,
    children,
    footer,
    size = 'md',
    closeOnBackdrop = true,
    closeOnEsc = true,
    showClose = true,
    initialFocusRef,
    className = '',
    bodyClassName = '',
    zClass = 'z-50',
}) {
    const dialogRef = useRef(null)
    const lastActiveRef = useRef(null)
    // Callbacks change every render in many call sites (inline arrow funcs).
    // We stash the latest references so the focus-trap effect can read them
    // without listing them as deps — otherwise the effect re-fires on every
    // parent render and steals focus back from inputs the user is typing into.
    const onCloseRef = useRef(onClose)
    const closeOnEscRef = useRef(closeOnEsc)
    const initialFocusRefRef = useRef(initialFocusRef)
    useEffect(() => {
        onCloseRef.current = onClose
        closeOnEscRef.current = closeOnEsc
        initialFocusRefRef.current = initialFocusRef
    })

    // Lock body scroll while open
    useEffect(() => {
        if (!open) return
        const original = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { document.body.style.overflow = original }
    }, [open])

    // ESC + focus management — runs exactly when the modal opens/closes.
    useEffect(() => {
        if (!open) return
        lastActiveRef.current = document.activeElement

        // Move initial focus
        const moveFocus = () => {
            if (initialFocusRefRef.current?.current?.focus) {
                initialFocusRefRef.current.current.focus()
                return
            }
            const root = dialogRef.current
            if (!root) return
            const focusables = root.querySelectorAll(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
            if (focusables.length > 0) focusables[0].focus()
            else root.focus()
        }
        setTimeout(moveFocus, 0)

        const onKey = (e) => {
            if (e.key === 'Escape' && closeOnEscRef.current) {
                e.stopPropagation()
                onCloseRef.current?.()
                return
            }
            if (e.key === 'Tab') {
                const root = dialogRef.current
                if (!root) return
                const focusables = Array.from(root.querySelectorAll(
                    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )).filter((el) => !el.hasAttribute('inert'))
                if (focusables.length === 0) return
                const first = focusables[0]
                const last = focusables[focusables.length - 1]
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault()
                    last.focus()
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault()
                    first.focus()
                }
            }
        }
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('keydown', onKey)
            if (lastActiveRef.current?.focus) {
                try { lastActiveRef.current.focus() } catch { /* element may be gone */ }
            }
        }
    }, [open])

    if (!open) return null

    const handleBackdrop = (e) => {
        if (!closeOnBackdrop) return
        if (e.target === e.currentTarget) onClose?.()
    }

    return (
        <div
            className={`fixed inset-0 ${zClass} flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in`}
            onMouseDown={handleBackdrop}
            role="presentation"
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? 'modal-title' : undefined}
                aria-describedby={description ? 'modal-description' : undefined}
                tabIndex={-1}
                className={`relative w-full ${SIZE_CLASS[size] || SIZE_CLASS.md} max-h-[90vh] flex flex-col bg-white dark:bg-zinc-800 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 ${className}`}
            >
                {(title || showClose) && (
                    <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 flex items-start gap-3">
                        {IconComp && (
                            <div className="rounded-lg bg-primary-50 dark:bg-primary-500/15 p-1.5 text-primary-600 dark:text-primary-300 flex-shrink-0 mt-0.5">
                                <IconComp className="w-4 h-4" />
                            </div>
                        )}
                        <div className="min-w-0 flex-1">
                            {title && (
                                <h2
                                    id="modal-title"
                                    className="text-base font-semibold text-zinc-900 dark:text-white truncate"
                                >
                                    {title}
                                </h2>
                            )}
                            {description && (
                                <p
                                    id="modal-description"
                                    className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5"
                                >
                                    {description}
                                </p>
                            )}
                        </div>
                        {showClose && (
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Închide"
                                className="rounded-lg p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 transition-colors -mt-0.5 -mr-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                )}
                <div className={`flex-1 overflow-y-auto ${bodyClassName || 'p-5'}`}>
                    {children}
                </div>
                {footer && (
                    <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 rounded-b-xl flex items-center justify-end gap-2 flex-shrink-0">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    )
}
