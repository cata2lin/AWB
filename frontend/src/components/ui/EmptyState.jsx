import { Inbox } from 'lucide-react'

export default function EmptyState({
    icon,
    title = 'Nimic de afișat',
    description,
    action,
    className = '',
    compact = false,
}) {
    const IconComp = icon || Inbox
    return (
        <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8 px-4' : 'py-16 px-6'} ${className}`}>
            <div className={`rounded-full bg-zinc-100 dark:bg-zinc-800 ${compact ? 'p-2.5 mb-3' : 'p-4 mb-4'} text-zinc-500 dark:text-zinc-400`}>
                <IconComp className={compact ? 'w-5 h-5' : 'w-7 h-7'} />
            </div>
            <div className={`font-semibold text-zinc-900 dark:text-white ${compact ? 'text-sm' : 'text-base'}`}>{title}</div>
            {description && (
                <div className={`mt-1 text-zinc-500 dark:text-zinc-400 max-w-md ${compact ? 'text-xs' : 'text-sm'}`}>{description}</div>
            )}
            {action && <div className="mt-4">{action}</div>}
        </div>
    )
}
