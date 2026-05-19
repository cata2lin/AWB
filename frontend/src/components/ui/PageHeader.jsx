export function PageContainer({ children, className = '' }) {
    return (
        <div className={`mx-auto w-full max-w-[1600px] px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5 ${className}`}>
            {children}
        </div>
    )
}

export function PageHeader({
    title,
    subtitle,
    icon: Icon,
    actions,
    className = '',
}) {
    return (
        <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
            <div className="flex items-center gap-2.5 min-w-0">
                {Icon && (
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-500/15 p-1.5 text-blue-600 dark:text-blue-300 flex-shrink-0">
                        <Icon className="w-5 h-5" />
                    </div>
                )}
                <div className="min-w-0">
                    <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-white truncate">{title}</h1>
                    {subtitle && (
                        <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{subtitle}</p>
                    )}
                </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    )
}

export function Section({
    title,
    icon: Icon,
    actions,
    children,
    className = '',
    contentClassName = '',
    padded = true,
}) {
    return (
        <section className={`bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-clip ${className}`}>
            {(title || actions) && (
                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2 text-sm sm:text-base">
                        {Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400" />}
                        <span className="truncate">{title}</span>
                    </h3>
                    {actions && <div className="flex items-center gap-2">{actions}</div>}
                </div>
            )}
            <div className={`${padded ? 'p-4' : ''} ${contentClassName}`}>
                {children}
            </div>
        </section>
    )
}

export default PageHeader
