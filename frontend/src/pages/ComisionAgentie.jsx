/**
 * ComisionAgentie — Agency Commission configuration & report page.
 *
 * Features:
 * - Per-store commission calculation with configurable %
 * - Toggle which stores are included in commission
 * - KPI summary cards (glassmorphism)
 * - Data table matching the LUNA/BRAND/COST/COMENZI/PLECATE/REFUZATE layout
 * - Month selector & CSV export
 */
import { useState, useEffect, useMemo } from 'react'
import {
    Percent, Store, Download, Save, Check, RefreshCw,
    ChevronLeft, ChevronRight, Settings2, TrendingUp,
    Package, Truck, AlertTriangle, DollarSign, ToggleLeft, ToggleRight,
    ArrowUpRight, ArrowDownRight
} from 'lucide-react'
import { comisionApi } from '../services/api'

/** Format RON currency values. */
const fmt = (n) => n == null ? '0.00' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ComisionAgentie() {
    // Period
    const [month, setMonth] = useState(() => {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })

    // Data
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)

    // Config
    const [config, setConfig] = useState(null)
    const [allStores, setAllStores] = useState([])
    const [showConfig, setShowConfig] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    // Commission % override (local edit before saving)
    const [localPct, setLocalPct] = useState(null)
    const [localStorePct, setLocalStorePct] = useState({})

    // Load config on mount
    useEffect(() => {
        const load = async () => {
            try {
                const res = await comisionApi.getConfig()
                setConfig(res.config)
                setAllStores(res.all_stores || [])
                setLocalPct(res.config?.comision_pct ?? 2.5)
                setLocalStorePct(res.config?.store_comision_pct || {})
            } catch (err) {
                console.error('Failed to load comision config:', err)
            }
        }
        load()
    }, [])

    // Load commission data when month or config changes
    useEffect(() => {
        if (config === null) return
        fetchData()
    }, [month, config])

    const fetchData = async () => {
        setLoading(true)
        try {
            const res = await comisionApi.getComision(month)
            setData(res)
        } catch (err) {
            console.error('Failed to load comision data:', err)
        } finally {
            setLoading(false)
        }
    }

    // Save config
    const handleSaveConfig = async () => {
        setSaving(true)
        try {
            const enabledUids = allStores
                .filter(s => tempEnabledUids.has(s.uid))
                .map(s => s.uid)
            const res = await comisionApi.updateConfig({
                comision_pct: localPct,
                enabled_store_uids: enabledUids,
                store_comision_pct: localStorePct,
            })
            setConfig(res.config)
            setSaved(true)
            setTimeout(() => setSaved(false), 2500)
        } catch (err) {
            console.error('Failed to save config:', err)
        } finally {
            setSaving(false)
        }
    }

    // Temp enabled UIDs for config panel (before save)
    const [tempEnabledUids, setTempEnabledUids] = useState(new Set())
    useEffect(() => {
        if (config?.enabled_store_uids) {
            setTempEnabledUids(new Set(config.enabled_store_uids))
        }
    }, [config])

    const toggleStoreUid = (uid) => {
        setTempEnabledUids(prev => {
            const next = new Set(prev)
            if (next.has(uid)) next.delete(uid)
            else next.add(uid)
            return next
        })
    }

    // Month navigation
    const navigateMonth = (dir) => {
        const [y, m] = month.split('-').map(Number)
        const d = new Date(y, m - 1 + dir, 1)
        setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const monthLabel = useMemo(() => {
        if (!month) return ''
        const [y, m] = month.split('-').map(Number)
        const d = new Date(y, m - 1, 1)
        return d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })
    }, [month])

    // Export CSV
    const handleExport = () => {
        const url = comisionApi.getExportUrl(month, data?.comision_pct)
        window.open(url, '_blank')
    }

    const summary = data?.summary || {}
    const stores = data?.stores || []

    return (
        <div className="p-6 space-y-6 bg-zinc-50 dark:bg-zinc-950 min-h-screen animate-fade-in">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-3 tracking-tight">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                            <Percent className="w-5 h-5 text-white" />
                        </div>
                        Comision Agenție
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 mt-1 text-sm">
                        Raport comision per brand — calculat automat din comenzi
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Month Picker */}
                    <div className="flex items-center gap-1 bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 px-1">
                        <button onClick={() => navigateMonth(-1)} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700/50 text-zinc-500 transition-colors">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 min-w-[140px] text-center capitalize">
                            {monthLabel}
                        </span>
                        <button onClick={() => navigateMonth(1)} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700/50 text-zinc-500 transition-colors">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Config Toggle */}
                    <button
                        onClick={() => setShowConfig(p => !p)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${showConfig
                            ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-600'
                            : 'bg-white dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700/50 hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                        }`}
                    >
                        <Settings2 className="w-4 h-4" />
                        Configurare
                    </button>

                    {/* Export */}
                    <button
                        onClick={handleExport}
                        disabled={!data || stores.length === 0}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-indigo-500/20"
                    >
                        <Download className="w-4 h-4" />
                        Export CSV
                    </button>
                </div>
            </div>

            {/* ══════════ Configuration Panel ══════════ */}
            {showConfig && (
                <div className="bg-white dark:bg-zinc-800/60 rounded-2xl border border-zinc-200 dark:border-zinc-700/50 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-5">
                        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
                            <Settings2 className="w-5 h-5 text-emerald-500" />
                            Configurare Comision
                        </h2>
                        <button
                            onClick={handleSaveConfig}
                            disabled={saving}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${saved
                                ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/20'
                            } disabled:opacity-50`}
                        >
                            {saved ? <><Check className="w-4 h-4" /> Salvat</> : <><Save className="w-4 h-4" /> {saving ? 'Se salvează...' : 'Salvează'}</>}
                        </button>
                    </div>

                    {/* Commission % */}
                    <div className="mb-5">
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            Procent Comision (%)
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                step="0.1"
                                min="0"
                                max="100"
                                value={localPct ?? ''}
                                onChange={(e) => setLocalPct(parseFloat(e.target.value) || 0)}
                                className="w-28 px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-right text-zinc-900 dark:text-white text-sm font-semibold focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                            />
                            <span className="text-sm text-zinc-500 dark:text-zinc-400">%</span>
                            <span className="text-xs text-zinc-400 dark:text-zinc-500">
                                Formula: {localPct}% × (Încasări − Transport)
                            </span>
                        </div>
                    </div>

                    {/* Store Toggles */}
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
                            Magazine incluse în calcul comision
                        </label>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-3">
                            {tempEnabledUids.size === 0
                                ? 'Niciun magazin selectat — se folosesc toate magazinele.'
                                : `${tempEnabledUids.size} magazine selectate`}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                            {allStores.map(store => {
                                const enabled = tempEnabledUids.has(store.uid)
                                return (
                                    <div
                                        key={store.uid}
                                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${enabled
                                            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-600'
                                            : 'bg-zinc-50 dark:bg-zinc-900/50 border-zinc-200 dark:border-zinc-700/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                                        }`}
                                    >
                                        <button
                                            onClick={() => toggleStoreUid(store.uid)}
                                            className="flex items-center gap-3 text-left flex-1 overflow-hidden"
                                        >
                                            {enabled
                                                ? <ToggleRight className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                                                : <ToggleLeft className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                                            }
                                            <span className={`text-sm font-medium truncate ${enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-500 dark:text-zinc-400'}`}>
                                                {store.name}
                                            </span>
                                        </button>
                                        
                                        {enabled && (
                                            <div className="flex items-center gap-1 ml-2">
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    min="0"
                                                    placeholder={localPct}
                                                    value={localStorePct[store.uid] !== undefined ? localStorePct[store.uid] : ''}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setLocalStorePct(p => {
                                                            const next = { ...p };
                                                            if (val === '') delete next[store.uid];
                                                            else next[store.uid] = parseFloat(val);
                                                            return next;
                                                        });
                                                    }}
                                                    className="w-14 px-2 py-1 text-xs font-semibold text-right border rounded-lg bg-white dark:bg-zinc-800 border-emerald-200 dark:border-emerald-600 text-emerald-800 dark:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                />
                                                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">%</span>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* ══════════ KPI Cards ══════════ */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
                    <span className="ml-3 text-zinc-500 dark:text-zinc-400">Se calculează comisioanele...</span>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Total Comision */}
                        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500/10 to-teal-500/5 dark:from-emerald-500/15 dark:to-teal-500/5 rounded-2xl p-5 border border-emerald-200/60 dark:border-emerald-700/30">
                            <div className="absolute top-3 right-3 w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                                <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <p className="text-xs font-semibold text-emerald-600/70 dark:text-emerald-400/70 uppercase tracking-wider">Total Comision</p>
                            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-1 tracking-tight">{fmt(summary.total_comision)} RON</p>
                            <p className="text-[10px] text-emerald-500/60 mt-1">{summary.formula}</p>
                        </div>

                        {/* Total Incasari */}
                        <div className="relative overflow-hidden bg-gradient-to-br from-indigo-500/10 to-violet-500/5 dark:from-indigo-500/15 dark:to-violet-500/5 rounded-2xl p-5 border border-indigo-200/60 dark:border-indigo-700/30">
                            <div className="absolute top-3 right-3 w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <p className="text-xs font-semibold text-indigo-600/70 dark:text-indigo-400/70 uppercase tracking-wider">Total Încasări</p>
                            <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-300 mt-1 tracking-tight">{fmt(summary.total_incasari)} RON</p>
                        </div>

                        {/* Total Transport */}
                        <div className="relative overflow-hidden bg-gradient-to-br from-amber-500/10 to-orange-500/5 dark:from-amber-500/15 dark:to-orange-500/5 rounded-2xl p-5 border border-amber-200/60 dark:border-amber-700/30">
                            <div className="absolute top-3 right-3 w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                                <Truck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                            </div>
                            <p className="text-xs font-semibold text-amber-600/70 dark:text-amber-400/70 uppercase tracking-wider">Total Transport</p>
                            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-1 tracking-tight">{fmt(summary.total_transport)} RON</p>
                        </div>

                        {/* Orders */}
                        <div className="relative overflow-hidden bg-gradient-to-br from-violet-500/10 to-purple-500/5 dark:from-violet-500/15 dark:to-purple-500/5 rounded-2xl p-5 border border-violet-200/60 dark:border-violet-700/30">
                            <div className="absolute top-3 right-3 w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
                                <Package className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                            </div>
                            <p className="text-xs font-semibold text-violet-600/70 dark:text-violet-400/70 uppercase tracking-wider">Comenzi / Plecate</p>
                            <p className="text-2xl font-bold text-violet-700 dark:text-violet-300 mt-1 tracking-tight">
                                {summary.total_comenzi?.toLocaleString('ro-RO') || 0}
                                <span className="text-sm font-normal text-violet-500 ml-1">/ {summary.total_plecate?.toLocaleString('ro-RO') || 0}</span>
                            </p>
                            {summary.total_refuzate > 0 && (
                                <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> {summary.total_refuzate} refuzate
                                </p>
                            )}
                        </div>
                    </div>

                    {/* ══════════ Data Table ══════════ */}
                    <div className="bg-white dark:bg-zinc-800/60 rounded-2xl border border-zinc-200 dark:border-zinc-700/50 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-700/50 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">
                                Detalii per Brand — <span className="capitalize">{monthLabel}</span>
                            </h2>
                            <span className="text-xs text-zinc-400 dark:text-zinc-500">
                                {stores.length} brand{stores.length !== 1 ? 'uri' : ''}
                            </span>
                        </div>

                        {stores.length === 0 ? (
                            <div className="px-6 py-12 text-center text-zinc-500 dark:text-zinc-400">
                                <Package className="w-12 h-12 mx-auto mb-3 text-zinc-300 dark:text-zinc-600" />
                                <p className="text-sm font-medium">Nu există date pentru luna selectată</p>
                                <p className="text-xs mt-1 text-zinc-400">Selectează o altă lună sau configurează magazinele.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/30">
                                            <th className="px-4 py-3 font-semibold">LUNA</th>
                                            <th className="px-4 py-3 font-semibold">BRAND</th>
                                            <th className="px-4 py-3 font-semibold text-right">COST</th>
                                            <th className="px-4 py-3 font-semibold text-right">COMENZI</th>
                                            <th className="px-4 py-3 font-semibold text-right">PLECATE</th>
                                            <th className="px-4 py-3 font-semibold text-right">REFUZATE</th>
                                            <th className="px-4 py-3 font-semibold text-right">ÎNCASĂRI</th>
                                            <th className="px-4 py-3 font-semibold text-right">COMISION %</th>
                                            <th className="px-4 py-3 font-semibold text-right">TRANSPORT</th>
                                            <th className="px-4 py-3 font-semibold text-right">TOTAL COMISION</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                        {stores.map((row, i) => (
                                            <tr key={row.store_uid} className="group hover:bg-zinc-50 dark:hover:bg-zinc-700/20 transition-colors">
                                                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{row.luna}</td>
                                                <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-100 whitespace-nowrap">{row.brand}</td>
                                                <td className="px-4 py-3 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">{row.cost}</td>
                                                <td className="px-4 py-3 text-right font-medium text-zinc-700 dark:text-zinc-200 tabular-nums">{row.comenzi.toLocaleString('ro-RO')}</td>
                                                <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-200 tabular-nums">{row.plecate.toLocaleString('ro-RO')}</td>
                                                <td className="px-4 py-3 text-right tabular-nums">
                                                    <span className={row.refuzate > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-zinc-400'}>
                                                        {row.refuzate.toLocaleString('ro-RO')}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right font-semibold text-zinc-800 dark:text-zinc-100 tabular-nums">{fmt(row.incasari)}</td>
                                                <td className="px-4 py-3 text-right tabular-nums">
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                                                        {row.comision_pct}%
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-300 tabular-nums">{fmt(row.transport)}</td>
                                                <td className="px-4 py-3 text-right font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{fmt(row.total_comision)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-zinc-50 dark:bg-zinc-900/40 border-t-2 border-zinc-300 dark:border-zinc-600 font-semibold">
                                            <td className="px-4 py-3 text-zinc-900 dark:text-white" colSpan={3}>TOTAL</td>
                                            <td className="px-4 py-3 text-right text-zinc-900 dark:text-white tabular-nums">{summary.total_comenzi?.toLocaleString('ro-RO')}</td>
                                            <td className="px-4 py-3 text-right text-zinc-900 dark:text-white tabular-nums">{summary.total_plecate?.toLocaleString('ro-RO')}</td>
                                            <td className="px-4 py-3 text-right text-red-600 dark:text-red-400 tabular-nums">{summary.total_refuzate?.toLocaleString('ro-RO')}</td>
                                            <td className="px-4 py-3 text-right text-zinc-900 dark:text-white tabular-nums">{fmt(summary.total_incasari)}</td>
                                            <td className="px-4 py-3 text-right text-zinc-400">—</td>
                                            <td className="px-4 py-3 text-right text-zinc-900 dark:text-white tabular-nums">{fmt(summary.total_transport)}</td>
                                            <td className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400 tabular-nums text-lg">{fmt(summary.total_comision)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
