/**
 * POProductPicker — preloads full catalogue on mount, filters client-side.
 * No round-trips on search/category change — instant filtering via useMemo.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Search, X, Plus, Check, Package, TrendingUp, TrendingDown, Minus, RefreshCw, ChevronDown, Building2, Edit2, ArrowUpDown } from 'lucide-react'
import { purchaseOrdersMgmtApi, analyticsApi } from '../services/api/analytics'
import { storesApi } from '../services/api/stores'
import { productsApi } from '../services/api/products'

const fmt = n => n == null ? '0' : Number(n).toLocaleString('ro-RO')

function VelocityIndicator({ velocity }) {
  if (velocity == null) return <span className="text-zinc-400 text-[10px]">—</span>
  const Icon = velocity > 1 ? TrendingUp : velocity > 0 ? Minus : TrendingDown
  const cls = velocity > 1 ? 'text-green-600 dark:text-green-400' : velocity > 0 ? 'text-zinc-500' : 'text-red-500 dark:text-red-400'
  return <span className={`flex items-center gap-0.5 text-xs font-semibold ${cls}`}><Icon className="w-3 h-3" />{velocity.toFixed(1)}/zi</span>
}

const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Name A→Z' },
  { value: 'stock_desc', label: 'Stock ↓' },
  { value: 'stock_asc', label: 'Stock ↑' },
  { value: 'velocity_desc', label: 'Velocity ↓' },
  { value: 'days_asc', label: 'Days left ↑' },
]

export default function POProductPicker({ existingSkus = [], onAddProducts, onClose, categories = [] }) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('')
  const [customStores, setCustomStores] = useState([])
  const [allStores, setAllStores] = useState([])
  const [showStoreDropdown, setShowStoreDropdown] = useState(false)
  const [sortBy, setSortBy] = useState('name_asc')

  // Full catalogue cache — loaded once on mount
  const [allProducts, setAllProducts] = useState([])
  const [catalogueLoading, setCatalogueLoading] = useState(true)

  // Analytics data lazy-loaded in background
  const [analyticsData, setAnalyticsData] = useState({})
  const [analyticsLoading, setAnalyticsLoading] = useState(true)

  const [selected, setSelected] = useState(new Set())
  const [editingVariantUid, setEditingVariantUid] = useState(null)
  const [variantForm, setVariantForm] = useState({ v1: '', v2: '' })
  const inputRef = useRef(null)

  const existingSet = useMemo(() => new Set(existingSkus), [existingSkus])

  // ── Load full catalogue ONCE on mount ──
  useEffect(() => {
    setCatalogueLoading(true)
    purchaseOrdersMgmtApi.productPicker({ limit: 1000 })
      .then(r => setAllProducts(r.products || []))
      .catch(() => {})
      .finally(() => setCatalogueLoading(false))
    inputRef.current?.focus()
  }, [])

  // ── Load stores ──
  useEffect(() => {
    storesApi.getStores()
      .then(r => setAllStores((r.stores || r || []).filter(s => s.name)))
      .catch(() => {})
  }, [])

  // ── Load analytics (velocity, days, urgency) in background ──
  useEffect(() => {
    setAnalyticsLoading(true)
    analyticsApi.getPurchaseOrders({ days: 30 })
      .then(r => {
        const map = {}
        for (const p of (r.products || [])) { if (p.sku) map[p.sku] = p }
        setAnalyticsData(map)
      })
      .catch(() => {})
      .finally(() => setAnalyticsLoading(false))
  }, [])

  // ── Resolve active category → store names ──
  const activeCatStores = useMemo(() => {
    if (!activeCategory) return []
    return categories.find(c => c.key === activeCategory)?.stores || []
  }, [activeCategory, categories])

  const effectiveStoreNames = useMemo(() => {
    const all = new Set([...activeCatStores, ...customStores])
    return [...all]
  }, [activeCatStores, customStores])

  // ── All filtering + sorting is CLIENT-SIDE (instant, no API call) ──
  const results = useMemo(() => {
    let list = allProducts

    // Category / store filter
    if (effectiveStoreNames.length > 0) {
      const nameSet = new Set(effectiveStoreNames)
      list = list.filter(p => (p.store_names || []).some(n => nameSet.has(n)))
    }

    // Text search (SKU, name, barcode)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(p =>
        (p.sku || '').toLowerCase().includes(q) ||
        (p.product_name || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q)
      )
      // Exact SKU matches first
      list = [...list].sort((a, b) => {
        const aEx = (a.sku || '').toLowerCase() === q ? 0 : 1
        const bEx = (b.sku || '').toLowerCase() === q ? 0 : 1
        return aEx - bEx || (a.product_name || '').localeCompare(b.product_name || '')
      })
      return list
    }

    // Sort
    list = [...list].sort((a, b) => {
      const aA = analyticsData[a.sku] || {}
      const bA = analyticsData[b.sku] || {}
      switch (sortBy) {
        case 'stock_desc': return (b.stock_available || 0) - (a.stock_available || 0)
        case 'stock_asc': return (a.stock_available || 0) - (b.stock_available || 0)
        case 'velocity_desc': return (bA.velocity || 0) - (aA.velocity || 0)
        case 'days_asc': return (aA.days_of_stock ?? 9999) - (bA.days_of_stock ?? 9999)
        default: return (a.product_name || '').localeCompare(b.product_name || '')
      }
    })
    return list
  }, [allProducts, effectiveStoreNames, search, sortBy, analyticsData])

  const selectableResults = useMemo(() => results.filter(p => !existingSet.has(p.sku)), [results, existingSet])

  const switchCategory = k => { setActiveCategory(k); setCustomStores([]); setSelected(new Set()) }
  const toggleCustomStore = n => { setCustomStores(p => p.includes(n) ? p.filter(s => s !== n) : [...p, n]); setSelected(new Set()) }
  const toggleSelect = sku => setSelected(prev => { const n = new Set(prev); n.has(sku) ? n.delete(sku) : n.add(sku); return n })
  const toggleAll = () => selected.size >= selectableResults.length
    ? setSelected(new Set())
    : setSelected(new Set(selectableResults.map(p => p.sku)))

  const handleAdd = () => {
    const toAdd = results.filter(p => selected.has(p.sku) && !existingSet.has(p.sku))
    const enriched = toAdd.map(p => { const a = analyticsData[p.sku] || {}; return { ...p, suggested_qty: a.suggested_qty || 1, velocity: a.velocity, days_of_stock: a.days_of_stock, urgency: a.urgency } })
    onAddProducts(enriched); setSelected(new Set()); onClose()
  }

  const handleSaveVariants = async uid => {
    try {
      await productsApi.updateVariants(uid, { tom_variant_1: variantForm.v1, tom_variant_2: variantForm.v2 })
      setAllProducts(prev => prev.map(p => p.uid === uid ? { ...p, tom_variant_1: variantForm.v1, tom_variant_2: variantForm.v2 } : p))
      setEditingVariantUid(null)
    } catch { alert('Failed to save variants.') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="relative w-[95vw] max-w-5xl h-[85vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 flex flex-col overflow-hidden animate-in">

        {/* ─── Header ─── */}
        <div className="px-5 pt-4 pb-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by SKU, barcode, or product name…"
                className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"><X className="w-4 h-4" /></button>}
            </div>

            {/* Sort */}
            <div className="relative flex-shrink-0">
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                className="pl-8 pr-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500/30 appearance-none cursor-pointer">
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <ArrowUpDown className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            </div>

            {catalogueLoading && <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin flex-shrink-0" />}
            <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-700"><X className="w-5 h-5" /></button>
          </div>

          {/* Category chips */}
          {categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold mr-1">Category:</span>
              <button onClick={() => switchCategory('')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${!activeCategory ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'}`}>
                All Products
              </button>
              {categories.map(c => (
                <button key={c.key} onClick={() => switchCategory(c.key)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${activeCategory === c.key ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'}`}>
                  {c.label}
                </button>
              ))}
              {/* Store dropdown */}
              <div className="relative ml-1">
                <button onClick={() => setShowStoreDropdown(!showStoreDropdown)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${customStores.length > 0 ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'}`}>
                  <Building2 className="w-3 h-3" />
                  {customStores.length > 0 ? `${customStores.length} stores` : 'Stores'}
                  <ChevronDown className="w-3 h-3" />
                </button>
                {showStoreDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-56 max-h-60 overflow-y-auto bg-white dark:bg-zinc-800 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-600 z-50 py-1" onClick={e => e.stopPropagation()}>
                    {allStores.map(s => {
                      const isInCat = activeCatStores.includes(s.name)
                      return (
                        <label key={s.uid || s.name} className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ${isInCat ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'}`}>
                          <input type="checkbox" checked={isInCat || customStores.includes(s.name)} disabled={isInCat} onChange={() => !isInCat && toggleCustomStore(s.name)} className="w-3 h-3 rounded" />
                          <span className={`truncate ${isInCat ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-700 dark:text-zinc-300'}`}>{s.name}</span>
                          {isInCat && <span className="ml-auto text-[9px] text-indigo-400">category</span>}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─── Info bar ─── */}
        {(results.length > 0 || catalogueLoading) && (
          <div className="flex items-center justify-between px-5 py-2 bg-zinc-50/50 dark:bg-zinc-800/30 border-b border-zinc-100 dark:border-zinc-700/50">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" checked={selected.size > 0 && selected.size >= selectableResults.length} onChange={toggleAll} className="w-3.5 h-3.5 rounded border-zinc-300 text-indigo-500" />
              Select all {selectableResults.length} available
            </label>
            <span className="text-[10px] text-zinc-400">
              {catalogueLoading ? 'Loading catalogue…' : `${results.length} results`} · {selected.size} selected
              {analyticsLoading && ' · Loading velocity…'}
            </span>
          </div>
        )}

        {/* ─── Grid ─── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {catalogueLoading && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400">
              <RefreshCw className="w-8 h-8 animate-spin mb-3 text-indigo-400" />
              <p className="text-sm">Loading product catalogue…</p>
            </div>
          )}
          {!catalogueLoading && results.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400">
              {search || effectiveStoreNames.length > 0
                ? <><Package className="w-10 h-10 mb-2 opacity-30" /><p className="text-sm">No products found</p></>
                : <><Search className="w-10 h-10 mb-2 opacity-30" /><p className="text-sm">Select a category or search for products</p></>}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {results.map(p => {
              const isAdded = existingSet.has(p.sku)
              const isChecked = selected.has(p.sku)
              const a = analyticsData[p.sku] || {}
              return (
                <button key={p.uid || p.sku} onClick={() => !isAdded && toggleSelect(p.sku)} disabled={isAdded}
                  className={`relative group text-left rounded-xl border-2 transition-all duration-150
                    ${isAdded ? 'opacity-40 cursor-default border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800'
                      : isChecked ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 shadow-md shadow-indigo-500/10 scale-[1.02]'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:shadow-md bg-white dark:bg-zinc-800'}`}>

                  {/* Checkbox */}
                  <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all
                    ${isAdded ? 'border-green-400 bg-green-100 dark:bg-green-500/20' : isChecked ? 'border-indigo-500 bg-indigo-500' : 'border-zinc-300 dark:border-zinc-600 group-hover:border-indigo-400'}`}>
                    {isAdded && <Check className="w-3 h-3 text-green-600 dark:text-green-400" />}
                    {isChecked && !isAdded && <Check className="w-3 h-3 text-white" />}
                  </div>

                  {/* Image */}
                  <div className="px-3 pt-3 pb-1">
                    <div className="w-full aspect-square rounded-lg bg-zinc-100 dark:bg-zinc-700 overflow-hidden mb-2 flex items-center justify-center">
                      {p.image
                        ? <img src={p.image} className="w-full h-full object-cover" alt={p.product_name} loading="lazy" />
                        : <Package className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />}
                    </div>
                    <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate leading-tight" title={p.product_name}>{p.product_name || '—'}</h4>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.is_custom && <span className="px-1.5 py-0.5 bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-[9px] font-bold uppercase rounded">Custom</span>}
                      {p.tom_variant_1 && <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-[9px] font-bold uppercase rounded border border-zinc-200 dark:border-zinc-600 truncate max-w-full">{p.tom_variant_1}</span>}
                      {p.tom_variant_2 && <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-[9px] font-bold uppercase rounded border border-zinc-200 dark:border-zinc-600 truncate max-w-full">{p.tom_variant_2}</span>}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p className="text-xs font-bold font-mono text-zinc-700 dark:text-zinc-300 truncate">{p.sku}</p>
                      <button onClick={e => { e.stopPropagation(); setEditingVariantUid(p.uid); setVariantForm({ v1: p.tom_variant_1 || '', v2: p.tom_variant_2 || '' }) }}
                        className="p-1 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 z-10"><Edit2 className="w-3 h-3" /></button>
                    </div>

                    {/* Inline variant editor */}
                    {editingVariantUid === p.uid && (
                      <div className="absolute inset-x-0 bottom-0 bg-white dark:bg-zinc-800 p-3 shadow-lg border-t border-zinc-200 dark:border-zinc-700 z-20 rounded-b-xl" onClick={e => e.stopPropagation()}>
                        <div className="space-y-2">
                          <div><label className="block text-[9px] font-bold text-zinc-500 uppercase mb-1">Variant 1 (Color)</label>
                            <input value={variantForm.v1} onChange={e => setVariantForm({ ...variantForm, v1: e.target.value })} className="w-full px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" /></div>
                          <div><label className="block text-[9px] font-bold text-zinc-500 uppercase mb-1">Variant 2 (Size)</label>
                            <input value={variantForm.v2} onChange={e => setVariantForm({ ...variantForm, v2: e.target.value })} className="w-full px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" /></div>
                          <div className="flex gap-2 pt-1">
                            <button onClick={() => setEditingVariantUid(null)} className="flex-1 px-2 py-1 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded hover:bg-zinc-200">Cancel</button>
                            <button onClick={() => handleSaveVariants(p.uid)} className="flex-1 px-2 py-1 text-[10px] font-bold bg-indigo-600 text-white rounded hover:bg-indigo-700">Save</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="px-3 pb-3 pt-1.5 mt-1 border-t border-zinc-100 dark:border-zinc-700/50">
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                      <div>
                        <span className="text-[9px] text-zinc-400 uppercase tracking-wider">Stock</span>
                        <p className={`text-xs font-bold ${(p.stock_available || 0) < 10 ? 'text-red-600 dark:text-red-400' : 'text-zinc-800 dark:text-zinc-200'}`}>{fmt(p.stock_available)}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-zinc-400 uppercase tracking-wider">Velocity</span>
                        <div><VelocityIndicator velocity={a.velocity} /></div>
                      </div>
                      <div>
                        <span className="text-[9px] text-zinc-400 uppercase tracking-wider">Days Left</span>
                        <p className={`text-xs font-bold ${a.days_of_stock == null ? 'text-zinc-400' : a.days_of_stock < 30 ? 'text-red-600 dark:text-red-400' : a.days_of_stock < 90 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                          {a.days_of_stock != null ? fmt(Math.round(a.days_of_stock)) : '∞'}
                        </p>
                      </div>
                      <div>
                        <span className="text-[9px] text-zinc-400 uppercase tracking-wider">Suggested</span>
                        <p className={`text-xs font-bold ${a.suggested_qty > 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'}`}>{a.suggested_qty > 0 ? `+${fmt(a.suggested_qty)}` : '—'}</p>
                      </div>
                    </div>
                  </div>

                  {isAdded && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl">
                      <span className="px-2 py-1 text-[10px] font-bold bg-green-100 dark:bg-green-500/30 text-green-700 dark:text-green-300 rounded-full">✓ Already Added</span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ─── Footer ─── */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80">
          <div className="text-xs text-zinc-500">
            {selected.size > 0
              ? <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{selected.size} product{selected.size !== 1 ? 's' : ''} selected</span>
              : <span>Click on products to select them</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded-lg transition-colors">Cancel</button>
            <button onClick={handleAdd} disabled={selected.size === 0}
              className="flex items-center gap-2 px-5 py-2 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/20">
              <Plus className="w-4 h-4" />
              Add {selected.size > 0 ? `${selected.size} Products` : 'Selected'} to PO
            </button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes animate-in { from { opacity:0; transform:scale(0.95) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
        .animate-in { animation: animate-in 0.2s ease-out; }
      `}</style>
    </div>
  )
}
