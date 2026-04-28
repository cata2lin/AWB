/**
 * SkuPickerModal — Reusable modal for selecting SKUs from the product database.
 *
 * Features:
 * - Searchable product list with images, SKU, name, stock
 * - Sortable columns (SKU, name, stock)
 * - Multi-select with checkboxes
 * - Shows currently selected SKUs as chips
 * - Used for velocity include/exclude pattern filters
 *
 * @param {string[]} selected - Currently selected SKU strings
 * @param {Function} onChange - Callback with updated SKU array
 * @param {Function} onClose - Close the modal
 * @param {string} title - Modal title (e.g. "Include SKU" or "Exclude SKU")
 * @param {string} accent - Color accent: 'emerald' for include, 'red' for exclude
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Search, X, Check, Package, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { purchaseOrdersMgmtApi } from '../services/api/analytics'

export default function SkuPickerModal({ selected = [], onChange, onClose, title = 'Selectează SKU', accent = 'emerald' }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [sort, setSort] = useState({ col: 'sku', dir: 'asc' })
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const selectedSet = useMemo(() => new Set(selected), [selected])

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus() }, [])

  /** Fetch products from the picker API */
  const doSearch = useCallback(async (q) => {
    setLoading(true)
    try {
      const params = { limit: 200 }
      if (q) params.search = q
      const r = await purchaseOrdersMgmtApi.productPicker(params)
      setResults(r.products || [])
    } catch (e) { console.error('SKU picker search failed:', e) }
    finally { setLoading(false) }
  }, [])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(search), 300)
    return () => clearTimeout(debounceRef.current)
  }, [search, doSearch])

  // Load initial results
  useEffect(() => { doSearch('') }, [doSearch])

  /** Toggle a SKU in the selection */
  const toggleSku = (sku) => {
    const next = new Set(selectedSet)
    if (next.has(sku)) next.delete(sku)
    else next.add(sku)
    onChange([...next])
  }

  /** Remove a SKU from the selection (from chip) */
  const removeSku = (sku) => {
    onChange(selected.filter(s => s !== sku))
  }

  /** Sort handler */
  const toggleSort = (col) => {
    setSort(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'asc' }
    )
  }

  /** Sorted results */
  const sorted = useMemo(() => {
    return [...results].sort((a, b) => {
      let av, bv
      if (sort.col === 'sku') { av = a.sku || ''; bv = b.sku || '' }
      else if (sort.col === 'name') { av = a.product_name || a.title || ''; bv = b.product_name || b.title || '' }
      else if (sort.col === 'stock') { av = a.stock ?? 0; bv = b.stock ?? 0 }
      else { av = a[sort.col] ?? ''; bv = b[sort.col] ?? '' }
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sort.dir === 'asc' ? av - bv : bv - av
    })
  }, [results, sort])

  const accentCls = accent === 'red'
    ? { bg: 'bg-red-600 hover:bg-red-700', chip: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30', ring: 'ring-red-500' }
    : { bg: 'bg-emerald-600 hover:bg-emerald-700', chip: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30', ring: 'ring-emerald-500' }

  const SortIcon = ({ col }) => {
    if (sort.col !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />
    return sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 w-[680px] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
            <Package className="w-4 h-4 text-zinc-400" /> {title}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected chips */}
        {selected.length > 0 && (
          <div className="px-5 py-2 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            <span className="text-[10px] text-zinc-400 self-center mr-1">{selected.length} selectate:</span>
            {selected.map(sku => (
              <span key={sku} className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border ${accentCls.chip}`}>
                {sku}
                <button onClick={() => removeSku(sku)} className="hover:opacity-70">×</button>
              </span>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="px-5 py-2 border-b border-zinc-100 dark:border-zinc-800">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Caută SKU sau nume produs..."
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-zinc-400 text-sm">Se încarcă...</div>
          ) : sorted.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-zinc-400 text-sm">Niciun produs găsit</div>
          ) : (
            <table className="w-full">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 w-12"></th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-400 uppercase cursor-pointer select-none"
                    onClick={() => toggleSort('sku')}>
                    <span className="flex items-center gap-1">SKU <SortIcon col="sku" /></span>
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-400 uppercase cursor-pointer select-none"
                    onClick={() => toggleSort('name')}>
                    <span className="flex items-center gap-1">Produs <SortIcon col="name" /></span>
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-400 uppercase cursor-pointer select-none"
                    onClick={() => toggleSort('stock')}>
                    <span className="flex items-center gap-1 justify-end">Stoc <SortIcon col="stock" /></span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {sorted.map(p => {
                  const sku = p.sku
                  const isSelected = selectedSet.has(sku)
                  const name = p.product_name || p.title || ''
                  const img = p.image || p.product_image || p.images?.[0]?.src || ''
                  return (
                    <tr key={sku} onClick={() => toggleSku(sku)}
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-emerald-50/60 dark:bg-emerald-900/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
                      <td className="px-3 py-1.5">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                          isSelected ? `${accentCls.bg} border-transparent` : 'border-zinc-300 dark:border-zinc-600'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        {img ? (
                          <img src={img} alt="" className="w-9 h-9 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700" />
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
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate block max-w-[250px]">{name}</span>
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
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
          <span className="text-xs text-zinc-400">{results.length} produse • {selected.length} selectate</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors">
              Închide
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
