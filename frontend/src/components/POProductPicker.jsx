/**
 * POProductPicker — Full-screen modal with scorecard grid for bulk product selection.
 * 
 * Shows products as rich scorecards with image, title, SKU, stock, velocity, and urgency.
 * Click cards to toggle selection. "Add to PO" button at the bottom adds all selected.
 * Designed for high-volume PO creation workflows.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Search, X, Plus, Check, Package, TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw, ChevronDown, Building2 } from 'lucide-react'
import { purchaseOrdersMgmtApi, analyticsApi } from '../services/api/analytics'
import { storesApi } from '../services/api/stores'

const fmt = n => n == null ? '0' : Number(n).toLocaleString('ro-RO')

function UrgencyBadge({ urgency }) {
  const cfg = {
    urgent: { label: 'Urgent', cls: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30' },
    warning: { label: 'Warning', cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30' },
    ok: { label: 'OK', cls: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/30' },
    overstock: { label: 'Overstock', cls: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30' },
    dormant: { label: 'Dormant', cls: 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-600' },
  }
  const c = cfg[urgency] || cfg.ok
  return <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded-full border ${c.cls}`}>{c.label}</span>
}

function VelocityIndicator({ velocity }) {
  if (velocity == null) return <span className="text-zinc-400 text-[10px]">—</span>
  const Icon = velocity > 1 ? TrendingUp : velocity > 0 ? Minus : TrendingDown
  const cls = velocity > 1 ? 'text-green-600 dark:text-green-400' : velocity > 0 ? 'text-zinc-500' : 'text-red-500 dark:text-red-400'
  return (
    <span className={`flex items-center gap-0.5 text-xs font-semibold ${cls}`}>
      <Icon className="w-3 h-3" /> {velocity.toFixed(1)}/zi
    </span>
  )
}

export default function POProductPicker({ existingSkus = [], onAddProducts, onClose, categories = [] }) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('')  // category key or ''
  const [customStores, setCustomStores] = useState([])       // manually selected store names
  const [allStores, setAllStores] = useState([])             // all available stores
  const [showStoreDropdown, setShowStoreDropdown] = useState(false)
  const [results, setResults] = useState([])
  const [analyticsData, setAnalyticsData] = useState({}) // sku -> analytics row
  const [loading, setLoading] = useState(false)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [selected, setSelected] = useState(new Set()) // Set of SKUs
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  const existingSet = useMemo(() => new Set(existingSkus), [existingSkus])

  // Resolve active category → store names string for the API
  const activeCatStores = useMemo(() => {
    if (!activeCategory) return []
    const cat = categories.find(c => c.key === activeCategory)
    return cat?.stores || []
  }, [activeCategory, categories])

  // Combined store filter: category stores + custom-selected stores
  const effectiveStoreFilter = useMemo(() => {
    const all = new Set([...activeCatStores, ...customStores])
    return [...all].join(',')
  }, [activeCatStores, customStores])

  // Load all stores on mount (for the dropdown)
  useEffect(() => {
    storesApi.getStores()
      .then(r => setAllStores((r.stores || r || []).filter(s => s.name)))
      .catch(() => {})
  }, [])

  // Load analytics data once on mount (velocity, days_of_stock, urgency, suggested_qty)
  useEffect(() => {
    let cancelled = false
    setAnalyticsLoading(true)
    analyticsApi.getPurchaseOrders({ days: 30 })
      .then(r => {
        if (cancelled) return
        const map = {}
        for (const p of (r.products || [])) {
          if (p.sku) map[p.sku] = p
        }
        setAnalyticsData(map)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAnalyticsLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Focus search on mount
  useEffect(() => { inputRef.current?.focus() }, [])

  // Search — allows empty text when store filter is active (shows all products from those stores)
  const doSearch = useCallback(async (q, storeFilter) => {
    if (!q && !storeFilter) { setResults([]); return }
    setLoading(true)
    try {
      const params = { limit: 150 }
      if (q) params.search = q
      if (storeFilter) params.store_names = storeFilter
      const r = await purchaseOrdersMgmtApi.productPicker(params)
      setResults(r.products || [])
    } catch (e) { console.error('Picker search failed:', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(search, effectiveStoreFilter), 300)
    return () => clearTimeout(debounceRef.current)
  }, [search, effectiveStoreFilter, doSearch])

  // Clear selection when category/store changes
  const switchCategory = (key) => {
    setActiveCategory(key)
    setCustomStores([])
    setSelected(new Set())
  }

  const toggleCustomStore = (name) => {
    setCustomStores(prev =>
      prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
    )
    setSelected(new Set())
  }

  const toggleSelect = (sku) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      return next
    })
  }

  const selectableResults = results.filter(p => !existingSet.has(p.sku))

  const toggleAll = () => {
    if (selected.size >= selectableResults.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectableResults.map(p => p.sku)))
    }
  }

  const handleAdd = () => {
    const toAdd = results.filter(p => selected.has(p.sku) && !existingSet.has(p.sku))
    // Enrich with analytics data (suggested_qty as default quantity)
    const enriched = toAdd.map(p => {
      const a = analyticsData[p.sku]
      return {
        ...p,
        suggested_qty: a?.suggested_qty || 1,
        velocity: a?.velocity,
        days_of_stock: a?.days_of_stock,
        urgency: a?.urgency,
      }
    })
    onAddProducts(enriched)
    setSelected(new Set())
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="relative w-[95vw] max-w-5xl h-[85vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl 
        border border-zinc-200 dark:border-zinc-700 flex flex-col overflow-hidden animate-in">

        {/* ─── Header ─── */}
        <div className="px-5 pt-4 pb-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
                placeholder={activeCategory ? `Search in ${categories.find(c => c.key === activeCategory)?.label || activeCategory}...` : 'Search by SKU, barcode, or product name...'}
                className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-600 
                  bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white placeholder-zinc-400
                  focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
              {search && (
                <button onClick={() => { setSearch(''); setResults([]) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {loading && <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin flex-shrink-0" />}
            <button onClick={onClose}
              className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-700">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Category filter chips */}
          {categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold mr-1">Category:</span>
              <button onClick={() => switchCategory('')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                  !activeCategory
                    ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
                All Products
              </button>
              {categories.map(c => (
                <button key={c.key} onClick={() => switchCategory(c.key)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                    activeCategory === c.key
                      ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 shadow-sm'
                      : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
                  {c.label}
                </button>
              ))}

              {/* Store dropdown trigger */}
              <div className="relative ml-1">
                <button onClick={() => setShowStoreDropdown(!showStoreDropdown)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                    customStores.length > 0
                      ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 shadow-sm'
                      : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}>
                  <Building2 className="w-3 h-3" />
                  {customStores.length > 0 ? `${customStores.length} stores` : 'Stores'}
                  <ChevronDown className="w-3 h-3" />
                </button>
                {showStoreDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-56 max-h-60 overflow-y-auto bg-white dark:bg-zinc-800 
                    rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-600 z-50 py-1"
                    onClick={e => e.stopPropagation()}>
                    {allStores.map(s => {
                      const isInCat = activeCatStores.includes(s.name)
                      const isCustom = customStores.includes(s.name)
                      return (
                        <label key={s.uid || s.name}
                          className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors
                            ${isInCat ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'}`}>
                          <input type="checkbox"
                            checked={isInCat || isCustom}
                            disabled={isInCat}
                            onChange={() => !isInCat && toggleCustomStore(s.name)}
                            className="w-3 h-3 rounded border-zinc-300 dark:border-zinc-600 text-indigo-500 focus:ring-indigo-500/30" />
                          <span className={`truncate ${isInCat ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                            {s.name}
                          </span>
                          {isInCat && <span className="ml-auto text-[9px] text-indigo-400">from category</span>}
                        </label>
                      )
                    })}
                    {allStores.length === 0 && (
                      <div className="px-3 py-2 text-xs text-zinc-400">Loading stores...</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─── Select All / Info bar ─── */}
        {results.length > 0 && (
          <div className="flex items-center justify-between px-5 py-2 bg-zinc-50/50 dark:bg-zinc-800/30 border-b border-zinc-100 dark:border-zinc-700/50">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-600 dark:text-zinc-400">
              <input type="checkbox"
                checked={selected.size > 0 && selected.size >= selectableResults.length}
                onChange={toggleAll}
                className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 text-indigo-500 focus:ring-indigo-500/30" />
              Select all {selectableResults.length} available
            </label>
            <span className="text-[10px] text-zinc-400">
              {results.length} results · {selected.size} selected
              {activeCategory && ` · Filtered: ${categories.find(c => c.key === activeCategory)?.label || activeCategory}`}
              {analyticsLoading && ' · Loading velocity data...'}
            </span>
          </div>
        )}

        {/* ─── Product Grid ─── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {results.length === 0 && !loading && (search || effectiveStoreFilter) && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400">
              <Package className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm">No products found{search ? ` for "${search}"` : ''}</p>
              {effectiveStoreFilter && <p className="text-xs mt-1">Try a different category or broaden your search</p>}
            </div>
          )}
          {results.length === 0 && !loading && !search && !effectiveStoreFilter && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400">
              <Search className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm">Select a category or search for products</p>
              <p className="text-xs mt-1 text-zinc-500">Click on product cards to select them</p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {results.map(p => {
              const isAdded = existingSet.has(p.sku)
              const isChecked = selected.has(p.sku)
              const a = analyticsData[p.sku] || {}

              return (
                <button key={p.uid || p.sku}
                  onClick={() => !isAdded && toggleSelect(p.sku)}
                  disabled={isAdded}
                  className={`relative group text-left rounded-xl border-2 transition-all duration-150
                    ${isAdded
                      ? 'opacity-40 cursor-default border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800'
                      : isChecked
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 shadow-md shadow-indigo-500/10 scale-[1.02]'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:shadow-md bg-white dark:bg-zinc-800'
                    }`}>

                  {/* Checkbox indicator */}
                  <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all
                    ${isAdded
                      ? 'border-green-400 bg-green-100 dark:bg-green-500/20'
                      : isChecked
                        ? 'border-indigo-500 bg-indigo-500'
                        : 'border-zinc-300 dark:border-zinc-600 group-hover:border-indigo-400'
                    }`}>
                    {isAdded && <Check className="w-3 h-3 text-green-600 dark:text-green-400" />}
                    {isChecked && !isAdded && <Check className="w-3 h-3 text-white" />}
                  </div>

                  {/* Urgency badge */}
                  {a.urgency && a.urgency !== 'ok' && a.urgency !== 'overstock' && a.urgency !== 'dormant' && (
                    <div className="absolute top-2 left-2">
                      <UrgencyBadge urgency={a.urgency} />
                    </div>
                  )}

                  {/* Product image */}
                  <div className="px-3 pt-3 pb-1">
                    <div className="w-full aspect-square rounded-lg bg-zinc-100 dark:bg-zinc-700 overflow-hidden mb-2 flex items-center justify-center">
                      {p.image ? (
                        <img src={p.image} className="w-full h-full object-cover" alt={p.product_name} loading="lazy" />
                      ) : (
                        <Package className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
                      )}
                    </div>

                    {/* Title */}
                    <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate leading-tight" title={p.product_name}>
                      {p.product_name || '—'}
                    </h4>

                    {/* SKU */}
                    <p className="text-xs font-bold font-mono text-zinc-700 dark:text-zinc-300 mt-0.5 truncate">{p.sku}</p>
                  </div>

                  {/* Stats bar */}
                  <div className="px-3 pb-3 pt-1.5 mt-1 border-t border-zinc-100 dark:border-zinc-700/50">
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                      {/* Stock */}
                      <div>
                        <span className="text-[9px] text-zinc-400 uppercase tracking-wider">Stock</span>
                        <p className={`text-xs font-bold ${(p.stock_available || 0) < 10 ? 'text-red-600 dark:text-red-400' : 'text-zinc-800 dark:text-zinc-200'}`}>
                          {fmt(p.stock_available)}
                        </p>
                      </div>

                      {/* Velocity */}
                      <div>
                        <span className="text-[9px] text-zinc-400 uppercase tracking-wider">Velocity</span>
                        <div><VelocityIndicator velocity={a.velocity} /></div>
                      </div>

                      {/* Days of stock */}
                      <div>
                        <span className="text-[9px] text-zinc-400 uppercase tracking-wider">Days Left</span>
                        <p className={`text-xs font-bold ${
                          a.days_of_stock == null ? 'text-zinc-400'
                            : a.days_of_stock < 30 ? 'text-red-600 dark:text-red-400'
                            : a.days_of_stock < 90 ? 'text-amber-600 dark:text-amber-400'
                            : 'text-zinc-700 dark:text-zinc-300'
                        }`}>
                          {a.days_of_stock != null ? fmt(Math.round(a.days_of_stock)) : '∞'}
                        </p>
                      </div>

                      {/* Suggested Qty */}
                      <div>
                        <span className="text-[9px] text-zinc-400 uppercase tracking-wider">Suggested</span>
                        <p className={`text-xs font-bold ${a.suggested_qty > 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'}`}>
                          {a.suggested_qty > 0 ? `+${fmt(a.suggested_qty)}` : '—'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Added overlay */}
                  {isAdded && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl">
                      <span className="px-2 py-1 text-[10px] font-bold bg-green-100 dark:bg-green-500/30 text-green-700 dark:text-green-300 rounded-full">
                        ✓ Already Added
                      </span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ─── Footer Action Bar ─── */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80">
          <div className="text-xs text-zinc-500">
            {selected.size > 0 ? (
              <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                {selected.size} product{selected.size !== 1 ? 's' : ''} selected
              </span>
            ) : (
              <span>Click on products to select them</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 
                bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded-lg transition-colors">
              Cancel
            </button>
            <button onClick={handleAdd} disabled={selected.size === 0}
              className="flex items-center gap-2 px-5 py-2 text-sm font-bold 
                bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg 
                disabled:opacity-30 disabled:cursor-not-allowed transition-all
                shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30">
              <Plus className="w-4 h-4" />
              Add {selected.size > 0 ? `${selected.size} Products` : 'Selected'} to PO
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes animate-in {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-in { animation: animate-in 0.2s ease-out; }
      `}</style>
    </div>
  )
}
