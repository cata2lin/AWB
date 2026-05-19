/**
 * Numeric input. Inherits styling from FormField conventions; meant to live
 * inside a <FormField label="...">.
 *
 * Differences from raw <input type=number>:
 *  - Strips invalid characters so paste of "1,234.50" becomes 1234.5
 *  - Calls onChange with a *number* (or null when empty), not a string
 *  - Forwards step / min / max / precision props
 *  - Inline error styling via `error` prop
 */
import { forwardRef } from 'react'

const NumberInput = forwardRef(function NumberInput(
    { value, onChange, placeholder, min, max, step = 'any', precision, error, disabled, className = '', id, autoFocus, ...rest },
    ref,
) {
    const displayValue =
        value === null || value === undefined || value === ''
            ? ''
            : precision != null && typeof value === 'number'
                ? value.toFixed(precision)
                : String(value)

    const handleChange = (e) => {
        const raw = e.target.value.replace(',', '.').trim()
        if (raw === '' || raw === '-') {
            onChange?.(null)
            return
        }
        const n = parseFloat(raw)
        if (Number.isNaN(n)) return
        if (min != null && n < min) return
        if (max != null && n > max) return
        onChange?.(n)
    }

    const base =
        'w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 transition-colors'
    const borderClass = error
        ? 'border-danger/60 focus:ring-danger/30'
        : 'border-zinc-200 dark:border-zinc-700 focus:ring-primary-500/40 focus:border-primary-500'

    return (
        <input
            ref={ref}
            id={id}
            type="number"
            inputMode="decimal"
            value={displayValue}
            onChange={handleChange}
            placeholder={placeholder}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            autoFocus={autoFocus}
            aria-invalid={!!error}
            className={`${base} ${borderClass} disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
            {...rest}
        />
    )
})

export default NumberInput
