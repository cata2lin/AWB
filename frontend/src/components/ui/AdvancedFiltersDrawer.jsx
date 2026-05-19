import { useEffect, useRef } from 'react'
import { X, RotateCcw } from 'lucide-react'

/**
 * AdvancedFiltersDrawer — slide-in side panel for per-column min/max filters.
 *
 * Generic on the column list: parent passes `fields` describing which numeric
 * columns get min/max inputs and reads the live `value` ({ field_key: {min, max} }).
 * Caller decides when to apply — typically wired through onChange on every keystroke
 * (filtering is client-side so it's cheap).
 */
export default function AdvancedFiltersDrawer({
    open,
    onClose,
    fields = [],
    value = {},
    onChange,
    onReset,
    title = 'Filtre avansate',
}) {
    const panelRef = useRef(null)

    useEffect(() => {
        if (!open) return
        const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [open, onClose])

    if (!open) return null

    const setField = (key, side, raw) => {
        const next = { ...(value || {}) }
        const cur = { ...(next[key] || { min: null, max: null }) }
        cur[side] = raw === '' ? null : Number(raw)
        if (cur.min == null && cur.max == null) {
            delete next[key]
        } else {
            next[key] = cur
        }
        onChange?.(next)
    }

    const clearField = (key) => {
        const next = { ...(value || {}) }
        delete next[key]
        onChange?.(next)
    }

    const activeCount = Object.keys(value || {}).length

    return (
        <div
            className="fixed inset-0 z-40 flex justify-end animate-fade-in"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
        >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                className="relative w-full max-w-sm h-full bg-white dark:bg-zinc-800 border-l border-zinc-200 dark:border-zinc-700 shadow-2xl flex flex-col"
            >
                <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h2>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            {activeCount > 0 ? `${activeCount} filtru(e) activ(e)` : 'Niciun filtru activ'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/60"
                        aria-label="Închide"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {fields.map((f) => {
                        const v = value?.[f.key] || {}
                        const active = v.min != null || v.max != null
                        return (
                            <div
                                key={f.key}
                                className={`p-3 rounded-lg border ${
                                    active
                                        ? 'border-primary-300 dark:border-primary-500/50 bg-primary-50/50 dark:bg-primary-500/5'
                                        : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800'
                                }`}
                            >
                                <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mb-2 flex items-center justify-between">
                                    <span>
                                        {f.label}
                                        {f.suffix && <span className="ml-1 text-[10px] text-zinc-400">{f.suffix}</span>}
                                    </span>
                                    {active && (
                                        <button
                                            type="button"
                                            onClick={() => clearField(f.key)}
                                            className="text-[10px] text-zinc-400 hover:text-red-500"
                                        >
                                            șterge
                                        </button>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                        Min
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={v.min ?? ''}
                                            onChange={(e) => setField(f.key, 'min', e.target.value)}
                                            placeholder="—"
                                            className="mt-0.5 w-full px-2 py-1.5 text-sm rounded-md border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 focus:ring-2 focus:ring-primary-500/30"
                                        />
                                    </label>
                                    <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                        Max
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={v.max ?? ''}
                                            onChange={(e) => setField(f.key, 'max', e.target.value)}
                                            placeholder="—"
                                            className="mt-0.5 w-full px-2 py-1.5 text-sm rounded-md border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 focus:ring-2 focus:ring-primary-500/30"
                                        />
                                    </label>
                                </div>
                            </div>
                        )
                    })}
                </div>

                <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={() => { onReset?.(); onChange?.({}) }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Resetează tot
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg"
                    >
                        Aplică
                    </button>
                </div>
            </div>
        </div>
    )
}
