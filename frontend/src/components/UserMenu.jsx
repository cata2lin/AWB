import { useEffect, useRef, useState } from 'react'
import { LogOut, Sun, Moon, ChevronDown } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

/**
 * UserMenu — topbar dropdown with profile, theme toggle, and logout.
 * Replaces the user/theme footer that used to live in the sidebar.
 */
export default function UserMenu({ user, onLogout }) {
    const darkMode = useAppStore((s) => s.darkMode)
    const toggleDarkMode = useAppStore((s) => s.toggleDarkMode)
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    useEffect(() => {
        if (!open) return
        const onClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    const initial = (user?.display_name || user?.username || '?')[0].toUpperCase()
    const name = user?.display_name || user?.username || 'Utilizator'
    const role = user?.role || ''

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 pl-1.5 pr-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            >
                <span className="w-7 h-7 rounded-md bg-primary-600 flex items-center justify-center text-white text-xs font-bold">
                    {initial}
                </span>
                <span className="hidden sm:flex flex-col leading-tight min-w-0 max-w-[120px]">
                    <span className="text-sm font-medium text-zinc-900 dark:text-white truncate">{name}</span>
                    {role && <span className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{role}</span>}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            </button>

            {open && (
                <div className="absolute right-0 mt-1 w-56 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-xl z-30 overflow-hidden animate-fade-in">
                    <div className="px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-700">
                        <div className="text-sm font-medium text-zinc-900 dark:text-white truncate">{name}</div>
                        {role && <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{role}</div>}
                    </div>
                    <div className="py-1">
                        <button
                            type="button"
                            onClick={() => { toggleDarkMode(); setOpen(false) }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700/50 flex items-center gap-3 text-zinc-700 dark:text-zinc-200 transition-colors"
                        >
                            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                            {darkMode ? 'Tema luminoasă' : 'Tema întunecată'}
                        </button>
                        <button
                            type="button"
                            onClick={() => { setOpen(false); onLogout?.() }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-3 text-danger-fg transition-colors"
                        >
                            <LogOut className="w-4 h-4" />
                            Deconectare
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
