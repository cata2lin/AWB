/**
 * POList — Left panel showing filterable PO list with status badges and inline category editor.
 */
import { useState } from 'react'
import { Search, RefreshCw, Plus, Edit3, CheckCircle2, Clock, Check, XCircle, Package, Settings, X, Save, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'

const STATUS_CFG = {
  DRAFT: { label: 'Draft', cls: 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300', icon: Edit3 },
  APPROVED: { label: 'Approved', cls: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300', icon: CheckCircle2 },
  PARTIALLY_RECEIVED: { label: 'Partial', cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300', icon: Clock },
  COMPLETED: { label: 'Done', cls: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300', icon: Check },
  CANCELLED: { label: 'Cancelled', cls: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300', icon: XCircle },
}

const TOM_CLS = {
  NEW: 'text-sky-600 dark:text-sky-400',
  SOURCING: 'text-indigo-600 dark:text-indigo-400',
  PRODUCTION: 'text-violet-600 dark:text-violet-400',
  SHIPPED: 'text-amber-600 dark:text-amber-400',
  DELIVERED: 'text-green-600 dark:text-green-400',
  CANCELLED: 'text-red-600 dark:text-red-400',
}

export { STATUS_CFG, TOM_CLS }

function CategoryEditor({ categories, onSave, onClose }) {
  const [cats, setCats] = useState([...categories])
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const update = (idx, field, value) => {
    setCats(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c))
  }

  const remove = (idx) => setCats(prev => prev.filter((_, i) => i !== idx))

  const add = () => {
    if (!newKey.trim() || !newLabel.trim()) return
    const key = newKey.trim().toLowerCase().replace(/\s+/g, '_')
    if (cats.find(c => c.key === key)) return
    setCats(prev => [...prev, { key, label: newLabel.trim(), stores: [], tom_enabled: true }])
    setNewKey('')
    setNewLabel('')
  }

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30">
      <div className="px-3 py-2 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Manage Categories</span>
        <div className="flex items-center gap-1">
          <button onClick={() => onSave(cats)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors">
            <Save className="w-3 h-3" /> Save
          </button>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="max-h-[240px] overflow-y-auto">
        {cats.map((c, idx) => (
          <div key={c.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            <input value={c.label} onChange={e => update(idx, 'label', e.target.value)}
              className="flex-1 px-2 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white" />
            <button onClick={() => update(idx, 'tom_enabled', !c.tom_enabled)}
              title={c.tom_enabled ? 'TOM sync ON' : 'TOM sync OFF'}
              className="p-1 rounded transition-colors">
              {c.tom_enabled
                ? <ToggleRight className="w-4 h-4 text-green-500" />
                : <ToggleLeft className="w-4 h-4 text-zinc-400" />}
            </button>
            <button onClick={() => remove(idx)}
              className="p-1 text-zinc-400 hover:text-red-500 rounded transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        {/* Add new */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-zinc-200 dark:border-zinc-700">
          <input value={newKey} onChange={e => setNewKey(e.target.value)}
            placeholder="key"
            className="w-20 px-2 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white placeholder-zinc-400" />
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
            placeholder="Label (e.g. 🏷️ My Category)"
            onKeyDown={e => e.key === 'Enter' && add()}
            className="flex-1 px-2 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white placeholder-zinc-400" />
          <button onClick={add} disabled={!newKey.trim() || !newLabel.trim()}
            className="p-1 text-indigo-500 hover:text-indigo-700 disabled:opacity-30 rounded transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function POList({ h }) {
  const [editingCats, setEditingCats] = useState(false)
  const fmt = n => n == null ? '0' : Number(n).toLocaleString('ro-RO')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-800 dark:text-white">Purchase Orders</h3>
          <div className="flex items-center gap-1.5">
            <button onClick={h.fetchOrders} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700">
              <RefreshCw className={`w-3.5 h-3.5 text-zinc-500 ${h.loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={h.startCreate}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
              <Plus className="w-3.5 h-3.5" /> New PO
            </button>
          </div>
        </div>
        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input value={h.search} onChange={e => h.setSearch(e.target.value)} placeholder="Search PO..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700/50 text-zinc-900 dark:text-white" />
        </div>
        {/* Status filter pills */}
        <div className="flex flex-wrap gap-1">
          {['', 'DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED'].map(s => (
            <button key={s} onClick={() => h.setStatusFilter(s)}
              className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all ${h.statusFilter === s
                ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
              {s ? STATUS_CFG[s]?.label : 'All'}
            </button>
          ))}
        </div>
        {/* Category filter with edit toggle */}
        {h.poCategories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <button onClick={() => h.setCategoryFilter('')}
              className={`px-2 py-1 text-[10px] font-medium rounded-md ${!h.categoryFilter ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300' : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500'}`}>
              All Cat
            </button>
            {h.poCategories.map(c => (
              <button key={c.key} onClick={() => h.setCategoryFilter(c.key)}
                className={`px-2 py-1 text-[10px] font-medium rounded-md ${h.categoryFilter === c.key ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300' : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500'}`}>
                {c.label}
              </button>
            ))}
            <button onClick={() => setEditingCats(!editingCats)}
              title="Manage categories"
              className={`p-1 rounded-md transition-colors ${editingCats ? 'text-indigo-500 bg-indigo-100 dark:bg-indigo-500/20' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700'}`}>
              <Settings className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Inline category editor */}
      {editingCats && (
        <CategoryEditor
          categories={h.poCategories}
          onSave={(cats) => { h.saveCategories(cats); setEditingCats(false) }}
          onClose={() => setEditingCats(false)}
        />
      )}

      {/* PO Items */}
      <div className="flex-1 overflow-y-auto">
        {h.orders.length === 0 && !h.loading && (
          <div className="px-4 py-12 text-center">
            <Package className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
            <p className="text-xs text-zinc-400">No purchase orders found</p>
          </div>
        )}
        {h.orders.map(po => {
          const cfg = STATUS_CFG[po.status] || STATUS_CFG.DRAFT
          const Icon = cfg.icon
          const isActive = h.selectedId === po.id && h.mode === 'detail'
          return (
            <button key={po.id} onClick={() => h.selectPO(po.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-700/50 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition-colors ${isActive ? 'bg-indigo-50 dark:bg-indigo-500/10 border-l-2 border-l-indigo-500' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono font-bold text-xs text-zinc-800 dark:text-zinc-200">{po.po_number}</span>
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${cfg.cls}`}>
                  <Icon className="w-2.5 h-2.5" /> {cfg.label}
                </span>
                {po.tom_number && (
                  <span className={`text-[9px] font-mono font-medium ${TOM_CLS[po.tom_status] || 'text-zinc-400'}`}>
                    TOM:{po.tom_status || '?'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                <span>{h.getCatConfig(po.po_category).label || po.po_category}</span>
                <span>·</span>
                <span>{po.total_items} items</span>
                <span>·</span>
                <span>{fmt(po.total_quantity)} u</span>
                {po.supplier_name && <><span>·</span><span className="truncate max-w-[80px]">{po.supplier_name}</span></>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
