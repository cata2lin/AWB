import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'  
import {
    LayoutDashboard, ListOrdered, Settings, History, Layers,
    BarChart3, Activity, Copy, FileText,
    Printer, ChevronDown, ChevronRight, Package, Percent, ShoppingCart,
    PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import Tooltip from './ui/Tooltip'

/**
 * Sidebar — navigation only. Sync controls + user/theme moved to the topbar
 * (SyncMenu, UserMenu). Supports an expanded (224px) and collapsed (60px,
 * icons only with hover tooltips) state, persisted via useAppStore.
 */

const NAV = [
    {
        type: 'group', key: 'print', icon: Printer, label: 'Print',
        children: [
            { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
            { path: '/rules', icon: Layers, label: 'Reguli' },
            { path: '/history', icon: History, label: 'Istoric' },
        ],
    },
    {
        type: 'group', key: 'orders', icon: ShoppingCart, label: 'Comenzi',
        children: [
            { path: '/orders', icon: ListOrdered, label: 'Toate comenzile' },
            { path: '/duplicates', icon: Copy, label: 'Duplicate' },
        ],
    },
    { type: 'divider' },
    { type: 'link', path: '/analytics', icon: BarChart3, label: 'Rapoarte' },
    { type: 'link', path: '/purchase-orders', icon: FileText, label: 'Purchase Orders' },
    { type: 'link', path: '/comision-agentie', icon: Percent, label: 'Comision Agenție' },
    { type: 'divider' },
    { type: 'link', path: '/custom-products', icon: Package, label: 'Produse Custom' },
    { type: 'link', path: '/settings', icon: Settings, label: 'Setări' },
    { type: 'link', path: '/logs', icon: Activity, label: 'System Monitor' },
]

function NavLinkRow({ to, icon, label, active, collapsed }) {
    const IconComp = icon
    const base =
        'group relative flex items-center gap-3 rounded-lg font-medium transition-colors'
    const idle =
        'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-200'
    const activeCls =
        'bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300'
    const padding = collapsed ? 'justify-center p-2.5' : 'px-3 py-2 text-sm'

    const link = (
        <Link
            to={to}
            className={`${base} ${padding} ${active ? activeCls : idle}`}
        >
            {active && !collapsed && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-primary-600" aria-hidden />
            )}
            <IconComp className={`w-4 h-4 flex-shrink-0 ${active ? 'text-primary-600 dark:text-primary-300' : ''}`} />
            {!collapsed && <span className="truncate">{label}</span>}
        </Link>
    )

    return collapsed ? <Tooltip label={label} side="right">{link}</Tooltip> : link
}

function NavGroup({ item, pathname, collapsed }) {
    const isChildActive = item.children.some((c) => pathname === c.path)
    // Initial open if a child is currently active. We auto-open at render time
    // (via lazy state) instead of an effect to avoid the setState-in-effect
    // lint rule; user can collapse manually thereafter.
    const [open, setOpen] = useState(isChildActive)
    // Track which path opened us so we re-open if the user navigates to a child
    // of this group from outside.
    const [lastActivePath, setLastActivePath] = useState(isChildActive ? pathname : null)
    if (isChildActive && lastActivePath !== pathname) {
        setLastActivePath(pathname)
        if (!open) setOpen(true)
    }

    // In collapsed mode, just render the children as flat icon rows (no group header).
    if (collapsed) {
        return (
            <div className="space-y-0.5">
                {item.children.map((child) => (
                    <NavLinkRow
                        key={child.path}
                        to={child.path}
                        icon={child.icon}
                        label={child.label}
                        active={pathname === child.path}
                        collapsed
                    />
                ))}
            </div>
        )
    }

    return (
        <div>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={`w-full flex items-center gap-3 rounded-lg font-medium transition-colors px-3 py-2 text-xs uppercase tracking-wider ${isChildActive
                    ? 'text-primary-700 dark:text-primary-300'
                    : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
            >
                <item.icon className="w-3.5 h-3.5" />
                <span className="flex-1 text-left">{item.label}</span>
                {open
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronRight className="w-3 h-3" />}
            </button>
            {open && (
                <div className="ml-1 space-y-0.5 mt-0.5">
                    {item.children.map((child) => (
                        <NavLinkRow
                            key={child.path}
                            to={child.path}
                            icon={child.icon}
                            label={child.label}
                            active={pathname === child.path}
                            collapsed={false}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

export default function Sidebar() {
    const location = useLocation()
    const collapsed = useAppStore((s) => s.sidebarCollapsed)
    const toggle = useAppStore((s) => s.toggleSidebar)

    // Ctrl+B / Cmd+B shortcut
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                e.preventDefault()
                toggle()
            }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [toggle])

    const widthClass = collapsed ? 'w-[60px]' : 'w-[224px]'

    return (
        <aside
            className={`${widthClass} h-screen bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 flex flex-col transition-[width] duration-200 ease-out`}
        >
            {/* Logo + collapse toggle */}
            <div className={`h-14 flex items-center ${collapsed ? 'justify-center px-2' : 'px-4 justify-between'} border-b border-zinc-200 dark:border-zinc-800`}>
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                        AW
                    </div>
                    {!collapsed && (
                        <span className="font-semibold text-zinc-900 dark:text-white tracking-tight text-sm">
                            AWB Print
                        </span>
                    )}
                </div>
                {!collapsed && (
                    <Tooltip label="Restrânge (Ctrl+B)" side="bottom">
                        <button
                            type="button"
                            onClick={toggle}
                            aria-label="Restrânge sidebar"
                            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                            <PanelLeftClose className="w-4 h-4" />
                        </button>
                    </Tooltip>
                )}
            </div>

            {/* Navigation */}
            <nav className={`flex-1 ${collapsed ? 'px-1.5 py-2' : 'px-2 py-3'} space-y-0.5 overflow-y-auto`}>
                {NAV.map((item, idx) => {
                    if (item.type === 'divider') {
                        return <div key={`div-${idx}`} className="my-2 mx-2 border-t border-zinc-200 dark:border-zinc-800" />
                    }
                    if (item.type === 'group') {
                        return (
                            <NavGroup
                                key={item.key}
                                item={item}
                                pathname={location.pathname}
                                collapsed={collapsed}
                            />
                        )
                    }
                    return (
                        <NavLinkRow
                            key={item.path}
                            to={item.path}
                            icon={item.icon}
                            label={item.label}
                            active={location.pathname.startsWith(item.path) && (item.path !== '/' || location.pathname === '/')}
                            collapsed={collapsed}
                        />
                    )
                })}
            </nav>

            {/* Footer: expand button when collapsed */}
            {collapsed && (
                <div className="border-t border-zinc-200 dark:border-zinc-800 p-1.5 flex justify-center">
                    <Tooltip label="Extinde (Ctrl+B)" side="right">
                        <button
                            type="button"
                            onClick={toggle}
                            aria-label="Extinde sidebar"
                            className="p-2 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                            <PanelLeftOpen className="w-4 h-4" />
                        </button>
                    </Tooltip>
                </div>
            )}
        </aside>
    )
}
