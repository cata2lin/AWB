/**
 * Purchase Orders Excel Export.
 * Uses SheetJS to generate XLSX with reorder analytics.
 */
import * as XLSX from 'xlsx'

export function exportPurchaseOrdersToExcel(products, meta) {
    const rows = products.map((p, i) => ({
        '#': i + 1,
        'SKU': p.sku,
        'Product': p.product_name,
        'Stock Available': p.stock_available,
        'Stock Committed': p.stock_committed,
        'Stock Incoming': p.stock_incoming,
        'Units Sold': p.units_sold,
        'Velocity (u/day)': p.velocity,
        'Days of Stock': p.days_of_stock ?? '∞',
        'Lead Time (days)': p.lead_time,
        'Reorder Point': p.reorder_point,
        'Suggested Qty': p.suggested_qty,
        'Urgency': p.urgency?.toUpperCase(),
        'Unit Cost': p.unit_cost,
        'Stock Value': p.stock_value,
        'Revenue': p.revenue,
        'Orders': p.orders,
        'Stores': p.stores?.join(', '),
        'Self-Produced': p.is_self_produced ? 'Yes' : 'No',
    }))

    const ws = XLSX.utils.json_to_sheet(rows)

    // Auto-width columns
    const colWidths = Object.keys(rows[0] || {}).map(key => ({
        wch: Math.max(key.length + 2, ...rows.map(r => String(r[key] ?? '').length + 2))
    }))
    ws['!cols'] = colWidths

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Orders')

    // Add meta sheet
    const metaRows = [
        { Key: 'Period', Value: `${meta.period_days} days` },
        { Key: 'Date From', Value: meta.date_from },
        { Key: 'Date To', Value: meta.date_to },
        { Key: 'Default Lead Time', Value: `${meta.default_lead_time} days` },
        { Key: 'Self-Produced Stores', Value: meta.self_produced_stores?.join(', ') },
        { Key: 'Exported At', Value: new Date().toISOString() },
    ]
    const metaWs = XLSX.utils.json_to_sheet(metaRows)
    XLSX.utils.book_append_sheet(wb, metaWs, 'Meta')

    const dateStr = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `purchase_orders_${dateStr}.xlsx`)
}
