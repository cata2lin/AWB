const TONES = {
    green: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
    primary: 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
    gray: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700/40 dark:text-zinc-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
    // Legacy alias — kept so older callers passing tone="indigo" still render
    indigo: 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300',
}

const STATUS_MAP = {
    delivered: { tone: 'green', label: 'Livrată' },
    in_transit: { tone: 'blue', label: 'În tranzit' },
    out_for_delivery: { tone: 'blue', label: 'În livrare' },
    shipped: { tone: 'blue', label: 'Expediată' },
    returned: { tone: 'orange', label: 'Returnată' },
    back_to_sender: { tone: 'orange', label: 'Retur expeditor' },
    refused: { tone: 'orange', label: 'Refuzată' },
    cancelled: { tone: 'red', label: 'Anulată' },
    failed: { tone: 'red', label: 'Eșuată' },
    pending: { tone: 'amber', label: 'În așteptare' },
    on_hold: { tone: 'amber', label: 'Reținută' },
    processing: { tone: 'primary', label: 'În procesare' },
    completed: { tone: 'green', label: 'Finalizată' },
    success: { tone: 'green', label: 'Succes' },
    error: { tone: 'red', label: 'Eroare' },
    warning: { tone: 'amber', label: 'Atenție' },
    info: { tone: 'blue', label: 'Info' },
}

export default function StatusBadge({
    status,
    tone,
    children,
    icon: Icon,
    size = 'sm',
    uppercase = false,
    className = '',
}) {
    const entry = status ? STATUS_MAP[String(status).toLowerCase()] : null
    const effectiveTone = tone || entry?.tone || 'gray'
    const label = children ?? entry?.label ?? (status ?? '')
    const toneClass = TONES[effectiveTone] || TONES.gray
    const sizeClass = size === 'xs'
        ? 'px-1.5 py-0.5 text-[10px]'
        : size === 'md'
        ? 'px-2.5 py-1 text-sm'
        : 'px-2 py-0.5 text-xs'

    return (
        <span className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClass} ${toneClass} ${uppercase ? 'uppercase tracking-wider' : ''} ${className}`}>
            {Icon && <Icon className="w-3 h-3" />}
            {label}
        </span>
    )
}
