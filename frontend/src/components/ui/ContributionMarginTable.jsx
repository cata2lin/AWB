/**
 * ContributionMarginTable — extracted from `ContributionMarginPnl.jsx`.
 *
 * Renders a P&L-style table where rows come typed: `header`, `consolidated`,
 * `subsidiary`, `section`, `subtotal`, `total`, `percent`, `normal`, `indent`,
 * `spacer`, `divider`. Each type has a distinct visual treatment matching the
 * Profitabilitate gold-standard look.
 *
 * Input:
 *   columnHeaders: [string, ...]  rendered above the data rows
 *   rows:          [{ type, label, values?, icon?, onClick? }, ...]
 *   stickyHeader:  bool (default true)
 *
 * Number formatting: the caller is expected to pre-format string values; for
 * convenience numeric values pass through ro-RO Intl.NumberFormat (rounded
 * to integer for currency, rendered as `X%` for type=percent).
 */

const fmt = (v) => {
    if (v === null || v === undefined || v === '') return ''
    const num = typeof v === 'string' ? parseFloat(v) : v
    if (Number.isNaN(num)) return ''
    return new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(Math.round(num))
}
const fmtPct = (v) => {
    if (v === null || v === undefined || v === '') return ''
    const num = typeof v === 'number' ? v : parseFloat(v)
    if (Number.isNaN(num)) return ''
    return `${Math.round(num)}%`
}

function CMRow({ row, colCount }) {
    const { type, label, values, onClick, icon } = row
    const cols = colCount || 4

    if (type === 'spacer') return <tr className="h-3"><td colSpan={cols + 1}></td></tr>
    if (type === 'divider')
        return (
            <tr>
                <td
                    colSpan={cols + 1}
                    className="h-2 bg-gradient-to-r from-zinc-200 via-zinc-100 to-zinc-200 dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-700"
                />
            </tr>
        )

    if (type === 'header' || type === 'consolidated') {
        const fontCls = type === 'consolidated' ? 'font-extrabold tracking-wide py-2.5' : 'font-bold py-2'
        return (
            <tr
                style={{ backgroundColor: 'oklch(0.59 0.14 271.02)' }}
                className={onClick ? 'cursor-pointer' : ''}
                onClick={onClick}
            >
                <td colSpan={cols + 1} className={`text-white ${fontCls} px-3 text-sm`}>
                    <span className="flex items-center gap-1.5">
                        {icon}
                        {label}
                    </span>
                </td>
            </tr>
        )
    }

    if (type === 'subsidiary') {
        return (
            <tr className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
                <td colSpan={cols + 1} className="py-2 px-3">
                    <span className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-200 dark:bg-amber-700/50 text-amber-800 dark:text-amber-300">
                            Filială
                        </span>
                        <span className="font-bold text-sm text-amber-900 dark:text-amber-200">{label}</span>
                    </span>
                </td>
            </tr>
        )
    }

    if (type === 'section') {
        return (
            <tr className="bg-blue-50 dark:bg-blue-900/30">
                <td
                    colSpan={cols + 1}
                    className="text-blue-800 dark:text-blue-300 font-bold py-2 px-3 text-[13px] border-b border-blue-100 dark:border-blue-800"
                >
                    {label}
                </td>
            </tr>
        )
    }

    const isNeg = (v) => typeof v === 'number' && v < 0
    const fmtVal = type === 'percent' ? fmtPct : fmt

    const rowStyles = {
        subtotal:
            'font-bold text-blue-700 dark:text-blue-300 border-t border-blue-200 dark:border-blue-700 border-b-2 border-b-blue-200 dark:border-b-blue-700',
        total:
            'font-extrabold text-blue-800 dark:text-blue-200 border-t-2 border-t-blue-600 dark:border-t-blue-500 border-b-2 border-b-blue-600 dark:border-b-blue-500 text-sm',
        percent: 'italic text-blue-600 dark:text-blue-400 font-semibold text-xs',
        indent: '',
        normal: '',
    }
    const cls = rowStyles[type] || ''
    const pad =
        type === 'indent'
            ? 'pl-6'
            : type === 'subtotal' || type === 'total'
                ? 'pl-3 py-[7px]'
                : type === 'percent'
                    ? 'pl-3 py-[3px]'
                    : 'pl-3'

    return (
        <tr
            className={`hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors ${type === 'subtotal' || type === 'total' ? '' : 'border-b border-zinc-100 dark:border-zinc-800'
                }`}
        >
            <td
                className={`${pad} py-[5px] text-[13px] whitespace-nowrap min-w-[260px] text-zinc-700 dark:text-zinc-100 ${cls}`}
            >
                {label}
            </td>
            {(values || []).map((v, i) => (
                <td
                    key={i}
                    className={`px-3 py-[5px] text-[13px] text-right whitespace-nowrap text-zinc-700 dark:text-zinc-100 ${cls} ${isNeg(v) && type !== 'percent' ? 'text-red-600 dark:text-red-400' : ''
                        }`}
                >
                    {typeof v === 'string' ? v : fmtVal(v)}
                </td>
            ))}
        </tr>
    )
}

export default function ContributionMarginTable({
    columnHeaders = [],
    rows = [],
    stickyHeader = true,
    className = '',
    rowLabel = '',
}) {
    const colCount = columnHeaders.length

    return (
        <div className={`overflow-auto bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 ${className}`}>
            <table className="w-full text-sm">
                <thead className={`${stickyHeader ? 'sticky top-0 z-10' : ''} bg-zinc-50 dark:bg-zinc-900`}>
                    <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-300 uppercase tracking-wider min-w-[260px]">
                            {rowLabel}
                        </th>
                        {columnHeaders.map((h, i) => (
                            <th
                                key={i}
                                className="text-right px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-300 uppercase tracking-wider whitespace-nowrap"
                            >
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <CMRow key={row.key ?? `${row.type}-${i}`} row={row} colCount={colCount} />
                    ))}
                </tbody>
            </table>
        </div>
    )
}
