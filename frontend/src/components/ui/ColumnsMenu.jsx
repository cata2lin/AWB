import { useEffect, useRef, useState } from 'react'
import { Settings2, Check, RotateCcw } from 'lucide-react'

export default function ColumnsMenu({
    columns = [],
    visibleKeys,
    onChange,
    defaultVisibleKeys,
    label = 'Coloane',
    className = '',
}) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    useEffect(() => {
        if (!open) return
        const onDocClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onDocClick)
        return () => document.removeEventListener('mousedown', onDocClick)
    }, [open])

    const toggle = (key) => {
        const next = visibleKeys.includes(key)
            ? visibleKeys.filter((k) => k !== key)
            : [...visibleKeys, key]
        onChange(next)
    }

    const toggleable = columns.filter((c) => !c.alwaysVisible && c.key)
    const allOn = toggleable.every((c) => visibleKeys.includes(c.key))

    const setAll = (on) => {
        const forced = columns.filter((c) => c.alwaysVisible && c.key).map((c) => c.key)
        if (on) onChange([...new Set([...forced, ...toggleable.map((c) => c.key)])])
        else onChange(forced)
    }

    const reset = () => {
        if (defaultVisibleKeys) onChange(defaultVisibleKeys)
    }

    const hiddenCount = toggleable.length - toggleable.filter((c) => visibleKeys.includes(c.key)).length

    return (
        <div ref={ref} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <Settings2 className="w-4 h-4" />
                <span>{label}</span>
                {hiddenCount > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                        −{hiddenCount}
                    </span>
                )}
            </button>
            {open && (
                <div className="absolute right-0 z-40 mt-1 w-60 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg overflow-hidden">
                    <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setAll(!allOn)}
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            >
                                {allOn ? 'Ascunde tot' : 'Arată tot'}
                            </button>
                            {defaultVisibleKeys && (
                                <button
                                    type="button"
                                    onClick={reset}
                                    className="text-xs text-zinc-500 hover:underline inline-flex items-center gap-1"
                                    aria-label="Resetează"
                                >
                                    <RotateCcw className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1">
                        {columns.map((col) => {
                            if (!col.key) return null
                            const isOn = visibleKeys.includes(col.key) || col.alwaysVisible
                            const locked = col.alwaysVisible
                            return (
                                <button
                                    key={col.key}
                                    type="button"
                                    onClick={() => !locked && toggle(col.key)}
                                    disabled={locked}
                                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isOn ? 'text-zinc-900 dark:text-white' : 'text-zinc-500 dark:text-zinc-400'}`}
                                >
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isOn ? 'bg-blue-600 border-blue-600' : 'border-zinc-300 dark:border-zinc-600'}`}>
                                        {isOn && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <span className="truncate">{col.header}</span>
                                    {locked && <span className="ml-auto text-[10px] text-zinc-400">obligatoriu</span>}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
