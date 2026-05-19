import { useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

export default function SearchInput({
    value,
    onChange,
    placeholder = 'Caută...',
    debounce = 0,
    onDebouncedChange,
    onEnter,
    className = '',
    autoFocus = false,
    disabled = false,
    size = 'sm',
}) {
    const isControlled = value !== undefined
    const [internal, setInternal] = useState(value ?? '')
    const [lastProp, setLastProp] = useState(value)
    const timer = useRef(null)

    // Sync internal state when controlled `value` prop changes — done at render
    // time (not in useEffect) to avoid the cascading-renders lint rule.
    if (isControlled && value !== lastProp) {
        setLastProp(value)
        setInternal(value ?? '')
    }
    const local = isControlled ? (value ?? '') : internal
    const setLocal = setInternal

    const handleChange = (e) => {
        const next = e.target.value
        setLocal(next)
        onChange?.(next)
        if (debounce > 0 && onDebouncedChange) {
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => onDebouncedChange(next), debounce)
        } else {
            onDebouncedChange?.(next)
        }
    }

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            if (timer.current) clearTimeout(timer.current)
            onDebouncedChange?.(local)
            onEnter?.(local)
        }
    }

    const handleClear = () => {
        if (timer.current) clearTimeout(timer.current)
        setLocal('')
        onChange?.('')
        onDebouncedChange?.('')
    }

    const sizeClass = size === 'md'
        ? 'pl-10 pr-9 py-2.5 text-sm'
        : 'pl-9 pr-8 py-2 text-sm'

    return (
        <div className={`relative ${className}`}>
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${size === 'md' ? 'w-4 h-4' : 'w-4 h-4'} text-zinc-400 pointer-events-none`} />
            <input
                type="text"
                value={local}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                autoFocus={autoFocus}
                disabled={disabled}
                className={`w-full ${sizeClass} rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-60`}
            />
            {local && (
                <button
                    type="button"
                    onClick={handleClear}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                    aria-label="Șterge"
                >
                    <X className="w-4 h-4" />
                </button>
            )}
        </div>
    )
}
