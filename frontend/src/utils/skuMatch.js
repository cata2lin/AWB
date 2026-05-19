/**
 * SKU pattern matching for include/exclude lists.
 *
 * Each pattern is matched against an SKU as follows:
 *   - If the pattern contains `*`, it is treated as a glob (`*` = any chars,
 *     other regex chars are escaped). Must match the full SKU.
 *   - Otherwise it is treated as a case-insensitive PREFIX. So `ha-` matches
 *     any SKU starting with `ha-`. The exact SKU is always its own prefix.
 *
 * Empty / blank patterns are ignored.
 */
export function skuMatches(sku, patterns) {
    if (!sku || !Array.isArray(patterns) || patterns.length === 0) return false
    const s = String(sku).toLowerCase()
    for (const raw of patterns) {
        if (!raw) continue
        const p = String(raw).trim().toLowerCase()
        if (!p) continue
        if (p.includes('*')) {
            const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
            try {
                if (new RegExp('^' + escaped + '$').test(s)) return true
            } catch {
                // Malformed pattern — fall through to prefix attempt below.
                if (s.startsWith(p.replace(/\*/g, ''))) return true
            }
        } else if (s.startsWith(p)) {
            return true
        }
    }
    return false
}

/** Test whether at least one pattern in the list matches sku. */
export const skuInList = skuMatches
