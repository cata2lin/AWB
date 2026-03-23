/**
 * P&L Excel Export Utility
 * Exports P&L and P&L Comparativ data to .xlsx files using SheetJS.
 */
import * as XLSX from 'xlsx'

/**
 * Format a number as Romanian-style money (e.g., 1.234,56)
 */
const fmtNum = (val) => {
    if (val === null || val === undefined || val === '') return ''
    const n = typeof val === 'number' ? val : parseFloat(val)
    if (isNaN(n)) return ''
    return Math.round(n * 100) / 100
}

/**
 * Extract value from nested P&L data using dot-path
 */
const getNestedVal = (data, path) => {
    if (!path || !data) return undefined
    if (path === '__unrealized_revenue') {
        const sb = data.status_breakdown || {}
        const inTransit = sb.in_transit?.revenue?.cu_tva || 0
        const other = sb.other?.revenue?.cu_tva || 0
        return { cu_tva: inTransit + other, fara_tva: (inTransit + other) / 1.21 }
    }
    if (path === '__unrealized_count') {
        const sb = data.status_breakdown || {}
        return (sb.in_transit?.count || 0) + (sb.other?.count || 0)
    }
    let obj = data
    for (const p of path.split('.')) obj = obj?.[p]
    return obj
}

/**
 * Build the standard P&L row definitions (shared by both export types)
 */
const buildPnlRows = (pnl, config) => {
    const bizBySection = pnl?.business_costs_by_section || {}
    const fixedEntries = bizBySection.fixed || []
    const fixedCostRows = fixedEntries.map(entry => ({
        type: 'row', label: `(-) ${entry.label}`, isDynamic: true, amount: entry.cu_tva, isNeg: true, section: 'fixed'
    }))

    return [
        { type: 'header', label: 'VENITURI' },
        { type: 'row', label: 'Vânzări Brute', path: 'income.gross_sales' },
        { type: 'row', label: '(-) Returnate/Anulate', path: 'income.returns_cancelled', isNeg: true, countPath: 'income.returns_cancelled_count' },
        { type: 'row', label: '(-) Nerealizate/În tranzit', path: '__unrealized_revenue', isNeg: true, countPath: '__unrealized_count' },
        { type: 'total', label: 'Revenue Livrat', path: 'income.sales_delivered', countPath: 'income.delivered_count' },
        { type: 'spacer' },
        { type: 'header', label: 'COGS' },
        { type: 'row', label: 'Cost Produse (SKU)', path: 'cogs.sku_costs', isNeg: true },
        { type: 'total', label: 'Total COGS', path: 'cogs.total_cogs', isNeg: true },
        { type: 'profit', label: 'PROFIT BRUT', path: 'gross_profit', pctKey: 'gross_margin_pct' },
        { type: 'spacer' },
        { type: 'header', label: 'COSTURI OPERAȚIONALE' },
        { type: 'row', label: 'Transport', path: 'operational.shipping', isNeg: true },
        { type: 'row', label: 'Frisbo Fee', path: 'operational.frisbo_fee', isNeg: true },
        { type: 'row', label: 'Salariu Depozit', path: 'operational.warehouse_salary', isNeg: true },
        { type: 'row', label: `Comision GT (${config?.gt_commission_pct || 0}%)`, path: 'operational.gt_commission', isNeg: true },
        { type: 'row', label: `Procesare Plăți (${config?.payment_processing_pct || 0}%)`, path: 'operational.payment_fee', isNeg: true },
        { type: 'total', label: 'Total Operațional', path: 'operational.total_operational', isNeg: true },
        { type: 'profit', label: 'PROFIT OPERAȚIONAL', path: 'operating_profit', pctKey: 'operating_margin_pct' },
        { type: 'spacer' },
        { type: 'header', label: 'MARKETING' },
        { type: 'row', label: 'Facebook Ads', path: 'marketing.facebook', isNeg: true },
        { type: 'row', label: 'TikTok Ads', path: 'marketing.tiktok', isNeg: true },
        { type: 'row', label: 'Google Ads', path: 'marketing.google', isNeg: true },
        { type: 'total', label: 'Total Marketing', path: 'marketing.total', isNeg: true },
        { type: 'spacer' },
        { type: 'header', label: `COSTURI FIXE (${pnl?.fixed_costs_month || ''})` },
        ...fixedCostRows,
        { type: 'total', label: 'Total Costuri Fixe', path: 'fixed_costs.total', isNeg: true },
        { type: 'spacer' },
        { type: 'net', label: 'PROFIT NET', path: 'net_profit', pctKey: 'net_margin_pct' },
    ]
}

