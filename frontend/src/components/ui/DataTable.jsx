import { Fragment } from 'react'
import { ArrowUp, ArrowDown, ArrowUpDown, Loader2 } from 'lucide-react'
import EmptyState from './EmptyState'

function HeaderCell({ col, sort, onSort, padding }) {
    const isActive = sort?.key === col.key
    const sortable = col.sortable && col.key
    const dir = isActive ? sort.direction : null
    const align = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'

    const onClick = () => {
        if (!sortable || !onSort) return
        if (!isActive) onSort({ key: col.key, direction: 'asc' })
        else if (dir === 'asc') onSort({ key: col.key, direction: 'desc' })
        else onSort({ key: null, direction: null })
    }

    return (
        <th
            scope="col"
            className={`${align} ${padding || 'px-3 py-2'} text-xs font-medium text-zinc-500 dark:text-zinc-300 uppercase tracking-wider ${sortable ? 'cursor-pointer select-none hover:text-zinc-700 dark:hover:text-white' : ''}`}
            onClick={sortable ? onClick : undefined}
            style={col.width ? { width: col.width } : undefined}
        >
            <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                <span>{col.header}</span>
                {sortable && (
                    dir === 'asc' ? <ArrowUp className="w-3 h-3" />
                        : dir === 'desc' ? <ArrowDown className="w-3 h-3" />
                            : <ArrowUpDown className="w-3 h-3 opacity-40" />
                )}
            </span>
        </th>
    )
}

export default function DataTable({
    columns: rawColumns = [],
    rows = [],
    rowKey = 'id',
    loading = false,
    error = null,
    empty,
    sort,
    onSort,
    onRowClick,
    expandedKey = null,
    renderExpanded,
    rowClassName,
    maxHeight = '70vh',
    stickyHeader = true,
    className = '',
    footer,
    striped = false,
    visibleColumnKeys,
    density = 'comfortable',
}) {
    const columns = visibleColumnKeys
        ? rawColumns.filter((c) => c.alwaysVisible || visibleColumnKeys.includes(c.key))
        : rawColumns.filter((c) => !c.hidden)
    const getKey = (row, idx) =>
        typeof rowKey === 'function' ? rowKey(row, idx) : row?.[rowKey] ?? idx
    const colSpan = columns.length
    const cellPadding = density === 'compact' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
    const headerPadding = density === 'compact' ? 'px-2 py-1.5' : 'px-3 py-2'

    const body = () => {
        if (loading) {
            return (
                <tr>
                    <td colSpan={colSpan} className="px-3 py-8 text-center text-zinc-500 dark:text-zinc-400">
                        <span className="inline-flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Se încarcă...
                        </span>
                    </td>
                </tr>
            )
        }
        if (error) {
            return (
                <tr>
                    <td colSpan={colSpan} className="px-3 py-8 text-center text-red-600 dark:text-red-400 text-sm">
                        {typeof error === 'string' ? error : (error?.message ?? 'A apărut o eroare')}
                    </td>
                </tr>
            )
        }
        if (!rows || rows.length === 0) {
            return (
                <tr>
                    <td colSpan={colSpan} className="p-0">
                        {empty ?? <EmptyState compact />}
                    </td>
                </tr>
            )
        }
        return rows.map((row, idx) => {
            const key = getKey(row, idx)
            const isExpanded = expandedKey != null && expandedKey === key
            const trClass = [
                'transition-colors',
                onRowClick ? 'cursor-pointer' : '',
                'hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
                striped && idx % 2 === 1 ? 'bg-zinc-50/40 dark:bg-zinc-900/30' : '',
                typeof rowClassName === 'function' ? rowClassName(row, idx) : rowClassName || '',
            ].filter(Boolean).join(' ')

            return (
                <Fragment key={key}>
                    <tr className={trClass} onClick={onRowClick ? () => onRowClick(row, idx) : undefined}>
                        {columns.map((col) => {
                            const align = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                            const content = col.render
                                ? col.render(row, idx)
                                : col.accessor
                                    ? col.accessor(row)
                                    : col.key ? row[col.key] : null
                            return (
                                <td
                                    key={col.key ?? col.header}
                                    className={`${align} ${cellPadding} text-zinc-900 dark:text-zinc-100 ${col.cellClassName || ''}`}
                                >
                                    {content}
                                </td>
                            )
                        })}
                    </tr>
                    {isExpanded && renderExpanded && (
                        <tr className="bg-zinc-50 dark:bg-zinc-900/50">
                            <td colSpan={colSpan} className="px-4 py-3">
                                {renderExpanded(row, idx)}
                            </td>
                        </tr>
                    )}
                </Fragment>
            )
        })
    }

    const headerBg = stickyHeader
        ? 'sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900'
        : 'bg-zinc-50 dark:bg-zinc-900'

    return (
        <div className={`overflow-clip rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 ${className}`}>
            <div className="overflow-auto" style={{ maxHeight }}>
                <table className="w-full">
                    <thead className={headerBg}>
                        <tr>
                            {columns.map((col) => (
                                <HeaderCell key={col.key ?? col.header} col={col} sort={sort} onSort={onSort} padding={headerPadding} />
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                        {body()}
                    </tbody>
                </table>
            </div>
            {footer && (
                <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30">
                    {footer}
                </div>
            )}
        </div>
    )
}

export function PaginationFooter({
    page,
    pageSize,
    total,
    onPageChange,
    loading = false,
}) {
    const start = total === 0 ? 0 : page * pageSize + 1
    const end = Math.min((page + 1) * pageSize, total)
    const lastPage = total > 0 ? Math.ceil(total / pageSize) - 1 : 0
    const canPrev = page > 0 && !loading
    const canNext = page < lastPage && !loading

    return (
        <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-300">
            <div>
                Afișare <span className="font-semibold text-zinc-900 dark:text-white">{start}–{end}</span> din <span className="font-semibold text-zinc-900 dark:text-white">{total}</span>
            </div>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => canPrev && onPageChange(page - 1)}
                    disabled={!canPrev}
                    className="px-3 py-1 rounded-md bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Înapoi
                </button>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    Pagina {total === 0 ? 0 : page + 1} / {Math.max(1, lastPage + 1)}
                </span>
                <button
                    type="button"
                    onClick={() => canNext && onPageChange(page + 1)}
                    disabled={!canNext}
                    className="px-3 py-1 rounded-md bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Înainte
                </button>
            </div>
        </div>
    )
}
