import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'awb-column-prefs'

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

export function useColumnVisibility(tableId, columns, defaultKeys) {
    const allKeys = columns.filter((c) => c.key).map((c) => c.key)
    const initialDefaults = defaultKeys ?? allKeys

    const [visibleKeys, setVisibleKeys] = useState(() => {
        const stored = readAll()[tableId]
        if (Array.isArray(stored)) {
            const filtered = stored.filter((k) => allKeys.includes(k))
            const forced = columns.filter((c) => c.alwaysVisible && c.key).map((c) => c.key)
            return [...new Set([...forced, ...filtered])]
        }
        return initialDefaults
    })

    useEffect(() => {
        const all = readAll()
        all[tableId] = visibleKeys
        writeAll(all)
    }, [tableId, visibleKeys])

    const reset = useCallback(() => setVisibleKeys(initialDefaults), [initialDefaults])

    return { visibleKeys, setVisibleKeys, reset, defaultVisibleKeys: initialDefaults }
}

export default useColumnVisibility
