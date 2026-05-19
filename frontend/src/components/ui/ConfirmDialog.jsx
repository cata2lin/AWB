import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import Button from './Button'

export default function ConfirmDialog({
    open,
    title = 'Confirmare',
    description,
    confirmLabel = 'Confirmă',
    cancelLabel = 'Anulează',
    variant = 'danger',
    onConfirm,
    onCancel,
    loading = false,
}) {
    useEffect(() => {
        if (!open) return
        const onKey = (e) => {
            if (e.key === 'Escape' && !loading) onCancel?.()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onCancel, loading])

    if (!open) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
            onClick={() => !loading && onCancel?.()}
        >
            <div
                className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-2xl w-full max-w-md mx-4"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {variant === 'danger' && <AlertTriangle className="w-5 h-5 text-red-500" />}
                        <h3 className="font-semibold text-zinc-900 dark:text-white">{title}</h3>
                    </div>
                    <button
                        type="button"
                        onClick={() => !loading && onCancel?.()}
                        disabled={loading}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 disabled:opacity-50"
                        aria-label="Închide"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                {description && (
                    <div className="px-5 py-4 text-sm text-zinc-700 dark:text-zinc-300">
                        {description}
                    </div>
                )}
                <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-end gap-2">
                    <Button variant="ghost" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
                    <Button variant={variant} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
                </div>
            </div>
        </div>
    )
}

