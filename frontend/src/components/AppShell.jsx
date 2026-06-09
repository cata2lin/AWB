import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import SyncMenu from './SyncMenu'
import UserMenu from './UserMenu'

/**
 * AppShell — root layout for authenticated routes.
 *
 * Composition:
 *   ┌────────────────────────────────────────────────────────┐
 *   │ Sidebar │  Topbar (SyncMenu · UserMenu)                │
 *   │  (col)  ├──────────────────────────────────────────────┤
 *   │         │  <Routes /> page content (scrollable)         │
 *   └────────────────────────────────────────────────────────┘
 *
 * The sidebar persists its own collapsed state via useAppStore. The topbar is
 * h-14, sticky-by-virtue-of-flex (the content region is the only scroll
 * container).
 */
export default function AppShell({ user, onLogout, children }) {
    // Mobile off-canvas drawer state. On md+ the sidebar is always inline (CSS).
    const [mobileOpen, setMobileOpen] = useState(false)
    const location = useLocation()

    // Close the drawer whenever the route changes (navigated from within it).
    // This is the external-system sync (URL -> drawer state) the rule's docs allow.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMobileOpen(false)
    }, [location.pathname])

    return (
        <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950">
            {/* Backdrop (mobile only) */}
            {mobileOpen && (
                <button
                    aria-label="Închide meniul"
                    onClick={() => setMobileOpen(false)}
                    className="fixed inset-0 z-30 bg-black/50 md:hidden"
                />
            )}
            <Sidebar mobileOpen={mobileOpen} />
            <div className="flex-1 flex flex-col min-w-0">
                <header className="h-14 flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between gap-2 px-4">
                    <button
                        aria-label="Deschide meniul"
                        onClick={() => setMobileOpen(true)}
                        className="md:hidden p-2 -ml-2 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                        <Menu className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-2 ml-auto">
                        <SyncMenu />
                        <UserMenu user={user} onLogout={onLogout} />
                    </div>
                </header>
                <main className="flex-1 overflow-auto">
                    {children}
                </main>
            </div>
        </div>
    )
}
