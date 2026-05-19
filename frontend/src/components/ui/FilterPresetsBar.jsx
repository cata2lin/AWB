import { useState, useEffect, useRef } from 'react'
import { Save, Bookmark, Trash2, Star, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { analyticsFilterPresetsApi } from '../../services/api/analyticsFilterPresets'

/**
 * FilterPresetsBar — dropdown for save / load / set-default / delete of saved
 * filter presets, scoped to a single `reportKey`.
 *
 * Parent owns the live filter state and provides:
 *   - currentFilters: serialisable object representing the current filters
 *   - onLoad(filters): apply a loaded preset
 *   - reportKey: e.g. 'livrabilitate_produse'
 *
 * Presets are stored server-side (table analytics_filter_presets) so they
 * are shared across users of the LAN deployment.
 */
export default function FilterPresetsBar({ reportKey, currentFilters, onLoad, className = '' }) {
    const [presets, setPresets] = useState([])
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [activeId, setActiveId] = useState(null)
    const wrapRef = useRef(null)

    const load = async () => {
        try {
            const data = await analyticsFilterPresetsApi.list(reportKey)
            setPresets(data)
            // If a default exists and no preset is active yet, apply it once on mount.
            const def = data.find(p => p.is_default)
            if (def && activeId == null && currentFilters?._initFromDefault) {
                onLoad?.(def.filters)
                setActiveId(def.id)
            }
        } catch (e) {
            toast.error('Eroare la încărcarea preseturilor: ' + (e?.response?.data?.detail || e?.message || ''))
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reportKey])

    useEffect(() => {
        const onClick = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [])

    const handleSave = async () => {
        const name = window.prompt('Nume preset?')
        if (!name?.trim()) return
        setSaving(true)
        try {
            const preset = await analyticsFilterPresetsApi.create({
                report_key: reportKey,
                name: name.trim(),
                filters: currentFilters || {},
            })
            toast.success(`Preset salvat: "${preset.name}"`)
            setActiveId(preset.id)
            await load()
        } catch (e) {
            toast.error('Eroare: ' + (e?.response?.data?.detail || e?.message || 'salvare eșuată'))
        } finally {
            setSaving(false)
        }
    }

    const handleOverwrite = async (preset) => {
        if (!window.confirm(`Suprascrie preset "${preset.name}" cu filtrele curente?`)) return
        try {
            await analyticsFilterPresetsApi.update(preset.id, { filters: currentFilters || {} })
            toast.success(`Preset actualizat: "${preset.name}"`)
            setActiveId(preset.id)
            await load()
        } catch (e) {
            toast.error('Eroare: ' + (e?.response?.data?.detail || e?.message || ''))
        }
    }

    const handleLoad = (preset) => {
        onLoad?.(preset.filters)
        setActiveId(preset.id)
        setOpen(false)
        toast.success(`Preset încărcat: "${preset.name}"`)
    }

    const handleDelete = async (preset, e) => {
        e.stopPropagation()
        if (!window.confirm(`Șterge preset "${preset.name}"?`)) return
        try {
            await analyticsFilterPresetsApi.delete(preset.id)
            if (activeId === preset.id) setActiveId(null)
            toast.success(`Șters: "${preset.name}"`)
            await load()
        } catch (err) {
            toast.error('Eroare: ' + (err?.response?.data?.detail || err?.message || ''))
        }
    }

    const handleSetDefault = async (preset, e) => {
        e.stopPropagation()
        try {
            await analyticsFilterPresetsApi.setDefault(preset.id)
            toast.success(`"${preset.name}" este acum presetul implicit`)
            await load()
        } catch (err) {
            toast.error('Eroare: ' + (err?.response?.data?.detail || err?.message || ''))
        }
    }

    const activePreset = presets.find(p => p.id === activeId)
    const buttonLabel = activePreset ? activePreset.name : (presets.length > 0 ? 'Preseturi' : 'Niciun preset')

    return (
        <div ref={wrapRef} className={`relative ${className}`}>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/60"
                >
                    <Bookmark className="w-3.5 h-3.5" />
                    <span className="max-w-[140px] truncate">{buttonLabel}</span>
                    {presets.length > 0 && (
                        <span className="text-[10px] text-zinc-400">({presets.length})</span>
                    )}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    title="Salvează filtrele curente ca preset"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50"
                >
                    <Save className="w-3.5 h-3.5" />
                    Salvează
                </button>
            </div>

            {open && (
                <div className="absolute right-0 mt-1 w-72 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg z-30 overflow-hidden">
                    {presets.length === 0 ? (
                        <div className="px-4 py-6 text-sm text-zinc-500 text-center">
                            Niciun preset salvat încă.
                            <br />
                            <span className="text-[11px] text-zinc-400">
                                Apasă "Salvează" pentru a păstra filtrele curente.
                            </span>
                        </div>
                    ) : (
                        <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-700/50">
                            {presets.map(p => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => handleLoad(p)}
                                    className={`w-full text-left px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-700/40 transition-colors ${
                                        activeId === p.id ? 'bg-primary-50/50 dark:bg-primary-500/10' : ''
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-zinc-800 dark:text-zinc-100 flex-1 truncate">
                                            {p.name}
                                        </span>
                                        {p.is_default && (
                                            <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                                                <Star className="w-3 h-3 fill-current" />
                                                implicit
                                            </span>
                                        )}
                                    </div>
                                    {p.description && (
                                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                                            {p.description}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2 mt-1.5">
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleOverwrite(p) }}
                                            className="text-[10px] text-zinc-500 hover:text-primary-600"
                                        >
                                            Suprascrie cu cele curente
                                        </button>
                                        {!p.is_default && (
                                            <button
                                                type="button"
                                                onClick={(e) => handleSetDefault(p, e)}
                                                className="text-[10px] text-zinc-500 hover:text-amber-600"
                                            >
                                                setează implicit
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => handleDelete(p, e)}
                                            className="ml-auto text-[10px] text-zinc-400 hover:text-red-500 inline-flex items-center gap-0.5"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                            șterge
                                        </button>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
