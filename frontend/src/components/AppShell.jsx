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
    return (
        <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
                <header className="h-14 flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-end gap-2 px-4">
                    <SyncMenu />
                    <UserMenu user={user} onLogout={onLogout} />
                </header>
                <main className="flex-1 overflow-auto">
                    {children}
                </main>
            </div>
        </div>
    )
}
