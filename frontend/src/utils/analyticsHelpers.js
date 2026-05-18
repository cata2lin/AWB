// Shared color and format helpers used across Analytics tabs.

// Deliverability / rate color thresholds (0-100%).
export const getRateColor = (rate) => {
    if (rate >= 80) return 'text-green-600 dark:text-green-400'
    if (rate >= 60) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
}

export const getRateBgColor = (rate) => {
    if (rate >= 80) return 'bg-green-500'
    if (rate >= 60) return 'bg-yellow-500'
    return 'bg-red-500'
}

// Locale-formatted integer (counts).
export const formatNumber = (num) => {
    if (num == null) return '0'
    return Number(num).toLocaleString('ro-RO')
}

// Locale-formatted currency: always 2 decimals.
export const formatMoney = (num) => {
    if (num == null) return '0.00'
    return Number(num).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// SKU profitability margin % color thresholds.
export const marginColor = (pct) => {
    if (pct < 10) return 'text-red-500 dark:text-red-400'
    if (pct < 25) return 'text-amber-500 dark:text-amber-400'
    return 'text-emerald-500 dark:text-emerald-400'
}

export const marginBg = (pct) => {
    if (pct < 10) return 'bg-red-500/10'
    if (pct < 25) return 'bg-amber-500/10'
    return 'bg-emerald-500/10'
}

// 'YYYY-MM' of the previous (last complete) month — default period for Deliverability tab.
export const getLastCompleteMonth = () => {
    const now = new Date()
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}`
}
