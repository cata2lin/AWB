import { useState } from 'react'
import { ChevronDown, ChevronRight, Package, X, Printer, Hash, MapPin, Box } from 'lucide-react'

/**
 * Enhanced Print Preview Component
 * 
 * Shows detailed grouping of orders before printing:
 * - Collapsible groups with color coding
 * - SKU frequency breakdown per group
 * - Order details with line items
 * - Store indicators
 */
export default function PrintPreview({ previewData, onClose, onPrint, isPrinting }) {
    const [expandedGroups, setExpandedGroups] = useState({})
    const [expandedOrders, setExpandedOrders] = useState({})

    const toggleGroup = (idx) => {
        setExpandedGroups(prev => ({ ...prev, [idx]: !prev[idx] }))
    }

    const toggleOrder = (orderUid) => {
        setExpandedOrders(prev => ({ ...prev, [orderUid]: !prev[orderUid] }))
    }

    // Calculate SKU frequency for a group (presence-based: how many orders contain each SKU)
    const getSkuBreakdown = (orders) => {
        const skuCount = {}
        orders.forEach(order => {
            const lineItems = order.line_items || []
            // Collect unique SKUs in this order
            const orderSkus = new Set()
            lineItems.forEach(item => {
                const sku = item.sku || item.inventory_item?.sku
                if (sku) orderSkus.add(sku)
            })
            // Count each unique SKU once per order (presence-based)
            orderSkus.forEach(sku => {
                skuCount[sku] = (skuCount[sku] || 0) + 1
            })
        })
        // Sort by frequency descending
        return Object.entries(skuCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10) // Top 10
    }

    if (!previewData) return null

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between flex-shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                            <Printer className="w-5 h-5 text-indigo-600" />
                            Print Preview
                        </h2>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            <span className="font-semibold text-zinc-700 dark:text-zinc-300">{previewData.total_orders}</span> orders in{' '}
                            <span className="font-semibold text-zinc-700 dark:text-zinc-300">{previewData.total_groups}</span> groups
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Groups List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {previewData.groups?.map((group, idx) => {
                        const isExpanded = expandedGroups[idx]
                        const skuBreakdown = getSkuBreakdown(group.orders || [])

                        return (
                            <div
                                key={idx}
                                className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden"
                            >
                                {/* Group Header */}
                                <div
                                    onClick={() => toggleGroup(idx)}
                                    className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-900 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                >
                                    <div
                                        className="w-4 h-4 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: group.group_color || '#6B7280' }}
                                    />

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold text-zinc-900 dark:text-white">
                                                {group.group_name}
                                            </span>
                                            <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-xs font-medium rounded-full">
                                                {group.order_count} orders
                                            </span>
                                        </div>

                                        {/* SKU Summary (always visible) */}
                                        {skuBreakdown.length > 0 && (
                                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                <span className="text-xs text-zinc-500">Top SKUs:</span>
                                                {skuBreakdown.slice(0, 3).map(([sku, count]) => (
                                                    <span
                                                        key={sku}
                                                        className="px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-xs rounded"
                                                    >
                                                        {sku.length > 20 ? sku.slice(0, 20) + '...' : sku} ({count})
                                                    </span>
                                                ))}
                                                {skuBreakdown.length > 3 && (
                                                    <span className="text-xs text-zinc-400">
                                                        +{skuBreakdown.length - 3} more
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {isExpanded ?
                                        <ChevronDown className="w-5 h-5 text-zinc-400" /> :
                                        <ChevronRight className="w-5 h-5 text-zinc-400" />
                                    }
                                </div>

                                {/* Expanded Group Content */}
                                {isExpanded && (
                                    <div className="border-t border-zinc-200 dark:border-zinc-700">
                                        {/* Full SKU Breakdown */}
                                        {skuBreakdown.length > 0 && (
                                            <div className="p-3 bg-zinc-100/50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
                                                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">SKU Frequency (sorted by print order)</p>
                                                <div className="flex flex-wrap gap-1">
                                                    {skuBreakdown.map(([sku, count]) => (
                                                        <span
                                                            key={sku}
                                                            className="px-2 py-1 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 text-xs rounded-lg flex items-center gap-1"
                                                        >
                                                            <Box className="w-3 h-3 text-zinc-400" />
                                                            <span className="font-medium">{sku}</span>
                                                            <span className="text-indigo-600 dark:text-indigo-400">×{count}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Orders List */}
                                        <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
                                            {(() => {
                                                // Compute the group's topSku (most frequent across all orders)
                                                const groupTopSku = skuBreakdown.length > 0 ? skuBreakdown[0][0] : null

                                                return group.orders?.map((order, orderIdx) => {
                                                    const isOrderExpanded = expandedOrders[order.uid]
                                                    // Get all SKUs in this order
                                                    const orderSkus = new Set()
                                                    for (const item of (order.line_items || [])) {
                                                        const sku = item?.sku || item?.inventory_item?.sku
                                                        if (sku) orderSkus.add(sku)
                                                    }
                                                    // Show the highest-frequency group SKU that this order contains
                                                    let dominantSku = '(no SKU)'
                                                    for (const [sku] of skuBreakdown) {
                                                        if (orderSkus.has(sku)) {
                                                            dominantSku = sku
                                                            break
                                                        }
                                                    }

                                                    return (
                                                        <div key={order.uid} className="bg-white dark:bg-zinc-800">
                                                            {/* Order Row */}
                                                            <div
                                                                onClick={() => toggleOrder(order.uid)}
                                                                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors"
                                                            >
                                                                <span className="w-6 text-center text-xs text-zinc-400 font-mono">
                                                                    {orderIdx + 1}
                                                                </span>

                                                                <div className="flex-1 min-w-0 flex items-center gap-3">
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="font-medium text-zinc-900 dark:text-white text-sm">
                                                                                #{order.order_number}
                                                                            </span>
                                                                            <span className="text-zinc-500 dark:text-zinc-400 text-sm truncate">
                                                                                {order.customer_name}
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex items-center gap-2 mt-0.5">
                                                                            <span className="text-xs text-zinc-400">
                                                                                {order.item_count} item{order.item_count !== 1 ? 's' : ''}
                                                                                {order.unique_sku_count > 0 && order.unique_sku_count !== order.item_count && (
                                                                                    <span className="text-zinc-500"> ({order.unique_sku_count} SKU{order.unique_sku_count !== 1 ? 's' : ''})</span>
                                                                                )}
                                                                            </span>
                                                                            <span className="text-xs px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded">
                                                                                {dominantSku}
                                                                            </span>
                                                                        </div>
                                                                    </div>

                                                                    {order.courier_name && (
                                                                        <span className="text-xs px-2 py-1 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded">
                                                                            {order.courier_name}
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                {isOrderExpanded ?
                                                                    <ChevronDown className="w-4 h-4 text-zinc-400" /> :
                                                                    <ChevronRight className="w-4 h-4 text-zinc-400" />
                                                                }
                                                            </div>

                                                            {/* Order Details */}
                                                            {isOrderExpanded && (
                                                                <div className="px-3 pb-3 ml-9 space-y-2">
                                                                    {/* Shipping Address */}
                                                                    {order.shipping_address && (
                                                                        <div className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                                                            <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                                                            <span>
                                                                                {order.shipping_address.city}, {order.shipping_address.province || order.shipping_address.country}
                                                                            </span>
                                                                        </div>
                                                                    )}

                                                                    {/* Line Items */}
                                                                    <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-2 space-y-1">
                                                                        {order.line_items?.map((item, itemIdx) => (
                                                                            <div key={itemIdx} className="flex items-center justify-between text-xs">
                                                                                <div className="flex items-center gap-2 min-w-0">
                                                                                    <Hash className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                                                                                    <span className="font-mono text-zinc-600 dark:text-zinc-300 truncate">
                                                                                        {item.sku || item.inventory_item?.sku || 'N/A'}
                                                                                    </span>
                                                                                </div>
                                                                                <span className="text-zinc-500 dark:text-zinc-400 flex-shrink-0 ml-2">
                                                                                    ×{item.quantity || 1}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })
                                            })()}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between flex-shrink-0">
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                        Click groups to expand • Click orders to see details
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onPrint}
                            disabled={isPrinting}
                            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                        >
                            <Printer className="w-4 h-4" />
                            {isPrinting ? 'Generating...' : `Print ${previewData.total_orders} Orders`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
