export default function DateInput({
    value,
    onChange,
    disabled = false,
    min,
    max,
    className = '',
    id,
    name,
    type = 'date',
    ariaLabel,
}) {
    return (
        <input
            id={id}
            name={name}
            type={type}
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.value, e)}
            min={min}
            max={max}
            disabled={disabled}
            aria-label={ariaLabel}
            className={`px-3 py-1.5 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-60 disabled:cursor-not-allowed dark:[color-scheme:dark] ${className}`}
        />
    )
}
