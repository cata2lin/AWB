/**
 * POManagerPanel — CRUD interface for Purchase Orders.
 * Sub-tab within PurchaseOrdersTab for creating and managing POs.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
    Plus, Search, RefreshCw, Package, ChevronDown, ChevronUp, Trash2,
    Check, Truck, X, Calendar, Hash, DollarSign, Edit3, Save, AlertTriangle,
    ShoppingCart, ArrowRight, CheckCircle2, Clock, XCircle, BoxSelect
} from 'lucide-react'
import { purchaseOrdersMgmtApi } from '../services/api/analytics'

const STATUS_CONFIG = {
    draft: { label: 'Draft', cls: 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300', icon: Edit3 },
    confirmed: { label: 'Confirmed', cls: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300', icon: CheckCircle2 },
    in_transit: { label: 'In Transit', cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300', icon: Truck },
    received: { label: 'Received', cls: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300', icon: Check },
    cancelled: { label: 'Cancelled', cls: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300', icon: XCircle },
}

const fmt = n => n == null ? '0' : Number(n).toLocaleString('ro-RO')
const fmtCur = n => n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON`

export default function POManagerPanel({ analyticsProducts = [], onRefresh }) {
    const [orders, setOrders] = useState([])
    const [loading, setLoading] = useState(false)
    const [expanded, setExpanded] = useState(null)
    const [expandedData, setExpandedData] = useState(null)
    const [statusFilter, setStatusFilter] = useState('')
    const [search, setSearch] = useState('')

    // Create PO modal
    const [showCreate, setShowCreate] = useState(false)
    const [createForm, setCreateForm] = useState({
        supplier_name: '', container_ref: '', expected_arrival_date: '', notes: '', items: []
    })
    const [productSearch, setProductSearch] = useState('')
    const [saving, setSaving] = useState(false)

    const fetchOrders = useCallback(async () => {
        setLoading(true)
        try {
            const params = {}
            if (statusFilter) params.status = statusFilter
            if (search) params.search = search
            const result = await purchaseOrdersMgmtApi.list(params)
            setOrders(result.orders || [])
        } catch (err) { console.error('Failed to fetch POs:', err) }
        finally { setLoading(false) }
    }, [statusFilter, search])

    useEffect(() => { fetchOrders() }, [fetchOrders])

    const expandPO = async (id) => {
        if (expanded === id) { setExpanded(null); setExpandedData(null); return }
        try {
            const data = await purchaseOrdersMgmtApi.get(id)
            setExpandedData(data)
            setExpanded(id)
        } catch (err) { console.error(err) }
    }

    const updateStatus = async (id, newStatus) => {
        try {
            await purchaseOrdersMgmtApi.update(id, { status: newStatus })
            fetchOrders()
            if (expanded === id) expandPO(id)
            if (onRefresh) onRefresh()
        } catch (err) { alert(err?.response?.data?.detail || 'Failed to update status') }
    }

    const deletePO = async (id) => {
        if (!confirm('Delete this draft PO?')) return
        try {
            await purchaseOrdersMgmtApi.delete(id)
            setExpanded(null)
            fetchOrders()
        } catch (err) { alert(err?.response?.data?.detail || 'Cannot delete') }
    }

    const receivePO = async (id) => {
        if (!expandedData?.items) return
        try {
            const receiveItems = expandedData.items.map(i => ({ item_id: i.id, received_qty: i.quantity }))
            await purchaseOrdersMgmtApi.receive(id, receiveItems)
            fetchOrders()
            expandPO(id)
            if (onRefresh) onRefresh()
        } catch (err) { alert(err?.response?.data?.detail || 'Failed') }
    }

    // Create PO helpers
    const addProduct = (p) => {
        if (createForm.items.find(i => i.sku === p.sku)) return
        setCreateForm(prev => ({
            ...prev,
            items: [...prev.items, {
                sku: p.sku, barcode: p.barcode || '', product_name: p.product_name || '',
                product_image: p.images?.[0]?.src || '', quantity: p.suggested_qty || 1,
                unit_cost: p.unit_cost || 0, is_new_product: (p.units_sold || 0) === 0,
            }]
        }))
    }

    const removeItem = (sku) => {
        setCreateForm(prev => ({ ...prev, items: prev.items.filter(i => i.sku !== sku) }))
    }

    const updateItem = (sku, field, value) => {
        setCreateForm(prev => ({
            ...prev, items: prev.items.map(i => i.sku === sku ? { ...i, [field]: value } : i)
        }))
    }

    const addAllUrgent = () => {
        const urgent = analyticsProducts.filter(p => p.urgency === 'urgent' || p.urgency === 'warning')
        urgent.forEach(addProduct)
    }

    const submitCreate = async () => {
        if (createForm.items.length === 0) { alert('Add at least one product'); return }
        setSaving(true)
        try {
            await purchaseOrdersMgmtApi.create(createForm)
            setShowCreate(false)
            setCreateForm({ supplier_name: '', container_ref: '', expected_arrival_date: '', notes: '', items: [] })
            fetchOrders()
        } catch (err) { alert(err?.response?.data?.detail || 'Failed to create PO') }
        finally { setSaving(false) }
    }

    const filteredAnalytics = productSearch
        ? analyticsProducts.filter(p =>
            (p.sku || '').toLowerCase().includes(productSearch.toLowerCase()) ||
            (p.product_name || '').toLowerCase().includes(productSearch.toLowerCase())
        ).slice(0, 20)
        : []

    const totalCost = createForm.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0)

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-1">
                        {['', 'draft', 'confirmed', 'in_transit', 'received'].map(s => (
                            <button key={s} onClick={() => setStatusFilter(s)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${statusFilter === s
                                    ? 'bg-white dark:bg-zinc-600 text-zinc-900 dark:text-white shadow-sm'
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
                                {s ? STATUS_CONFIG[s]?.label : 'All'}
                            </button>
                        ))}
                    </div>
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO..."
                            className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700/50 text-zinc-900 dark:text-white w-40" />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={fetchOrders} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700">
                        <RefreshCw className={`w-4 h-4 text-zinc-500 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button onClick={() => setShowCreate(true)}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
                        <Plus className="w-4 h-4" /> Create PO
                    </button>
                </div>
            </div>

            {/* PO List */}
            <div className="space-y-2">
                {orders.length === 0 && !loading && (
                    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 px-6 py-12 text-center">
                        <ShoppingCart className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                        <p className="text-sm text-zinc-400">No purchase orders yet. Create one to start tracking incoming inventory.</p>
                    </div>
                )}
                {orders.map(po => {
                    const cfg = STATUS_CONFIG[po.status] || STATUS_CONFIG.draft
                    const Icon = cfg.icon
                    const isExpanded = expanded === po.id
                    return (
                        <div key={po.id} className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-clip">
                            <button onClick={() => expandPO(po.id)}
                                className="w-full px-4 py-3 flex items-center gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition-colors text-left">
                                <div className="flex items-center gap-2 min-w-[140px]">
                                    <span className="font-mono font-semibold text-sm text-zinc-800 dark:text-zinc-200">{po.po_number}</span>
                                </div>
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.cls}`}>
                                    <Icon className="w-3 h-3" /> {cfg.label}
                                </span>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 min-w-[100px]">{po.supplier_name || '—'}</span>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 min-w-[100px]">
                                    {po.container_ref ? <span className="flex items-center gap-1"><BoxSelect className="w-3 h-3" />{po.container_ref}</span> : '—'}
                                </span>
                                <span className="text-xs text-zinc-500 min-w-[80px]">{po.total_items} items</span>
                                <span className="text-xs text-zinc-500 min-w-[60px]">{fmt(po.total_quantity)} units</span>
                                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 min-w-[100px]">{fmtCur(po.total_cost)}</span>
                                <span className="text-xs text-zinc-400 min-w-[80px]">
                                    {po.expected_arrival_date ? `ETA: ${po.expected_arrival_date}` : ''}
                                </span>
                                <div className="ml-auto">
                                    {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                                </div>
                            </button>

                            {isExpanded && expandedData && (
                                <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-3 space-y-3">
                                    {/* Actions */}
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {po.status === 'draft' && <>
                                            <button onClick={() => updateStatus(po.id, 'confirmed')} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg"><CheckCircle2 className="w-3.5 h-3.5" /> Confirm</button>
                                            <button onClick={() => deletePO(po.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                                        </>}
                                        {po.status === 'confirmed' && <button onClick={() => updateStatus(po.id, 'in_transit')} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg"><Truck className="w-3.5 h-3.5" /> Mark In Transit</button>}
                                        {(po.status === 'confirmed' || po.status === 'in_transit') && <button onClick={() => receivePO(po.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg"><Check className="w-3.5 h-3.5" /> Mark Received</button>}
                                        {po.status !== 'received' && po.status !== 'cancelled' && <button onClick={() => updateStatus(po.id, 'cancelled')} className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"><XCircle className="w-3.5 h-3.5" /> Cancel</button>}
                                        {expandedData.notes && <span className="text-xs text-zinc-400 ml-auto italic">📝 {expandedData.notes}</span>}
                                    </div>

                                    {/* Items table */}
                                    <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
                                        <table className="w-full text-sm">
                                            <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                                <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                                                    <th className="px-3 py-2 text-left font-medium">Product</th>
                                                    <th className="px-3 py-2 text-left font-medium">SKU</th>
                                                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                                                    <th className="px-3 py-2 text-right font-medium">Unit Cost</th>
                                                    <th className="px-3 py-2 text-right font-medium">Line Total</th>
                                                    <th className="px-3 py-2 text-right font-medium">Received</th>
                                                    <th className="px-3 py-2 text-center font-medium">Type</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                                {expandedData.items?.map(item => (
                                                    <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/20">
                                                        <td className="px-3 py-2">
                                                            <div className="flex items-center gap-2">
                                                                {item.product_image ? <img src={item.product_image} className="w-7 h-7 rounded object-cover border border-zinc-200 dark:border-zinc-600" /> : <Package className="w-5 h-5 text-zinc-400" />}
                                                                <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]">{item.product_name || '—'}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">{item.sku}</td>
                                                        <td className="px-3 py-2 text-right font-semibold text-zinc-900 dark:text-white">{fmt(item.quantity)}</td>
                                                        <td className="px-3 py-2 text-right text-xs text-zinc-500">{fmtCur(item.unit_cost)}</td>
                                                        <td className="px-3 py-2 text-right text-xs font-medium text-zinc-700 dark:text-zinc-300">{fmtCur(item.line_cost)}</td>
                                                        <td className="px-3 py-2 text-right text-xs">{item.received_qty > 0 ? <span className="text-green-600 font-medium">{fmt(item.received_qty)}</span> : <span className="text-zinc-400">0</span>}</td>
                                                        <td className="px-3 py-2 text-center">
                                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${item.is_new_product ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300' : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'}`}>
                                                                {item.is_new_product ? 'NEW' : 'RESTOCK'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Create PO Modal */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-8 overflow-y-auto">
                    <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-2xl w-full max-w-4xl mx-4 mb-8">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
                            <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-indigo-500" /> Create Purchase Order</h2>
                            <button onClick={() => setShowCreate(false)}><X className="w-5 h-5 text-zinc-400 hover:text-zinc-600" /></button>
                        </div>

                        <div className="p-6 space-y-4">
                            {/* PO metadata */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div><label className="text-xs text-zinc-500 block mb-1">Supplier</label>
                                    <input value={createForm.supplier_name} onChange={e => setCreateForm(p => ({ ...p, supplier_name: e.target.value }))}
                                        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" placeholder="Supplier name" />
                                </div>
                                <div><label className="text-xs text-zinc-500 block mb-1">Container Ref</label>
                                    <input value={createForm.container_ref} onChange={e => setCreateForm(p => ({ ...p, container_ref: e.target.value }))}
                                        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" placeholder="Container #" />
                                </div>
                                <div><label className="text-xs text-zinc-500 block mb-1">Expected Arrival</label>
                                    <input type="date" value={createForm.expected_arrival_date} onChange={e => setCreateForm(p => ({ ...p, expected_arrival_date: e.target.value }))}
                                        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                </div>
                                <div><label className="text-xs text-zinc-500 block mb-1">Notes</label>
                                    <input value={createForm.notes} onChange={e => setCreateForm(p => ({ ...p, notes: e.target.value }))}
                                        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" placeholder="Notes" />
                                </div>
                            </div>

                            {/* Add products */}
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                                    <input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Search products to add..."
                                        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                </div>
                                <button onClick={addAllUrgent} className="flex items-center gap-1 px-3 py-2 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg whitespace-nowrap">
                                    <AlertTriangle className="w-3.5 h-3.5" /> Add All Urgent/Warning
                                </button>
                            </div>

                            {/* Product search results */}
                            {productSearch && filteredAnalytics.length > 0 && (
                                <div className="bg-zinc-50 dark:bg-zinc-700/30 rounded-lg border border-zinc-200 dark:border-zinc-600 max-h-48 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                    {filteredAnalytics.map(p => (
                                        <button key={p.sku} onClick={() => { addProduct(p); setProductSearch('') }}
                                            className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-600/30 text-xs">
                                            <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300 w-40 truncate">{p.sku}</span>
                                            <span className="text-zinc-500 truncate flex-1">{p.product_name}</span>
                                            <span className="text-zinc-400">Stk:{fmt(p.stock_available)}</span>
                                            <span className="text-zinc-400">Sug:{fmt(p.suggested_qty)}</span>
                                            <Plus className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Items in PO */}
                            {createForm.items.length > 0 && (
                                <div className="overflow-x-auto max-h-[300px] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-600">
                                    <table className="w-full text-sm">
                                        <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                            <tr className="text-xs text-zinc-500">
                                                <th className="px-3 py-2 text-left font-medium">SKU</th>
                                                <th className="px-3 py-2 text-left font-medium">Name</th>
                                                <th className="px-3 py-2 text-right font-medium">Qty</th>
                                                <th className="px-3 py-2 text-right font-medium">Unit Cost</th>
                                                <th className="px-3 py-2 text-right font-medium">Total</th>
                                                <th className="px-3 py-2 text-center font-medium">Type</th>
                                                <th className="px-3 py-2 w-8"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                            {createForm.items.map(item => (
                                                <tr key={item.sku}>
                                                    <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">{item.sku}</td>
                                                    <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[200px]">{item.product_name}</td>
                                                    <td className="px-3 py-2 text-right">
                                                        <input type="number" min="1" value={item.quantity} onChange={e => updateItem(item.sku, 'quantity', parseInt(e.target.value) || 0)}
                                                            className="w-20 px-2 py-1 text-xs text-right rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-3 py-2 text-right">
                                                        <input type="number" min="0" step="0.01" value={item.unit_cost} onChange={e => updateItem(item.sku, 'unit_cost', parseFloat(e.target.value) || 0)}
                                                            className="w-20 px-2 py-1 text-xs text-right rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-3 py-2 text-right text-xs font-medium text-zinc-700 dark:text-zinc-300">{fmtCur(item.quantity * item.unit_cost)}</td>
                                                    <td className="px-3 py-2 text-center">
                                                        <button onClick={() => updateItem(item.sku, 'is_new_product', !item.is_new_product)}
                                                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer ${item.is_new_product ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300' : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'}`}>
                                                            {item.is_new_product ? 'NEW' : 'RESTOCK'}
                                                        </button>
                                                    </td>
                                                    <td className="px-3 py-2"><button onClick={() => removeItem(item.sku)}><X className="w-4 h-4 text-red-400 hover:text-red-600" /></button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* Total and submit */}
                            <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-700">
                                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                                    {createForm.items.length} items · {fmt(createForm.items.reduce((s, i) => s + i.quantity, 0))} units · <span className="font-semibold text-zinc-900 dark:text-white">{fmtCur(totalCost)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Cancel</button>
                                    <button onClick={submitCreate} disabled={saving || createForm.items.length === 0}
                                        className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-40">
                                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Create PO
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
