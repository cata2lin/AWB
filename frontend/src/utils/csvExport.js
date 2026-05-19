/**
 * Shared CSV export helper for every report table.
 *
 * Excel reads UTF-8 only when a BOM is present, and ro-RO content uses commas as
 * the decimal separator — so we quote every cell and use ; as field separator
 * for Excel-friendly imports. Callers can override `separator` to ',' if needed.
 */

const escapeCell = (value) => {
    if (value === null || value === undefined) return ''
    const str = typeof value === 'string' ? value : String(value)
    return `"${str.replace(/"/g, '""')}"`
}

const toFilename = (base) => {
    const stamp = new Date().toISOString().slice(0, 10)
    return `${base.replace(/[^a-z0-9_-]+/gi, '_')}_${stamp}.csv`
}

/**
 * Build and download a CSV file.
 *
 * @param {object} opts
 * @param {string} opts.filename       Base name (date suffix + .csv appended).
 * @param {Array<{key:string,label:string,format?:Function}>} opts.columns
 * @param {Array<object>} opts.rows    Source rows (objects keyed by column.key).
 * @param {string} [opts.separator]    Field separator. Defaults to ';' (Excel-friendly for ro-RO).
 */
export function exportCsv({ filename, columns, rows, separator = ';' }) {
    if (!Array.isArray(columns) || columns.length === 0) return
    if (!Array.isArray(rows)) rows = []

    const header = columns.map((c) => escapeCell(c.label ?? c.key)).join(separator)
    const body = rows.map((row) =>
        columns
            .map((col) => {
                const raw = col.accessor ? col.accessor(row) : row?.[col.key]
                const out = col.format ? col.format(raw, row) : raw
                return escapeCell(out)
            })
            .join(separator),
    )

    const csv = [header, ...body].join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = toFilename(filename)
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
}

export default exportCsv
