/**
 * SkuPickerModal — Reusable modal for selecting SKUs from the product database.
 *
 * Loads ALL products on mount, then filters/sorts client-side for instant UX.
 * Features: search by SKU/name, filter by store, sort asc/desc on any column.
 *
 * @param {string[]} selected - Currently selected SKU strings
 * @param {Function} onChange - Callback with updated SKU array
 * @param {Function} onClose - Close the modal
 * @param {string} title - Modal title
 * @param {string} accent - 'emerald' | 'red'
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { Search, X, Check, Package, ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react'
import { purchaseOrdersMgmtApi } from '../services/api/analytics'
import { storesApi } from '../services/api/stores'

export default function SkuPickerModal({ selected = [], onChange, onClose, title = 'Selectează SKU', accent = 'emerald' }) {
  const [allProducts, setAllProducts] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [sort, setSort] = useState({ col: 'sku', dir: 'asc' })
  const inputRef = useRef(null)
  const selectedSet = useMemo(() => new Set(selected), [selected])

  /** Load all products + stores on mount */
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [prodRes, storeRes] = await Promise.all([
          purchaseOrdersMgmtApi.productPicker({ limit: 300 }),
          storesApi.getStores(),
        ])
        if (cancelled) return
        setAllProducts(prodRes.products || [])
        setStores((storeRes.stores || storeRes || []).filter(s => s.name))
      } catch (e) { console.error('SkuPickerModal load error:', e) }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Focus search after load
  useEffect(() => { if (!loading) inputRef.current?.focus() }, [loading])

  /** Toggle a SKU */
  const toggleSku = (sku) => {
    const next = new Set(selectedSet)
    if (next.has(sku)) next.delete(sku)
    else next.add(sku)
    onChange([...next])
  }

  /** Remove a SKU from chips */
  const removeSku = (sku) => onChange(selected.filter(s => s !== sku))

  /** Sort handler */
  const toggleSort = (col) => {
    setSort(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'asc' }
    )
  }

  /** Client-side filtered + sorted results */
  const filteredSorted = useMemo(() => {
    let list = allProducts

    // Text search (SKU or product name)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(p =>
        (p.sku || '').toLowerCase().includes(q) ||
        (p.product_name || p.title || '').toLowerCase().includes(q)
      )
    }

    // Store filter
    if (storeFilter) {
      list = list.filter(p => {
        const pStores = p.store_names || p.store_name || ''
        return pStores.toLowerCase().includes(storeFilter.toLowerCase())
      })
    }

    // Sort
    return [...list].sort((a, b) => {
      let av, bv
      if (sort.col === 'sku') { av = a.sku || ''; bv = b.sku || '' }
      else if (sort.col === 'name') { av = a.product_name || a.title || ''; bv = b.product_name || b.title || '' }
      else if (sort.col === 'stock') { av = a.stock ?? 0; bv = b.stock ?? 0 }
      else if (sort.col === 'store') { av = a.store_names || a.store_name || ''; bv = b.store_names || b.store_name || '' }
      else { av = a[sort.col] ?? ''; bv = b[sort.col] ?? '' }
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sort.dir === 'asc' ? av - bv : bv - av
    })
  }, [allProducts, search, storeFilter, sort])

  // Accent styles
  const accentCls = accent === 'red'
    ? { bg: 'bg-red-600', chip: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30' }
    : { bg: 'bg-emerald-600', chip: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' }

  /** Sort column header helper */
  const SortTh = ({ col, label, align = 'left' }) => (
    <th className={`px-3 py-2 text-${align} text-[10px] font-semibold text-zinc-400 uppercase cursor-pointer select-none hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors`}
      onClick={() => toggleSort(col)}>
      <span className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {sort.col === col
          ? (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-20" />}
      </span>
    </th>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 w-[720px] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
            <Package className="w-4 h-4 text-zinc-400" /> {title}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected chips */}
        {selected.length > 0 && (
          <div className="px-5 py-2 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
            <span className="text-[10px] text-zinc-400 self-center mr-1 font-semibold">{selected.length} selectate:</span>
            {selected.map(sku => (
              <span key={sku} className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border ${accentCls.chip}`}>
                {sku}
                <button onClick={() => removeSku(sku)} className="hover:opacity-70 ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}

        {/* Search + Store filter row */}
        <div className="px-5 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Caută SKU sau nume produs..."
              className="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
            className="px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white min-w-[140px]">
            <option value="">Toate magazinele</option>
            {stores.map(s => (
              <option key={s.uid || s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Product table */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400 text-sm gap-2">
              <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              Se încarcă produsele...
            </div>
          ) : filteredSorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400 text-sm gap-1">
              <Package className="w-8 h-8 opacity-30" />
              Niciun produs găsit
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-2 py-2 w-12"></th>
                  <SortTh col="sku" label="SKU" />
                  <SortTh col="name" label="Produs" />
                  <SortTh col="store" label="Magazin" />
                  <SortTh col="stock" label="Stoc" align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredSorted.map(p => {
                  const sku = p.sku
                  const isSelected = selectedSet.has(sku)
                  const name = p.product_name || p.title || ''
                  const img = p.image || p.product_image || p.images?.[0]?.src || ''
                  const storeName = p.store_names || p.store_name || ''
                  return (
                    <tr key={sku} onClick={() => toggleSku(sku)}
                      className={`cursor-pointer transition-colors ${isSelected ? (accent === 'red' ? 'bg-red-50/60 dark:bg-red-900/10' : 'bg-emerald-50/60 dark:bg-emerald-900/10') : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
                      <td className="px-3 py-1.5">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                          isSelected ? `${accentCls.bg} border-transparent` : 'border-zinc-300 dark:border-zinc-600'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        {img ? (
                          <img src={img} alt="" className="w-9 h-9 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700" loading="lazy" />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                            <Package className="w-4 h-4 text-zinc-400" />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100">{sku}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate block max-w-[220px]">{name}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="text-[10px] text-zinc-400 truncate block max-w-[120px]">{storeName}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <span className={`text-xs font-medium ${(p.stock ?? 0) === 0 ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-300'}`}>
                          {(p.stock ?? 0).toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
          <span className="text-xs text-zinc-400">
            {filteredSorted.length} produse afișate • <span className="font-semibold text-zinc-600 dark:text-zinc-300">{selected.length} selectate</span>
          </span>
          <button onClick={onClose}
            className={`px-4 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors ${accentCls.bg} hover:opacity-90`}>
            Gata
          </button>
        </div>
      </div>
    </div>
  )
}
