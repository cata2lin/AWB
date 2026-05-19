/**
 * PurchaseOrders page — Top-level route for Purchase Order management.
 * 
 * URL-driven routing:
 * - /purchase-orders → list view
 * - /purchase-orders/:poNumber → detail view (e.g. /purchase-orders/PO-0006)
 * - /purchase-orders/new → create view
 *
 * Navigation:
 * - Clicking a PO navigates to /purchase-orders/PO-XXXX (pushes history entry)
 * - Browser back button returns to /purchase-orders (list) automatically
 * - Page refresh on a PO URL: selectPOByNumber() loads directly from API
 */
import { useEffect, useRef } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import usePOManager from '../components/usePOManager'
import PurchaseOrdersList from '../components/PurchaseOrdersList'
import PurchaseOrderDetailPage from '../components/PurchaseOrderDetail'

export default function PurchaseOrders() {
  const { poNumber } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const h = usePOManager({ analyticsProducts: [], onRefresh: null })
  // Track the last poNumber we triggered a load for to avoid duplicate fetches
  const loadedPONumber = useRef(null)

  // Sync URL → state on mount and URL changes
  useEffect(() => {
    if (poNumber === 'new') {
      if (h.mode !== 'create') {
        h.startCreate()
        try {
          const raw = sessionStorage.getItem('po_prefill')
          if (raw) {
            const items = JSON.parse(raw)
            if (Array.isArray(items) && items.length > 0) {
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
      // Already showing this PO — nothing to do
      if (loadedPONumber.current === poNumber && h.mode === 'detail') return

      // Try from already-loaded list first (fast path)
      const po = h.orders.find(o => o.po_number === poNumber)
      if (po && h.selectedId !== po.id) {
        loadedPONumber.current = poNumber
        h.selectPO(po.id)
        return
      }

      // Fallback: direct API load by number (handles page refresh & deep links)
      if (loadedPONumber.current !== poNumber) {
        loadedPONumber.current = poNumber
        h.selectPOByNumber(poNumber)
      }
      return
    }

    // No poNumber in URL → list mode
    loadedPONumber.current = null
    if (h.mode !== 'list') {
      h.setMode('list')
      h.setSelectedId?.(null)
    }
    // Sync filters from URL
    const urlStatus = searchParams.get('status') || ''
    const urlCategory = searchParams.get('category') || ''
    if (urlStatus !== h.statusFilter) h.setStatusFilter(urlStatus)
    if (urlCategory !== h.categoryFilter) h.setCategoryFilter(urlCategory)
  }, [poNumber, searchParams])

  // Wrap navigation helpers to update URL
  const wrappedH = {
    ...h,
    // Override selectPO to push URL
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
    // Override setMode: going to list navigates back
    setMode: (mode) => {
      h.setMode(mode)
      if (mode === 'list') navigate('/purchase-orders')
    },
    // Override cancelCreate
    cancelCreate: () => {
      h.cancelCreate()
      navigate('/purchase-orders')
    },
    // Override submitCreate
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
    },
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* View router — show list when no poNumber in URL, detail otherwise */}
      {!poNumber && h.mode !== 'create' && h.mode !== 'edit' && (
        <PurchaseOrdersList h={wrappedH} />
      )}
      {(poNumber || h.mode === 'create' || h.mode === 'detail' || h.mode === 'edit') && (
        <PurchaseOrderDetailPage h={wrappedH} />
      )}
    </div>
  )
}
