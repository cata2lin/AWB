import { useEffect, useMemo, useRef, useState } from 'react'
import {
    Scale, UploadCloud, FileSpreadsheet, AlertTriangle, CheckCircle2,
    PackageX, Boxes, Coins, Download, X, Search,
} from 'lucide-react'
import { authFetch, API_URL } from '../../utils/authFetch'
import { toastSuccess, toastError, toastInfo } from '../../utils/toast'
import { formatNumber } from '../../utils/analyticsHelpers'
import { exportCsv } from '../../utils/csvExport'

const ron = (n) => `${formatNumber(Math.round(n || 0))} lei`
const kg = (n) => (n == null ? '—' : `${Number(n).toFixed(2)} kg`)
const money = (n) => (n == null ? '—' : `${Number(n).toFixed(2)}`)

// Status pill styling — each carries an explicit dark: sibling (CLAUDE.md Tier 3).
const STATUS_META = {
    all: { label: 'Toate', cls: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200' },
    PROBLEM: { label: 'Problemă', cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
    VOLUMETRIC: { label: 'Volumetric', cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
    PARTIAL: { label: 'SKU lipsă', cls: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' },
    UNDER: { label: 'Sub greutate', cls: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300' },
    OK: { label: 'OK', cls: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' },
    NO_SKU: { label: 'Fără SKU', cls: 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300' },
}

const fmtLocal = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function lastMonthRange() {
    const now = new Date()
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: fmtLocal(lm), to: fmtLocal(lmEnd) }
}

export default function CourierAuditTab({ selectedStores = [] }) {
    const [mode, setMode] = useState('upload') // 'upload' | 'imported'
    const [file, setFile] = useState(null)
    const [dragOver, setDragOver] = useState(false)
    const [threshold, setThreshold] = useState(0.5)
    const [minWeight, setMinWeight] = useState(3)
    const [{ from, to }, setRange] = useState(lastMonthRange())
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [activeFilter, setActiveFilter] = useState('all')
    const [search, setSearch] = useState('')
    const inputRef = useRef(null)

    useEffect(() => {
        // Reset results when switching analysis mode so stale numbers don't linger.
        setData(null)
        setActiveFilter('all')
    }, [mode])

    const results = useMemo(() => data?.results || [], [data])
    const summary = data?.summary || {}

    const counts = useMemo(() => {
        const c = { all: results.length }
        for (const r of results) c[r.status] = (c[r.status] || 0) + 1
        return c
    }, [results])

    const visibleRows = useMemo(() => {
        const q = search.trim().toLowerCase()
        return results.filter((r) => {
            if (activeFilter !== 'all' && r.status !== activeFilter) return false
            if (!q) return true
            const hay = `${r.awb} ${r.order_ref || ''} ${r.description || ''} ${(r.items || [])
                .map((i) => i.sku)
                .join(' ')}`.toLowerCase()
            return hay.includes(q)
        })
    }, [results, activeFilter, search])

    const handlePickFile = () => inputRef.current?.click()

    const handleFileChange = (e) => {
        const f = e.target.files?.[0]
        if (f) {
            setFile(f)
            toastInfo(`Fișier selectat: ${f.name}`)
        }
    }

    const handleDrop = (e) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f && /\.(xls|xlsx|csv)$/i.test(f.name)) {
            setFile(f)
            toastInfo(`Fișier selectat: ${f.name}`)
        } else if (f) {
            toastError('Format nesuportat. Folosește .csv, .xls sau .xlsx')
        }
    }

    const handleClearFile = () => setFile(null)

    const handleAnalyzeUpload = async () => {
        if (!file) {
            toastError('Selectează o factură DPD (.csv / .xls / .xlsx).')
            return
        }
        setLoading(true)
        try {
            const fd = new FormData()
            fd.append('file', file)
            fd.append('threshold', String(threshold))
            fd.append('min_weight', String(minWeight))
            const res = await authFetch(`${API_URL}/analytics/courier-audit`, {
                method: 'POST',
                body: fd,
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.detail || `HTTP ${res.status}`)
            }
            const json = await res.json()
            setData(json)
            setActiveFilter('all')
            const s = json.summary || {}
            toastSuccess(`Analiză completă: ${s.problems || 0} probleme, +${(s.total_excess_kg || 0).toFixed(2)} kg exces`)
        } catch (e) {
            toastError(e)
        } finally {
            setLoading(false)
        }
    }

    const handleAnalyzeImported = async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (from && to) { params.set('date_from', from); params.set('date_to', to) }
            if (selectedStores.length) params.set('store_uids', selectedStores.join(','))
            params.set('threshold', String(threshold))
            params.set('min_weight', String(minWeight))
            const res = await authFetch(`${API_URL}/analytics/courier-audit/imported?${params}`)
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.detail || `HTTP ${res.status}`)
            }
            const json = await res.json()
            setData(json)
            setActiveFilter('all')
            const s = json.summary || {}
            toastSuccess(`Analiză completă: ${s.problems || 0} probleme din ${s.parcels_above_min_weight || 0} AWB-uri`)
        } catch (e) {
            toastError(e)
        } finally {
            setLoading(false)
        }
    }

    const handleExportDispute = () => {
        const rows = data?.dispute_rows || []
        if (!rows.length) {
            toastError('Nicio sesizare de exportat (niciun colet cu status Problemă).')
            return
        }
        exportCsv({
            filename: 'sesizare_dpd',
            columns: [
                { key: 'awb', label: 'AWB' },
                { key: 'date', label: 'Data' },
                { key: 'order_ref', label: 'Referință comandă' },
                { key: 'billed_weight', label: 'Greutate facturată (kg)', format: (v) => Number(v || 0).toFixed(2) },
                { key: 'expected_weight', label: 'Greutate corectă (kg)', format: (v) => (v == null ? '' : Number(v).toFixed(2)) },
                { key: 'excess_kg', label: 'Exces (kg)', format: (v) => Number(v || 0).toFixed(2) },
                { key: 'amount', label: 'Cost facturat', format: (v) => Number(v || 0).toFixed(2) },
                { key: 'estimated_excess_cost', label: 'Cost exces estimat', format: (v) => Number(v || 0).toFixed(2) },
                { key: 'description', label: 'Conținut' },
            ],
            rows,
        })
        toastSuccess(`Sesizare exportată: ${rows.length} colete`)
    }

    return (
        <div className="space-y-5 mt-4">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20 flex-shrink-0">
                    <Scale className="w-4 h-4 text-white" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Audit Greutate Curier (DPD)</h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Detectează coletele facturate la o greutate mai mare decât cea reală și recuperează banii
                    </p>
                </div>
            </div>

            {/* Mode toggle */}
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => setMode('upload')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${mode === 'upload'
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
                >
                    Încarcă factură DPD
                </button>
                <button
                    onClick={() => setMode('imported')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${mode === 'imported'
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
                >
                    Analizează date importate
                </button>
            </div>

            {/* Controls */}
            {mode === 'upload' ? (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
                    {/* Drop zone */}
                    {!file ? (
                        <div
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            onClick={handlePickFile}
                            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${dragOver
                                ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                                : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 hover:border-violet-400'}`}
                        >
                            <UploadCloud className="w-10 h-10 mx-auto text-violet-500 mb-3" />
                            <div className="font-semibold text-zinc-800 dark:text-zinc-100">
                                Trage factura DPD aici sau click pentru a selecta
                            </div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                Formate acceptate: .csv, .xls, .xlsx
                            </div>
                            <input
                                ref={inputRef}
                                type="file"
                                accept=".csv,.xls,.xlsx"
                                onChange={handleFileChange}
                                className="hidden"
                            />
                        </div>
                    ) : (
                        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                                <FileSpreadsheet className="w-7 h-7 text-violet-500 flex-shrink-0" />
                                <div className="min-w-0">
                                    <div className="font-medium text-zinc-900 dark:text-white truncate">{file.name}</div>
                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                        {(file.size / 1024).toFixed(0)} KB
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={handleClearFile}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                title="Șterge fișierul"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    {/* Settings */}
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-4 space-y-3">
                        <SettingsFields
                            threshold={threshold} setThreshold={setThreshold}
                            minWeight={minWeight} setMinWeight={setMinWeight}
                        />
                        <button
                            onClick={handleAnalyzeUpload}
                            disabled={loading || !file}
                            className="w-full px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
                        >
                            {loading ? 'Se analizează…' : 'Pornește Audit'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                    <label className="block">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">De la</span>
                        <input
                            type="date" value={from}
                            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white text-sm dark:[color-scheme:dark]"
                        />
                    </label>
                    <label className="block">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">Până la</span>
                        <input
                            type="date" value={to}
                            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                            className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white text-sm dark:[color-scheme:dark]"
                        />
                    </label>
                    <SettingsFields
                        threshold={threshold} setThreshold={setThreshold}
                        minWeight={minWeight} setMinWeight={setMinWeight}
                        inline
                    />
                    <button
                        onClick={handleAnalyzeImported}
                        disabled={loading}
                        className="px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
                    >
                        {loading ? 'Se analizează…' : 'Analizează'}
                    </button>
                </div>
            )}

            {/* Volumetric note (imported path has no dims) */}
            {summary.volumetric_note && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800 dark:text-amber-200">{summary.volumetric_note}</p>
                </div>
            )}

            {loading && (
                <div className="text-sm text-zinc-500 dark:text-zinc-400">Se încarcă…</div>
            )}

            {!loading && data && (
                <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        <SummaryCard icon={Boxes} label="AWB analizate" value={formatNumber(summary.parcels_above_min_weight || 0)} />
                        <SummaryCard icon={AlertTriangle} label="Probleme" value={formatNumber(summary.problems || 0)} accent="red" />
                        <SummaryCard icon={Scale} label="Exces facturabil" value={`+${(summary.total_excess_kg || 0).toFixed(2)} kg`} accent="amber" />
                        <SummaryCard icon={Coins} label="Cost exces estimat" value={ron(summary.estimated_excess_cost)} accent="amber" />
                        <SummaryCard icon={PackageX} label="SKU necunoscute" value={formatNumber(summary.unknown_skus_count || 0)} />
                        <SummaryCard icon={CheckCircle2} label="OK" value={formatNumber(summary.ok || 0)} accent="emerald" />
                    </div>

                    {/* Toolbar: filter pills + search + export */}
                    <div className="flex flex-wrap items-center gap-2">
                        {['all', 'PROBLEM', 'VOLUMETRIC', 'PARTIAL', 'UNDER', 'OK'].map((k) => {
                            const meta = STATUS_META[k]
                            const n = counts[k] || 0
                            const active = activeFilter === k
                            return (
                                <button
                                    key={k}
                                    onClick={() => setActiveFilter(k)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${active
                                        ? 'ring-2 ring-violet-500 ' + meta.cls
                                        : meta.cls + ' opacity-80 hover:opacity-100'}`}
                                >
                                    {meta.label} <span className="font-bold">({n})</span>
                                </button>
                            )
                        })}
                        <div className="relative ml-auto">
                            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Caută AWB / SKU…"
                                className="pl-8 pr-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white text-sm w-48"
                            />
                        </div>
                        <button
                            onClick={handleExportDispute}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
                        >
                            <Download className="w-4 h-4" /> Descarcă sesizare
                        </button>
                    </div>

                    {/* Results table */}
                    {visibleRows.length === 0 ? (
                        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                            Niciun colet pentru filtrul selectat.
                        </div>
                    ) : (
                        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-x-auto max-h-[560px]">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 z-10">
                                    <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-left">
                                        <th className="px-3 py-2 font-medium">AWB</th>
                                        <th className="px-3 py-2 font-medium">Data</th>
                                        <th className="px-3 py-2 font-medium text-right">Cost</th>
                                        <th className="px-3 py-2 font-medium text-right">Greut. facturată</th>
                                        <th className="px-3 py-2 font-medium text-right">Greut. reală</th>
                                        <th className="px-3 py-2 font-medium text-right">Volumetric</th>
                                        <th className="px-3 py-2 font-medium text-right">Facturabil corect</th>
                                        <th className="px-3 py-2 font-medium text-right">Diferență</th>
                                        <th className="px-3 py-2 font-medium">SKU / Conținut</th>
                                        <th className="px-3 py-2 font-medium">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {visibleRows.map((r, i) => {
                                        const diff = r.billable_difference
                                        const diffCls = diff == null ? 'text-zinc-400'
                                            : diff > threshold ? 'text-red-600 dark:text-red-400 font-semibold'
                                                : diff < -threshold ? 'text-sky-600 dark:text-sky-400'
                                                    : 'text-zinc-600 dark:text-zinc-300'
                                        const skuText = (r.items || []).map((x) => `${x.qty}× ${x.sku}`).join(', ')
                                        return (
                                            <tr key={`${r.awb}-${i}`} className="bg-white dark:bg-zinc-900/40 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                                                <td className="px-3 py-2 font-mono text-xs text-zinc-900 dark:text-zinc-100">{r.awb || '—'}</td>
                                                <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{r.date || '—'}</td>
                                                <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-200">{money(r.amount)}</td>
                                                <td className="px-3 py-2 text-right font-medium text-zinc-900 dark:text-white">{kg(r.weight_dpd)}</td>
                                                <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-200">{kg(r.weight_calculated)}</td>
                                                <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-200">{kg(r.volumetric_weight)}</td>
                                                <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-200">{kg(r.expected_billable_weight)}</td>
                                                <td className={`px-3 py-2 text-right ${diffCls}`}>
                                                    {diff == null ? '—' : `${diff > 0 ? '+' : ''}${diff.toFixed(2)} kg`}
                                                </td>
                                                <td className="px-3 py-2 max-w-xs truncate text-zinc-600 dark:text-zinc-300" title={skuText || r.description}>
                                                    {skuText || r.description || '—'}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[r.status]?.cls || STATUS_META.NO_SKU.cls}`}>
                                                        {r.status_label || STATUS_META[r.status]?.label || r.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Unknown SKUs */}
                    {(summary.unknown_skus || []).length > 0 && (
                        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 p-4">
                            <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-2">
                                SKU-uri necunoscute ({summary.unknown_skus.length}) — nu au greutate învățată
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {summary.unknown_skus.slice(0, 60).map((sku) => (
                                    <span key={sku} className="px-2 py-0.5 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
                                        {sku}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

function SettingsFields({ threshold, setThreshold, minWeight, setMinWeight, inline = false }) {
    return (
        <div className={inline ? 'grid grid-cols-2 gap-2' : 'space-y-3'}>
            <label className="block">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Ignoră sub (kg)</span>
                <input
                    type="number" min="0" step="0.1" value={minWeight}
                    onChange={(e) => setMinWeight(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white text-sm"
                />
            </label>
            <label className="block">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Prag toleranță (kg)</span>
                <input
                    type="number" min="0" step="0.1" value={threshold}
                    onChange={(e) => setThreshold(parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white text-sm"
                />
            </label>
        </div>
    )
}

const ACCENT = {
    red: 'text-red-600 dark:text-red-400',
    amber: 'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    default: 'text-zinc-900 dark:text-white',
}

function SummaryCard({ icon: IconComponent, label, value, accent = 'default' }) {
    return (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                {IconComponent ? <IconComponent className="w-3.5 h-3.5" /> : null} {label}
            </div>
            <div className={`mt-1 text-lg font-bold ${ACCENT[accent] || ACCENT.default}`}>{value}</div>
        </div>
    )
}
