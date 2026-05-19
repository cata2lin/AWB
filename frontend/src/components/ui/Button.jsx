import { Loader2 } from 'lucide-react'

/**
 * Button — single source of truth for action triggers.
 *
 * Variants are SEMANTIC, not hue-coded:
 *   primary   → main action, blue
 *   secondary → neutral surface
 *   success   → positive (rare; usually primary is enough)
 *   danger    → destructive
 *   warning   → caution
 *   ghost     → transparent, hover-only
 *   outline   → bordered, no fill
 *   link      → text-only, underline on hover
 */
const VARIANTS = {
    primary:
        'bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white border border-transparent shadow-sm',
    secondary:
        'bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300 text-zinc-900 border border-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:active:bg-zinc-500 dark:text-white dark:border-zinc-600',
    success:
        'bg-green-600 hover:bg-green-700 active:bg-green-800 text-white border border-transparent',
    danger:
        'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white border border-transparent',
    warning:
        'bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white border border-transparent',
    ghost:
        'bg-transparent hover:bg-zinc-100 active:bg-zinc-200 text-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700 border border-transparent',
    outline:
        'bg-white hover:bg-zinc-50 text-zinc-900 border border-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-white dark:border-zinc-600',
    link:
        'bg-transparent text-primary-700 dark:text-primary-300 hover:underline border border-transparent p-0',
}

const SIZES = {
    xs: 'px-2 py-1 text-xs gap-1 rounded-md',
    sm: 'px-3 py-1.5 text-sm gap-1.5 rounded-lg',
    md: 'px-4 py-2 text-sm gap-2 rounded-lg',
    lg: 'px-5 py-2.5 text-base gap-2 rounded-lg',
}

export default function Button({
    children,
    variant = 'primary',
    size = 'sm',
    loading = false,
    disabled = false,
    icon: Icon,
    iconRight: IconRight,
    type = 'button',
    onClick,
    className = '',
    fullWidth = false,
    ...rest
}) {
    const isDisabled = disabled || loading
    const variantClass = VARIANTS[variant] || VARIANTS.primary
    const sizeClass = variant === 'link' ? '' : (SIZES[size] || SIZES.sm)

    return (
        <button
            type={type}
            onClick={onClick}
            disabled={isDisabled}
            className={`inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-60 disabled:cursor-not-allowed ${variantClass} ${sizeClass} ${fullWidth ? 'w-full' : ''} ${className}`}
            {...rest}
        >
            {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : Icon && <Icon className="w-4 h-4" />
            }
            {children && <span>{children}</span>}
            {!loading && IconRight && <IconRight className="w-4 h-4" />}
        </button>
    )
}
