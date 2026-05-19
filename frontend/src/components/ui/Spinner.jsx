import { Loader2 } from 'lucide-react'

const SIZE = {
    xs: 'w-3 h-3',
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-8 h-8',
    xl: 'w-12 h-12',
}

/**
 * Single canonical loading spinner. Always lucide Loader2 + animate-spin.
 * Replaces the mix of <RefreshCw className="animate-spin">, raw div spinners
 * with border tricks, and inline Loader2 across the codebase.
 */
export default function Spinner({ size = 'md', className = '', label }) {
    if (label) {
        return (
            <span className={`inline-flex items-center gap-2 ${className}`}>
                <Loader2 className={`${SIZE[size] || SIZE.md} animate-spin`} />
                <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
            </span>
        )
    }
    return <Loader2 className={`${SIZE[size] || SIZE.md} animate-spin ${className}`} />
}
