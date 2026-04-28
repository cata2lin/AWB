/**
 * POProductPicker — Persistent grid with checkbox multi-select for bulk PO product selection.
 * 
 * Key features:
 * - Persistent search grid (no disappearing dropdown)
 * - Checkbox multi-select with "Add Selected" batch action
 * - "Select All" for bulk operations
 * - Already-added products are dimmed with "✓ Added" badge
 * - Exact SKU/barcode match is auto-highlighted
 * - Barcode scanner support (exact match auto-adds)
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, RefreshCw, Plus, Check, Package, ChevronUp, ChevronDown, X } from 'lucide-react'
import { purchaseOrdersMgmtApi } from '../services/api/analytics'

const fmt = n => n == null ? '0' : Number(n).toLocaleString('ro-RO')
const fmtCur = n => n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON`

export default function POProductPicker({ existingSkus = [], onAddProducts }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(new Set()) // Set of UIDs
  const [collapsed, setCollapsed] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  // Existing SKUs set for O(1) lookup
  const existingSet = new Set(existingSkus)

  // Search with debounce
  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 1) { setResults([]); return }
    setLoading(true)
    try {
      const r = await purchaseOrdersMgmtApi.productPicker({ search: q, limit: 100 })
      const products = r.products || []
      setResults(products)

      // Auto-add on exact barcode/SKU match (scanner support)
      if (r.exact_match_uid && q.length >= 5) {
        const exact = products.find(p => p.uid === r.exact_match_uid)
        if (exact && !existingSet.has(exact.sku)) {
          onAddProducts([exact])
        }
      }
    } catch (e) { console.error('Picker search failed:', e) }
    finally { setLoading(false) }
  }, [existingSkus])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(search), 300)
    return () => clearTimeout(debounceRef.current)
  }, [search, doSearch])

  // Clear selection when results change
  useEffect(() => { setSelected(new Set()) }, [results])

  const toggleSelect = (uid) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const toggleAll = () => {
    const selectable = results.filter(p => !existingSet.has(p.sku))
    if (selected.size >= selectable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectable.map(p => p.uid)))
    }
  }

  const addSelected = () => {
    const toAdd = results.filter(p => selected.has(p.uid) && !existingSet.has(p.sku))
    if (toAdd.length > 0) {
      onAddProducts(toAdd)
      setSelected(new Set())
    }
  }

  const selectableCount = results.filter(p => !existingSet.has(p.sku)).length
  const selectedCount = selected.size

  if (collapsed) {
    return (
      <button onClick={() => { setCollapsed(false); setTimeout(() => inputRef.current?.focus(), 100) }}
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 
          bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/15 rounded-lg transition-colors">
        <span className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5" /> Search & Add Products
        </span>
        <ChevronDown className="w-4 h-4" />
      </button>
    )
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-600 rounded-xl bg-white dark:bg-zinc-800 overflow-hidden">
      {/* Search header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-700">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by SKU, barcode, or product name..."
            autoFocus
            className="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 
              bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white placeholder-zinc-400
              focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
          {search && (
            <button onClick={() => { setSearch(''); setResults([]) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              <X className="w-3 h-3" />
            </button>
          )}
          {loading && <RefreshCw className="w-3.5 h-3.5 absolute right-7 top-1/2 -translate-y-1/2 text-indigo-400 animate-spin" />}
        </div>
        <button onClick={() => setCollapsed(true)}
          className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700">
          <ChevronUp className="w-4 h-4" />
        </button>
      </div>

      {/* Results grid */}
      {results.length > 0 && (
        <>
          <div className="max-h-[280px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-900/80 sticky top-0 z-10">
                <tr className="text-zinc-500 text-[10px] uppercase tracking-wider">
                  <th className="px-2 py-1.5 text-left w-8">
                    <input type="checkbox" checked={selected.size > 0 && selected.size >= selectableCount}
                      onChange={toggleAll}
                      className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 text-indigo-500 
                        focus:ring-indigo-500/30 cursor-pointer" />
                  </th>
                  <th className="px-2 py-1.5 text-left">Product</th>
                  <th className="px-2 py-1.5 text-left">SKU</th>
                  <th className="px-2 py-1.5 text-right">Stock</th>
                  <th className="px-2 py-1.5 text-right">Cost</th>
                  <th className="px-2 py-1.5 text-right">Stores</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                {results.map(p => {
                  const isAdded = existingSet.has(p.sku)
                  const isChecked = selected.has(p.uid)
                  return (
                    <tr key={p.uid}
                      onClick={() => !isAdded && toggleSelect(p.uid)}
                      className={`cursor-pointer transition-colors ${
                        isAdded
                          ? 'opacity-40 cursor-default bg-zinc-50 dark:bg-zinc-800'
                          : isChecked
                            ? 'bg-indigo-50 dark:bg-indigo-500/10'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30'
                      }`}>
                      <td className="px-2 py-1.5">
                        {isAdded ? (
                          <span className="flex items-center justify-center w-3.5 h-3.5">
                            <Check className="w-3 h-3 text-green-500" />
                          </span>
                        ) : (
                          <input type="checkbox" checked={isChecked}
                            onChange={() => toggleSelect(p.uid)}
                            onClick={e => e.stopPropagation()}
                            className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 text-indigo-500 
                              focus:ring-indigo-500/30 cursor-pointer" />
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          {p.image ? (
                            <img src={p.image} className="w-6 h-6 rounded object-cover border border-zinc-200 dark:border-zinc-600 flex-shrink-0" alt="" />
                          ) : (
                            <Package className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-zinc-800 dark:text-zinc-200 font-medium truncate max-w-[180px]">
                              {p.product_name || '—'}
                            </div>
                            {p.variant_title && p.variant_title !== p.product_name && (
                              <div className="text-[10px] text-zinc-400 truncate max-w-[180px]">{p.variant_title}</div>
                            )}
                          </div>
                          {isAdded && (
                            <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-semibold bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 rounded-full">
                              Added
                            </span>
                          )}
                          {p.is_exact_match && !isAdded && (
                            <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-semibold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-full">
                              Match
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{p.sku}</td>
                      <td className="px-2 py-1.5 text-right">
                        <span className={`font-medium ${p.stock_available < 10 ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                          {fmt(p.stock_available)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right text-zinc-500 dark:text-zinc-400">{fmtCur(p.unit_cost)}</td>
                      <td className="px-2 py-1.5 text-right">
                        {(p.store_names || []).length > 0 ? (
                          <span className="text-[10px] text-zinc-400 truncate max-w-[100px] inline-block"
                            title={(p.store_names || []).join(', ')}>
                            {(p.store_names || []).slice(0, 2).join(', ')}
                            {(p.store_names || []).length > 2 && ` +${(p.store_names || []).length - 2}`}
                          </span>
                        ) : <span className="text-zinc-400">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-200 dark:border-zinc-700">
            <span className="text-[10px] text-zinc-500">
              {results.length} results · {selectableCount} available · {selectedCount} selected
            </span>
            <button onClick={addSelected} disabled={selectedCount === 0}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold 
                bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg 
                disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Add {selectedCount > 0 ? `${selectedCount} Selected` : 'Selected'}
            </button>
          </div>
        </>
      )}

      {/* Empty state */}
      {results.length === 0 && search.length >= 1 && !loading && (
        <div className="px-4 py-6 text-center text-xs text-zinc-400">
          No products found for "{search}"
        </div>
      )}
      {results.length === 0 && search.length < 1 && (
        <div className="px-4 py-4 text-center text-xs text-zinc-400">
          Type a SKU, barcode, or product name to search
        </div>
      )}
    </div>
  )
}