/**
 * Export single-store P&L to Excel (one sheet per store + total)
 */
export function exportPnlToExcel(profitabilityData) {
    if (!profitabilityData) return

    const wb = XLSX.utils.book_new()
    const pnl = profitabilityData.pnl
    const config = profitabilityData.config || {}
    const rows = buildPnlRows(pnl, config)

    // Helper to build a sheet for one P&L dataset
    const buildSheet = (data, title) => {
        const sheetData = [[title, 'Cu TVA', 'Fără TVA']]

        for (const row of rows) {
            if (row.type === 'spacer') {
                sheetData.push([])
                continue
            }
            if (row.isDynamic) {
                // Fixed cost row — value comes from the row itself
                const amount = row.amount || 0
                sheetData.push([row.label, fmtNum(amount), fmtNum(amount / 1.21)])
                continue
            }

            const val = row.path ? getNestedVal(data, row.path) : undefined
            const cuTva = typeof val === 'number' ? val : (val?.cu_tva ?? '')
            const faraTva = typeof val === 'number' ? val : (val?.fara_tva ?? '')
            const pct = row.pctKey ? data[row.pctKey] : undefined

            let label = row.label
            if (pct !== undefined) label += ` (${pct}%)`

            if (row.countPath) {
                const count = getNestedVal(data, row.countPath)
                if (count !== undefined) label += ` [${count} comenzi]`
            }

            sheetData.push([label, fmtNum(cuTva), fmtNum(faraTva)])
        }

        return XLSX.utils.aoa_to_sheet(sheetData)
    }

    // Total P&L sheet
    const totalData = { ...pnl, income: { ...pnl?.income, sales_delivered: pnl?.income?.total_realized, delivered_count: pnl?.income?.delivered_count } }
    const totalSheet = buildSheet(totalData, 'TOTAL')
    XLSX.utils.book_append_sheet(wb, totalSheet, 'TOTAL')

    // Per-store sheets
    const storePnls = profitabilityData.pnl_by_store || []
    for (const sp of storePnls) {
        const name = (sp.store_name || 'Store').slice(0, 31) // Excel sheet name max 31 chars
        const sheet = buildSheet(sp, name)
        XLSX.utils.book_append_sheet(wb, sheet, name)
    }

    // Transport fallback stats sheet
    const fb = profitabilityData.transport_fallback_stats
    if (fb) {
        const fbSheet = XLSX.utils.aoa_to_sheet([
            ['Transport Cost Source', 'Count'],
            ['CSV Import', fb.csv_import],
            ['Same SKU Match', fb.same_sku],
            ['Brand Average', fb.brand_avg],
            ['Customer Paid', fb.customer_paid],
            ['Zero / Unknown', fb.zero],
        ])
        XLSX.utils.book_append_sheet(wb, fbSheet, 'Transport Sources')
    }

    // Auto-size columns
    for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName]
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
        const colWidths = []
        for (let c = range.s.c; c <= range.e.c; c++) {
            let maxLen = 10
            for (let r = range.s.r; r <= range.e.r; r++) {
                const cell = ws[XLSX.utils.encode_cell({ r, c })]
                if (cell && cell.v) {
                    maxLen = Math.max(maxLen, String(cell.v).length)
                }
            }
            colWidths.push({ wch: Math.min(maxLen + 2, 40) })
        }
        ws['!cols'] = colWidths
    }

    XLSX.writeFile(wb, `PnL_${new Date().toISOString().split('T')[0]}.xlsx`)
}

