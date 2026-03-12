import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X, Check, Search } from 'lucide-react'

/**
 * Multi-select dropdown filter component with search
 * 
 * @param {Object} props
 * @param {string} props.label - Label shown when closed
 * @param {Array} props.options - Array of {value, label} options
 * @param {Array} props.selected - Array of selected values
 * @param {Function} props.onChange - Callback when selection changes
 * @param {string} props.icon - Optional icon component
 * @param {boolean} props.searchable - Enable search input
 * @param {string} props.allLabel - Label for "All" state
 */
export default function MultiSelectFilter({
    label,
    options = [],
    selected = [],
    onChange,
    icon: Icon,
    searchable = false,
    allLabel = 'All'
}) {
    const [isOpen, setIsOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const dropdownRef = useRef(null)

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const filteredOptions = searchable && searchQuery
        ? options.filter(opt =>
            opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            opt.value.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : options

    const toggleOption = (value) => {
        if (selected.includes(value)) {
            onChange(selected.filter(v => v !== value))
        } else {
            onChange([...selected, value])
        }
    }

    const selectAll = () => {
        if (selected.length === options.length) {
            onChange([])
        } else {
            onChange(options.map(o => o.value))
        }
    }

    const clearAll = () => {
        onChange([])
        setSearchQuery('')
    }

    const getDisplayText = () => {
        if (selected.length === 0) return allLabel
        if (selected.length === 1) {
            const opt = options.find(o => o.value === selected[0])
            return opt?.label || selected[0]
        }
        return `${selected.length} selected`
    }

    return (
        <div ref={dropdownRef} className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-colors min-w-[140px] ${selected.length > 0
                        ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500 text-indigo-700 dark:text-indigo-300'
                        : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
                    }`}
            >
                {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                <span className="truncate text-sm font-medium">{getDisplayText()}</span>
                <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute z-50 mt-1 w-64 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg overflow-hidden">
                    {/* Header with actions */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={selectAll}
                                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                                {selected.length === options.length ? 'Deselect all' : 'Select all'}
                            </button>
                            {selected.length > 0 && (
                                <button
                                    onClick={clearAll}
                                    className="text-xs text-red-500 hover:underline"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Search input */}
                    {searchable && (
                        <div className="p-2 border-b border-zinc-100 dark:border-zinc-700">
                            <div className="relative">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-8 pr-3 py-1.5 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    onClick={(e) => e.stopPropagation()}
                                />
                            </div>
                        </div>
                    )}

                    {/* Options list */}
                    <div className="max-h-60 overflow-y-auto">
                        {filteredOptions.length === 0 ? (
                            <div className="px-3 py-4 text-sm text-zinc-500 text-center">
                                No options found
                            </div>
                        ) : (
                            filteredOptions.map((option) => {
                                const isSelected = selected.includes(option.value)
                                return (
                                    <button
                                        key={option.value}
                                        onClick={() => toggleOption(option.value)}
                                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-500/10' : ''
                                            }`}
                                    >
                                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isSelected
                                                ? 'bg-indigo-600 border-indigo-600'
                                                : 'border-zinc-300 dark:border-zinc-600'
                                            }`}>
                                            {isSelected && <Check className="w-3 h-3 text-white" />}
                                        </div>
                                        {option.color && (
                                            <div
                                                className="w-3 h-3 rounded-full flex-shrink-0"
                                                style={{ backgroundColor: option.color }}
                                            />
                                        )}
                                        <span className={`truncate ${isSelected ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-zinc-700 dark:text-zinc-300'}`}>
                                            {option.label}
                                        </span>
                                        {option.count !== undefined && (
                                            <span className="ml-auto text-xs text-zinc-400">
                                                ({option.count})
                                            </span>
                                        )}
                                    </button>
                                )
                            })
                        )}
                    </div>

                    {/* Selected count footer */}
                    {selected.length > 0 && (
                        <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                            <div className="flex items-center gap-1 flex-wrap">
                                {selected.slice(0, 3).map(val => {
                                    const opt = options.find(o => o.value === val)
                                    return (
                                        <span
                                            key={val}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 rounded text-xs"
                                        >
                                            {opt?.label?.slice(0, 15) || val}
                                            <button
                                                onClick={(e) => { e.stopPropagation(); toggleOption(val) }}
                                                className="hover:text-indigo-900"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </span>
                                    )
                                })}
                                {selected.length > 3 && (
                                    <span className="text-xs text-zinc-500">+{selected.length - 3} more</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
