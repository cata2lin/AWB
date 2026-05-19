import { useState, useEffect, useMemo } from 'react'
import { Eye, EyeOff, Search, X } from 'lucide-react'
import Modal from './Modal'
import { skuMatches } from '../../utils/skuMatch'

/**
 * IncludeExcludeModal — manage allow/deny lists for SKUs and stores in one place.
 *
 * `value`: { included_skus, excluded_skus, included_stores, excluded_stores }
 * `onChange(next)`: parent owns the state.
 *
 * Stores are picked from `availableStores` (array of { uid, name }).
 * SKUs are free-text — paste-friendly textarea, also clickable chip-pick from
 * the current visible rows via `availableSkus` (array of { sku, product_name }).
 */
export default function IncludeExcludeModal({
    open,
    onClose,
    value = {},
    onChange,
    availableStores = [],
    availableSkus = [],
}) {
    const [tab, setTab] = useState('skus') // 'skus' | 'stores'
    const [skuQuery, setSkuQuery] = useState('')
    const [storeQuery, setStoreQuery] = useState('')

    // Local mirror so we don't fire onChange on every keystroke of the textarea.
    const [localIncSkus, setLocalIncSkus] = useState('')
    const [localExcSkus, setLocalExcSkus] = useState('')

    useEffect(() => {
        if (!open) return
        setLocalIncSkus((value.included_skus || []).join('\n'))
        setLocalExcSkus((value.excluded_skus || []).join('\n'))
    }, [open, value.included_skus, value.excluded_skus])

    const parseList = (text) =>
        text.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)

    const commitSkus = () => {
        onChange?.({
            ...value,
            included_skus: parseList(localIncSkus),
            excluded_skus: parseList(localExcSkus),
        })
    }

    const toggleStore = (uid, side) => {
        const key = side === 'include' ? 'included_stores' : 'excluded_stores'
        const cur = new Set(value[key] || [])
        if (cur.has(uid)) cur.delete(uid)
        else cur.add(uid)
        // Selecting include also removes from exclude (and vice-versa).
        const other = side === 'include' ? 'excluded_stores' : 'included_stores'
        const otherSet = new Set(value[other] || [])
        otherSet.delete(uid)
        onChange?.({
            ...value,
            [key]: [...cur],
            [other]: [...otherSet],
        })
    }

    const filteredSkus = useMemo(() => {
        if (!skuQuery.trim()) return availableSkus.slice(0, 50)
        const q = skuQuery.toLowerCase()
        return availableSkus.filter(
            (r) => (r.sku || '').toLowerCase().includes(q) || (r.product_name || '').toLowerCase().includes(q),
        ).slice(0, 50)
    }, [skuQuery, availableSkus])

    const filteredStores = useMemo(() => {
        if (!storeQuery.trim()) return availableStores
        const q = storeQuery.toLowerCase()
        return availableStores.filter(
            (s) => (s.uid || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q),
        )
    }, [storeQuery, availableStores])

    const skuStatus = (sku) => {
        if (skuMatches(sku, value.included_skus || [])) return 'included'
        if (skuMatches(sku, value.excluded_skus || [])) return 'excluded'
        return 'none'
    }

    const addSkuTo = (sku, side) => {
        const incSet = new Set(parseList(localIncSkus))
        const excSet = new Set(parseList(localExcSkus))
        if (side === 'include') {
            incSet.add(sku); excSet.delete(sku)
        } else if (side === 'exclude') {
            excSet.add(sku); incSet.delete(sku)
        } else {
            incSet.delete(sku); excSet.delete(sku)
        }
        const nextInc = [...incSet]
        const nextExc = [...excSet]
        setLocalIncSkus(nextInc.join('\n'))
        setLocalExcSkus(nextExc.join('\n'))
        onChange?.({ ...value, included_skus: nextInc, excluded_skus: nextExc })
    }

    const incSkuCount = (value.included_skus || []).length
    const excSkuCount = (value.excluded_skus || []).length
    const incStoreCount = (value.included_stores || []).length
    const excStoreCount = (value.excluded_stores || []).length

    const footer = (
        <>
            <button
                type="button"
                onClick={() => onChange?.({
                    included_skus: [], excluded_skus: [],
                    included_stores: [], excluded_stores: [],
                })}
                className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:underline mr-auto"
            >
                Șterge toate listele
            </button>
            <button
                type="button"
                onClick={() => { commitSkus(); onClose?.() }}
                className="px-4 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg"
            >
                Aplică
            </button>
        </>
    )

    return (
        <Modal
            open={open}
            onClose={() => { commitSkus(); onClose?.() }}
            title="Include / Exclude produse și magazine"
            description="Listele filtrează raportul după aplicare. Sunt salvate ca parte din preset."
            size="lg"
            footer={footer}
        >
            <div className="space-y-4">
                <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
                    {[
                        { key: 'skus', label: `SKU-uri (${incSkuCount}+${excSkuCount})` },
                        { key: 'stores', label: `Magazine (${incStoreCount}+${excStoreCount})` },
                    ].map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                                tab === t.key
                                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                                    : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {tab === 'skus' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                <Eye className="w-3.5 h-3.5" />
                                Doar aceste SKU-uri ({parseList(localIncSkus).length})
                            </div>
                            <textarea
                                value={localIncSkus}
                                onChange={(e) => setLocalIncSkus(e.target.value)}
                                onBlur={commitSkus}
                                placeholder={'Un pattern per linie sau separate prin virgulă.\nExemplu:\n  ha-       → toate SKU-urile care încep cu "ha-"\n  ha-001    → SKU-ul exact ha-001\n  ha-*-l    → glob (orice între)'}
                                rows={8}
                                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-emerald-200 dark:border-emerald-700/50 bg-emerald-50/30 dark:bg-emerald-500/5 text-zinc-800 dark:text-zinc-100 focus:ring-2 focus:ring-emerald-500/30"
                            />
                            <p className="text-[11px] text-zinc-500">
                                Match-uire pe prefix (case-insensitive). Dacă e completat, raportul afișează doar SKU-urile potrivite.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-400">
                                <EyeOff className="w-3.5 h-3.5" />
                                Exclude aceste SKU-uri ({parseList(localExcSkus).length})
                            </div>
                            <textarea
                                value={localExcSkus}
                                onChange={(e) => setLocalExcSkus(e.target.value)}
                                onBlur={commitSkus}
                                placeholder={'Un pattern per linie sau separate prin virgulă.\nExemplu:\n  ha-       → exclude toate SKU-urile care încep cu "ha-"\n  ha-*-test → glob'}
                                rows={8}
                                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-red-200 dark:border-red-700/50 bg-red-50/30 dark:bg-red-500/5 text-zinc-800 dark:text-zinc-100 focus:ring-2 focus:ring-red-500/30"
                            />
                            <p className="text-[11px] text-zinc-500">
                                Match-uire pe prefix. Aceste SKU-uri sunt eliminate din raport.
                            </p>
                        </div>

                        {availableSkus.length > 0 && (
                            <div className="md:col-span-2">
                                <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-2">
                                    Sau alege din SKU-urile curente
                                </div>
                                <div className="relative mb-2">
                                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                                    <input
                                        value={skuQuery}
                                        onChange={(e) => setSkuQuery(e.target.value)}
                                        placeholder="Caută SKU sau produs…"
                                        className="pl-8 pr-2 py-1.5 text-sm w-full rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100"
                                    />
                                </div>
                                <div className="max-h-48 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                    {filteredSkus.map((r) => {
                                        const status = skuStatus(r.sku)
                                        return (
                                            <div key={r.sku} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                                                <span className="flex-1 truncate">
                                                    <span className="font-mono text-zinc-700 dark:text-zinc-200">{r.sku}</span>
                                                    {r.product_name && (
                                                        <span className="text-zinc-400 dark:text-zinc-500 ml-2">{r.product_name}</span>
                                                    )}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => addSkuTo(r.sku, status === 'included' ? 'clear' : 'include')}
                                                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                                        status === 'included'
                                                            ? 'bg-emerald-600 text-white'
                                                            : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                                                    }`}
                                                >
                                                    Include
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => addSkuTo(r.sku, status === 'excluded' ? 'clear' : 'exclude')}
                                                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                                        status === 'excluded'
                                                            ? 'bg-red-600 text-white'
                                                            : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 hover:bg-red-100 dark:hover:bg-red-500/20'
                                                    }`}
                                                >
                                                    Exclude
                                                </button>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {tab === 'stores' && (
                    <div className="space-y-3">
                        <div className="relative">
                            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                            <input
                                value={storeQuery}
                                onChange={(e) => setStoreQuery(e.target.value)}
                                placeholder="Caută magazin…"
                                className="pl-8 pr-2 py-1.5 text-sm w-full rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100"
                            />
                        </div>
                        <div className="text-[11px] text-zinc-500">
                            "Include" restricționează raportul doar la aceste magazine.
                            "Exclude" le elimină. Goale ⇒ se folosește selecția globală.
                        </div>
                        <div className="max-h-72 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg divide-y divide-zinc-100 dark:divide-zinc-700/50">
                            {filteredStores.map((s) => {
                                const included = (value.included_stores || []).includes(s.uid)
                                const excluded = (value.excluded_stores || []).includes(s.uid)
                                return (
                                    <div key={s.uid} className="flex items-center gap-2 px-3 py-2 text-sm">
                                        <span className="flex-1 truncate">
                                            <span className="text-zinc-800 dark:text-zinc-200">{s.name || s.uid}</span>
                                            {s.name && <span className="text-zinc-400 ml-2 text-xs font-mono">{s.uid}</span>}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => toggleStore(s.uid, 'include')}
                                            className={`px-2.5 py-1 rounded text-xs font-medium ${
                                                included
                                                    ? 'bg-emerald-600 text-white'
                                                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                                            }`}
                                        >
                                            Include
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => toggleStore(s.uid, 'exclude')}
                                            className={`px-2.5 py-1 rounded text-xs font-medium ${
                                                excluded
                                                    ? 'bg-red-600 text-white'
                                                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 hover:bg-red-100 dark:hover:bg-red-500/20'
                                            }`}
                                        >
                                            Exclude
                                        </button>
                                    </div>
                                )
                            })}
                            {filteredStores.length === 0 && (
                                <div className="px-3 py-6 text-center text-xs text-zinc-400">
                                    Niciun magazin nu corespunde căutării
                                </div>
                            )}
                        </div>
                        {(incStoreCount > 0 || excStoreCount > 0) && (
                            <div className="flex flex-wrap items-center gap-1 pt-2 border-t border-zinc-100 dark:border-zinc-700/50">
                                <span className="text-[10px] uppercase font-semibold text-zinc-400">Selectate:</span>
                                {(value.included_stores || []).map((u) => (
                                    <span key={`i-${u}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                                        ✓ {u}
                                        <button type="button" onClick={() => toggleStore(u, 'include')}><X className="w-3 h-3" /></button>
                                    </span>
                                ))}
                                {(value.excluded_stores || []).map((u) => (
                                    <span key={`e-${u}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">
                                        ✕ {u}
                                        <button type="button" onClick={() => toggleStore(u, 'exclude')}><X className="w-3 h-3" /></button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    )
}
