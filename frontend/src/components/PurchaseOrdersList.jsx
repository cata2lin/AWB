/**
 * PurchaseOrdersList — Full-page PO list with scorecards, status tabs, table, pagination.
 * 
 * Replicates the Grandia inventory purchase-orders list UI exactly,
 * adapted for our React/Vite stack and existing backend API.
 */
import { useState, useMemo } from 'react'
import {
  Search, Plus, FileText, CheckCircle2, CircleDot, XCircle, AlertTriangle,
  Package, DollarSign, Clock, Layers, RefreshCw, Settings, X, Save, Trash2,
  ToggleLeft, ToggleRight, Edit3, Loader2, ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react'

const STATUS_CONFIG = {
  DRAFT: { label: 'Draft', icon: FileText, color: 'text-gray-700 dark:text-gray-300', bg: 'bg-gray-50 dark:bg-gray-500/10 border-gray-200 dark:border-gray-600' },
  SENT: { label: 'Sent', icon: CheckCircle2, color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-600' },
  ORDERED: { label: 'Ordered', icon: CircleDot, color: 'text-indigo-700 dark:text-indigo-300', bg: 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-600' },
  APPROVED: { label: 'Approved', icon: CheckCircle2, color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-600' },
  PARTIALLY_RECEIVED: { label: 'Partial', icon: CircleDot, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-600' },
  COMPLETED: { label: 'Completed', icon: CheckCircle2, color: 'text-green-700 dark:text-green-300', bg: 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-600' },
  CANCELLED: { label: 'Cancelled', icon: XCircle, color: 'text-red-700 dark:text-red-300', bg: 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-600' },
}

const TOM_STATUS_CLASSES = {
  NEW: 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-600',
  SOURCING: 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-600',
  PRODUCTION: 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-600',
  SHIPPED: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-600',
  DELIVERED: 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 border-green-200 dark:border-green-600',
  CANCELLED: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-600',
}

function ProgressBar({ received, ordered }) {
  const pct = ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 rounded-full bg-gray-200 dark:bg-zinc-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            pct === 100 ? 'bg-green-500' : pct > 0 ? 'bg-blue-500' : 'bg-gray-300 dark:bg-zinc-600'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm text-zinc-500 dark:text-zinc-400 whitespace-nowrap tabular-nums">
        {received ?? 0} / {ordered ?? 0}
      </span>
    </div>
  )
}

function SyncStatusCell({ po }) {
  if (!po.tom_number && !po.tom_status) {
    return <span className="text-zinc-400 dark:text-zinc-600 text-xs">—</span>
  }
  const status = po.tom_status || 'NEW'
  const cls = TOM_STATUS_CLASSES[status] || TOM_STATUS_CLASSES.NEW
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium ${cls}`}>
        {status}
      </span>
      {po.tom_number && (
        <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
          {po.tom_number}
        </span>
      )}
    </div>
  )
}

/* ── Category Editor (inline settings panel) ── */
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
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
        <span className="text-sm font-semibold text-zinc-800 dark:text-white">Manage Categories</span>
        <div className="flex items-center gap-2">
          <button onClick={() => onSave(cats)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-900 dark:bg-indigo-600 hover:bg-gray-800 dark:hover:bg-indigo-700 text-white rounded-lg transition-colors">
            <Save className="w-3 h-3" /> Save
          </button>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="max-h-[300px] overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
        {cats.map((c, idx) => (
          <div key={c.key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
            <input value={c.label} onChange={e => update(idx, 'label', e.target.value)}
              className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            <button onClick={() => update(idx, 'tom_enabled', !c.tom_enabled)}
              title={c.tom_enabled ? 'TOM sync ON' : 'TOM sync OFF'}
              className="p-1.5 rounded-lg transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700">
              {c.tom_enabled
                ? <ToggleRight className="w-5 h-5 text-green-500" />
                : <ToggleLeft className="w-5 h-5 text-zinc-400" />}
            </button>
            <button onClick={() => remove(idx)}
              className="p-1.5 text-zinc-400 hover:text-red-500 rounded-lg transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {/* Add new */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <input value={newKey} onChange={e => setNewKey(e.target.value)}
            placeholder="key"
            className="w-24 px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
            placeholder="Label (e.g. 🏷️ My Category)"
            onKeyDown={e => e.key === 'Enter' && add()}
            className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <button onClick={add} disabled={!newKey.trim() || !newLabel.trim()}
            className="p-1.5 text-indigo-500 hover:text-indigo-700 disabled:opacity-30 rounded-lg transition-colors">
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  )
}

const fmt = n => n == null ? '0' : Number(n).toLocaleString('ro-RO')
const fmtUsd = n => n == null || n === 0 ? '' : `$${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} USD`

export default function PurchaseOrdersList({ h }) {
  const [showCatEditor, setShowCatEditor] = useState(false)
  const [sortCol, setSortCol] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc') // 'asc' | 'desc'

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <ArrowUpDown className="h-3 w-3 text-zinc-300 dark:text-zinc-600" />
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
  }

  // Sort orders client-side
  const sortedOrders = useMemo(() => {
    const arr = [...h.orders]
    arr.sort((a, b) => {
      let va, vb
      switch (sortCol) {
        case 'po_number': va = a.po_number || ''; vb = b.po_number || ''; break
        case 'status': va = a.status || ''; vb = b.status || ''; break
        case 'po_category': va = a.po_category || ''; vb = b.po_category || ''; break
        case 'created_at': va = a.created_at || ''; vb = b.created_at || ''; break
        case 'total_cost': va = a.total_cost || 0; vb = b.total_cost || 0; break
        case 'fulfillment':
          va = (a.total_quantity > 0) ? (a.received_quantity || 0) / a.total_quantity : 0
          vb = (b.total_quantity > 0) ? (b.received_quantity || 0) / b.total_quantity : 0
          break
        case 'supplier_name': va = a.supplier_name || ''; vb = b.supplier_name || ''; break
        default: va = a.created_at || ''; vb = b.created_at || ''
      }
      if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase() }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [h.orders, sortCol, sortDir])

  // Compute stats from loaded orders
  const stats = useMemo(() => {
    const s = { DRAFT: 0, SENT: 0, ORDERED: 0, APPROVED: 0, PARTIALLY_RECEIVED: 0, COMPLETED: 0, CANCELLED: 0 }
    let totalValue = 0, totalValueUsd = 0, totalUnits = 0, unitsPending = 0, uniqueSkus = new Set()
    const openStatuses = new Set(['DRAFT', 'SENT', 'ORDERED', 'APPROVED', 'PARTIALLY_RECEIVED'])
    let openCount = 0

    for (const po of h.orders) {
      s[po.status] = (s[po.status] || 0) + 1
      const qty = po.total_quantity || 0
      const cost = po.total_cost || 0
      const costUsd = po.total_cost_usd || 0
      if (openStatuses.has(po.status)) {
        openCount++
        totalValue += cost
        totalValueUsd += costUsd
        totalUnits += qty
        unitsPending += qty - (po.received_quantity || 0)
      }
    }
    return { ...s, openCount, totalValue, totalValueUsd, totalUnits, unitsPending, uniqueSkus: h.orders.length }
  }, [h.orders])

  const statusTabs = [
    { key: '', label: 'All', icon: FileText, count: h.orders.length },
    { key: 'DRAFT', label: 'Draft', icon: FileText, count: stats.DRAFT },
    { key: 'SENT', label: 'Sent', icon: CheckCircle2, count: stats.SENT },
    { key: 'ORDERED', label: 'Ordered', icon: CircleDot, count: stats.ORDERED },
    { key: 'COMPLETED', label: 'Completed', icon: CheckCircle2, count: stats.COMPLETED },
    { key: 'CANCELLED', label: 'Cancelled', icon: XCircle, count: stats.CANCELLED },
  ]

  const scorecards = [
    { label: 'Open POs', value: stats.openCount, icon: FileText, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10' },
    { label: 'Open Value', value: `${fmt(stats.totalValue)} RON`, subValue: `$${fmt(stats.totalValueUsd)} USD`, icon: DollarSign, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
    { label: 'Units on Order', value: fmt(stats.totalUnits), icon: Package, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-500/10' },
    { label: 'Units Pending', value: fmt(stats.unitsPending), icon: Clock, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
    { label: 'Total POs', value: h.orders.length, icon: Layers, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-500/10' },
    { label: 'Overdue', value: 0, icon: AlertTriangle, color: 'text-gray-400 dark:text-gray-500', bg: 'bg-gray-50 dark:bg-gray-500/10' },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Purchase Orders</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage purchase orders and track incoming inventory
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCatEditor(!showCatEditor)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors">
            <Settings className="h-4 w-4" />
            Categories
          </button>
          <button onClick={h.fetchOrders}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors">
            <RefreshCw className={`h-4 w-4 ${h.loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button onClick={h.startCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 dark:bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:hover:bg-indigo-700 transition-colors">
            <Plus className="h-4 w-4" />
            New PO
          </button>
        </div>
      </div>

      {/* Category Editor */}
      {showCatEditor && (
        <CategoryEditor
          categories={h.poCategories}
          onSave={(cats) => { h.saveCategories(cats); setShowCatEditor(false) }}
          onClose={() => setShowCatEditor(false)}
        />
      )}

      {/* Scorecards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {scorecards.map(card => (
          <div key={card.label} className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5">
            <div className="flex items-center gap-2.5">
              <div className={`rounded-lg ${card.bg} p-2`}>
                <card.icon className={`h-5 w-5 ${card.color}`} />
              </div>
              <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                {card.label}
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
              {card.value}
            </p>
            {card.subValue && <p className="text-xs font-medium text-zinc-500 mt-1">{card.subValue}</p>}
          </div>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1.5 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 p-1.5 bg-white dark:bg-zinc-900">
        {statusTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => h.setStatusFilter(tab.key)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
              h.statusFilter === tab.key
                ? 'bg-gray-900 dark:bg-indigo-600 text-white'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            <span className={`ml-0.5 rounded-full px-2 py-0.5 text-xs ${
              h.statusFilter === tab.key ? 'bg-white/20' : 'bg-zinc-100 dark:bg-zinc-800'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mt-6">
        <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          value={h.search}
          onChange={(e) => h.setSearch(e.target.value)}
          placeholder="Search by PO number, category, or supplier..."
          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-2.5 pl-11 pr-4 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* Category filter chips */}
      {h.poCategories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-400 uppercase tracking-wider font-semibold mr-1">Category:</span>
          <button onClick={() => h.setCategoryFilter('')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${
              !h.categoryFilter
                ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 shadow-sm'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}>
            All
          </button>
          {h.poCategories.map(c => (
            <button key={c.key} onClick={() => h.setCategoryFilter(c.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${
                h.categoryFilter === c.key
                  ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 shadow-sm'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      {h.loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : h.orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            No purchase orders found
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Create your first purchase order to get started
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white dark:bg-zinc-900 mt-6">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
              <tr>
                {[
                  { key: 'po_number', label: 'PO #', align: 'left' },
                  { key: 'status', label: 'Status', align: 'left' },
                  { key: 'po_category', label: 'Category', align: 'left' },
                  { key: 'created_at', label: 'Date', align: 'left' },
                  { key: 'total_cost', label: 'Total', align: 'right' },
                  { key: 'fulfillment', label: 'Fulfillment', align: 'left' },
                  { key: null, label: 'TOM Sync', align: 'left' },
                  { key: 'supplier_name', label: 'Supplier', align: 'left' },
                ].map(col => (
                  <th key={col.label}
                    onClick={() => col.key && toggleSort(col.key)}
                    className={`px-5 py-3.5 font-medium text-sm text-zinc-500 dark:text-zinc-400 ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.key ? 'cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200 select-none' : ''}`}>
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.key && <SortIcon col={col.key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {sortedOrders.map(po => {
                const statusConf = STATUS_CONFIG[po.status] || STATUS_CONFIG.DRAFT
                const StatusIcon = statusConf.icon
                return (
                  <tr key={po.id}
                    onClick={() => h.selectPO(po.id)}
                    className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer">
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-base text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300">
                          {po.po_number}
                        </span>
                        {po.title && (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[280px]" title={po.title}>
                            {po.title}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium ${statusConf.bg} ${statusConf.color}`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {statusConf.label}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-zinc-600 dark:text-zinc-400 text-sm">
                      {h.getCatConfig(po.po_category)?.label || po.po_category || '—'}
                    </td>
                    <td className="px-5 py-4 text-zinc-500 dark:text-zinc-400">
                      {po.created_at ? new Date(po.created_at).toLocaleDateString('en-GB', {
                        day: '2-digit', month: 'short', year: 'numeric'
                      }) : '—'}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{fmt(po.total_cost || 0)} RON</span>
                        {po.total_cost_usd > 0 && <span className="text-xs text-zinc-500 dark:text-zinc-400">{fmtUsd(po.total_cost_usd)}</span>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <ProgressBar received={po.received_quantity || 0} ordered={po.total_quantity || 0} />
                    </td>
                    <td className="px-5 py-4">
                      <SyncStatusCell po={po} />
                    </td>
                    <td className="px-5 py-4 text-zinc-500 dark:text-zinc-400 text-sm truncate max-w-[160px]">
                      {po.supplier_name || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
