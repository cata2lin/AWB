import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, ListOrdered, Settings, History, Layers, Sun, Moon, RefreshCw, BarChart3 } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/orders', icon: ListOrdered, label: 'Orders' },
    { path: '/rules', icon: Layers, label: 'Rules' },
    { path: '/analytics', icon: BarChart3, label: 'Analytics' },
    { path: '/history', icon: History, label: 'History' },
    { path: '/settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar() {
    const location = useLocation()
    const { darkMode, toggleDarkMode, isSyncing, syncOrders, fullSyncOrders, lastSyncAt } = useAppStore()

    return (
        <aside className="w-64 h-screen bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
            {/* Logo */}
            <div className="h-16 flex items-center px-6 border-b border-zinc-200/80 dark:border-zinc-800/60">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-indigo-500/25">
                    AW
                </div>
                <span className="ml-3 font-semibold text-zinc-900 dark:text-white tracking-tight">AWB Print</span>
            </div>

            {/* Navigation */}
            <nav className="flex-1 py-4 px-3 space-y-1">
                {navItems.map((item) => {
                    const isActive = location.pathname === item.path
                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${isActive
                                ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shadow-sm dark:shadow-none border-l-[3px] border-indigo-500 pl-[9px]'
                                : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-200'
                                }`}
                        >
                            <item.icon className={`w-5 h-5 ${isActive ? 'text-indigo-500' : ''}`} />
                            {item.label}
                        </Link>
                    )
                })}
            </nav>

            {/* Sync & Theme */}
            <div className="p-4 border-t border-zinc-200/80 dark:border-zinc-800/60 space-y-3">
                <button
                    onClick={syncOrders}
                    disabled={isSyncing}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-indigo-500/20 glow-btn"
                >
                    <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                    {isSyncing ? 'Syncing...' : 'Sync Orders (45 zile)'}
                </button>
                <button
                    onClick={fullSyncOrders}
                    disabled={isSyncing}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-all shadow-lg shadow-amber-500/20"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    {isSyncing ? 'Syncing...' : 'Full Re-Sync (toate)'}
                </button>
                {lastSyncAt && (
                    <p className="text-xs text-zinc-400 text-center">
                        Last sync: {new Date(lastSyncAt).toLocaleTimeString()}
                    </p>
                )}
                <button
                    onClick={toggleDarkMode}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800/60 hover:bg-zinc-200 dark:hover:bg-zinc-700/60 text-zinc-600 dark:text-zinc-300 rounded-lg text-sm font-medium transition-all"
                >
                    {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    {darkMode ? 'Light Mode' : 'Dark Mode'}
                </button>
            </div>
        </aside>
    )
}
