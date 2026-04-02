/**
 * ProductsTab — Grouped product inventory with expandable listings,
 * DB-persisted primary listing selection, stock exclusion, cost filter/sort,
 * missing barcode flag, and Excel export.
 */
import { useState, useEffect, useCallback } from 'react'
import {
    Package, Search, RefreshCw, ChevronDown, ChevronUp, ChevronRight,
    Image as ImageIcon, Store, Box, AlertTriangle, Download,
    Eye, EyeOff, Layers, AlertCircle, Star, Check
} from 'lucide-react'
import { productsApi } from '../services/api/products'
import { skuCostsApi } from '../services/api'

export default function ProductsTab({ stores = [] }) {
    const [products, setProducts] = useState([])
    const [stats, setStats] = useState(null)
    const [total, setTotal] = useState(0)
    const [skuCosts, setSkuCosts] = useState({})

    // Filters
    const [search, setSearch] = useState('')
    const [storeFilter, setStoreFilter] = useState('')
    const [stateFilter, setStateFilter] = useState('')
    const [stockFilter, setStockFilter] = useState('')
    const [excludeFilter, setExcludeFilter] = useState('')
    const [costFilter, setCostFilter] = useState('')
    const [barcodeFilter, setBarcodeFilter] = useState('')
    const [sortField, setSortField] = useState('title_1')
    const [sortDir, setSortDir] = useState('asc')

    // Pagination
    const [skip, setSkip] = useState(0)
    const [limit] = useState(50)

    // UI
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [exporting, setExporting] = useState(false)
    const [importing, setImporting] = useState(false)
    const [cogsImportResult, setCogsImportResult] = useState(null)
    const [editingCost, setEditingCost] = useState(null)
    const [expandedGroup, setExpandedGroup] = useState(null)
    const [settingPrimary, setSettingPrimary] = useState(null) // uid being saved

    const buildParams = useCallback(() => {
        const params = { sort_field: sortField, sort_direction: sortDir }
        if (search) params.search = search
        if (storeFilter) params.store_uid = storeFilter
        if (stateFilter) params.state = stateFilter
        if (stockFilter === 'in_stock') params.has_stock = true
        if (stockFilter === 'out_of_stock') params.has_stock = false
        if (excludeFilter) params.exclude_filter = excludeFilter
        if (costFilter) params.has_cost = costFilter
        if (barcodeFilter) params.missing_barcode = barcodeFilter
        return params
    }, [search, storeFilter, stateFilter, stockFilter, excludeFilter, costFilter, barcodeFilter, sortField, sortDir])

    // Fetch
    const fetchProducts = useCallback(async () => {
        setLoading(true)
        try {
            const params = { ...buildParams(), skip, limit }
            const res = await productsApi.getGroupedProducts(params)
            setProducts(res.products || [])
            setTotal(res.total || 0)
        } catch (err) { console.error('Failed to fetch products:', err) }
        finally { setLoading(false) }
    }, [skip, limit, buildParams])

    useEffect(() => { fetchProducts() }, [fetchProducts])

    // Stats
    const refreshStats = useCallback(async () => {
        try { setStats(await productsApi.getStats()) } catch (err) { console.error(err) }
    }, [])
    useEffect(() => { refreshStats() }, [refreshStats])

    // SKU costs
    useEffect(() => {
        (async () => {
            try {
                const data = await skuCostsApi.getSkuCosts()
                const items = Array.isArray(data) ? data : (data?.items || data?.sku_costs || [])
                const map = {}
                items.forEach(i => { if (i.sku && i.cost != null) map[i.sku] = i.cost })
                setSkuCosts(map)
            } catch (err) { console.error('Failed to load SKU costs:', err) }
        })()
    }, [])

    // Sync
    const handleSync = async () => {
        setSyncing(true)
        try {
            await productsApi.triggerSync()
            setTimeout(async () => {
                await fetchProducts(); await refreshStats(); setSyncing(false)
            }, 3000)
        } catch (err) { console.error(err); setSyncing(false) }
    }

    // Excel export
    const handleExport = async () => {
        setExporting(true)
        try { await productsApi.exportExcel(buildParams()) }
        catch (err) { console.error('Export failed:', err) }
        finally { setExporting(false) }
    }

    // COGS import from Excel
    const handleImportCogs = async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        e.target.value = '' // reset input
        setImporting(true)
        setCogsImportResult(null)
        try {
            const result = await productsApi.importCogsExcel(file)
            setCogsImportResult(result)
            // Reload costs + products
            const costsResp = await skuCostsApi.getSkuCosts()
            const items = Array.isArray(costsResp) ? costsResp : (costsResp?.items || costsResp?.sku_costs || [])
            const map = {}; items.forEach(c => { if (c.sku && c.cost != null) map[c.sku] = c.cost })
            setSkuCosts(map)
            await fetchProducts()
            // Auto-hide result after 8 seconds
            setTimeout(() => setCogsImportResult(null), 8000)
        } catch (err) {
            console.error('COGS import failed:', err)
            setCogsImportResult({ error: err.response?.data?.detail || 'Import failed' })
        } finally { setImporting(false) }
    }

    // Exclude toggle
    const handleToggleExclude = async (uid, currentExclude) => {
        try {
            await productsApi.toggleExclude(uid, !currentExclude)
            setProducts(prev => prev.map(p =>
                p.uid === uid ? { ...p, exclude_from_stock: !currentExclude } : p
            ))
            await refreshStats()
        } catch (err) { console.error(err) }
    }

    // Set primary listing (persisted to DB)
    const handleSetPrimary = async (product, listingUid) => {
        setSettingPrimary(listingUid)
        try {
            await productsApi.setPrimary(product.uid, listingUid)
            // Find the chosen listing and update parent row locally
            const chosen = (product.listings || []).find(l => l.uid === listingUid)
            if (chosen) {
                setProducts(prev => prev.map(p => {
                    if (p.uid === product.uid) {
                        return {
                            ...p,
                            primary_uid: listingUid,
                            stock_available: chosen.stock_available,
                            stock_committed: chosen.stock_committed,
                            stock_incoming: chosen.stock_incoming,
                            images: chosen.images?.length ? chosen.images : p.images,
                        }
                    }
                    return p
                }))
            }
        } catch (err) { console.error('Failed to set primary:', err) }
        finally { setSettingPrimary(null) }
    }

    // Cost save
    const handleSaveCost = async (sku, cost) => {
        try {
            const n = parseFloat(cost) || 0
            if (skuCosts[sku] !== undefined) await skuCostsApi.updateSkuCost(sku, { cost: n })
            else await skuCostsApi.createSkuCost({ sku, name: '', cost: n, currency: 'RON' })
            setSkuCosts(prev => ({ ...prev, [sku]: n }))
            setEditingCost(null)
        } catch (err) { console.error(err) }
    }

    // Sort
    const toggleSort = (field) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        else { setSortField(field); setSortDir('asc') }
        setSkip(0)
    }
    const SortIcon = ({ field }) => {
        if (sortField !== field) return <ChevronDown className="w-3 h-3 text-zinc-400 opacity-0 group-hover:opacity-100" />
        return sortDir === 'asc'
            ? <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
            : <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
    }

    const fmt = (n) => n != null ? Number(n).toLocaleString('ro-RO') : '0'
    const totalPages = Math.ceil(total / limit)
    const currentPage = Math.floor(skip / limit) + 1
    const stockColor = (q) => q <= 0 ? 'text-red-500' : q < 10 ? 'text-amber-500' : 'text-emerald-500'
    const stateColor = (s) => ({
        active: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        draft: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
        archived: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
        deleted: 'bg-red-500/10 text-red-500 border-red-500/20',
    }[s] || 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20')

    // Listing sub-row with "use as primary" button
    const renderListingRow = (listing, parentProduct) => {
        const isPrimary = parentProduct.primary_uid === listing.uid
        const isSaving = settingPrimary === listing.uid
        return (
            <tr key={listing.uid}
                className={`border-l-2 transition-colors ${isPrimary
                    ? 'border-l-emerald-400 bg-emerald-50/30 dark:bg-emerald-900/10'
                    : 'border-l-indigo-400 bg-indigo-50/20 dark:bg-indigo-900/10'}`}>
                <td className="px-3 py-2 pl-8 text-xs text-zinc-400">
                    <div className="flex items-center gap-1">
                        ↳
                        {isPrimary && <Check className="w-3 h-3 text-emerald-500" />}
                    </div>
                </td>
                <td className="px-3 py-2">
                    {listing.images?.[0]?.src ? (
                        <img src={listing.images[0].src} alt="" className="w-8 h-8 rounded object-cover border border-zinc-200 dark:border-zinc-700" loading="lazy"
                            onError={(e) => { e.target.style.display = 'none' }} />
                    ) : (
                        <div className="w-8 h-8 rounded bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center">
                            <ImageIcon className="w-3 h-3 text-zinc-400" />
                        </div>
                    )}
                </td>
                <td className="px-3 py-2">
                    <div className="text-xs text-zinc-600 dark:text-zinc-300">{listing.title_1 || '—'}</div>
                    {listing.missing_barcode && (
                        <span className="inline-flex items-center gap-0.5 text-amber-500 text-xs mt-0.5">
                            <AlertCircle className="w-3 h-3" /> Barcode lipsă
                        </span>
                    )}
                </td>
                <td className="px-3 py-2 text-xs font-mono text-zinc-500">{listing.sku || '—'}</td>
                <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                        {(listing.stores || []).map(s => (
                            <span key={s.uid} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded text-xs">
                                <Store className="w-2.5 h-2.5" />{s.name || s.uid?.slice(0, 8)}
                            </span>
                        ))}
                    </div>
                </td>
                <td className={`px-3 py-2 text-right text-xs font-semibold ${stockColor(listing.stock_available)}`}>
                    {fmt(listing.stock_available)}
                </td>
                <td className="px-3 py-2 text-right text-xs text-zinc-400">{fmt(listing.stock_committed)}</td>
                <td className="px-3 py-2 text-right">
                    <button
                        onClick={(e) => { e.stopPropagation(); handleSetPrimary(parentProduct, listing.uid) }}
                        disabled={isPrimary || isSaving}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all ${isPrimary
                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 cursor-default'
                            : isSaving
                            ? 'bg-zinc-200 dark:bg-zinc-600 text-zinc-400 cursor-wait'
                            : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:text-indigo-600 dark:hover:text-indigo-400'
                        }`}
                        title={isPrimary ? 'Aceasta e sursa activă pentru stoc/imagine' : 'Folosește stocul și imaginea din această listare'}>
                        {isPrimary ? <><Check className="w-3 h-3" /> Activ</>
                            : isSaving ? <><RefreshCw className="w-3 h-3 animate-spin" /> Se salvează...</>
                            : <><Star className="w-3 h-3" /> Folosește</>}
                    </button>
                </td>
                <td className="px-3 py-2 text-center">
                    <span className={`inline-flex px-1.5 py-0.5 rounded-full text-xs border ${stateColor(listing.state)}`}>
                        {listing.state}
                    </span>
                </td>
                <td className="px-3 py-2" />
            </tr>
        )
    }

    return (
        <div className="space-y-6">
            {/* KPIs */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
                    {[
                        { label: 'Total Produse', value: stats.total_products, icon: Package, color: 'indigo' },
                        { label: 'Active', value: stats.active_products, color: 'emerald' },
                        { label: 'În Stoc', value: stats.in_stock, icon: Box, color: 'green' },
                        { label: 'Fără Stoc', value: stats.out_of_stock, icon: AlertTriangle, color: 'red' },
                        { label: 'Stoc Disponibil', value: stats.total_stock_available, color: 'blue' },
                        { label: 'Stoc Committed', value: stats.total_stock_committed, color: 'amber' },
                        { label: 'Excluse', value: stats.excluded_count, icon: EyeOff, color: 'zinc' },
                    ].map(({ label, value, icon: Icon, color }) => (
                        <div key={label} className={`bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-${color}-500`}>
                            <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                {Icon && <Icon className={`w-4 h-4 text-${color}-500`} />} {label}
                            </div>
                            <div className={`text-2xl font-bold text-${color}-600 dark:text-${color}-400 mt-1`}>{fmt(value)}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input type="text" value={search}
                        onChange={(e) => { setSearch(e.target.value); setSkip(0) }}
                        placeholder="Caută titlu, SKU, cod de bare..."
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all" />
                </div>

                {[
                    { value: storeFilter, set: setStoreFilter, options: [['', 'Toate magazinele'], ...stores.map(s => [s.uid, s.name])] },
                    { value: stateFilter, set: setStateFilter, options: [['', 'Toate stările'], ['active', 'Active'], ['draft', 'Draft'], ['archived', 'Arhivate']] },
                    { value: stockFilter, set: setStockFilter, options: [['', 'Tot stocul'], ['in_stock', 'În stoc'], ['out_of_stock', 'Fără stoc']] },
                    { value: excludeFilter, set: setExcludeFilter, options: [['', 'Toate produsele'], ['active', 'Neexcluse'], ['excluded', 'Excluse']] },
                    { value: costFilter, set: setCostFilter, options: [['', 'Cost: Toate'], ['yes', 'Cu cost'], ['no', 'Fără cost']] },
                    { value: barcodeFilter, set: setBarcodeFilter, options: [['', 'Barcode: Toate'], ['yes', 'Cu barcode lipsă'], ['no', 'Barcode complet']] },
                ].map(({ value, set, options }, fi) => (
                    <select key={fi} value={value} onChange={(e) => { set(e.target.value); setSkip(0) }}
                        className="px-3 py-2.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-700 dark:text-zinc-300">
                        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                ))}

                <button onClick={handleSync} disabled={syncing}
                    className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                    <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? 'Sync...' : 'Sync'}
                </button>

                <button onClick={handleExport} disabled={exporting}
                    className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                    <Download className={`w-4 h-4 ${exporting ? 'animate-bounce' : ''}`} />
                    {exporting ? 'Export...' : 'Excel'}
                </button>

                <div className="h-6 w-px bg-zinc-300 dark:bg-zinc-600" />

                <button onClick={() => productsApi.downloadCogsTemplate()}
                    className="flex items-center gap-2 px-3 py-2.5 bg-zinc-100 dark:bg-zinc-700/50 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl text-sm font-medium transition-colors">
                    <Download className="w-4 h-4" />
                    Template COGS
                </button>

                <input type="file" id="cogs-import-input" accept=".xlsx,.xls" className="hidden"
                    onChange={handleImportCogs} />
                <button onClick={() => document.getElementById('cogs-import-input').click()} disabled={importing}
                    className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                    <Package className={`w-4 h-4 ${importing ? 'animate-spin' : ''}`} />
                    {importing ? 'Import...' : 'Import COGS'}
                </button>

                <div className="text-sm text-zinc-500 dark:text-zinc-400 ml-auto">
                    {fmt(total)} produse unice
                </div>
            </div>

            {/* COGS Import Result */}
            {cogsImportResult && (
                <div className={`rounded-xl p-3 text-sm flex items-center justify-between ${
                    cogsImportResult.error
                        ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                        : 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                }`}>
                    <span>
                        {cogsImportResult.error
                            ? `❌ ${cogsImportResult.error}`
                            : `✅ Import finalizat: ${cogsImportResult.created} create, ${cogsImportResult.updated} actualizate (${cogsImportResult.total_processed} procesate total)${cogsImportResult.errors?.length ? ` — ${cogsImportResult.errors.length} erori` : ''}`
                        }
                    </span>
                    <button onClick={() => setCogsImportResult(null)}
                        className="text-xs px-2 py-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">×</button>
                </div>
            )}

            {/* Table */}
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-zinc-200 dark:border-zinc-700/50 bg-zinc-50 dark:bg-zinc-800/80">
                                <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase w-12">#</th>
                                <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Img</th>
                                <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase cursor-pointer group"
                                    onClick={() => toggleSort('title_1')}>
                                    <span className="flex items-center gap-1">Produs <SortIcon field="title_1" /></span>
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase cursor-pointer group"
                                    onClick={() => toggleSort('sku')}>
                                    <span className="flex items-center gap-1">SKU <SortIcon field="sku" /></span>
                                </th>
                                <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Magazine</th>
                                <th className="px-3 py-3 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase cursor-pointer group"
                                    onClick={() => toggleSort('stock_available')}>
                                    <span className="flex items-center justify-end gap-1">Disponibil <SortIcon field="stock_available" /></span>
                                </th>
                                <th className="px-3 py-3 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase cursor-pointer group"
                                    onClick={() => toggleSort('stock_committed')}>
                                    <span className="flex items-center justify-end gap-1">Committed <SortIcon field="stock_committed" /></span>
                                </th>
                                <th className="px-3 py-3 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase cursor-pointer group"
                                    onClick={() => toggleSort('cost')}>
                                    <span className="flex items-center justify-end gap-1">Cost/buc <SortIcon field="cost" /></span>
                                </th>
                                <th className="px-3 py-3 text-center text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Stare</th>
                                <th className="px-3 py-3 text-center text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase w-16">Excl.</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                            {loading ? (
                                <tr><td colSpan={10} className="px-6 py-12 text-center">
                                    <RefreshCw className="w-6 h-6 text-indigo-500 animate-spin mx-auto mb-2" />
                                    <span className="text-zinc-500 text-sm">Se încarcă produsele...</span>
                                </td></tr>
                            ) : products.length === 0 ? (
                                <tr><td colSpan={10} className="px-6 py-12 text-center text-zinc-500 text-sm">
                                    Niciun produs găsit. Apasă "Sync" pentru a sincroniza din Frisbo.
                                </td></tr>
                            ) : products.map((p, idx) => {
                                const firstImg = p.images?.[0]?.src
                                const cost = p.cost ?? skuCosts[p.sku]
                                const isEditing = editingCost?.sku === p.sku
                                const isExcluded = p.exclude_from_stock
                                const isGrouped = (p.grouped_count || 1) > 1
                                const isExpanded = expandedGroup === p.uid

                                return (<>
                                    <tr key={p.uid}
                                        className={`transition-colors ${isGrouped ? 'cursor-pointer' : ''} ${isExcluded
                                            ? 'opacity-50 bg-zinc-50/50 dark:bg-zinc-900/30'
                                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30'
                                        } ${isExpanded ? 'bg-indigo-50/40 dark:bg-indigo-900/15' : ''}`}
                                        onClick={() => isGrouped && setExpandedGroup(isExpanded ? null : p.uid)}>
                                        <td className="px-3 py-3 text-sm text-zinc-400">
                                            <div className="flex items-center gap-1">
                                                {isGrouped && (
                                                    <ChevronRight className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                                )}
                                                {skip + idx + 1}
                                            </div>
                                        </td>
                                        <td className="px-3 py-3">
                                            {firstImg ? (
                                                <img src={firstImg} alt={p.title_1}
                                                    className="w-10 h-10 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700"
                                                    loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
                                            ) : (
                                                <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center">
                                                    <ImageIcon className="w-4 h-4 text-zinc-400" />
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className={`text-sm font-medium truncate max-w-[250px] ${isExcluded ? 'line-through text-zinc-500' : 'text-zinc-900 dark:text-white'}`}>
                                                    {p.title_1 || '—'}
                                                </div>
                                                {isGrouped && (
                                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-md text-xs font-semibold flex-shrink-0"
                                                        title={`${p.grouped_count} listări grupate — click pentru detalii`}>
                                                        <Layers className="w-3 h-3" />×{p.grouped_count}
                                                    </span>
                                                )}
                                                {p.has_missing_barcode && (
                                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-md text-xs font-medium flex-shrink-0"
                                                        title="Una sau mai multe listări nu au cod de bare">
                                                        <AlertCircle className="w-3 h-3" />
                                                    </span>
                                                )}
                                            </div>
                                            {p.title_2 && <div className="text-xs text-zinc-500 truncate max-w-[250px]">{p.title_2}</div>}
                                            {p.barcode && <div className="text-xs text-zinc-400 font-mono">{p.barcode}</div>}
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className="text-sm font-mono text-zinc-600 dark:text-zinc-300">{p.sku || '—'}</span>
                                        </td>
                                        <td className="px-3 py-3">
                                            <div className="flex flex-wrap gap-1">
                                                {(p.stores || []).slice(0, 4).map(s => (
                                                    <span key={s.uid} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-medium">
                                                        <Store className="w-3 h-3" />{s.name || s.uid?.slice(0, 8)}
                                                    </span>
                                                ))}
                                                {(p.stores || []).length > 4 && <span className="text-xs text-zinc-400">+{p.stores.length - 4}</span>}
                                            </div>
                                        </td>
                                        <td className={`px-3 py-3 text-right text-sm font-semibold ${stockColor(p.stock_available)}`}>
                                            {fmt(p.stock_available)}
                                        </td>
                                        <td className="px-3 py-3 text-right text-sm text-zinc-500 dark:text-zinc-400">
                                            {fmt(p.stock_committed)}
                                        </td>
                                        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                            {isEditing ? (
                                                <div className="flex items-center justify-end gap-1">
                                                    <input type="number"
                                                        className="w-20 px-2 py-1 text-sm text-right bg-white dark:bg-zinc-700 border border-indigo-400 rounded-lg focus:ring-2 focus:ring-indigo-500 text-zinc-900 dark:text-white"
                                                        value={editingCost.value}
                                                        onChange={(e) => setEditingCost({ ...editingCost, value: e.target.value })}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleSaveCost(p.sku, editingCost.value)
                                                            if (e.key === 'Escape') setEditingCost(null)
                                                        }}
                                                        autoFocus />
                                                    <button className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                                                        onClick={() => handleSaveCost(p.sku, editingCost.value)}>✓</button>
                                                </div>
                                            ) : (
                                                <button
                                                    className={`text-sm font-medium px-2 py-1 rounded-lg transition-colors ${cost
                                                        ? 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                                                        : 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 italic'}`}
                                                    onClick={() => setEditingCost({ sku: p.sku, value: cost || 0 })}
                                                    title="Click pentru a edita costul">
                                                    {cost ? `${Number(cost).toFixed(2)}` : 'Adaugă'}
                                                </button>
                                            )}
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${stateColor(p.state)}`}>
                                                {p.state || '?'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => handleToggleExclude(p.uid, p.exclude_from_stock)}
                                                className={`p-1.5 rounded-lg transition-colors ${isExcluded
                                                    ? 'bg-red-100 dark:bg-red-900/30 text-red-500 hover:bg-red-200 dark:hover:bg-red-900/50'
                                                    : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-600'}`}
                                                title={isExcluded ? 'Include în calcul stoc' : 'Exclude din calcul stoc'}>
                                                {isExcluded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </td>
                                    </tr>
                                    {/* Expanded individual listings */}
                                    {isExpanded && isGrouped && (p.listings || []).map((l) => renderListingRow(l, p))}
                                </>)
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-700/50">
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">
                            Pagina {currentPage} din {totalPages} ({fmt(total)} produse)
                        </span>
                        <div className="flex items-center gap-2">
                            <button disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - limit))}
                                className="px-3 py-1.5 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-40">
                                ← Anterior
                            </button>
                            <button disabled={skip + limit >= total} onClick={() => setSkip(skip + limit)}
                                className="px-3 py-1.5 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-40">
                                Următor →
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
