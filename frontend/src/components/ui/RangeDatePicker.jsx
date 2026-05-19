import { useState } from 'react'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import DateInput from './DateInput'

const fmtLocal = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const PRESETS = [
    { key: 'today', label: 'Azi', resolve: () => { const d = new Date(); return [fmtLocal(d), fmtLocal(d)] } },
    { key: '7d', label: '7 zile', resolve: () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 7); return [fmtLocal(s), fmtLocal(e)] } },
    { key: '30d', label: '30 zile', resolve: () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 30); return [fmtLocal(s), fmtLocal(e)] } },
    { key: '90d', label: '90 zile', resolve: () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 90); return [fmtLocal(s), fmtLocal(e)] } },
    {
        key: 'thisMonth', label: 'Luna asta', resolve: () => {
            const n = new Date()
            return [fmtLocal(new Date(n.getFullYear(), n.getMonth(), 1)), fmtLocal(n)]
        }
    },
    {
        key: 'lastMonth', label: 'Luna trecută', resolve: () => {
            const n = new Date()
            return [
                fmtLocal(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
                fmtLocal(new Date(n.getFullYear(), n.getMonth(), 0)),
            ]
        }
    },
]

/**
 * RangeDatePicker — pair of <DateInput>s with quick preset chips and a clear
 * button. Calls onChange({ from, to }) with ISO 'YYYY-MM-DD' strings (or null).
 *
 * Caller is responsible for actually fetching when the range changes; this
 * primitive just collects the values.
 */
export default function RangeDatePicker({
    value,
    onChange,
    presets = PRESETS,
    showPresets = true,
    className = '',
    fromLabel = 'De la',
    toLabel = 'Până la',
}) {
    const [activePreset, setActivePreset] = useState(null)
    const { from = '', to = '' } = value || {}

    const update = (next) => {
        setActivePreset(null)
        onChange?.(next)
    }

    const applyPreset = (preset) => {
        setActivePreset(preset.key)
        const [f, t] = preset.resolve()
        onChange?.({ from: f, to: t })
    }

    const clear = () => {
        setActivePreset(null)
        onChange?.({ from: '', to: '' })
    }

    return (
        <div className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
            <CalendarIcon className="w-4 h-4 text-zinc-400" />
            <DateInput
                value={from}
                onChange={(v) => update({ from: v, to })}
                ariaLabel={fromLabel}
            />
            <span className="text-zinc-400">→</span>
            <DateInput
                value={to}
                onChange={(v) => update({ from, to: v })}
                ariaLabel={toLabel}
            />
            {(from || to) && (
                <button
                    type="button"
                    onClick={clear}
                    aria-label="Șterge intervalul"
                    className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            )}
            {showPresets && (
                <div className="flex flex-wrap items-center gap-1 ml-1">
                    {presets.map((p) => {
                        const active = activePreset === p.key
                        return (
                            <button
                                key={p.key}
                                type="button"
                                onClick={() => applyPreset(p)}
                                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${active
                                    ? 'bg-primary-600 text-white'
                                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                                    }`}
                            >
                                {p.label}
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
