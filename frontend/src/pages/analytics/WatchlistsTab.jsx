import { useEffect, useState, useCallback } from 'react'
import { Eye, Plus, Trash2, ChevronLeft, Info } from 'lucide-react'
import { authFetch, API_URL } from '../../utils/authFetch'
import { toastSuccess, toastError } from '../../utils/toast'
import { formatNumber } from '../../utils/analyticsHelpers'
import BulkActionBar from '../../components/BulkActionBar'

const WL_COLORS = ['#8b5cf6', '#f59e0b', '#ef4444', '#10b981', '#38bdf8', '#f472b6', '#6366f1']

const fmtDate = (x) => {
    if (!x) return '—'
    const d = new Date(x)
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ro-RO')
}

// Render a single snapshot value (numbers get locale formatting, rest as-is).
const fmtSnapVal = (v) => {
    if (v == null) return '—'
    if (typeof v === 'number') return formatNumber(Math.round(v))
    if (typeof v === 'boolean') return v ? 'da' : 'nu'
    return String(v)
}

export default function WatchlistsTab() {
    const [lists, setLists] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const [activeId, setActiveId] = useState(null)
    const [detail, setDetail] = useState(null)
    const [detailLoading, setDetailLoading] = useState(false)

    const [showCreate, setShowCreate] = useState(false)
    const [newName, setNewName] = useState('')
    const [newColor, setNewColor] = useState(WL_COLORS[0])
    const [creating, setCreating] = useState(false)

    const [selectedSkus, setSelectedSkus] = useState(() => new Set())

    // ── Load list ────────────────────────────────────────────────────────────
    const loadLists = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const res = await authFetch(`${API_URL}/analytics/watchlists`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setLists(json.watchlists || [])
        } catch (e) {
            setError(e.message || 'Eroare la încărcare')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { loadLists() }, [loadLists])

    // ── Load detail ──────────────────────────────────────────────────────────
    const loadDetail = useCallback(async (id) => {
        setDetailLoading(true); setError(null)
        setSelectedSkus(new Set())
        try {
            const res = await authFetch(`${API_URL}/analytics/watchlists/${id}`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setDetail(json)
        } catch (e) {
            setError(e.message || 'Eroare la încărcare')
        } finally {
            setDetailLoading(false)
        }
    }, [])

    const handleOpenDetail = useCallback((id) => {
        setActiveId(id)
        loadDetail(id)
    }, [loadDetail])

    const handleBackToList = useCallback(() => {
        setActiveId(null)
        setDetail(null)
        setSelectedSkus(new Set())
        loadLists()
    }, [loadLists])

    // ── Create ───────────────────────────────────────────────────────────────
    const handleOpenCreate = useCallback(() => {
        setNewName(''); setNewColor(WL_COLORS[0]); setShowCreate(true)
    }, [])

    const handleCreate = useCallback(async () => {
        const name = newName.trim()
        if (!name) { toastError('Introdu un nume'); return }
        setCreating(true)
        try {
            const res = await authFetch(`${API_URL}/analytics/watchlists`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color: newColor }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.detail || `HTTP ${res.status}`)
            }
            toastSuccess('Watchlist creat')
            setShowCreate(false)
            await loadLists()
        } catch (e) {
            toastError(e)
        } finally {
            setCreating(false)
        }
    }, [newName, newColor, loadLists])

    // ── Delete watchlist ─────────────────────────────────────────────────────
    const handleDeleteWatchlist = useCallback(async (id, name) => {
        if (!confirm(`Ștergi watchlist-ul "${name}"?`)) return
        try {
            const res = await authFetch(`${API_URL}/analytics/watchlists/${id}`, { method: 'DELETE' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            toastSuccess('Watchlist șters')
            await loadLists()
        } catch (e) {
            toastError(e)
        }
    }, [loadLists])

    // ── Delete item ──────────────────────────────────────────────────────────
    const handleDeleteItem = useCallback(async (itemId) => {
        if (!activeId) return
        if (!confirm('Ștergi acest produs din watchlist?')) return
        try {
            const res = await authFetch(`${API_URL}/analytics/watchlists/${activeId}/items/${itemId}`, { method: 'DELETE' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            toastSuccess('Produs șters')
            await loadDetail(activeId)
        } catch (e) {
            toastError(e)
        }
    }, [activeId, loadDetail])

    // ── Selection / bulk actions ─────────────────────────────────────────────
    const handleToggleSelect = useCallback((sku) => {
        setSelectedSkus((prev) => {
            const next = new Set(prev)
            if (next.has(sku)) next.delete(sku); else next.add(sku)
            return next
        })
    }, [])

    const handleToggleAll = useCallback(() => {
        const items = detail?.items || []
        setSelectedSkus((prev) => {
            if (prev.size === items.length && items.length > 0) return new Set()
            return new Set(items.map((i) => i.sku))
        })
    }, [detail])

    const handleClearSelection = useCallback(() => setSelectedSkus(new Set()), [])

    const handleCopySkus = useCallback(async () => {
        const skus = Array.from(selectedSkus)
        if (!skus.length) { toastError('Niciun SKU selectat'); return }
        const text = skus.join('\n')
        try {
            await navigator.clipboard.writeText(text)
            toastSuccess(`${skus.length} SKU-uri copiate`)
        } catch {
            const ta = document.createElement('textarea')
            ta.value = text; document.body.appendChild(ta); ta.select()
            document.execCommand('copy'); document.body.removeChild(ta)
            toastSuccess(`${skus.length} SKU-uri copiate`)
        }
    }, [selectedSkus])

    // Add-to-watchlist from within a watchlist is a no-op placeholder here — the
    // bulk bar's primary cross-tab use is from the analytics product tables. In
    // this tab we surface Copiază SKU + Deselectează only.
    const handleAddToWatchlist = useCallback(() => {
        toastSuccess('Folosește bara din tabul de produse pentru a adăuga în watchlist')
    }, [])

    // ── Render: detail view ──────────────────────────────────────────────────
    if (activeId && detail) {
        const w = detail.watchlist
        const items = detail.items || []
        const color = w.color || WL_COLORS[0]
        // Union of all snapshot keys across items → table columns.
        const snapKeys = Array.from(
            items.reduce((set, it) => {
                if (it.snapshot && typeof it.snapshot === 'object') {
                    Object.keys(it.snapshot).forEach((k) => set.add(k))
                }
                return set
            }, new Set())
        )
        const allSelected = items.length > 0 && selectedSkus.size === items.length

        return (
            <div className="space-y-5 mt-4">
                <button
                    type="button"
                    onClick={handleBackToList}
                    className="flex items-center gap-1.5 text-sm font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300"
                >
                    <ChevronLeft className="w-4 h-4" />
                    Înapoi la liste
                </button>

                <div className="flex items-center gap-3">
                    <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: `${color}22` }}
                    >
                        <span className="w-3 h-3 rounded-full" style={{ background: color }} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{w.name}</h2>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {formatNumber(items.length)} produse · creat {fmtDate(w.created_at)}
                        </p>
                    </div>
                </div>

                {/* Delta-vs-snapshot explainer */}
                <div className="rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-4 py-3 flex gap-3">
                    <Info className="w-5 h-5 text-sky-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-sky-800 dark:text-sky-200">
                        <div className="font-semibold">Delta vs. snapshot</div>
                        <p className="mt-1 text-sky-700 dark:text-sky-300/90">
                            Valorile de mai jos sunt cele salvate la momentul adăugării (snapshot).
                            Comparația live (valoarea curentă − snapshot) necesită un join cu raportul
                            de analytics — momentan afișăm doar snapshot-ul.
                            {' '}<span className="font-mono text-xs opacity-80">TODO: live join</span>
                        </p>
                    </div>
                </div>

                {detailLoading && (
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">Se încarcă…</div>
                )}

                {!detailLoading && items.length === 0 && (
                    <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 px-6 py-12 text-center">
                        <Eye className="w-8 h-8 mx-auto text-zinc-400 dark:text-zinc-600" />
                        <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">Niciun produs în watchlist</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Selectează produse în tabul de produse și folosește „Adaugă în Watchlist”.
                        </p>
                    </div>
                )}

                {!detailLoading && items.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-zinc-100 dark:bg-zinc-800 text-left">
                                    <th className="sticky left-0 z-10 bg-zinc-100 dark:bg-zinc-800 px-3 py-2 w-10">
                                        <input
                                            type="checkbox"
                                            checked={allSelected}
                                            onChange={handleToggleAll}
                                            className="accent-violet-600"
                                            aria-label="Selectează tot"
                                        />
                                    </th>
                                    <th className="px-3 py-2 font-semibold text-zinc-600 dark:text-zinc-300">SKU</th>
                                    <th className="px-3 py-2 font-semibold text-zinc-600 dark:text-zinc-300 whitespace-nowrap">Adăugat</th>
                                    {snapKeys.map((k) => (
                                        <th key={k} className="px-3 py-2 font-semibold text-zinc-600 dark:text-zinc-300 text-right whitespace-nowrap">
                                            {k}
                                            <div className="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">snapshot</div>
                                        </th>
                                    ))}
                                    <th className="px-3 py-2 w-10" />
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((it) => {
                                    const checked = selectedSkus.has(it.sku)
                                    return (
                                        <tr
                                            key={it.id}
                                            className={`border-t border-zinc-100 dark:border-zinc-800 ${checked ? 'bg-violet-50 dark:bg-violet-900/10' : ''}`}
                                        >
                                            <td className={`sticky left-0 z-10 px-3 py-2 ${checked ? 'bg-violet-50 dark:bg-violet-900/20' : 'bg-white dark:bg-zinc-900'}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => handleToggleSelect(it.sku)}
                                                    className="accent-violet-600"
                                                    aria-label={`Selectează ${it.sku}`}
                                                />
                                            </td>
                                            <td className="px-3 py-2 font-mono text-zinc-900 dark:text-white">{it.sku}</td>
                                            <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{fmtDate(it.added_at)}</td>
                                            {snapKeys.map((k) => (
                                                <td key={k} className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-200 tabular-nums">
                                                    {fmtSnapVal(it.snapshot?.[k])}
                                                </td>
                                            ))}
                                            <td className="px-3 py-2 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteItem(it.id)}
                                                    className="p-1.5 rounded-md text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                                    title="Șterge produs"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                <BulkActionBar
                    selectedCount={selectedSkus.size}
                    onCopySkus={handleCopySkus}
                    onAddToWatchlist={handleAddToWatchlist}
                    onClear={handleClearSelection}
                />
            </div>
        )
    }

    // ── Render: list view ────────────────────────────────────────────────────
    return (
        <div className="space-y-5 mt-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20 flex-shrink-0">
                        <Eye className="w-4 h-4 text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Watchlists</h2>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Colecții de produse urmărite, cu snapshot la momentul adăugării
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={handleOpenCreate}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Crează Watchlist
                </button>
            </div>

            {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {loading && (
                <div className="text-sm text-zinc-500 dark:text-zinc-400">Se încarcă…</div>
            )}

            {!loading && lists.length === 0 && (
                <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 px-6 py-12 text-center">
                    <Eye className="w-8 h-8 mx-auto text-zinc-400 dark:text-zinc-600" />
                    <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">Nicio watchlist creată</p>
                    <button
                        type="button"
                        onClick={handleOpenCreate}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Crează prima watchlist
                    </button>
                </div>
            )}

            {!loading && lists.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {lists.map((w) => {
                        const color = w.color || WL_COLORS[0]
                        return (
                            <div
                                key={w.id}
                                onClick={() => handleOpenDetail(w.id)}
                                role="button"
                                tabIndex={0}
                                className="group relative cursor-pointer rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 overflow-hidden hover:shadow-md transition-shadow"
                            >
                                <div className="h-1" style={{ background: color }} />
                                <div className="p-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <div
                                                className="w-9 h-9 rounded-lg flex items-center justify-center"
                                                style={{ background: `${color}22` }}
                                            >
                                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                                            </div>
                                            <div>
                                                <div className="font-semibold text-zinc-900 dark:text-white">{w.name}</div>
                                                <div className="text-xs text-zinc-500 dark:text-zinc-400">{fmtDate(w.created_at)}</div>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleDeleteWatchlist(w.id, w.name) }}
                                            className="p-1.5 rounded-md text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                            title="Șterge watchlist"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                    <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-700/60 text-center">
                                        <div className="text-xl font-bold" style={{ color }}>{formatNumber(w.item_count || 0)}</div>
                                        <div className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Produse</div>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Create modal */}
            {showCreate && (
                <div
                    className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
                    onClick={() => setShowCreate(false)}
                >
                    <div
                        className="w-full max-w-md rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-base font-bold text-zinc-900 dark:text-white">Crează Watchlist</h3>
                        <div className="mt-4">
                            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Nume</label>
                            <input
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                                placeholder="Ex: Produse de vară"
                                autoFocus
                                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                        </div>
                        <div className="mt-4">
                            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">Culoare</label>
                            <div className="flex gap-2.5">
                                {WL_COLORS.map((c) => (
                                    <button
                                        key={c}
                                        type="button"
                                        onClick={() => setNewColor(c)}
                                        className="w-8 h-8 rounded-full transition-transform hover:scale-110"
                                        style={{
                                            background: c,
                                            border: c === newColor ? '3px solid white' : '3px solid transparent',
                                            boxShadow: c === newColor ? `0 0 0 2px ${c}` : 'none',
                                        }}
                                        aria-label={`Culoare ${c}`}
                                    />
                                ))}
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowCreate(false)}
                                className="px-4 py-2 rounded-lg text-sm font-medium border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                            >
                                Anulează
                            </button>
                            <button
                                type="button"
                                onClick={handleCreate}
                                disabled={creating}
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                            >
                                {creating ? 'Se salvează…' : 'Salvează'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