/**
 * Export P&L Comparativ (multi-store side-by-side) to Excel
 */
export function exportPnlComparativToExcel(profitabilityData) {
    if (!profitabilityData) return

    const wb = XLSX.utils.book_new()
    const pnl = profitabilityData.pnl
    const config = profitabilityData.config || {}
    const storePnls = profitabilityData.pnl_by_store || []
    const rows = buildPnlRows(pnl, config)

    // Build column list: stores + total
    const columns = [
        ...storePnls.map(sp => ({ key: sp.store_uid, label: sp.store_name, data: sp })),
        {
            key: '_total', label: 'TOTAL', data: {
                ...pnl, income: { ...pnl?.income, sales_delivered: pnl?.income?.total_realized, delivered_count: pnl?.income?.delivered_count }
            }
        },
    ]

    // Header row
    const header = ['Indicator', ...columns.map(c => c.label)]
    const sheetData = [header]

    // Delivery stats
    const statRows = [
        { label: 'Expediate', getVal: (col) => (col.data?.shipped_count || ((col.data?.income?.delivered_count || 0) + (col.data?.status_breakdown?.in_transit?.count || 0))) },
        { label: 'Livrate', getVal: (col) => col.data?.income?.delivered_count || 0 },
        { label: 'Retur/Anulate', getVal: (col) => col.data?.income?.returns_cancelled_count || 0 },
        {
            label: 'Livrabilitate %', getVal: (col) => {
                const shipped = col.data?.shipped_count || ((col.data?.income?.delivered_count || 0) + (col.data?.status_breakdown?.in_transit?.count || 0))
                const delivered = col.data?.income?.delivered_count || 0
                return shipped > 0 ? Math.round((delivered / shipped) * 1000) / 10 : 0
            }
        },
    ]
    for (const sr of statRows) {
        sheetData.push([sr.label, ...columns.map(c => sr.getVal(c))])
    }
    sheetData.push([]) // spacer

    // P&L rows
    for (const row of rows) {
        if (row.type === 'spacer') {
            sheetData.push([])
            continue
        }

        if (row.isDynamic) {
            // Fixed cost row — show per-store values from business_costs_by_section
            const vals = columns.map(col => {
                const bizBySection = col.data?.business_costs_by_section || pnl?.business_costs_by_section || {}
                const fixedEntries = bizBySection.fixed || []
                const match = fixedEntries.find(e => `(-) ${e.label}` === row.label)
                return fmtNum(match?.cu_tva || 0)
            })
            sheetData.push([row.label, ...vals])
            continue
        }

        const label = row.label
        const vals = columns.map(col => {
            if (!row.path) return ''
            const val = getNestedVal(col.data, row.path)
            const cuTva = typeof val === 'number' ? val : (val?.cu_tva ?? 0)
            return fmtNum(cuTva)
        })

        // Add margin % for profit rows
        if (row.pctKey) {
            const pcts = columns.map(col => {
                const pct = col.data?.[row.pctKey]
                return pct !== undefined ? `${pct}%` : ''
            })
            sheetData.push([label, ...vals])
            sheetData.push([`  Marjă %`, ...pcts])
        } else {
            sheetData.push([label, ...vals])
        }
    }

    const ws = XLSX.utils.aoa_to_sheet(sheetData)

    // Auto-size columns
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    const colWidths = []
    for (let c = range.s.c; c <= range.e.c; c++) {
        let maxLen = 10
        for (let r = range.s.r; r <= range.e.r; r++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })]
            if (cell && cell.v) {
                maxLen = Math.max(maxLen, String(cell.v).length)
            }
        }
        colWidths.push({ wch: Math.min(maxLen + 2, 40) })
    }
    ws['!cols'] = colWidths

    XLSX.utils.book_append_sheet(wb, ws, 'P&L Comparativ')
    XLSX.writeFile(wb, `PnL_Comparativ_${new Date().toISOString().split('T')[0]}.xlsx`)
}
