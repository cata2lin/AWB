/**
 * POCreateModal — Create PO modal with DB product picker, category picker, and image validation.
 */
import { Plus, X, Search, RefreshCw, Save, AlertTriangle, ShoppingCart, Package, Image } from 'lucide-react'
import { fmt, fmtCur } from './POManagerPanel'

export default function POCreateModal({ h, analyticsProducts = [], poCategories = [] }) {
  const totalCost = h.createForm.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0)
  const missingImages = h.createForm.items.filter(i => !(i.product_image || '').trim())
  const catConfig = poCategories.find(c => c.key === h.createForm.po_category) || { tom_enabled: false }
  const isTomEnabled = catConfig.tom_enabled

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-8 overflow-y-auto">
      <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-2xl w-full max-w-5xl mx-4 mb-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-indigo-500" /> Create Purchase Order
          </h2>
          <button onClick={h.resetCreate}><X className="w-5 h-5 text-zinc-400 hover:text-zinc-600" /></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Category + Type + Priority */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Category</label>
              <select value={h.createForm.po_category} onChange={e => h.setCreateForm(p => ({ ...p, po_category: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white">
                {poCategories.length > 0 ? poCategories.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                )) : <>
                  <option value="packaging">📦 Packaging</option>
                  <option value="oils">🫒 Oils</option>
                </>}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Type</label>
              <select value={h.createForm.po_type} onChange={e => h.setCreateForm(p => ({ ...p, po_type: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white">
                <option value="RESTOCK">Restock</option>
                <option value="NEW_PRODUCT">New Product</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Priority</label>
              <select value={h.createForm.priority} onChange={e => h.setCreateForm(p => ({ ...p, priority: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white">
                <option value="STANDARD">Standard</option>
                <option value="HIGH">High</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Supplier</label>
              <input value={h.createForm.supplier_name} onChange={e => h.setCreateForm(p => ({ ...p, supplier_name: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" placeholder="Supplier" />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Expected Arrival</label>
              <input type="date" value={h.createForm.expected_arrival_date} onChange={e => h.setCreateForm(p => ({ ...p, expected_arrival_date: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Notes</label>
              <input value={h.createForm.notes} onChange={e => h.setCreateForm(p => ({ ...p, notes: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" placeholder="Notes" />
            </div>
          </div>

          {/* Product picker — DB search */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={h.pickerSearch} onChange={e => h.setPickerSearch(e.target.value)} placeholder="Search products from database (SKU, name, barcode)..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" />
              {h.pickerLoading && <RefreshCw className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 animate-spin" />}
            </div>
            <button onClick={h.addAllUrgent} className="flex items-center gap-1 px-3 py-2 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg whitespace-nowrap">
              <AlertTriangle className="w-3.5 h-3.5" /> Add Urgent
            </button>
          </div>

          {/* Picker results */}
          {h.pickerResults.length > 0 && (
            <div className="bg-zinc-50 dark:bg-zinc-700/30 rounded-lg border border-zinc-200 dark:border-zinc-600 max-h-48 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {h.pickerResults.map(p => (
                <button key={p.uid || p.sku} onClick={() => { h.addProduct(p); h.setPickerSearch('') }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-600/30 text-xs">
                  {p.image ? <img src={p.image} className="w-6 h-6 rounded object-cover border border-zinc-200 dark:border-zinc-600 flex-shrink-0" /> : <Package className="w-5 h-5 text-zinc-400 flex-shrink-0" />}
                  <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300 w-36 truncate">{p.sku}</span>
                  <span className="text-zinc-500 truncate flex-1">{p.product_name}</span>
                  <span className="text-zinc-400">Stk:{fmt(p.stock_available)}</span>
                  <span className="text-zinc-400">{p.barcode || 'no barcode'}</span>
                  <Plus className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* Image warning for TOM-enabled categories */}
          {isTomEnabled && missingImages.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
              <Image className="w-4 h-4 flex-shrink-0" />
              <span><strong>{missingImages.length}</strong> item(s) missing images — TOM requires images for all lines. These will block sending to TOM.</span>
            </div>
          )}

          {/* Items table */}
          {h.createForm.items.length > 0 && (
            <div className="overflow-x-auto max-h-[300px] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-600">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                  <tr className="text-xs text-zinc-500">
                    <th className="px-3 py-2 w-8"></th>
                    <th className="px-3 py-2 text-left font-medium">SKU</th>
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Unit Cost</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 text-center font-medium">Img</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                  {h.createForm.items.map(item => (
                    <tr key={item.sku} className={!item.product_image && isTomEnabled ? 'bg-amber-50/50 dark:bg-amber-500/5' : ''}>
                      <td className="px-3 py-2">
                        {item.product_image ? <img src={item.product_image} className="w-6 h-6 rounded object-cover" /> : <Package className="w-5 h-5 text-zinc-400" />}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">{item.sku}</td>
                      <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[180px]">{item.product_name}</td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" min="1" value={item.quantity} onChange={e => h.updateItem(item.sku, 'quantity', parseInt(e.target.value) || 0)}
                          className="w-20 px-2 py-1 text-xs text-right rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" min="0" step="0.01" value={item.unit_cost} onChange={e => h.updateItem(item.sku, 'unit_cost', parseFloat(e.target.value) || 0)}
                          className="w-20 px-2 py-1 text-xs text-right rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-medium text-zinc-700 dark:text-zinc-300">{fmtCur(item.quantity * item.unit_cost)}</td>
                      <td className="px-3 py-2 text-center">
                        {item.product_image ? <span className="text-green-500 text-[10px]">✓</span> : <span className="text-amber-500 text-[10px]">✗</span>}
                      </td>
                      <td className="px-3 py-2"><button onClick={() => h.removeItem(item.sku)}><X className="w-4 h-4 text-red-400 hover:text-red-600" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-700">
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {h.createForm.items.length} items · {fmt(h.createForm.items.reduce((s, i) => s + i.quantity, 0))} units · <span className="font-semibold text-zinc-900 dark:text-white">{fmtCur(totalCost)}</span>
              {isTomEnabled && missingImages.length > 0 && <span className="ml-2 text-amber-500 text-xs">⚠ {missingImages.length} missing images</span>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={h.resetCreate} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Cancel</button>
              <button onClick={h.submitCreate} disabled={h.saving || h.createForm.items.length === 0}
                className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-40">
                {h.saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Create PO
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
