import { cloneElement, isValidElement } from 'react'

const baseInputClass = 'w-full px-3 py-2 rounded-lg text-sm border bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 disabled:opacity-60 disabled:cursor-not-allowed'

export function FormField({
    label,
    htmlFor,
    error,
    hint,
    required = false,
    className = '',
    children,
}) {
    const id = htmlFor || (isValidElement(children) ? children.props.id : undefined)
    const describedById = error ? `${id}-error` : hint ? `${id}-hint` : undefined

    const enhancedChild = isValidElement(children)
        ? cloneElement(children, {
            id,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': describedById,
        })
        : children

    return (
        <div className={`flex flex-col gap-1 ${className}`}>
            {label && (
                <label htmlFor={id} className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {label}
                    {required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
            )}
            {enhancedChild}
            {error
                ? <span id={`${id}-error`} className="text-xs text-red-600 dark:text-red-400">{error}</span>
                : hint && <span id={`${id}-hint`} className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
            }
        </div>
    )
}

export function TextInput({
    value,
    onChange,
    error,
    type = 'text',
    placeholder,
    disabled = false,
    className = '',
    id,
    name,
    autoFocus = false,
    autoComplete,
    min,
    max,
    step,
    ...rest
}) {
    const borderClass = error
        ? 'border-red-400 dark:border-red-500 focus:ring-red-500/40'
        : 'border-zinc-200 dark:border-zinc-700 focus:ring-blue-500/40'

    return (
        <input
            id={id}
            name={name}
            type={type}
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.value, e)}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            autoComplete={autoComplete}
            min={min}
            max={max}
            step={step}
            className={`${baseInputClass} ${borderClass} ${className}`}
            {...rest}
        />
    )
}

export function TextArea({
    value,
    onChange,
    error,
    rows = 3,
    placeholder,
    disabled = false,
    className = '',
    id,
    name,
    ...rest
}) {
    const borderClass = error
        ? 'border-red-400 dark:border-red-500 focus:ring-red-500/40'
        : 'border-zinc-200 dark:border-zinc-700 focus:ring-blue-500/40'

    return (
        <textarea
            id={id}
            name={name}
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.value, e)}
            rows={rows}
            placeholder={placeholder}
            disabled={disabled}
            className={`${baseInputClass} ${borderClass} resize-y ${className}`}
            {...rest}
        />
    )
}

export default FormField
