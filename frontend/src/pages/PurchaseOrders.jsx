/**
 * PurchaseOrders page — Top-level route for Purchase Order management.
 * 
 * Manages view state (list vs create vs detail) and renders the appropriate
 * full-page view. Uses the same usePOManager hook for state management.
 */
import { useState } from 'react'
import usePOManager from '../components/usePOManager'
import PurchaseOrdersList from '../components/PurchaseOrdersList'
import PurchaseOrderDetail from '../components/PurchaseOrderDetail'
import { Check, XCircle, AlertTriangle } from 'lucide-react'

export default function PurchaseOrders() {
  const h = usePOManager({ analyticsProducts: [], onRefresh: null })

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
      {h.mode === 'list' && (
        <PurchaseOrdersList h={h} />
      )}
      {(h.mode === 'create' || h.mode === 'detail') && (
        <PurchaseOrderDetail h={h} />
      )}
    </div>
  )
}
