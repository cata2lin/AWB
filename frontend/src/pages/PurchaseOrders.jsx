/**
 * PurchaseOrders page — Top-level route for Purchase Order management.
 * 
 * URL-driven routing:
 * - /purchase-orders → list view (with optional ?status=X&category=Y&search=Z&sort=X&order=asc)
 * - /purchase-orders/:poNumber → detail view (e.g. /purchase-orders/PO-0006)
 * - /purchase-orders/new → create view
 */
import { useEffect } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import usePOManager from '../components/usePOManager'
import PurchaseOrdersList from '../components/PurchaseOrdersList'
import PurchaseOrderDetailPage from '../components/PurchaseOrderDetail'
import { Check, XCircle, AlertTriangle } from 'lucide-react'

export default function PurchaseOrders() {
  const { poNumber } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const h = usePOManager({ analyticsProducts: [], onRefresh: null })

  // Sync URL → state on mount and URL changes
  useEffect(() => {
    if (poNumber === 'new') {
      if (h.mode !== 'create') {
        h.startCreate()
        
        // Check for prefill data immediately when starting create mode
        try {
          const raw = sessionStorage.getItem('po_prefill')
          if (raw) {
            const items = JSON.parse(raw)
            if (Array.isArray(items) && items.length > 0) {
              // Add velocity items to the create form
              // We need a slight delay to ensure startCreate's EMPTY_FORM is applied first
              setTimeout(() => {
                h.addProducts(items.map(item => ({
                  sku: item.sku,
                  product_name: item.product_name,
                  unit_cost: item.unit_cost,
                  suggested_qty: item.quantity,
                })))
              }, 50)
            }
            sessionStorage.removeItem('po_prefill')
          }
        } catch (e) { console.error('Prefill parse error:', e) }
      }
      return
    }

    if (poNumber) {
      // Find the PO by po_number and select it
      const po = h.orders.find(o => o.po_number === poNumber)
      if (po && (h.selectedId !== po.id || h.mode !== 'detail')) {
        h.selectPO(po.id)
      }
      return
    }
    // List mode — sync filters from URL
    const urlStatus = searchParams.get('status') || ''
    const urlCategory = searchParams.get('category') || ''
    const urlSearch = searchParams.get('search') || ''
    if (urlStatus !== h.statusFilter) h.setStatusFilter(urlStatus)
    if (urlCategory !== h.categoryFilter) h.setCategoryFilter(urlCategory)
    if (urlSearch !== h.search) h.setSearch(urlSearch)
  }, [poNumber, searchParams, h.orders.length])

  // Wrap navigation helpers to update URL
  const wrappedH = {
    ...h,
    // Override selectPO to navigate
    selectPO: async (id) => {
      await h.selectPO(id)
      const po = h.orders.find(o => o.id === id)
      if (po) navigate(`/purchase-orders/${po.po_number}`)
    },
    // Override startCreate to navigate
    startCreate: () => {
      h.startCreate()
      navigate('/purchase-orders/new')
    },
    // Override setMode to navigate back
    setMode: (mode) => {
      h.setMode(mode)
      if (mode === 'list') navigate('/purchase-orders')
    },
    // Override cancelCreate to navigate
    cancelCreate: () => {
      h.cancelCreate()
      navigate('/purchase-orders')
    },
    // Override submitCreate to navigate to the new PO
    submitCreate: async () => {
      await h.submitCreate()
    },
    // Override filters to update URL
    setStatusFilter: (s) => {
      h.setStatusFilter(s)
      const params = new URLSearchParams(searchParams)
      if (s) params.set('status', s); else params.delete('status')
      navigate(`/purchase-orders?${params.toString()}`, { replace: true })
    },
    setCategoryFilter: (c) => {
      h.setCategoryFilter(c)
      const params = new URLSearchParams(searchParams)
      if (c) params.set('category', c); else params.delete('category')
      navigate(`/purchase-orders?${params.toString()}`, { replace: true })
    },
    setSearch: (q) => {
      h.setSearch(q)
      // Debounce URL update for search
    },
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Toast notification */}
      {h.toast && (
        <div className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-xl shadow-2xl text-sm font-medium flex items-center gap-2 animate-in slide-in-from-right ${
          h.toast.type === 'error' ? 'bg-red-600 text-white' : h.toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-white'
        }`}>
          {h.toast.type === 'error' ? <XCircle className="w-4 h-4" /> : h.toast.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {h.toast.msg}
          <button onClick={() => h.setToast(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* View router */}
      {h.mode === 'list' && !poNumber && (
        <PurchaseOrdersList h={wrappedH} />
      )}
      {(h.mode === 'create' || h.mode === 'detail' || poNumber) && (
        <PurchaseOrderDetailPage h={wrappedH} />
      )}
    </div>
  )
}
