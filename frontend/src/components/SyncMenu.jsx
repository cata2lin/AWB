import { useEffect, useRef, useState } from 'react'
import {
    RefreshCw, ChevronDown, Activity, Clock, Layers, StopCircle, Zap,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { syncApi } from '../services/api/sync'
import { toastError, toastSuccess } from '../utils/toast'

/**
 * SyncMenu — topbar dropdown that triggers any of the four sync tiers plus
 * Full and (when active) Stop. Polls the backend every 10s for status so a
 * scheduler-initiated sync shows as "running".
 */
export default function SyncMenu() {
    const isSyncing = useAppStore((s) => s.isSyncing)
    const lastSyncAt = useAppStore((s) => s.lastSyncAt)
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const ref = useRef(null)

    // Outside click closes
    useEffect(() => {
        if (!open) return
        const onClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    // Poll backend status
    useEffect(() => {
        const tick = async () => {
            try {
                const data = await syncApi.getStatus()
                const running = data?.status === 'running'
                const state = useAppStore.getState()
                if (running && !state.isSyncing) useAppStore.setState({ isSyncing: true })
                else if (!running && state.isSyncing) useAppStore.setState({ isSyncing: false, lastSyncAt: new Date().toISOString() })
            } catch { /* ignore */ }
        }
        const id = setInterval(tick, 10000)
        tick()
        return () => clearInterval(id)
    }, [])

    const trigger = async (sync_type, label) => {
        setOpen(false)
        if (isSyncing) return
        setBusy(true)
        try {
            await syncApi.triggerSync({ sync_type })
            toastSuccess(`${label} pornit`)
            useAppStore.setState({ isSyncing: true })
        } catch (err) {
            toastError(err)
        } finally {
            setBusy(false)
        }
    }

    const stop = async () => {
        setOpen(false)
        try {
            await syncApi.cancelSync()
            toastSuccess('Sincronizare oprită')
            useAppStore.setState({ isSyncing: false })
        } catch (err) {
            toastError(err)
        }
    }

    const items = [
        { key: 'incremental', label: 'Incremental', desc: 'Doar comenzile modificate (rapid)', icon: Zap, color: 'text-emerald-500' },
        { key: 'recent_7d', label: '7 zile', desc: 'updated_at în ultimele 7 zile', icon: Clock, color: 'text-sky-500' },
        { key: 'window_30d', label: '30 zile', desc: 'updated_at în ultimele 30 zile', icon: Clock, color: 'text-primary-500' },
        { key: 'deep_90d', label: 'Deep 90 zile', desc: 'updated_at în ultimele 90 zile', icon: Layers, color: 'text-violet-500' },
        { key: 'full', label: 'Full sync', desc: 'Toate comenzile (lent, manual)', icon: RefreshCw, color: 'text-amber-500' },
    ]

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-primary-500' : ''}`} />
                <span>{isSyncing ? 'Se sincronizează...' : 'Sincronizare'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            </button>

            {open && (
                <div className="absolute right-0 mt-1 w-72 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-xl z-30 overflow-hidden animate-fade-in">
                    <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                            Tipuri sincronizare
                        </span>
                        {lastSyncAt && (
                            <span className="text-[10px] text-zinc-400" title={new Date(lastSyncAt).toISOString()}>
                                {new Date(lastSyncAt).toLocaleTimeString('ro-RO')}
                            </span>
                        )}
                    </div>
                    <div className="py-1">
                        {items.map((it) => (
                            <button
                                key={it.key}
                                type="button"
                                onClick={() => trigger(it.key, it.label)}
                                disabled={busy || isSyncing}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700/50 flex items-center gap-3 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <it.icon className={`w-4 h-4 flex-shrink-0 ${it.color}`} />
                                <div className="min-w-0">
                                    <div className="font-medium text-zinc-900 dark:text-white">{it.label}</div>
                                    <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{it.desc}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                    {isSyncing && (
                        <div className="border-t border-zinc-200 dark:border-zinc-700 p-1">
                            <button
                                type="button"
                                onClick={stop}
                                className="w-full px-3 py-2 text-left text-sm rounded-lg text-danger-fg hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-3 transition-colors"
                            >
                                <StopCircle className="w-4 h-4 flex-shrink-0 text-red-500" />
                                <span className="font-medium">Oprește sincronizarea</span>
                            </button>
                        </div>
                    )}
                    <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                        <Activity className="w-3 h-3" />
                        Auto-sync: Incremental 10m · Recent 20m · 30D 2h · Deep 24h
                    </div>
                </div>
            )}
        </div>
    )
}
