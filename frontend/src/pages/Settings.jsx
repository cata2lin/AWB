import { useState, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useStores, useUpdateStore, useSyncStatus } from '../hooks/useApi'
import { profitabilityConfigApi, businessCostsApi, courierCsvApi } from '../services/api'
import { Download, Upload, Palette, RefreshCw, Clock, AlertCircle, DollarSign, Save, Check, Plus, Trash2, Copy, ChevronLeft, ChevronRight, Edit2, X, FileUp, Loader, Truck, Zap } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export default function Settings() {
    const { batchSize, setBatchSize } = useAppStore()
    const { data: stores = [], isLoading, error } = useStores()
    const { data: syncStatus } = useSyncStatus()
    const updateStoreMutation = useUpdateStore()

    // Profitability config state
    const [profitConfig, setProfitConfig] = useState(null)
    const [configLoading, setConfigLoading] = useState(true)
    const [configSaving, setConfigSaving] = useState(false)
    const [configSaved, setConfigSaved] = useState(false)
    const [configError, setConfigError] = useState(null)

    // --- Business Costs State ---
    const [bizCostMonth, setBizCostMonth] = useState(() => {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
    const [bizCosts, setBizCosts] = useState([])
    const [bizCostsLoading, setBizCostsLoading] = useState(false)
    const [bizCategories, setBizCategories] = useState([])
    const [showAddForm, setShowAddForm] = useState(false)
    const [editingCostId, setEditingCostId] = useState(null)
    const [editingCost, setEditingCost] = useState({})
    const [newCost, setNewCost] = useState({ category: 'salary', label: '', amount: '', cost_type: 'fixed', scope: 'all', store_uids: [], notes: '', has_tva: true, pnl_section: 'fixed' })
    const [bizSaving, setBizSaving] = useState(false)
    const [cloneSource, setCloneSource] = useState('')

    // --- CSV Import State ---
    const [csvCourier, setCsvCourier] = useState('dpd')
    const [csvFile, setCsvFile] = useState(null)
    const [csvUploading, setCsvUploading] = useState(false)
    const [csvUploadPct, setCsvUploadPct] = useState(0)
    const [csvImportId, setCsvImportId] = useState(null)
    const [csvImportStatus, setCsvImportStatus] = useState(null)
    const [csvHistory, setCsvHistory] = useState([])
    const [csvEstimating, setCsvEstimating] = useState(false)

    // Load profitability config
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const data = await profitabilityConfigApi.getConfig()
                setProfitConfig(data)
            } catch (err) {
                setConfigError('Failed to load profitability config')
            } finally {
                setConfigLoading(false)
            }
        }
        loadConfig()
    }, [])

    // Load business cost categories on mount
    useEffect(() => {
        const loadCategories = async () => {
            try {
                const data = await businessCostsApi.getCategories()
                setBizCategories(data.categories || [])
            } catch (err) {
                console.error('Failed to load categories:', err)
            }
        }
        loadCategories()
    }, [])

    // Load business costs when month changes
    useEffect(() => {
        const loadBizCosts = async () => {
            setBizCostsLoading(true)
            try {
                const data = await businessCostsApi.getCosts(bizCostMonth)
                setBizCosts(data.costs || [])
            } catch (err) {
                console.error('Failed to load business costs:', err)
            } finally {
                setBizCostsLoading(false)
            }
        }
        loadBizCosts()
    }, [bizCostMonth])

    const refreshBizCosts = async () => {
        setBizCostsLoading(true)
        try {
            const data = await businessCostsApi.getCosts(bizCostMonth)
            setBizCosts(data.costs || [])
        } catch (err) {
            console.error('Failed to refresh:', err)
        } finally {
            setBizCostsLoading(false)
        }
    }

    // Load CSV import history on mount
    useEffect(() => {
        const loadCsvHistory = async () => {
            try {
                const data = await courierCsvApi.getImportHistory(10)
                setCsvHistory(data.imports || [])
            } catch (err) {
                console.error('Failed to load CSV history:', err)
            }
        }
        loadCsvHistory()
    }, [])

    const handleAddCost = async () => {
        if (!newCost.label || !newCost.amount) return
        setBizSaving(true)
        try {
            await businessCostsApi.createCost({
                ...newCost,
                amount: parseFloat(newCost.amount) || 0,
                month: bizCostMonth,
                store_uids: newCost.scope !== 'all' ? newCost.store_uids : null,
            })
            setNewCost({ category: 'salary', label: '', amount: '', cost_type: 'fixed', scope: 'all', store_uids: [], notes: '', has_tva: true, pnl_section: 'fixed' })
            setShowAddForm(false)
            await refreshBizCosts()
        } catch (err) {
            console.error('Failed to add cost:', err)
        } finally {
            setBizSaving(false)
        }
    }

    const handleDeleteCost = async (id) => {
        if (!confirm('Ștergi acest cost?')) return
        try {
            await businessCostsApi.deleteCost(id)
            await refreshBizCosts()
        } catch (err) {
            console.error('Failed to delete:', err)
        }
    }

    const handleSaveEditCost = async (id) => {
        setBizSaving(true)
        try {
            await businessCostsApi.updateCost(id, editingCost)
            setEditingCostId(null)
            setEditingCost({})
            await refreshBizCosts()
        } catch (err) {
            console.error('Failed to update:', err)
        } finally {
            setBizSaving(false)
        }
    }

    const handleCloneMonth = async () => {
        if (!cloneSource) return
        setBizSaving(true)
        try {
            const result = await businessCostsApi.cloneMonth(cloneSource, bizCostMonth)
            alert(`Clonat ${result.cloned} costuri fixe din ${cloneSource}. ${result.skipped_duplicates} duplicate ignorate.`)
            setCloneSource('')
            await refreshBizCosts()
        } catch (err) {
            console.error('Clone failed:', err)
            alert('Clonare eșuată: ' + (err.response?.data?.detail || err.message))
        } finally {
            setBizSaving(false)
        }
    }

    const navigateMonth = (dir) => {
        const [y, m] = bizCostMonth.split('-').map(Number)
        const d = new Date(y, m - 1 + dir, 1)
        setBizCostMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const bizCostTotal = bizCosts.reduce((sum, c) => sum + (c.amount || 0), 0)
    const categoryIcon = (key) => bizCategories.find(c => c.key === key)?.icon || '📦'

    const handleConfigChange = (field, value) => {
        setProfitConfig(prev => ({ ...prev, [field]: value }))
        setConfigSaved(false)
    }

    const handleSaveConfig = async () => {
        setConfigSaving(true)
        setConfigError(null)
        try {
            const result = await profitabilityConfigApi.updateConfig(profitConfig)
            setProfitConfig(result.config)
            setConfigSaved(true)
            setTimeout(() => setConfigSaved(false), 3000)
        } catch (err) {
            setConfigError('Failed to save profitability config')
        } finally {
            setConfigSaving(false)
        }
    }

    const handleColorChange = (storeUid, color) => {
        updateStoreMutation.mutate({ uid: storeUid, updates: { color_code: color } })
    }

    const handleExport = () => {
        const config = {
            stores: stores.map(s => ({ uid: s.uid, name: s.name, color: s.color_code })),
            batchSize,
            exportedAt: new Date().toISOString(),
        }
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'awb-print-config.json'
        a.click()
    }

    // Config input helper
    const ConfigInput = ({ label, description, field, type = 'number', step = '0.01', suffix = '' }) => (
        <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
                {description && <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>}
            </div>
            <div className="flex items-center gap-1 ml-4">
                <input
                    type={type}
                    step={step}
                    value={profitConfig?.[field] ?? ''}
                    onChange={(e) => handleConfigChange(field, type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                    className="w-24 px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-right text-zinc-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                {suffix && <span className="text-xs text-zinc-500 dark:text-zinc-400 w-8">{suffix}</span>}
            </div>
        </div>
    )

    return (
        <div className="p-6 space-y-6 animate-fade-in bg-zinc-50 dark:bg-zinc-950 min-h-screen">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Settings</h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                    Configure application preferences, store colors, and profitability parameters
                </p>
            </div>

            {/* Sync Status */}
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <RefreshCw className="w-5 h-5 text-zinc-500" />
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">Sync Status</h2>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-zinc-600 dark:text-zinc-400">Status</span>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${syncStatus?.status === 'running'
                            ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'
                            : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
                            }`}>
                            {syncStatus?.status === 'running' ? 'Syncing...' : 'Idle'}
                        </span>
                    </div>
                    {syncStatus?.last_sync && (
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-600 dark:text-zinc-400">Last Sync</span>
                            <span className="text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDistanceToNow(new Date(syncStatus.last_sync), { addSuffix: true })}
                            </span>
                        </div>
                    )}
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-zinc-600 dark:text-zinc-400">Auto-sync Interval</span>
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">30 minutes</span>
                    </div>
                </div>
            </div>

            {/* ═══════════════════ Profitability Settings ═══════════════════ */}
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-emerald-500" />
                        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">Profitability Settings</h2>
                    </div>
                    <button
                        onClick={handleSaveConfig}
                        disabled={configSaving || configLoading}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${configSaved
                            ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                            : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-500/20'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {configSaved ? <><Check className="w-4 h-4" /> Saved</> : <><Save className="w-4 h-4" /> {configSaving ? 'Saving...' : 'Save'}</>}
                    </button>
                </div>

                {configError && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2 mb-4">
                        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-600 dark:text-red-400">{configError}</p>
                    </div>
                )}

                {configLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                    </div>
                ) : profitConfig && (
                    <div className="space-y-6">
                        {/* Packaging */}
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">Packaging</h3>
                            <ConfigInput label="Cost per order" description="Packaging materials cost per order" field="packaging_cost_per_order" suffix="RON" />
                        </div>

                        <hr className="border-zinc-200 dark:border-zinc-700" />

                        {/* Agency Commission - DEPRECATED (now managed as monthly business cost) */}
                        <div className="opacity-50">
                            <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Agency Commission</h3>
                            <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">
                                ℹ️ Agency commission is now managed as a monthly business cost in the Fixed Costs section below. Per-order calculation has been removed.
                            </p>
                        </div>

                        <hr className="border-zinc-200 dark:border-zinc-700" />

                        {/* GT Commission */}
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">George Talent (GT) Commission</h3>
                            <div className="space-y-3">
                                <ConfigInput label="GT Commission rate" description="Percentage of revenue for GT store" field="gt_commission_pct" suffix="%" />
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">GT Store UID</label>
                                    <select
                                        value={profitConfig.gt_commission_store_uid || ''}
                                        onChange={(e) => handleConfigChange('gt_commission_store_uid', e.target.value || null)}
                                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                    >
                                        <option value="">— None —</option>
                                        {stores.map(s => <option key={s.uid} value={s.uid}>{s.name}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <hr className="border-zinc-200 dark:border-zinc-700" />

                        {/* Payment Processing */}
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">Payment Processing</h3>
                            <div className="space-y-3">
                                <ConfigInput label="Variable fee" description="Percentage of order value" field="payment_processing_pct" suffix="%" />
                                <ConfigInput label="Fixed fee" description="Fixed fee per transaction" field="payment_processing_fixed" suffix="RON" />
                            </div>
                        </div>

                        <hr className="border-zinc-200 dark:border-zinc-700" />

                        {/* Frisbo & VAT */}
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">Other</h3>
                            <div className="space-y-3">
                                <ConfigInput label="Frisbo fee per order" description="Fulfillment fee (0 if not applicable)" field="frisbo_fee_per_order" suffix="RON" />
                                <ConfigInput label="VAT rate" description="TVA rate for net profit calculation" field="vat_rate" step="0.01" />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ═══════════════════ Business Costs ═══════════════════ */}
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-amber-500" />
                        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">Costuri Fixe & Sezoniere</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => navigateMonth(-1)} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400"><ChevronLeft className="w-4 h-4" /></button>
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 min-w-[80px] text-center">{bizCostMonth}</span>
                        <button onClick={() => navigateMonth(1)} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400"><ChevronRight className="w-4 h-4" /></button>
                    </div>
                </div>

                {/* Actions row */}
                <div className="flex items-center gap-2 mb-4">
                    <button
                        onClick={() => setShowAddForm(!showAddForm)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        <Plus className="w-4 h-4" /> Adaugă Cost
                    </button>
                    <div className="flex items-center gap-1.5 ml-auto">
                        <select
                            value={cloneSource}
                            onChange={(e) => setCloneSource(e.target.value)}
                            className="px-2 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-700 dark:text-zinc-300"
                        >
                            <option value="">Clonează din...</option>
                            {(() => {
                                const months = []
                                const [y, m] = bizCostMonth.split('-').map(Number)
                                for (let i = 1; i <= 6; i++) {
                                    const d = new Date(y, m - 1 - i, 1)
                                    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
                                }
                                return months.map(mo => <option key={mo} value={mo}>{mo}</option>)
                            })()}
                        </select>
                        <button
                            onClick={handleCloneMonth}
                            disabled={!cloneSource || bizSaving}
                            className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
                        >
                            <Copy className="w-3.5 h-3.5" /> Clonează
                        </button>
                    </div>
                </div>

                {/* Add form */}
                {showAddForm && (
                    <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 mb-4 border border-zinc-200 dark:border-zinc-700">
                        <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Cost nou — {bizCostMonth}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Categorie</label>
                                <select
                                    value={newCost.category}
                                    onChange={(e) => setNewCost(p => ({ ...p, category: e.target.value }))}
                                    className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white"
                                >
                                    {bizCategories.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Denumire</label>
                                <input
                                    type="text"
                                    value={newCost.label}
                                    onChange={(e) => setNewCost(p => ({ ...p, label: e.target.value }))}
                                    placeholder="ex: Salarii angajați"
                                    className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Sumă (RON)</label>
                                <input
                                    type="number"
                                    value={newCost.amount}
                                    onChange={(e) => setNewCost(p => ({ ...p, amount: e.target.value }))}
                                    placeholder="0.00"
                                    className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Tip</label>
                                <select
                                    value={newCost.cost_type}
                                    onChange={(e) => setNewCost(p => ({ ...p, cost_type: e.target.value }))}
                                    className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white"
                                >
                                    <option value="fixed">Fix (recurent)</option>
                                    <option value="seasonal">Sezonier (o singură dată)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Aplicare</label>
                                <select
                                    value={newCost.scope}
                                    onChange={(e) => setNewCost(p => ({ ...p, scope: e.target.value, store_uids: [] }))}
                                    className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white"
                                >
                                    <option value="all">Toate magazinele</option>
                                    <option value="store">Un magazin</option>
                                    <option value="stores">Mai multe magazine</option>
                                </select>
                            </div>
                            {newCost.scope !== 'all' && (
                                <div>
                                    <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Magazine</label>
                                    <div className="flex flex-wrap gap-1">
                                        {stores.map(s => (
                                            <label key={s.uid} className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-600 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={newCost.store_uids.includes(s.uid)}
                                                    onChange={(e) => {
                                                        setNewCost(p => ({
                                                            ...p,
                                                            store_uids: e.target.checked
                                                                ? [...p.store_uids, s.uid]
                                                                : p.store_uids.filter(u => u !== s.uid)
                                                        }))
                                                    }}
                                                    className="rounded"
                                                />
                                                {s.name}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="mt-3">
                            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Notițe (opțional)</label>
                            <input
                                type="text"
                                value={newCost.notes}
                                onChange={(e) => setNewCost(p => ({ ...p, notes: e.target.value }))}
                                placeholder="Detalii suplimentare..."
                                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white"
                            />
                        </div>
                        <div className="flex items-center gap-4 mt-3">
                            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={newCost.has_tva}
                                    onChange={(e) => setNewCost(p => ({ ...p, has_tva: e.target.checked }))}
                                    className="rounded border-zinc-300 dark:border-zinc-600 text-emerald-600 focus:ring-emerald-500"
                                />
                                Include TVA (deductibil)
                            </label>
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-zinc-500 dark:text-zinc-400">Secțiune P&L:</label>
                                <select
                                    value={newCost.pnl_section}
                                    onChange={(e) => setNewCost(p => ({ ...p, pnl_section: e.target.value }))}
                                    className="px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded text-sm text-zinc-900 dark:text-white"
                                >
                                    <option value="cogs">📦 COGS</option>
                                    <option value="operational">🏢 Operațional</option>
                                    <option value="marketing">📣 Marketing</option>
                                    <option value="fixed">💼 Costuri Fixe</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                            <button
                                onClick={handleAddCost}
                                disabled={bizSaving || !newCost.label || !newCost.amount}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
                            >
                                {bizSaving ? 'Se salvează...' : 'Salvează'}
                            </button>
                            <button
                                onClick={() => setShowAddForm(false)}
                                className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg text-sm font-medium transition-colors"
                            >
                                Anulează
                            </button>
                        </div>
                    </div>
                )}

                {/* Costs table */}
                {bizCostsLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-600"></div>
                    </div>
                ) : bizCosts.length === 0 ? (
                    <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
                        <p className="text-sm">Nu există costuri pentru {bizCostMonth}.</p>
                        <p className="text-xs mt-1">Adaugă costuri noi sau clonează dintr-o lună anterioară.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
                                    <th className="pb-2 font-medium">Categorie</th>
                                    <th className="pb-2 font-medium">Denumire</th>
                                    <th className="pb-2 font-medium">Sumă (RON)</th>
                                    <th className="pb-2 font-medium">TVA</th>
                                    <th className="pb-2 font-medium">Secțiune P&L</th>
                                    <th className="pb-2 font-medium">Tip</th>
                                    <th className="pb-2 font-medium">Aplicare</th>
                                    <th className="pb-2 font-medium text-right">Acțiuni</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                                {bizCosts.map(cost => (
                                    <tr key={cost.id} className="group hover:bg-zinc-50 dark:hover:bg-zinc-700/30">
                                        {editingCostId === cost.id ? (
                                            <>
                                                <td className="py-2 pr-2">
                                                    <select
                                                        value={editingCost.category ?? cost.category}
                                                        onChange={(e) => setEditingCost(p => ({ ...p, category: e.target.value }))}
                                                        className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded text-sm"
                                                    >
                                                        {bizCategories.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
                                                    </select>
                                                </td>
                                                <td className="py-2 pr-2">
                                                    <input
                                                        type="text"
                                                        value={editingCost.label ?? cost.label}
                                                        onChange={(e) => setEditingCost(p => ({ ...p, label: e.target.value }))}
                                                        className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded text-sm text-zinc-900 dark:text-white"
                                                    />
                                                </td>
                                                <td className="py-2 pr-2">
                                                    <input
                                                        type="number"
                                                        value={editingCost.amount ?? cost.amount}
                                                        onChange={(e) => setEditingCost(p => ({ ...p, amount: parseFloat(e.target.value) || 0 }))}
                                                        className="w-24 px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded text-sm text-right text-zinc-900 dark:text-white"
                                                    />
                                                </td>
                                                <td className="py-2 pr-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={editingCost.has_tva ?? cost.has_tva ?? true}
                                                        onChange={(e) => setEditingCost(p => ({ ...p, has_tva: e.target.checked }))}
                                                        className="rounded border-zinc-300 dark:border-zinc-600 text-emerald-600"
                                                    />
                                                </td>
                                                <td className="py-2 pr-2">
                                                    <select
                                                        value={editingCost.pnl_section ?? cost.pnl_section ?? 'fixed'}
                                                        onChange={(e) => setEditingCost(p => ({ ...p, pnl_section: e.target.value }))}
                                                        className="px-1 py-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded text-xs"
                                                    >
                                                        <option value="cogs">COGS</option>
                                                        <option value="operational">Operațional</option>
                                                        <option value="marketing">Marketing</option>
                                                        <option value="fixed">Fixe</option>
                                                    </select>
                                                </td>
                                                <td className="py-2 pr-2 text-xs text-zinc-500 dark:text-zinc-400">{cost.cost_type === 'fixed' ? 'Fix' : 'Sezonier'}</td>
                                                <td className="py-2 pr-2 text-xs text-zinc-500 dark:text-zinc-400">
                                                    {cost.scope === 'all' ? 'Toate' : cost.store_uids?.join(', ')}
                                                </td>
                                                <td className="py-2 text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button onClick={() => handleSaveEditCost(cost.id)} disabled={bizSaving} className="p-1 text-green-600 hover:text-green-700"><Check className="w-4 h-4" /></button>
                                                        <button onClick={() => { setEditingCostId(null); setEditingCost({}) }} className="p-1 text-zinc-400 hover:text-zinc-600"><X className="w-4 h-4" /></button>
                                                    </div>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="py-2 pr-2">
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-700 rounded text-xs font-medium text-zinc-700 dark:text-zinc-300">
                                                        {categoryIcon(cost.category)} {bizCategories.find(c => c.key === cost.category)?.label || cost.category}
                                                    </span>
                                                </td>
                                                <td className="py-2 pr-2 text-zinc-800 dark:text-zinc-200">
                                                    {cost.label}
                                                    {cost.notes && <span className="ml-1 text-xs text-zinc-400">({cost.notes})</span>}
                                                </td>
                                                <td className="py-2 pr-2 text-right font-medium text-zinc-900 dark:text-white">
                                                    {cost.amount?.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON
                                                </td>
                                                <td className="py-2 pr-2">
                                                    <span className={`text-xs px-1.5 py-0.5 rounded ${cost.has_tva !== false ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'}`}>
                                                        {cost.has_tva !== false ? 'Cu TVA' : 'Fără TVA'}
                                                    </span>
                                                </td>
                                                <td className="py-2 pr-2">
                                                    <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                                                        {{ cogs: '📦 COGS', operational: '🏢 Oper.', marketing: '📣 Mkt.', fixed: '💼 Fixe' }[cost.pnl_section] || '💼 Fixe'}
                                                    </span>
                                                </td>
                                                <td className="py-2 pr-2">
                                                    <span className={`text-xs px-1.5 py-0.5 rounded ${cost.cost_type === 'fixed' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'}`}>
                                                        {cost.cost_type === 'fixed' ? 'Fix' : 'Sezonier'}
                                                    </span>
                                                </td>
                                                <td className="py-2 pr-2 text-xs text-zinc-500 dark:text-zinc-400">
                                                    {cost.scope === 'all' ? '🌐 Toate' : cost.store_uids?.map(u => stores.find(s => s.uid === u)?.name || u).join(', ')}
                                                </td>
                                                <td className="py-2 text-right">
                                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={() => { setEditingCostId(cost.id); setEditingCost({ category: cost.category, label: cost.label, amount: cost.amount, has_tva: cost.has_tva ?? true, pnl_section: cost.pnl_section || 'fixed' }) }} className="p-1 text-zinc-400 hover:text-indigo-600"><Edit2 className="w-3.5 h-3.5" /></button>
                                                        <button onClick={() => handleDeleteCost(cost.id)} className="p-1 text-zinc-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                                                    </div>
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-zinc-300 dark:border-zinc-600">
                                    <td className="py-2 font-semibold text-zinc-900 dark:text-white" colSpan={2}>Total ({bizCostMonth})</td>
                                    <td className="py-2 text-right font-bold text-zinc-900 dark:text-white">
                                        {bizCostTotal.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON
                                    </td>
                                    <td colSpan={5}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            {/* General Settings */}
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4 tracking-tight">General</h2>

                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                Batch Size
                            </label>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Maximum orders per print batch
                            </p>
                        </div>
                        <input
                            type="number"
                            value={batchSize}
                            onChange={(e) => setBatchSize(Number(e.target.value))}
                            className="w-24 px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-right text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                    </div>
                </div>
            </div>

            {/* Store Colors */}
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <Palette className="w-5 h-5 text-zinc-500" />
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">Store Colors</h2>
                </div>

                {isLoading && (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
                    </div>
                )}

                {stores.length === 0 && !isLoading && !error && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-4">
                        No stores available. Sync orders from Frisbo first.
                    </p>
                )}

                {stores.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {stores.map((store) => (
                            <div key={store.uid} className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg">
                                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{store.name}</span>
                                <input
                                    type="color"
                                    value={store.color_code || '#6B7280'}
                                    onChange={(e) => handleColorChange(store.uid, e.target.value)}
                                    className="w-10 h-8 rounded border border-zinc-200 dark:border-zinc-700 cursor-pointer"
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ─── CSV Import ─── */}
            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4 flex items-center gap-2 tracking-tight">
                    <Truck className="w-5 h-5" /> Import CSV Curier
                </h2>

                {/* Upload form */}
                <div className="flex flex-wrap items-end gap-3 mb-4">
                    <div>
                        <label className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Curier</label>
                        <select
                            value={csvCourier}
                            onChange={e => setCsvCourier(e.target.value)}
                            className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-sm text-zinc-900 dark:text-white"
                        >
                            <option value="dpd">DPD</option>
                            <option value="sameday">Sameday</option>
                            <option value="packeta">Packeta</option>
                            <option value="speedy">Speedy</option>
                        </select>
                    </div>
                    <div className="flex-1 min-w-[200px]">
                        <label className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Fișier CSV</label>
                        <input
                            type="file"
                            accept=".csv"
                            onChange={e => setCsvFile(e.target.files?.[0] || null)}
                            className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 dark:file:bg-violet-900/30 dark:file:text-violet-300"
                        />
                    </div>
                    <button
                        onClick={async () => {
                            if (!csvFile) return
                            setCsvUploading(true)
                            setCsvUploadPct(0)
                            setCsvImportStatus(null)
                            try {
                                const res = await courierCsvApi.importCsv(csvFile, csvCourier, pct => setCsvUploadPct(pct))
                                setCsvImportId(res.import_id)
                                setCsvImportStatus({ status: 'processing', ...res })
                                // Start polling
                                const poll = setInterval(async () => {
                                    try {
                                        const st = await courierCsvApi.getImportStatus(res.import_id)
                                        setCsvImportStatus(st)
                                        if (st.status !== 'processing') {
                                            clearInterval(poll)
                                            setCsvUploading(false)
                                            // Refresh history
                                            const h = await courierCsvApi.getImportHistory(10)
                                            setCsvHistory(h.imports || [])
                                        }
                                    } catch { clearInterval(poll); setCsvUploading(false) }
                                }, 2000)
                            } catch (err) {
                                setCsvImportStatus({ status: 'failed', error_message: err.message })
                                setCsvUploading(false)
                            }
                        }}
                        disabled={!csvFile || csvUploading}
                        className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-400 text-white rounded-lg font-medium text-sm transition-colors"
                    >
                        {csvUploading ? <Loader className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                        {csvUploading ? `Upload ${csvUploadPct}%` : 'Import'}
                    </button>
                    <button
                        onClick={async () => {
                            setCsvEstimating(true)
                            try {
                                const res = await courierCsvApi.triggerEstimation()
                                alert(`Estimare completă: ${res.orders_updated} comenzi actualizate, ${res.orders_no_match} fără potrivire`)
                            } catch (err) {
                                alert('Eroare: ' + err.message)
                            }
                            setCsvEstimating(false)
                        }}
                        disabled={csvEstimating}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-zinc-400 text-white rounded-lg font-medium text-sm transition-colors"
                        title="Estimare automată: copiază costurile de transport de la comenzi similare (aceleași produse)"
                    >
                        {csvEstimating ? <Loader className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        Estimare Lipsă
                    </button>
                </div>

                {/* Import status */}
                {csvImportStatus && (
                    <div className={`p-3 rounded-lg mb-4 text-sm ${csvImportStatus.status === 'completed' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800' :
                        csvImportStatus.status === 'failed' ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800' :
                            'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                        }`}>
                        <div className="font-medium">
                            {csvImportStatus.status === 'processing' && '⏳ Se procesează...'}
                            {csvImportStatus.status === 'completed' && '✅ Import finalizat'}
                            {csvImportStatus.status === 'failed' && '❌ Import eșuat'}
                        </div>
                        {csvImportStatus.total_rows > 0 && (
                            <div className="mt-1">
                                {csvImportStatus.total_rows} rânduri • {csvImportStatus.matched_rows} potrivite ({csvImportStatus.match_rate}%) • {csvImportStatus.unmatched_rows} nepotrivite
                            </div>
                        )}
                        {csvImportStatus.error_message && <div className="mt-1 text-xs">{csvImportStatus.error_message}</div>}
                        {csvImportStatus.preset_used && <div className="mt-1 text-xs">Preset: {csvImportStatus.preset_used}</div>}
                    </div>
                )}

                {/* Import history */}
                {csvHistory.length > 0 && (
                    <div className="mt-2">
                        <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Istoric importuri</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
                                        <th className="pb-1 pr-3">Data</th>
                                        <th className="pb-1 pr-3">Fișier</th>
                                        <th className="pb-1 pr-3">Curier</th>
                                        <th className="pb-1 pr-3">Rânduri</th>
                                        <th className="pb-1 pr-3">Potrivite</th>
                                        <th className="pb-1">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {csvHistory.map(imp => (
                                        <tr key={imp.id} className="border-b border-zinc-100 dark:border-zinc-700/50">
                                            <td className="py-1 pr-3 text-zinc-500 dark:text-zinc-400">{imp.imported_at ? new Date(imp.imported_at).toLocaleDateString('ro-RO') : '-'}</td>
                                            <td className="py-1 pr-3 truncate max-w-[150px] text-zinc-800 dark:text-zinc-200" title={imp.filename}>{imp.filename}</td>
                                            <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-300">{imp.courier_name}</td>
                                            <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-300">{imp.total_rows}</td>
                                            <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-300">{imp.matched_rows} ({imp.match_rate}%)</td>
                                            <td className="py-1">
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${imp.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                                                    imp.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                                                        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                                    }`}>{imp.status}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Import/Export */}
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">Configuration</h2>

                <div className="flex gap-4">
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        Export Config
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-colors">
                        <Upload className="w-4 h-4" />
                        Import Config
                    </button>
                </div>
            </div>
        </div>
    )
}
