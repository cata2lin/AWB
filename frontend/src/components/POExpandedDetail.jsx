/**
 * POExpandedDetail — Expanded PO row showing items, TOM sync buttons, and sync log.
 */
import { useState } from 'react'
import { Check, Trash2, Truck, XCircle, CheckCircle2, Send, RotateCw, PenLine, Ban, Package, FileText, ChevronDown, ChevronUp, AlertTriangle, RefreshCw, Clock, Image } from 'lucide-react'
import { STATUS_CFG, TOM_STATUS_CLS, fmt, fmtCur } from './POManagerPanel'

export default function POExpandedDetail({ po, data, tomBusy, onUpdateStatus, onDelete, onReceive, onTomAction, isTomEnabled }) {
  const [showLog, setShowLog] = useState(false)
  const hasTom = !!data.tom_number
  const missingImages = (data.items || []).filter(i => !(i.product_image || '').trim())

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-3 space-y-3">
      {/* Status Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {po.status === 'DRAFT' && <>
          <button onClick={() => onUpdateStatus('APPROVED')} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg"><CheckCircle2 className="w-3.5 h-3.5" /> Approve</button>
          <button onClick={onDelete} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
        </>}
        {po.status === 'APPROVED' && <>
          <button onClick={onReceive} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg"><Check className="w-3.5 h-3.5" /> Receive All</button>
        </>}
        {po.status === 'PARTIALLY_RECEIVED' && <>
          <button onClick={() => onUpdateStatus('COMPLETED')} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg"><Check className="w-3.5 h-3.5" /> Complete</button>
        </>}
        {!['COMPLETED', 'CANCELLED'].includes(po.status) &&
          <button onClick={() => onUpdateStatus('CANCELLED')} className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"><XCircle className="w-3.5 h-3.5" /> Cancel</button>
        }
        {data.notes && <span className="text-xs text-zinc-400 ml-auto italic">📝 {data.notes}</span>}
      </div>

      {/* TOM Sync Bar — categories with tom_enabled */}
      {isTomEnabled && (
        <div className="flex items-center gap-2 flex-wrap p-2.5 rounded-lg bg-gradient-to-r from-sky-50 to-indigo-50 dark:from-sky-500/5 dark:to-indigo-500/5 border border-sky-200 dark:border-sky-500/20">
          <span className="text-[10px] font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wider mr-1">TOM</span>
          {hasTom ? (
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${TOM_STATUS_CLS[data.tom_status] || 'bg-zinc-100 text-zinc-500'}`}>
              {data.tom_number} · {data.tom_status || 'UNKNOWN'}
            </span>
          ) : (
            <span className="text-[10px] text-zinc-400">Not sent</span>
          )}

          {/* Missing images warning */}
          {missingImages.length > 0 && !hasTom && (
            <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
              <Image className="w-3 h-3" /> {missingImages.length} item(s) missing images
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {/* Send — only for APPROVED packaging POs not yet sent */}
            {po.status === 'APPROVED' && !hasTom && (
              <button onClick={() => onTomAction('send')} disabled={!!tomBusy}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-sky-600 hover:bg-sky-700 text-white rounded-lg disabled:opacity-40">
                {tomBusy === 'send' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send to TOM
              </button>
            )}
            {/* Refresh — only if sent */}
            {hasTom && (
              <button onClick={() => onTomAction('refresh')} disabled={!!tomBusy}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-40">
                {tomBusy === 'refresh' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />} Refresh
              </button>
            )}
            {/* Resend to TOM — only if sent */}
            {hasTom && !['CANCELLED', 'DELIVERED'].includes(data.tom_status) && (
              <button onClick={() => onTomAction('amend')} disabled={!!tomBusy}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-40">
                {tomBusy === 'amend' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Resend to TOM
              </button>
            )}
            {/* Cancel in TOM */}
            {hasTom && !['CANCELLED', 'DELIVERED'].includes(data.tom_status) && (
              <button onClick={() => onTomAction('cancel')} disabled={!!tomBusy}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg disabled:opacity-40">
                {tomBusy === 'cancel' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />} Cancel TOM
              </button>
            )}
          </div>

          {/* Shipment info */}
          {data.tom_shipment_code && (
            <div className="w-full flex items-center gap-3 mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              <span>🚢 {data.tom_shipment_code}</span>
              {data.tom_shipment_mode && <span>Mode: {data.tom_shipment_mode}</span>}
              {data.tom_shipment_eta && <span>ETA: {new Date(data.tom_shipment_eta).toLocaleDateString('ro-RO')}</span>}
              {data.tom_supplier_name && <span>Supplier: {data.tom_supplier_name}</span>}
            </div>
          )}
        </div>
      )}

      {/* Items table */}
      <div className="overflow-x-auto max-h-[50vh] overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-700/50">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
            <tr className="text-xs text-zinc-500 dark:text-zinc-400">
              <th className="px-3 py-2 text-left font-medium">Product</th>
              <th className="px-3 py-2 text-left font-medium">SKU</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit Cost</th>
              <th className="px-3 py-2 text-right font-medium">Line Total</th>
              <th className="px-3 py-2 text-right font-medium">Received</th>
              {isPkg && <th className="px-3 py-2 text-center font-medium">TOM Status</th>}
              {isPkg && <th className="px-3 py-2 text-right font-medium">TOM Qty</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
            {(data.items || []).map(item => (
              <tr key={item.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-700/20 ${!item.product_image && isPkg ? 'bg-amber-50/30 dark:bg-amber-500/5' : ''}`}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {item.product_image ? (
                      <img src={item.product_image} className="w-7 h-7 rounded object-cover border border-zinc-200 dark:border-zinc-600" />
                    ) : (
                      <div className="w-7 h-7 rounded bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center" title="Missing image — required for TOM">
                        <Image className="w-3.5 h-3.5 text-amber-500" />
                      </div>
                    )}
                    <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]">{item.product_name || '—'}</span>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">{item.sku}</td>
                <td className="px-3 py-2 text-right font-semibold text-zinc-900 dark:text-white">{fmt(item.quantity)}</td>
                <td className="px-3 py-2 text-right text-xs text-zinc-500">{fmtCur(item.unit_cost)}</td>
                <td className="px-3 py-2 text-right text-xs font-medium text-zinc-700 dark:text-zinc-300">{fmtCur(item.line_cost)}</td>
                <td className="px-3 py-2 text-right text-xs">{item.received_qty > 0 ? <span className="text-green-600 font-medium">{fmt(item.received_qty)}</span> : <span className="text-zinc-400">0</span>}</td>
                {isPkg && (
                  <td className="px-3 py-2 text-center">
                    {item.tom_status ? (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TOM_STATUS_CLS[item.tom_status] || 'bg-zinc-100 text-zinc-500'}`}>{item.tom_status}</span>
                    ) : <span className="text-zinc-400 text-[10px]">—</span>}
                  </td>
                )}
                {isPkg && (
                  <td className="px-3 py-2 text-right text-[10px] text-zinc-500">
                    {item.tom_ordered_qty != null && <span>O:{item.tom_ordered_qty} </span>}
                    {item.tom_shipped_qty != null && <span>S:{item.tom_shipped_qty} </span>}
                    {item.tom_received_qty != null && <span className="text-green-600">R:{item.tom_received_qty}</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sync Log toggle */}
      {(data.sync_logs || []).length > 0 && (
        <div>
          <button onClick={() => setShowLog(!showLog)} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-medium">
            <FileText className="w-3.5 h-3.5" /> Sync Log ({data.sync_logs.length})
            {showLog ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showLog && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700/50 bg-zinc-50 dark:bg-zinc-900">
              {data.sync_logs.map(log => (
                <div key={log.id} className="px-3 py-2 flex items-start gap-3 text-xs">
                  <span className={`px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${log.status === 'SUCCESS' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300'}`}>
                    {log.status}
                  </span>
                  <span className="font-mono text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{log.action}</span>
                  <span className="text-zinc-400">{log.items_affected} items</span>
                  {log.error_message && <span className="text-red-500 truncate max-w-[300px]" title={log.error_message}>⚠ {log.error_message}</span>}
                  <span className="text-zinc-400 ml-auto whitespace-nowrap">{log.created_at ? new Date(log.created_at).toLocaleString('ro-RO') : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
