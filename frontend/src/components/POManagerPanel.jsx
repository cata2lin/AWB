/**
 * POManagerPanel — Two-panel PO management layout.
 * Left: filterable PO list | Right: detail/create view.
 */
import { Check, XCircle, AlertTriangle } from 'lucide-react'
import usePOManager from './usePOManager'
import POList from './POList'
import PODetail from './PODetail'

export default function POManagerPanel({ analyticsProducts = [], onRefresh }) {
  const h = usePOManager({ analyticsProducts, onRefresh })

  return (
    <div className="relative">
      {/* Toast */}
      {h.toast && (
        <div className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-xl shadow-2xl text-sm font-medium flex items-center gap-2 animate-in slide-in-from-right ${
          h.toast.type === 'error' ? 'bg-red-600 text-white' : h.toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-white'
        }`}>
          {h.toast.type === 'error' ? <XCircle className="w-4 h-4" /> : h.toast.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {h.toast.msg}
          <button onClick={() => h.setToast(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Two-panel layout */}
      <div className="flex rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 overflow-hidden" style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}>
        {/* Left panel — PO List */}
        <div className="w-[320px] flex-shrink-0 border-r border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <POList h={h} />
        </div>
        {/* Right panel — Detail / Create */}
        <div className="flex-1 overflow-hidden">
          <PODetail h={h} />
        </div>
      </div>
    </div>
  )
}
