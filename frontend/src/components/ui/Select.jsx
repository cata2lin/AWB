export default function Select({
    value,
    onChange,
    options = [],
    placeholder,
    disabled = false,
    className = '',
    id,
    name,
    ariaLabel,
    children,
}) {
    return (
        <select
            id={id}
            name={name}
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.value, e)}
            disabled={disabled}
            aria-label={ariaLabel}
            className={`px-3 py-1.5 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
        >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {children}
            {options.map((opt) =>
                typeof opt === 'string'
                    ? <option key={opt} value={opt}>{opt}</option>
                    : <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
            )}
        </select>
    )
}
