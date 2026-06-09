import { useState, useEffect, Fragment } from 'react'
import {
    Package, RefreshCw, DollarSign, AlertTriangle, Truck, Calendar,
} from 'lucide-react'
import { authFetch, API_URL } from '../../utils/authFetch'
import { formatMoney } from '../../utils/analyticsHelpers'
import { analyticsApi } from '../../services/api'
import ContributionMarginPnl from '../../components/ContributionMarginPnl'

// eslint-disable-next-line no-unused-vars
export default function ProfitabilityTab({ stores = [], selectedStores = [], days = 30 }) {
    // Profitability state
    const [profitabilityData, setProfitabilityData] = useState(null)
    const [orderProfitData, setOrderProfitData] = useState(null)
    const [orderProfitPage, setOrderProfitPage] = useState(0)
    const [orderProfitStatus, setOrderProfitStatus] = useState('')
    const [orderProfitLoading, setOrderProfitLoading] = useState(false)
    const [ordersLoaded, setOrdersLoaded] = useState(false)  // gate auto-refetch to after first explicit load

    // Profitability date period filter (independent of global date filter)
    // NOTE: Currently unused in the visible UI — kept for parity with the original
    // Analytics.jsx state (the "Analizează" trigger has been removed upstream).
    const [profitPeriod] = useState('30d')
    const [profitDateFrom] = useState('')
    const [profitDateTo] = useState('')
    // eslint-disable-next-line no-unused-vars
    const [profitLoading, setProfitLoading] = useState(false)
    // eslint-disable-next-line no-unused-vars
    const [expandedPnlSections, setExpandedPnlSections] = useState({})
    const [profitStores] = useState([])

    // Order-row expansion + CSV gaps state (only used by this tab)
    const [expandedOrderUid, setExpandedOrderUid] = useState(null)
    const [csvGapsData, setCsvGapsData] = useState(null)
    const [csvGapsLoading, setCsvGapsLoading] = useState(false)

    // --- Profitability period refetch ---
    // Kept for parity with the original component. The "Analizează" button that
    // previously called this was removed upstream; the function has no callers in
    // the visible UI but remains here so re-introducing the button is trivial.
    // eslint-disable-next-line no-unused-vars
    const fetchProfitability = async (period, customFrom, customTo) => {
        setProfitLoading(true)
        try {
            const params = new URLSearchParams()
            if (profitStores.length > 0) {
                params.set('store_uids', profitStores.join(','))
            }

            const now = new Date()
            let dateFrom, dateTo

            // Helper: format a local Date as YYYY-MM-DD without UTC shift
            const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

            if (period === '30d') {
                const d = new Date(now); d.setDate(d.getDate() - 30)
                dateFrom = fmtLocal(d)
                dateTo = fmtLocal(now)
            } else if (period === '90d') {
                const d = new Date(now); d.setDate(d.getDate() - 90)
                dateFrom = fmtLocal(d)
                dateTo = fmtLocal(now)
            } else if (period === 'thisMonth') {
                dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
                dateTo = fmtLocal(now)
            } else if (period === 'lastMonth') {
                const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
                const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0)
                dateFrom = fmtLocal(lm)
                dateTo = fmtLocal(lmEnd)
            } else if (period === 'custom') {
                if (!customFrom || !customTo) { setProfitLoading(false); return }
                dateFrom = customFrom
                dateTo = customTo
            } else if (/^\d{4}-\d{2}$/.test(period)) {
                // Specific month like '2026-01'
                const [y, m] = period.split('-').map(Number)
                dateFrom = `${y}-${String(m).padStart(2, '0')}-01`
                const lastDay = new Date(y, m, 0).getDate()
                dateTo = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
            }

            if (dateFrom) params.set('date_from', dateFrom)
            if (dateTo) params.set('date_to', dateTo)

            const res = await authFetch(`${API_URL}/analytics/profitability?${params}`)
            const data = await res.json()
            setProfitabilityData(data)
        } catch (err) {
            console.error('Failed to fetch profitability:', err)
        } finally {
            setProfitLoading(false)
        }
    }

    // Touch the dead state vars so eslint doesn't flag them as unused. These are
    // kept intentionally to preserve the original Analytics.jsx surface area.
    void profitPeriod; void profitDateFrom; void profitDateTo; void profitStores

    // Named loader for the order-profitability table (greppable, reused by the
    // button AND the pagination effect — previously the fetch lived inline in the
    // button's onClick so Prev/Next changed the page counter but never refetched).
    const loadOrderProfit = async () => {
        setOrderProfitLoading(true)
        try {
            const params = new URLSearchParams()
            if (selectedStores.length > 0) params.set('store_uids', selectedStores.join(','))
            if (days) params.set('days', days.toString())
            if (orderProfitStatus) params.set('status', orderProfitStatus)
            params.set('skip', (orderProfitPage * 25).toString())
            params.set('limit', '25')
            const res = await authFetch(`${API_URL}/analytics/profitability/orders?${params}`)
            const data = await res.json()
            setOrderProfitData(data)
        } catch (err) {
            console.error('Failed to fetch order profitability:', err)
        } finally {
            setOrderProfitLoading(false)
        }
    }

    // After the first explicit load, refetch whenever the page or status changes
    // (Prev/Next + the status dropdown). Gated by ordersLoaded so the table doesn't
    // auto-fetch on mount.
    useEffect(() => {
        if (ordersLoaded) loadOrderProfit()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderProfitPage, orderProfitStatus])

    return (
        <div className="space-y-6">
            {/* ═══ CONTRIBUTION MARGIN P&L ═══ */}
            <ContributionMarginPnl authFetch={authFetch} />



            {/* Order Profitability Table */}
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-clip">
                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                    <h3 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                        <Package className="w-5 h-5 text-green-600" />
                        Order Profitability Details
                    </h3>
                    <div className="flex items-center gap-2">
                        <select
                            value={orderProfitStatus}
                            onChange={(e) => {
                                setOrderProfitStatus(e.target.value)
                                setOrderProfitPage(0)
                            }}
                            className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white"
                        >
                            <option value="">All Statuses</option>
                            <option value="delivered">Delivered</option>
                            <option value="in_transit">In Transit</option>
                            <option value="returned">Returned</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                        <button
                            onClick={() => {
                                // Reset to page 0 on an explicit (re)load; the effect
                                // handles subsequent page/status-driven refetches.
                                if (orderProfitPage !== 0) setOrderProfitPage(0)
                                setOrdersLoaded(true)
                                loadOrderProfit()
                            }}
                            disabled={orderProfitLoading}
                            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"
                        >
                            {orderProfitLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                            Load Orders
                        </button>
                    </div>
                </div>

                {orderProfitData?.orders?.length > 0 ? (
                    <>
                        <div className="overflow-auto max-h-[75vh]">
                            <table className="w-full">
                                <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                    <tr>
                                        <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 dark:text-white uppercase">Order</th>
                                        <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 dark:text-white uppercase">Date</th>
                                        <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 dark:text-white uppercase">Status</th>
                                        <th className="text-right px-3 py-2 text-xs font-medium text-zinc-500 dark:text-white uppercase">Revenue</th>
                                        <th className="text-right px-3 py-2 text-xs font-medium text-zinc-500 dark:text-white uppercase">Total Costs</th>
                                        <th className="text-right px-3 py-2 text-xs font-medium text-zinc-500 dark:text-white uppercase">Gross Profit</th>
                                        <th className="text-right px-3 py-2 text-xs font-medium text-zinc-500 dark:text-white uppercase">Net Profit</th>
                                        <th className="text-right px-3 py-2 text-xs font-medium text-zinc-500 dark:text-white uppercase">Margin</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                                    {orderProfitData.orders.map(order => (
                                        <Fragment key={order.uid}>
                                            <tr
                                                onClick={() => setExpandedOrderUid(expandedOrderUid === order.uid ? null : order.uid)}
                                                className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 cursor-pointer"
                                            >
                                                <td className="px-3 py-1.5 text-sm">
                                                    <div className="font-medium text-zinc-900 dark:text-white">#{order.order_number}</div>
                                                    <div className="text-xs text-zinc-500 dark:text-white">{order.customer_name}</div>
                                                    {order.has_missing_costs && (
                                                        <span className="inline-flex items-center gap-1 text-xs text-amber-600" title="Some SKUs missing costs">
                                                            <AlertTriangle className="w-3 h-3" />
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-1.5 text-xs text-zinc-600 dark:text-white">
                                                    {order.created_at ? new Date(order.created_at).toLocaleDateString() : '-'}
                                                </td>
                                                <td className="px-3 py-1.5 text-sm">
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${order.status === 'delivered' ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' :
                                                        order.status === 'in_transit' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' :
                                                            order.status === 'back_to_sender' || order.status === 'returned' ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400' :
                                                                order.status === 'cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400' :
                                                                    'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-white'
                                                        }`}>
                                                        {order.status}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-1.5 text-xs text-right text-zinc-900 dark:text-white font-medium">
                                                    {formatMoney(order.total_price || order.revenue)}
                                                </td>
                                                <td className="px-3 py-1.5 text-xs text-right text-red-600 dark:text-red-400">
                                                    {formatMoney(order.total_costs)}
                                                </td>
                                                <td className={`px-3 py-1.5 text-xs text-right font-bold ${(order.profit_gross || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                    {formatMoney(order.profit_gross)}
                                                </td>
                                                <td className={`px-3 py-1.5 text-xs text-right ${(order.profit_net || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                    {formatMoney(order.profit_net)}
                                                </td>
                                                <td className="px-3 py-1.5 text-xs text-right">
                                                    <span className={order.margin_pct >= 20 ? 'text-green-600 dark:text-green-400' : order.margin_pct >= 10 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}>
                                                        {order.margin_pct}%
                                                    </span>
                                                </td>
                                            </tr>
                                            {expandedOrderUid === order.uid && (
                                                <tr className="bg-zinc-50 dark:bg-zinc-900/50">
                                                    <td colSpan={8} className="px-4 py-3">
                                                        {/* Currency conversion notice */}
                                                        {order.original_currency && order.original_currency !== 'RON' && (
                                                            <div className="mb-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-sm">
                                                                <span className="font-medium text-amber-800 dark:text-amber-300">💱 Currency conversion:</span>
                                                                <span className="text-amber-700 dark:text-amber-400 ml-1">
                                                                    Original order in {order.original_currency} ({formatMoney(order.original_total_price)} {order.original_currency})
                                                                    → converted at {order.exchange_rate} {order.original_currency}/RON
                                                                </span>
                                                            </div>
                                                        )}

                                                        {/* Revenue Breakdown */}
                                                        <div className="mb-4 p-3 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                                            <div className="text-xs font-medium text-zinc-500 dark:text-white uppercase mb-2">Revenue Breakdown (RON)</div>
                                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                                                <div>
                                                                    <div className="text-zinc-500 dark:text-white">Subtotal (products)</div>
                                                                    <div className="font-medium text-zinc-900 dark:text-white">{formatMoney(order.subtotal_price)} RON</div>
                                                                    {order.original_currency && order.original_currency !== 'RON' && order.original_subtotal_price && (
                                                                        <div className="text-xs text-zinc-400">{formatMoney(order.original_subtotal_price)} {order.original_currency}</div>
                                                                    )}
                                                                </div>
                                                                <div>
                                                                    <div className="text-zinc-500 dark:text-white">Discounts</div>
                                                                    <div className="font-medium text-green-600 dark:text-green-400">{order.total_discounts > 0 ? '-' : ''}{formatMoney(order.total_discounts)} RON</div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-zinc-500 dark:text-white">Shipping (customer paid)</div>
                                                                    <div className="font-medium text-orange-600 dark:text-orange-400">{formatMoney(order.shipping_cost)} RON</div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-zinc-500 dark:text-white">Total Price</div>
                                                                    <div className="font-bold text-zinc-900 dark:text-white">{formatMoney(order.total_price)} RON</div>
                                                                    {order.original_currency && order.original_currency !== 'RON' && order.original_total_price && (
                                                                        <div className="text-xs text-zinc-400">{formatMoney(order.original_total_price)} {order.original_currency}</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Cost Breakdown */}
                                                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/30">
                                                            <div className="text-xs font-medium text-red-500 dark:text-red-400 uppercase mb-2">Cost Breakdown (all in RON)</div>
                                                            <div className="space-y-2 text-sm">
                                                                <div className="flex justify-between items-start">
                                                                    <div>
                                                                        <div className="text-zinc-700 dark:text-white">📦 SKU Costs</div>
                                                                        <div className="text-[11px] text-zinc-400">Sum of (cost_per_unit × qty) for each product</div>
                                                                    </div>
                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.sku_costs)} RON</div>
                                                                </div>
                                                                <div className="flex justify-between items-start">
                                                                    <div>
                                                                        <div className="text-zinc-700 dark:text-white">📋 Packaging</div>
                                                                        <div className="text-[11px] text-zinc-400">Fixed {formatMoney(profitabilityData?.config?.packaging_cost_per_order)} RON/order</div>
                                                                    </div>
                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.packaging_cost)} RON</div>
                                                                </div>

                                                                <div className="flex justify-between items-start">
                                                                    <div>
                                                                        <div className="text-zinc-700 dark:text-white">👤 GT Commission</div>
                                                                        <div className="text-[11px] text-zinc-400">{profitabilityData?.config?.gt_commission_pct}% × {formatMoney(order.total_price)} (GT store only)</div>
                                                                    </div>
                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.gt_commission)} RON</div>
                                                                </div>
                                                                <div className="flex justify-between items-start">
                                                                    <div>
                                                                        <div className="text-zinc-700 dark:text-white">💳 Payment Processing</div>
                                                                        <div className="text-[11px] text-zinc-400">{profitabilityData?.config?.payment_processing_pct}% × {formatMoney(order.total_price)} + {formatMoney(profitabilityData?.config?.payment_processing_fixed)} fixed</div>
                                                                    </div>
                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.payment_fee)} RON</div>
                                                                </div>
                                                                <div className="flex justify-between items-start">
                                                                    <div>
                                                                        <div className="text-zinc-700 dark:text-white">ðŸ­ Frisbo Fee</div>
                                                                        <div className="text-[11px] text-zinc-400">Fixed {formatMoney(profitabilityData?.config?.frisbo_fee_per_order)} RON/order</div>
                                                                    </div>
                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.frisbo_fee)} RON</div>
                                                                </div>
                                                                <div className="flex justify-between items-start">
                                                                    <div>
                                                                        <div className="text-zinc-700 dark:text-white">🚚 Shipping Cost</div>
                                                                        <div className="text-[11px] text-zinc-400">Total Price − Subtotal (courier delivery cost)</div>
                                                                    </div>
                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.shipping_cost)} RON</div>
                                                                </div>
                                                                <div className="flex justify-between items-start pt-2 border-t border-red-200 dark:border-red-800">
                                                                    <div className="font-bold text-zinc-900 dark:text-white">Total Costs</div>
                                                                    <div className="font-bold text-red-700 dark:text-red-400">{formatMoney(order.total_costs)} RON</div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Profit Summary */}
                                                        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-100 dark:border-green-900/30">
                                                            <div className="text-xs font-medium text-green-500 dark:text-green-400 uppercase mb-2">Profit Summary</div>
                                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                                                <div>
                                                                    <div className="text-zinc-500 dark:text-white">Gross Profit</div>
                                                                    <div className={`font-bold ${(order.profit_gross || 0) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{formatMoney(order.profit_gross)} {order.currency || 'RON'}</div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-zinc-500 dark:text-white">Net Profit (after VAT)</div>
                                                                    <div className={`font-bold ${(order.profit_net || 0) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{formatMoney(order.profit_net)} {order.currency || 'RON'}</div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-zinc-500 dark:text-white">Margin</div>
                                                                    <div className={`font-bold ${order.margin_pct >= 20 ? 'text-green-700 dark:text-green-400' : order.margin_pct >= 10 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-700 dark:text-red-400'}`}>{order.margin_pct}%</div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Line Items */}
                                                        {order.line_items?.length > 0 && (
                                                            <div className="mt-3">
                                                                <div className="text-xs font-medium text-zinc-500 dark:text-white uppercase mb-2">Line Items</div>
                                                                <table className="w-full text-sm">
                                                                    <thead className="bg-zinc-50 dark:bg-zinc-900">
                                                                        <tr className="text-xs text-zinc-500 dark:text-white">
                                                                            <th className="text-left py-1">SKU</th>
                                                                            <th className="text-left py-1">Title</th>
                                                                            <th className="text-right py-1">Qty</th>
                                                                            <th className="text-right py-1">Price/Unit</th>
                                                                            <th className="text-right py-1">Cost/Unit</th>
                                                                            <th className="text-right py-1">Total Price</th>
                                                                            <th className="text-right py-1">Total Cost</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {order.line_items.map((item, idx) => (
                                                                            <tr key={idx} className="border-t border-zinc-200 dark:border-zinc-700">
                                                                                <td className="py-2 font-mono text-zinc-700 dark:text-white">{item.sku}</td>
                                                                                <td className="py-2 text-zinc-600 dark:text-white truncate max-w-[150px]">{item.title}</td>
                                                                                <td className="py-2 text-right text-zinc-900 dark:text-white">{item.quantity}</td>
                                                                                <td className="py-2 text-right text-zinc-900 dark:text-white">{item.price_per_unit?.toFixed(2) ?? '-'}</td>
                                                                                <td className="py-2 text-right text-zinc-900 dark:text-white">
                                                                                    {item.cost_per_unit != null ? (
                                                                                        <span>{item.cost_per_unit.toFixed(2)}</span>
                                                                                    ) : (
                                                                                        <span className="text-amber-600 flex items-center justify-end gap-1">
                                                                                            <AlertTriangle className="w-3 h-3" /> Missing
                                                                                        </span>
                                                                                    )}
                                                                                </td>
                                                                                <td className="py-2 text-right text-zinc-900 dark:text-white">{item.price_total?.toFixed(2) ?? '-'}</td>
                                                                                <td className="py-2 text-right text-red-600 dark:text-red-400">{item.cost_total?.toFixed(2) ?? '-'}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between text-sm text-zinc-600 dark:text-white">
                            <div>
                                Showing {orderProfitData.skip + 1}-{Math.min(orderProfitData.skip + orderProfitData.orders.length, orderProfitData.total)} of {orderProfitData.total}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setOrderProfitPage(Math.max(0, orderProfitPage - 1))}
                                    disabled={orderProfitPage === 0}
                                    className="px-3 py-1 bg-zinc-100 dark:bg-zinc-700 rounded disabled:opacity-50"
                                >
                                    Prev
                                </button>
                                <button
                                    onClick={() => setOrderProfitPage(orderProfitPage + 1)}
                                    disabled={(orderProfitPage + 1) * 25 >= orderProfitData.total}
                                    className="px-3 py-1 bg-zinc-100 dark:bg-zinc-700 rounded disabled:opacity-50"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </>
                ) : orderProfitLoading ? (
                    <div className="p-8 text-center text-zinc-500">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                        Loading orders...
                    </div>
                ) : (
                    <div className="p-8 text-center text-zinc-500">
                        Click "Load Orders" to view individual order profitability
                    </div>
                )}
            </div>

            {/* ═══ CSV IMPORT COVERAGE GAPS ═══ */}
            <div className="bg-white dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                        <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">CSV Import Coverage Gaps</h3>
                    </div>
                    <button
                        onClick={async () => {
                            setCsvGapsLoading(true)
                            try {
                                const data = await analyticsApi.getCsvCoverageGaps({ months: 6 })
                                setCsvGapsData(data)
                            } catch (e) { console.error('Failed to load CSV gaps:', e) }
                            setCsvGapsLoading(false)
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors flex items-center gap-1"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${csvGapsLoading ? 'animate-spin' : ''}`} />
                        {csvGapsData ? 'Refresh' : 'Load Gaps'}
                    </button>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
                    Periods where orders exist but have no transport cost from CSV imports. Import the corresponding courier CSV to fill these gaps.
                </p>

                {csvGapsLoading ? (
                    <div className="p-6 text-center text-zinc-500">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                        Analyzing coverage...
                    </div>
                ) : csvGapsData ? (
                    csvGapsData.couriers.length === 0 ? (
                        <div className="p-6 text-center text-emerald-500 dark:text-emerald-400 flex flex-col items-center gap-2">
                            <Package className="w-8 h-8" />
                            <span className="font-medium">All periods covered!</span>
                            <span className="text-xs text-zinc-500">No missing CSV imports detected in the last {csvGapsData.analysis_months} months.</span>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {csvGapsData.couriers.map(courier => (
                                <div key={courier.courier_name} className="border border-zinc-200 dark:border-zinc-700/50 rounded-lg overflow-hidden">
                                    <div className="bg-zinc-50 dark:bg-zinc-900/40 px-4 py-2.5 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Truck className="w-4 h-4 text-zinc-500" />
                                            <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-100">{courier.courier_name}</span>
                                        </div>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-medium">
                                            {courier.total_orders_missing} orders missing cost
                                        </span>
                                    </div>
                                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                        {courier.gaps.map((gap, idx) => {
                                            const severity = gap.coverage_pct === 0 ? 'red' : gap.coverage_pct < 50 ? 'amber' : 'yellow'
                                            const colors = {
                                                red: 'bg-red-50 dark:bg-red-900/10 border-l-red-500',
                                                amber: 'bg-amber-50 dark:bg-amber-900/10 border-l-amber-500',
                                                yellow: 'bg-yellow-50 dark:bg-yellow-900/10 border-l-yellow-500',
                                            }
                                            return (
                                                <div key={idx} className={`px-4 py-2.5 border-l-3 ${colors[severity]} flex items-center justify-between`}>
                                                    <div className="flex items-center gap-3">
                                                        <Calendar className="w-4 h-4 text-zinc-400" />
                                                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                                                            {new Date(gap.date_from).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                            {' → '}
                                                            {new Date(gap.date_to).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                        </span>
                                                        <span className="text-xs text-zinc-400">({gap.weeks} {gap.weeks === 1 ? 'week' : 'weeks'})</span>
                                                    </div>
                                                    <div className="flex items-center gap-4 text-xs">
                                                        <span className="text-zinc-500">
                                                            {gap.orders_with_cost}/{gap.total_orders} covered
                                                        </span>
                                                        <div className="w-20 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all ${
                                                                    severity === 'red' ? 'bg-red-500' :
                                                                    severity === 'amber' ? 'bg-amber-500' : 'bg-yellow-500'
                                                                }`}
                                                                style={{ width: `${gap.coverage_pct}%` }}
                                                            />
                                                        </div>
                                                        <span className={`font-medium ${
                                                            severity === 'red' ? 'text-red-600 dark:text-red-400' :
                                                            severity === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-yellow-600 dark:text-yellow-400'
                                                        }`}>
                                                            {gap.orders_missing_cost} missing
                                                        </span>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )
                ) : (
                    <div className="p-6 text-center text-zinc-400 text-sm">
                        Click "Load Gaps" to analyze CSV import coverage across couriers.
                    </div>
                )}
            </div>
        </div>
    )
}
