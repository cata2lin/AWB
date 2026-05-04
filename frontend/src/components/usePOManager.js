/**
 * usePOManager — state & handlers for the PO Manager panel.
 * 
 * Manages: PO list, CRUD operations, product picker, TOM sync actions.
 * Extracted hook keeps the UI components lean.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { purchaseOrdersMgmtApi } from '../services/api/analytics'
import { settingsApi } from '../services/api/analytics'

const EMPTY_FORM = {
  title: '', po_category: '', po_type: 'RESTOCK', priority: 'STANDARD',
  supplier_name: '', container_ref: '', expected_arrival_date: '', notes: '', created_by: '', items: []
}

export default function usePOManager({ analyticsProducts, onRefresh }) {
  // ── PO List state ──
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedPO, setSelectedPO] = useState(null) // full PO detail
  const [selectedId, setSelectedId] = useState(null) // just the ID
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')

  // ── Create/Edit state ──
  const [mode, setMode] = useState('list') // list | create | detail | edit
  const [poForm, setPoForm] = useState({ ...EMPTY_FORM })

  // ── Product picker ──
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerResults, setPickerResults] = useState([])
  const [pickerLoading, setPickerLoading] = useState(false)

  // ── Operations ──
  const [saving, setSaving] = useState(false)
  const [tomBusy, setTomBusy] = useState(null) // 'send'|'refresh'|'amend'|'cancel'
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  // ── Categories ──
  const [poCategories, setPoCategories] = useState([])

  const showToast = (msg, type = 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ msg, type })
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }

  // ── Load categories on mount ──
  useEffect(() => {
    settingsApi.getPoCategories()
      .then(r => {
        const cats = r.categories || []
        setPoCategories(cats)
        if (cats.length > 0 && !poForm.po_category) {
          setPoForm(prev => ({ ...prev, po_category: cats[0].key }))
        }
      })
      .catch(() => {})
  }, [])

  // ── PO List fetch ──
  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (statusFilter) params.status = statusFilter
      if (categoryFilter) params.category = categoryFilter
      if (search) params.search = search
      const r = await purchaseOrdersMgmtApi.list(params)
      setOrders(r.orders || [])
    } catch (e) { console.error('PO fetch fail:', e) }
    finally { setLoading(false) }
  }, [statusFilter, categoryFilter, search])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // ── Select a PO ──
  const selectPO = async (id) => {
    if (selectedId === id && mode === 'detail') {
      // Toggle off
      setSelectedId(null)
      setSelectedPO(null)
      setMode('list')
      return
    }
    try {
      const d = await purchaseOrdersMgmtApi.get(id)
      setSelectedPO(d)
      setSelectedId(id)
      setMode('detail')
    } catch (e) { console.error(e) }
  }

  const refreshSelected = async () => {
    if (!selectedId) return
    try {
      const d = await purchaseOrdersMgmtApi.get(selectedId)
      setSelectedPO(d)
    } catch (_) {}
  }

  // ── Status transitions ──
  const updateStatus = async (id, s) => {
    try {
      await purchaseOrdersMgmtApi.update(id, { status: s })
      fetchOrders()
      if (selectedId === id) refreshSelected()
      onRefresh?.()
      showToast(`Status → ${s}`, 'success')
    } catch (e) { showToast(e?.response?.data?.detail || 'Status update failed', 'error') }
  }

  const deletePO = async (id) => {
    if (!confirm('Delete this draft PO?')) return
    try {
      await purchaseOrdersMgmtApi.delete(id)
      setSelectedId(null)
      setSelectedPO(null)
      setMode('list')
      fetchOrders()
      showToast('PO deleted', 'success')
    } catch (e) { showToast(e?.response?.data?.detail || 'Cannot delete', 'error') }
  }

  const receivePO = async (id) => {
    if (!selectedPO?.items) return
    try {
      const ri = selectedPO.items.map(i => ({ item_id: i.id, received_qty: i.quantity }))
      await purchaseOrdersMgmtApi.receive(id, ri)
      fetchOrders()
      refreshSelected()
      onRefresh?.()
      showToast('All items received', 'success')
    } catch (e) { showToast(e?.response?.data?.detail || 'Receive failed', 'error') }
  }

  // ── TOM sync ──
  const tomAction = async (id, action) => {
    setTomBusy(action)
    try {
      let r
      if (action === 'send') r = await purchaseOrdersMgmtApi.tomSend(id)
      else if (action === 'refresh') r = await purchaseOrdersMgmtApi.tomRefresh(id)
      else if (action === 'amend') r = await purchaseOrdersMgmtApi.tomAmend(id)
      else if (action === 'cancel') {
        const reason = prompt('Cancel reason:', 'Cancelled by user')
        if (!reason) { setTomBusy(null); return }
        r = await purchaseOrdersMgmtApi.tomCancel(id, reason)
      }
      showToast(`TOM ${action}: ${r?.tom_number || r?.tom_status || 'OK'}`, 'success')
      fetchOrders()
      refreshSelected()
    } catch (e) {
      showToast(e?.response?.data?.detail || `TOM ${action} failed`, 'error')
    } finally { setTomBusy(null) }
  }

  // ── Product picker (DB search) ──
  const searchProducts = useCallback(async (q) => {
    if (!q || q.length < 2) { setPickerResults([]); return }
    setPickerLoading(true)
    try {
      const r = await purchaseOrdersMgmtApi.productPicker({ search: q, limit: 30 })
      setPickerResults(r.products || [])
    } catch (_) {}
    finally { setPickerLoading(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchProducts(pickerSearch), 250)
    return () => clearTimeout(t)
  }, [pickerSearch, searchProducts])

  // ── Item management ──
  const _buildItem = (p) => ({
    product_uid: p.uid || p.product_uid || '', sku: p.sku, barcode: p.barcode || '',
    product_name: p.product_name || '', variant_title: p.variant_title || '',
    product_image: p.image || p.product_image || p.images?.[0]?.src || '',
    quantity: p.suggested_qty || 1, unit_cost: p.unit_cost || 0,
  })

  const addProduct = (p) => {
    if (poForm.items.find(i => i.sku === p.sku)) return
    setPoForm(prev => ({ ...prev, items: [...prev.items, _buildItem(p)] }))
  }

  /** Batch add — for multi-select picker */
  const addProducts = (products) => {
    setPoForm(prev => {
      const existingSkus = new Set(prev.items.map(i => i.sku))
      const newItems = products.filter(p => !existingSkus.has(p.sku)).map(_buildItem)
      return { ...prev, items: [...prev.items, ...newItems] }
    })
  }

  const removeItem = (sku) => setPoForm(p => ({ ...p, items: p.items.filter(i => i.sku !== sku) }))
  const updateItem = (sku, f, v) => setPoForm(p => ({ ...p, items: p.items.map(i => i.sku === sku ? { ...i, [f]: v } : i) }))

  const addAllUrgent = () => {
    (analyticsProducts || []).filter(p => p.urgency === 'urgent' || p.urgency === 'warning').forEach(addProduct)
  }

  // ── Create PO ──
  const startCreate = () => {
    const defaultCat = poCategories.length > 0 ? poCategories[0].key : 'packaging'
    setPoForm({ ...EMPTY_FORM, po_category: defaultCat })
    setPickerSearch('')
    setPickerResults([])
    setMode('create')
    setSelectedId(null)
    setSelectedPO(null)
  }

  const submitCreate = async () => {
    if (!poForm.items.length) { showToast('Add at least one product', 'error'); return }
    setSaving(true)
    try {
      const result = await purchaseOrdersMgmtApi.create(poForm)
      showToast(`PO ${result.po_number || ''} created`, 'success')
      setMode('list')
      setPoForm({ ...EMPTY_FORM })
      fetchOrders()
      // Auto-select the new PO
      if (result.id) {
        setTimeout(() => selectPO(result.id), 300)
      }
    } catch (e) { showToast(e?.response?.data?.detail || 'Create failed', 'error') }
    finally { setSaving(false) }
  }

  const cancelCreate = () => {
    setMode('list')
    setPoForm({ ...EMPTY_FORM })
    setPickerSearch('')
    setPickerResults([])
  }

  // ── Edit PO ──
  const startEdit = () => {
    if (!selectedPO) return
    setPoForm({
      title: selectedPO.title || '',
      po_category: selectedPO.po_category || '',
      po_type: selectedPO.po_type || 'RESTOCK',
      priority: selectedPO.priority || 'STANDARD',
      supplier_name: selectedPO.supplier_name || '',
      container_ref: selectedPO.container_ref || '',
      expected_arrival_date: selectedPO.expected_arrival_date ? selectedPO.expected_arrival_date.split('T')[0] : '',
      notes: selectedPO.notes || '',
      created_by: selectedPO.created_by || '',
      items: JSON.parse(JSON.stringify(selectedPO.items || [])),
    })
    setMode('edit')
  }

  const saveEdit = async () => {
    if (!poForm.items.length) { showToast('Add at least one product', 'error'); return }
    setSaving(true)
    try {
      await purchaseOrdersMgmtApi.update(selectedId, poForm)
      await purchaseOrdersMgmtApi.updateItems(selectedId, poForm.items)
      
      let amendMsg = ''
      if (selectedPO.tom_number) {
        try {
          const tr = await purchaseOrdersMgmtApi.tomAmend(selectedId)
          amendMsg = ` & TOM amended`
        } catch (e) {
          amendMsg = ` (TOM amend failed: ${e?.response?.data?.detail || 'Unknown'})`
        }
      }
      showToast(`PO updated successfully${amendMsg}`, amendMsg.includes('failed') ? 'error' : 'success')
      
      setMode('detail')
      fetchOrders()
      refreshSelected()
    } catch (e) {
      showToast(e?.response?.data?.detail || 'Update failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Category helpers ──
  const getCatConfig = (key) => poCategories.find(c => c.key === key) || { key, label: key, tom_enabled: false }

  /** Save updated categories to backend */
  const saveCategories = async (cats) => {
    try {
      await settingsApi.updatePoCategories(cats)
      setPoCategories(cats)
      showToast('Categories updated', 'success')
    } catch (e) { showToast('Failed to save categories', 'error') }
  }

  return {
    // PO list
    orders, loading, selectedPO, selectedId, statusFilter, setStatusFilter,
    categoryFilter, setCategoryFilter, search, setSearch,
    // Mode
    mode, setMode,
    // Create form
    poForm, setPoForm,
    // Picker
    pickerSearch, setPickerSearch, pickerResults, pickerLoading,
    // Operations
    saving, tomBusy, toast, setToast,
    // Categories
    poCategories, getCatConfig,
    // Actions
    fetchOrders, selectPO, updateStatus, deletePO, receivePO, tomAction,
    addProduct, addProducts, removeItem, updateItem, addAllUrgent,
    startCreate, submitCreate, cancelCreate, startEdit, saveEdit, showToast,
    // Category management
    saveCategories,
  }
}
