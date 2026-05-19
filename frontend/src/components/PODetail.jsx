/**
 * PODetail — Right panel: view existing PO detail OR create new PO.
 * Unified layout for both modes with inline product search.
 */
import { useState, useMemo } from 'react'
import { RefreshCw, Save, Plus, X, Package, Check, Trash2, Send, RotateCw, PenLine, Ban, FileText, ChevronDown, ChevronUp, CheckCircle2, XCircle, Search, Filter, ArrowUpDown, ArrowUp, ArrowDown, Edit2, Layers } from 'lucide-react'
import { STATUS_CFG, TOM_CLS } from './POList'
import POProductPicker from './POProductPicker'
import { productsApi } from '../services/api/products'
import useConfirm from '../hooks/useConfirm'

const fmt = n => n == null ? '0' : Number(n).toLocaleString('ro-RO')
const fmtCur = n => n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON`
const fmtUsd = n => n == null ? '' : `$${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2 })}`
const round2 = n => Math.round(n * 100) / 100

export default function PODetail({ h }) {
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [showLog, setShowLog] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [itemSearch, setItemSearch] = useState(h.search || '')
  const [itemPriorityFilter, setItemPriorityFilter] = useState('')
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  // Use SKU as unique key for variant editing — product_uid can be empty/shared
  const [editingVariantSku, setEditingVariantSku] = useState(null)
  const [variantForm, setVariantForm] = useState({ v1: '', v2: '' })

  const handleDeletePO = async (po) => {
    const ok = await confirm({
      title: 'Șterge comanda draft',
      description: `Sigur ștergi comanda ${po.po_number || ''}? Această acțiune este ireversibilă.`,
      confirmLabel: 'Da, șterge',
      cancelLabel: 'Anulează',
      variant: 'danger',
    })
    if (ok) await h.deletePO(po.id)
  }

  const handleSaveVariants = async (uid, sku) => {
    try {
      await productsApi.updateVariants(uid, {
        tom_variant_1: variantForm.v1,
        tom_variant_2: variantForm.v2
      })
      // Update local form items to reflect the saved variants
      if (isEditable) {
        h.updateItem(sku, 'tom_variant_1', variantForm.v1)
        h.updateItem(sku, 'tom_variant_2', variantForm.v2)
      }
      h.setToast({ type: 'success', msg: 'Variants updated!' })
      setEditingVariantSku(null)
    } catch (e) {
      console.error('Failed to save variants:', e)
      h.setToast({ type: 'error', msg: 'Failed to save variants.' })
    }
  }

  const isCreate = h.mode === 'create'
  const isEditable = ['create', 'edit'].includes(h.mode)
  const po = isCreate ? null : h.selectedPO
  const items = isEditable ? h.poForm.items : (po?.items || [])
  const catConfig = isEditable
    ? (h.poCategories.find(c => c.key === h.poForm.po_category) || { tom_enabled: false })
    : h.getCatConfig(po?.po_category)
  const isTomEnabled = catConfig.tom_enabled
  const hasTom = !isCreate && !!po?.tom_number

  const totalCost = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_cost || 0), 0)
  const totalQty = items.reduce((s, i) => s + (i.quantity || 0), 0)
  // Live USD computation — use the PO's stored exchange rate, or fall back to item-level usd costs
  const usdRate = po?.usd_exchange_rate || null
  const totalCostUsd = usdRate ? round2(totalCost / usdRate) : null

  // Filter items by search and priority — must be called before any early return
  const filteredItems = useMemo(() => {
    let result = items
    if (itemSearch) {
      const q = itemSearch.toLowerCase()
      result = result.filter(i => (i.product_name || '').toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q))
    }
    if (itemPriorityFilter) {
      result = result.filter(i => (i.priority || po?.priority || 'STANDARD') === itemPriorityFilter)
    }
    if (sortCol) {
      result = [...result].sort((a, b) => {
        let valA, valB;
        switch (sortCol) {
          case 'product_name':
            valA = (a.product_name || '').toLowerCase(); valB = (b.product_name || '').toLowerCase();
            break;
          case 'sku':
            valA = (a.sku || '').toLowerCase(); valB = (b.sku || '').toLowerCase();
            break;
          case 'priority':
            valA = (a.priority || po?.priority || 'STANDARD'); valB = (b.priority || po?.priority || 'STANDARD');
            break;
          case 'quantity':
            valA = a.quantity || 0; valB = b.quantity || 0;
            break;
          case 'unit_cost':
            valA = a.unit_cost || 0; valB = b.unit_cost || 0;
            break;
          case 'total':
            valA = (a.quantity || 0) * (a.unit_cost || 0); valB = (b.quantity || 0) * (b.unit_cost || 0);
            break;
          case 'received':
            valA = a.received_qty || 0; valB = b.received_qty || 0;
            break;
          case 'tom':
            valA = a.tom_status || ''; valB = b.tom_status || '';
            break;
          default:
            valA = a[sortCol]; valB = b[sortCol];
        }
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
      })
    }
    return result
  }, [items, itemSearch, itemPriorityFilter, po?.priority, sortCol, sortDir])

  const SortHeader = ({ col, label, className }) => {
    const isActive = sortCol === col
    return (
      <th className={`px-3 py-2.5 font-medium cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors select-none ${className}`} 
          onClick={() => {
            if (isActive) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
            else { setSortCol(col); setSortDir('asc') }
          }}>
        <div className={`flex items-center gap-1 ${className.includes('text-right') ? 'justify-end' : className.includes('text-center') ? 'justify-center' : ''}`}>
          {label}
          {isActive ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-primary-500" /> : <ArrowDown className="w-3 h-3 text-primary-500" />) : <ArrowUpDown className="w-3 h-3 text-zinc-300 dark:text-zinc-600" />}
        </div>
      </th>
    )
  }

  // Empty state
  if (!isCreate && !po) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-500">
        <div className="text-center">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select a PO or create a new one</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* ═══ HEADER ═══ */}
      <div className="p-5 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-zinc-800 dark:text-white flex items-center gap-2">
            {isCreate ? (
              <><Plus className="w-5 h-5 text-primary-500" /> New Purchase Order</>
            ) : h.mode === 'edit' ? (
              <><PenLine className="w-5 h-5 text-primary-500" /> Editing {po.po_number}</>
            ) : (
              <><span className="font-mono text-lg">{po.po_number}</span>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_CFG[po.status]?.cls || ''}`}>
                {po.status}
              </span></>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {!isCreate && h.mode === 'detail' && ['DRAFT', 'SENT', 'ORDERED', 'APPROVED', 'PARTIALLY_RECEIVED'].includes(po?.status) && (
              <button onClick={h.startEdit} className="p-1.5 text-zinc-400 hover:text-primary-600 dark:hover:text-primary-400 flex items-center gap-1 text-xs font-medium">
                <PenLine className="w-4 h-4" /> Edit
              </button>
            )}
            {isEditable && (
              <button onClick={isCreate ? h.cancelCreate : () => h.setMode('detail')} className="p-1.5 text-zinc-400 hover:text-zinc-600"><X className="w-5 h-5" /></button>
            )}
          </div>
        </div>

        {/* Meta fields */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {isEditable ? (<>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Category</label>
              <select value={h.poForm.po_category} onChange={e => h.setPoForm(p => ({ ...p, po_category: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white">
                {h.poCategories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Type</label>
              <select value={h.poForm.po_type} onChange={e => h.setPoForm(p => ({ ...p, po_type: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white">
                <option value="RESTOCK">Restock</option>
                <option value="NEW_PRODUCT">New Product</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Priority</label>
              <select value={h.poForm.priority} onChange={e => h.setPoForm(p => ({ ...p, priority: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white">
                <option value="STANDARD">Standard</option>
                <option value="HIGH">High</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Supplier</label>
              <input value={h.poForm.supplier_name} onChange={e => h.setPoForm(p => ({ ...p, supplier_name: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" placeholder="Supplier name" />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Expected Arrival</label>
              <input type="date" value={h.poForm.expected_arrival_date} onChange={e => h.setPoForm(p => ({ ...p, expected_arrival_date: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white dark:[color-scheme:dark]" />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Notes</label>
              <input value={h.poForm.notes} onChange={e => h.setPoForm(p => ({ ...p, notes: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" placeholder="Notes" />
            </div>
          </>) : (<>
            <div className="text-sm"><span className="text-zinc-500">Category:</span> <span className="font-medium text-zinc-700 dark:text-zinc-300">{catConfig.label || po.po_category}</span></div>
            <div className="text-sm"><span className="text-zinc-500">Type:</span> <span className="font-medium text-zinc-700 dark:text-zinc-300">{po.po_type}</span></div>
            <div className="text-sm"><span className="text-zinc-500">Priority:</span> <span className="font-medium text-zinc-700 dark:text-zinc-300">{po.priority}</span></div>
            {po.supplier_name && <div className="text-sm"><span className="text-zinc-500">Supplier:</span> <span className="font-medium text-zinc-700 dark:text-zinc-300">{po.supplier_name}</span></div>}
            {po.expected_arrival_date && <div className="text-sm"><span className="text-zinc-500">ETA:</span> <span className="font-medium text-zinc-700 dark:text-zinc-300">{po.expected_arrival_date}</span></div>}
            {po.notes && <div className="text-sm col-span-2 italic text-zinc-400">📝 {po.notes}</div>}
          </>)}
        </div>

        {/* TOM Sync Bar (detail mode — only for TOM-enabled categories) */}
        {!isCreate && isTomEnabled && (
          <div className="mt-4 flex items-center gap-3 flex-wrap p-3 rounded-lg bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20">
            <span className="text-xs font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wider">TOM</span>
            {hasTom ? (
              <span className={`text-sm font-mono font-semibold ${TOM_CLS[po.tom_status] || 'text-zinc-400'}`}>
                {po.tom_number} · {po.tom_status || '?'}
              </span>
            ) : <span className="text-sm text-zinc-400">Not sent</span>}
            <div className="ml-auto flex items-center gap-2">
              {po.status === 'APPROVED' && !hasTom && (
                <button onClick={() => h.tomAction(po.id, 'send')} disabled={!!h.tomBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold bg-sky-600 hover:bg-sky-700 text-white rounded-lg disabled:opacity-40">
                  {h.tomBusy === 'send' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to TOM
                </button>
              )}
              {hasTom && (
                <button onClick={() => h.tomAction(po.id, 'refresh')} disabled={!!h.tomBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg disabled:opacity-40">
                  {h.tomBusy === 'refresh' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />} Refresh
                </button>
              )}
              {hasTom && !['CANCELLED', 'DELIVERED'].includes(po.tom_status) && (<>
                <button onClick={() => h.tomAction(po.id, 'amend')} disabled={!!h.tomBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-40">
                  {h.tomBusy === 'amend' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Resend to TOM
                </button>
                <button onClick={() => h.tomAction(po.id, 'cancel')} disabled={!!h.tomBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg disabled:opacity-40">
                  {h.tomBusy === 'cancel' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />} Cancel
                </button>
              </>)}
            </div>
            {po.tom_shipment_code && (
              <div className="w-full flex items-center gap-3 mt-1 text-[10px] text-zinc-500">
                <span>🚢 {po.tom_shipment_code}</span>
                {po.tom_shipment_mode && <span>Mode: {po.tom_shipment_mode}</span>}
                {po.tom_shipment_eta && <span>ETA: {new Date(po.tom_shipment_eta).toLocaleDateString('ro-RO')}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ ADD PRODUCTS BUTTON (create mode) ═══ */}
      {isEditable && (
        <div className="px-4 pt-3">
          <button onClick={() => setShowPicker(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold 
              text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-500/10 
              hover:bg-primary-100 dark:hover:bg-primary-500/15 
              border-2 border-dashed border-primary-300 dark:border-primary-500/30
              rounded-xl transition-all hover:scale-[1.01]">
            <Plus className="w-5 h-5" />
            Search & Add Products
            {items.length > 0 && <span className="text-xs font-normal text-zinc-400">({items.length} in PO)</span>}
          </button>
        </div>
      )}

      {/* Product picker modal */}
      {showPicker && (
        <POProductPicker
          existingSkus={h.poForm.items.map(i => i.sku)}
          onAddProducts={h.addProducts}
          onClose={() => setShowPicker(false)}
          categories={h.poCategories}
        />
      )}

      {/* ═══ ITEMS TABLE ═══ */}
      <div className="flex-1 overflow-auto px-5 py-4">
        {items.length === 0 ? (
          <div className="text-center py-12 text-zinc-400 text-sm">
            {isEditable ? 'Click "Search & Add Products" to populate this PO' : 'No items'}
          </div>
        ) : (<>
          {/* Search & Filter Bar */}
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input value={itemSearch} onChange={e => setItemSearch(e.target.value)}
                placeholder="Search by product name or SKU..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white placeholder-zinc-400" />
            </div>
            <select value={itemPriorityFilter} onChange={e => setItemPriorityFilter(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white">
              <option value="">All Priorities</option>
              <option value="STANDARD">Standard</option>
              <option value="HIGH">High</option>
            </select>
            <span className="text-xs text-zinc-400 whitespace-nowrap">{filteredItems.length}/{items.length}</span>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-600 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                <tr className="text-zinc-500">
                  <SortHeader col="product_name" label="Product" className="text-left" />
                  <SortHeader col="sku" label="SKU" className="text-left" />
                  <SortHeader col="priority" label="Priority" className="text-center" />
                  <SortHeader col="quantity" label="Qty" className="text-right" />
                  <SortHeader col="unit_cost" label="Unit Cost" className="text-right" />
                  <SortHeader col="total" label="Total" className="text-right" />
                  {!isCreate && <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-center" title="Same SKU in other Draft/Approved POs">Other POs</th>}
                  {!isCreate && <SortHeader col="received" label="Received" className="text-right" />}
                  {!isCreate && isTomEnabled && <SortHeader col="tom" label="TOM" className="text-center" />}
                  {isEditable && <th className="px-3 py-2.5 w-10"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                {filteredItems.map((item, idx) => (
                  <tr key={`${item.sku || item.id}-${idx}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {item.product_image ? <img src={item.product_image} className="w-10 h-10 rounded-lg object-cover" /> : <Package className="w-8 h-8 text-zinc-400" />}
                        <span className="text-zinc-700 dark:text-zinc-300 truncate max-w-[300px] font-medium">{item.product_name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 relative">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-base text-zinc-700 dark:text-zinc-300">{item.sku}</span>
                        {/* TOM variant badges — compact inline display */}
                        {(item.tom_variant_1 || item.tom_variant_2) && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {item.tom_variant_1 && <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-[9px] font-bold uppercase rounded border border-zinc-200 dark:border-zinc-600 truncate max-w-[80px]" title={item.tom_variant_1}>{item.tom_variant_1}</span>}
                            {item.tom_variant_2 && <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-[9px] font-bold uppercase rounded border border-zinc-200 dark:border-zinc-600 truncate max-w-[60px]" title={item.tom_variant_2}>{item.tom_variant_2}</span>}
                          </div>
                        )}
                        {/* Edit button — only show when product has a uid */}
                        {item.product_uid && (
                          <button onClick={(e) => {
                            e.stopPropagation()
                            setEditingVariantSku(editingVariantSku === item.sku ? null : item.sku)
                            setVariantForm({ v1: item.tom_variant_1 || '', v2: item.tom_variant_2 || '' })
                          }} className="p-1 text-zinc-400 hover:text-primary-600 dark:hover:text-primary-400 z-10 ml-auto flex-shrink-0" title="Edit TOM Variants">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      
                      {/* Inline Variant Editor — keyed by SKU for uniqueness */}
                      {editingVariantSku === item.sku && (
                        <div className="absolute top-full left-0 mt-1 w-52 bg-white dark:bg-zinc-800 p-3 shadow-xl border border-zinc-200 dark:border-zinc-700 z-50 rounded-xl"
                             onClick={e => e.stopPropagation()}>
                          <div className="space-y-2">
                            <div>
                              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Variant 1 (Color)</label>
                              <input type="text" value={variantForm.v1} onChange={e => setVariantForm({ ...variantForm, v1: e.target.value })}
                                className="w-full px-2 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Variant 2 (Size)</label>
                              <input type="text" value={variantForm.v2} onChange={e => setVariantForm({ ...variantForm, v2: e.target.value })}
                                className="w-full px-2 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button onClick={() => setEditingVariantSku(null)} className="flex-1 px-2 py-1.5 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded hover:bg-zinc-200">Cancel</button>
                              <button onClick={() => handleSaveVariants(item.product_uid, item.sku)} className="flex-1 px-2 py-1.5 text-[10px] font-bold bg-primary-600 text-white rounded hover:bg-primary-700">Save</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isEditable ? (
                        <select value={item.priority || ''} onChange={e => h.updateItem(item.sku, 'priority', e.target.value || null)}
                          className="w-24 px-2 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white">
                          <option value="">Inherit</option>
                          <option value="STANDARD">Standard</option>
                          <option value="HIGH">High</option>
                        </select>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          (item.priority || po?.priority) === 'HIGH'
                            ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-600'
                            : 'bg-zinc-50 dark:bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-600'
                        }`}>
                          {item.priority || po?.priority || 'STD'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditable ? (
                        <input type="number" min="1" value={item.quantity} onChange={e => h.updateItem(item.sku, 'quantity', parseInt(e.target.value) || 0)}
                          className="w-20 px-2 py-1 text-sm text-right rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                      ) : <span className="font-semibold text-zinc-900 dark:text-white">{fmt(item.quantity)}</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditable ? (
                        <input type="number" min="0" step="0.01" value={item.unit_cost} onChange={e => h.updateItem(item.sku, 'unit_cost', parseFloat(e.target.value) || 0)}
                          className="w-20 px-2 py-1 text-sm text-right rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-zinc-700 dark:text-zinc-300">{fmtCur(item.unit_cost)}</span>
                          {item.unit_cost_usd != null && <span className="text-xs text-zinc-500">${fmt(item.unit_cost_usd)}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-zinc-800 dark:text-zinc-200">{fmtCur((item.quantity || 0) * (item.unit_cost || 0))}</span>
                        {/* Live USD: compute from exchange rate if available, else use stored usd cost */}
                        {(usdRate || item.unit_cost_usd != null) && (
                          <span className="text-xs text-zinc-500">
                            {usdRate
                              ? fmtUsd(round2((item.quantity || 0) * (item.unit_cost || 0) / usdRate))
                              : `$${fmt((item.quantity || 0) * (item.unit_cost_usd || 0))}`}
                          </span>
                        )}
                      </div>
                    </td>
                    {!isCreate && (() => {
                      const overlap = item.other_pos || []
                      const totalPending = overlap.reduce((s, p) => s + (p.pending_qty ?? p.quantity ?? 0), 0)
                      const tooltip = overlap.map(p =>
                        `${p.po_number} (${p.status}) · ${p.quantity} ordered${p.received_qty ? `, ${p.received_qty} recv` : ''}, ${p.pending_qty ?? p.quantity} pending`
                      ).join('\n')
                      return (
                        <td className="px-4 py-3 text-center">
                          {overlap.length > 0 ? (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-600 cursor-help"
                              title={tooltip}
                            >
                              <Layers className="w-3 h-3" />
                              <span>{overlap.length}</span>
                              {totalPending > 0 && <span className="text-[10px] opacity-75">({fmt(totalPending)} pending)</span>}
                            </span>
                          ) : (
                            <span className="text-zinc-300 dark:text-zinc-600">—</span>
                          )}
                        </td>
                      )
                    })()}
                    {!isCreate && (
                      <td className="px-4 py-3 text-right">
                        {item.tom_received_qty != null && item.tom_received_qty > 0 ? (
                          <span className="text-green-600 font-medium" title={`TOM received: ${fmt(item.tom_received_qty)}${item.tom_shipped_qty ? ` · Shipped: ${fmt(item.tom_shipped_qty)}` : ''}`}>
                            {fmt(item.tom_received_qty)}
                          </span>
                        ) : item.received_qty > 0 ? (
                          <span className="text-green-600 font-medium">{fmt(item.received_qty)}</span>
                        ) : (
                          <span className="text-zinc-400">0</span>
                        )}
                      </td>
                    )}
                    {!isCreate && isTomEnabled && (
                      <td className="px-4 py-3 text-center">
                        {item.tom_status ? <span className={`text-xs font-medium ${TOM_CLS[item.tom_status] || 'text-zinc-400'}`}>{item.tom_status}</span> : <span className="text-zinc-400">—</span>}
                      </td>
                    )}
                    {isEditable && (
                      <td className="px-4 py-3"><button onClick={() => h.removeItem(item.sku)}><X className="w-4 h-4 text-red-400 hover:text-red-600" /></button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
      </div>

      {/* ═══ FOOTER / ACTION BAR ═══ */}
      <div className="p-4 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80">
        {/* Summary */}
        <div className="text-sm text-zinc-500 mb-3">
          {items.length} items · {fmt(totalQty)} units · <span className="font-semibold text-zinc-900 dark:text-white">{fmtCur(totalCost)}</span>
          {/* Live USD total — always compute from current items + exchange rate */}
          {totalCostUsd != null && <span className="ml-1.5 font-medium text-zinc-500">({fmtUsd(totalCostUsd)} USD)</span>}
          {totalCostUsd == null && po?.total_cost_usd != null && <span className="ml-1.5 font-medium text-zinc-500">({fmtUsd(po.total_cost_usd)} USD)</span>}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {isEditable ? (<>
            <button onClick={isCreate ? h.cancelCreate : () => { h.setMode('detail'); h.setToast(null) }} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Cancel</button>
            <button onClick={isCreate ? h.submitCreate : h.saveEdit} disabled={h.saving || items.length === 0}
              className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-lg disabled:opacity-40">
              {h.saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {isCreate ? 'Create PO' : 'Save Changes'}
            </button>
          </>) : (<>
            {['DRAFT', 'APPROVED'].includes(po.status) && (
              <button onClick={h.startEdit} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg">
                <PenLine className="w-4 h-4" /> Edit PO
              </button>
            )}
            {po.status === 'DRAFT' && (<>
              <button onClick={() => h.updateStatus(po.id, 'APPROVED')} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                <CheckCircle2 className="w-4 h-4" /> Approve
              </button>
              <button onClick={() => handleDeletePO(po)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </>)}
            {po.status === 'APPROVED' && (
              <button onClick={() => h.receivePO(po.id)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg">
                <Check className="w-4 h-4" /> Receive All
              </button>
            )}
            {po.status === 'PARTIALLY_RECEIVED' && (
              <button onClick={() => h.updateStatus(po.id, 'COMPLETED')} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg">
                <Check className="w-4 h-4" /> Complete
              </button>
            )}
            {!['COMPLETED', 'CANCELLED'].includes(po.status) && (
              <button onClick={() => h.updateStatus(po.id, 'CANCELLED')} className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg">
                <XCircle className="w-4 h-4" /> Cancel
              </button>
            )}
          </>)}
        </div>

        {/* Sync Log */}
        {!isCreate && (po?.sync_logs || []).length > 0 && (
          <div className="mt-2">
            <button onClick={() => setShowLog(!showLog)} className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-medium">
              <FileText className="w-3 h-3" /> Sync Log ({po.sync_logs.length})
              {showLog ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showLog && (
              <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700/50 bg-white dark:bg-zinc-900">
                {po.sync_logs.map(log => (
                  <div key={log.id} className="px-2 py-1.5 flex items-start gap-2 text-[10px]">
                    <span className={`px-1 py-0.5 rounded font-medium ${log.status === 'SUCCESS' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300'}`}>{log.status}</span>
                    <span className="font-mono text-zinc-600 dark:text-zinc-400">{log.action}</span>
                    {log.error_message && <span className="text-red-500 truncate max-w-[200px]" title={log.error_message}>⚠ {log.error_message}</span>}
                    <span className="text-zinc-400 ml-auto">{log.created_at ? new Date(log.created_at).toLocaleString('ro-RO') : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  )
}
