/**
 * BarcodeManagerPanel — View products missing barcodes and generate unique EAN-13s.
 */
import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Hash, Package, Check, Zap, List, AlertTriangle } from 'lucide-react'
import { barcodesApi } from '../services/api/analytics'

const fmt = n => n == null ? '0' : Number(n).toLocaleString('ro-RO')

export default function BarcodeManagerPanel() {
    const [view, setView] = useState('missing') // missing | registry
    const [missing, setMissing] = useState([])
    const [registry, setRegistry] = useState([])
    const [loading, setLoading] = useState(false)
    const [search, setSearch] = useState('')
    const [generating, setGenerating] = useState(new Set())
    const [selected, setSelected] = useState(new Set())

    const fetchMissing = useCallback(async () => {
        setLoading(true)
        try {
            const result = await barcodesApi.getMissing({ search: search || undefined })
            setMissing(result.products || [])
        } catch (err) { console.error(err) }
        finally { setLoading(false) }
    }, [search])

    const fetchRegistry = useCallback(async () => {
        setLoading(true)
        try {
            const result = await barcodesApi.getRegistry()
            setRegistry(result.barcodes || [])
        } catch (err) { console.error(err) }
        finally { setLoading(false) }
    }, [])

    useEffect(() => {
        if (view === 'missing') fetchMissing()
        else fetchRegistry()
    }, [view, fetchMissing, fetchRegistry])

    const generateSingle = async (p) => {
        setGenerating(prev => new Set([...prev, p.sku]))
        try {
            await barcodesApi.generate([{ sku: p.sku, product_uid: p.uid }])
            fetchMissing()
            fetchRegistry()
        } catch (err) { alert('Failed to generate barcode') }
        finally { setGenerating(prev => { const n = new Set(prev); n.delete(p.sku); return n }) }
    }

    const generateBulk = async () => {
        const items = missing.filter(p => selected.has(p.sku))
        if (items.length === 0) { alert('Select products first'); return }
        setLoading(true)
        try {
            await barcodesApi.generate(items.map(p => ({ sku: p.sku, product_uid: p.uid })))
            setSelected(new Set())
            fetchMissing()
            fetchRegistry()
        } catch (err) { alert('Failed to generate barcodes') }
        finally { setLoading(false) }
    }

    const toggleSelect = (sku) => {
        setSelected(prev => { const n = new Set(prev); n.has(sku) ? n.delete(sku) : n.add(sku); return n })
    }

    const toggleAll = () => {
        if (selected.size === missing.length) setSelected(new Set())
        else setSelected(new Set(missing.map(p => p.sku)))
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-1">
                        <button onClick={() => setView('missing')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${view === 'missing' ? 'bg-white dark:bg-zinc-600 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400'}`}>
                            <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />Missing ({missing.length})
                        </button>
                        <button onClick={() => setView('registry')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${view === 'registry' ? 'bg-white dark:bg-zinc-600 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400'}`}>
                            <List className="w-3.5 h-3.5 inline mr-1" />Registry ({registry.length})
                        </button>
                    </div>
                    {view === 'missing' && (
                        <div className="relative">
                            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU..."
                                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700/50 text-zinc-900 dark:text-white w-48" />
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {view === 'missing' && selected.size > 0 && (
                        <button onClick={generateBulk} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg">
                            <Zap className="w-3.5 h-3.5" /> Generate {selected.size} Barcodes
                        </button>
                    )}
                    <button onClick={view === 'missing' ? fetchMissing : fetchRegistry} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700">
                        <RefreshCw className={`w-4 h-4 text-zinc-500 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Tables */}
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-clip">
                <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
                    {view === 'missing' ? (
                        <table className="w-full text-sm">
                            <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                                    <th className="px-3 py-2.5 w-8">
                                        <input type="checkbox" checked={selected.size === missing.length && missing.length > 0} onChange={toggleAll}
                                            className="rounded border-zinc-300 dark:border-zinc-600" />
                                    </th>
                                    <th className="px-3 py-2.5 text-left font-medium">Product</th>
                                    <th className="px-3 py-2.5 text-left font-medium">SKU</th>
                                    <th className="px-3 py-2.5 text-right font-medium">Stock</th>
                                    <th className="px-3 py-2.5 w-32 font-medium">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                {missing.length === 0 && (
                                    <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-400">
                                        <Check className="w-6 h-6 inline mr-2 text-green-500" />All products have barcodes
                                    </td></tr>
                                )}
                                {missing.map(p => (
                                    <tr key={p.uid} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/20">
                                        <td className="px-3 py-2">
                                            <input type="checkbox" checked={selected.has(p.sku)} onChange={() => toggleSelect(p.sku)}
                                                className="rounded border-zinc-300 dark:border-zinc-600" />
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                {p.image ? <img src={p.image} className="w-7 h-7 rounded object-cover border border-zinc-200 dark:border-zinc-600" /> : <Package className="w-5 h-5 text-zinc-400" />}
                                                <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate max-w-[250px]">{p.product_name}</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">{p.sku}</td>
                                        <td className="px-3 py-2 text-right text-xs text-zinc-600 dark:text-zinc-300">{fmt(p.stock_available)}</td>
                                        <td className="px-3 py-2 text-center">
                                            <button onClick={() => generateSingle(p)} disabled={generating.has(p.sku)}
                                                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-40 mx-auto">
                                                {generating.has(p.sku) ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Hash className="w-3 h-3" />}
                                                Generate EAN-13
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                                    <th className="px-3 py-2.5 text-left font-medium">Barcode (EAN-13)</th>
                                    <th className="px-3 py-2.5 text-left font-medium">SKU</th>
                                    <th className="px-3 py-2.5 text-left font-medium">Assigned</th>
                                    <th className="px-3 py-2.5 text-left font-medium">Created</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                {registry.length === 0 && (
                                    <tr><td colSpan={4} className="px-4 py-12 text-center text-zinc-400">No barcodes generated yet</td></tr>
                                )}
                                {registry.map(b => (
                                    <tr key={b.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/20">
                                        <td className="px-3 py-2 font-mono font-semibold text-sm text-zinc-800 dark:text-zinc-200">{b.barcode}</td>
                                        <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">{b.sku || '—'}</td>
                                        <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{b.assigned_at ? new Date(b.assigned_at).toLocaleDateString('ro-RO') : '—'}</td>
                                        <td className="px-3 py-2 text-xs text-zinc-400">{b.created_at ? new Date(b.created_at).toLocaleDateString('ro-RO') : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    )
}
