import { TrendingUp, TrendingDown } from 'lucide-react'

const THEMES = {
    primary: { card: 'border-primary-200 bg-primary-50/60 dark:border-primary-800 dark:bg-primary-950/40', text: 'text-primary-700 dark:text-primary-300' },
    blue: { card: 'border-blue-200 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-300' },
    green: { card: 'border-green-200 bg-green-50/60 dark:border-green-800 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-300' },
    violet: { card: 'border-violet-200 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/40', text: 'text-violet-700 dark:text-violet-300' },
    red: { card: 'border-red-200 bg-red-50/60 dark:border-red-800 dark:bg-red-950/40', text: 'text-red-600 dark:text-red-400' },
    amber: { card: 'border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300' },
    zinc: { card: 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800', text: 'text-zinc-900 dark:text-white' },
    // Legacy alias — old callers pass 'indigo'; map to primary so the look is consistent
    indigo: { card: 'border-primary-200 bg-primary-50/60 dark:border-primary-800 dark:bg-primary-950/40', text: 'text-primary-700 dark:text-primary-300' },
}

export default function KpiCard({
    label,
    value,
    color = 'blue',
    trend,
    trendLabel,
    icon: Icon,
    negative = false,
    className = '',
}) {
    const theme = THEMES[color] || THEMES.blue
    const isNeg = negative || (typeof value === 'number' && value < 0)
    const TrendIcon = typeof trend === 'number' ? (trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : null) : null
    const trendColor = typeof trend === 'number'
        ? (trend > 0 ? 'text-green-600 dark:text-green-400' : trend < 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400')
        : 'text-zinc-500 dark:text-zinc-400'

    return (
        <div className={`rounded-xl border p-4 transition-colors ${theme.card} ${className}`}>
            <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{label}</div>
                {Icon && <Icon className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />}
            </div>
            <div className={`text-xl font-bold ${isNeg ? 'text-red-600 dark:text-red-400' : theme.text}`}>{value}</div>
            {(trendLabel || TrendIcon) && (
                <div className={`flex items-center gap-1 mt-1.5 text-xs ${trendColor}`}>
                    {TrendIcon && <TrendIcon size={12} />}
                    {trendLabel && <span>{trendLabel}</span>}
                </div>
            )}
        </div>
    )
}
