/**
 * PurchaseOrderDetail — Full-page wrapper for PO detail/create views.
 * Reuses existing PODetail component inside a Grandia-style full-page layout.
 */
import { ArrowLeft } from 'lucide-react'
import PODetail from './PODetail'

export default function PurchaseOrderDetailPage({ h }) {
  const po = h.selectedPO
  const isCreate = h.mode === 'create'

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      {/* Back button */}
      <button onClick={() => { h.setMode('list'); h.setToast(null) }}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
        <ArrowLeft className="h-4 w-4" />
        Back to Purchase Orders
      </button>

      {/* Title */}
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
        {isCreate ? 'New Purchase Order' : (po?.po_number || 'Purchase Order')}
      </h1>

      {/* Main content card */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
        style={{ minHeight: 'calc(100vh - 220px)' }}>
        <PODetail h={h} />
      </div>
    </div>
  )
}
