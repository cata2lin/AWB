import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'awb-table-density'

function readAll() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return raw ? JSON.parse(raw) : {}
    } catch {
        return {}
    }
}

function writeAll(value) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
        /* quota or disabled storage — ignore */
    }
}

/**
 * Persist per-table density preference. Used by DataTable instances that show
 * a `<DensityToggle>` next to their `<ColumnsMenu>`.
 *
 * @param {string} tableId - stable identifier for this table (matches the one passed to useColumnVisibility).
 * @param {'comfortable'|'compact'} fallback - initial density when nothing is stored.
 */
export function useTableDensity(tableId, fallback = 'comfortable') {
    const [density, setDensity] = useState(() => {
        const stored = readAll()[tableId]
        return stored === 'comfortable' || stored === 'compact' ? stored : fallback
    })

    useEffect(() => {
        const all = readAll()
        all[tableId] = density
        writeAll(all)
    }, [tableId, density])

    const toggle = useCallback(() => {
        setDensity((d) => (d === 'comfortable' ? 'compact' : 'comfortable'))
    }, [])

    return { density, setDensity, toggle }
}

export default useTableDensity
