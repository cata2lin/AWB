import { Fragment, useMemo, useState } from 'react'
import {
    TrendingUp, RefreshCw, Search, ChevronDown, Plus, Trash2, AlertTriangle, Download,
} from 'lucide-react'
import { formatNumber, marginColor, marginBg } from '../../utils/analyticsHelpers'
import { analyticsApi, skuMarketingCostsApi } from '../../services/api'
import ColumnsMenu from '../../components/ui/ColumnsMenu'
import { useColumnVisibility } from '../../hooks/useColumnVisibility'
import { exportCsv } from '../../utils/csvExport'

const SKU_PROFIT_COLUMNS = [
    { key: 'sku',          header: 'SKU',         alwaysVisible: true },
    { key: 'name',         header: 'Nume' },
    { key: 'units_sold',   header: 'Unități' },
    { key: 'revenue',      header: 'Venituri' },
    { key: 'cogs',         header: 'COGS' },
    { key: 'transport',    header: 'Transport' },
    { key: 'fees',         header: 'Taxe' },
    { key: 'marketing',    header: 'Marketing' },
    { key: 'contribution', header: 'Contribuție' },
    { key: 'margin_pct',   header: 'Marjă %' },
    { key: 'return_rate',  header: 'Retur %' },
]

export default function SkuProfitabilityTab({ stores = [] }) {
    const [skuProfitData, setSkuProfitData] = useState(null)
    const [skuProfitLoading, setSkuProfitLoading] = useState(false)
    const [skuProfitDays, setSkuProfitDays] = useState(30)
    const [skuProfitDateFrom, setSkuProfitDateFrom] = useState('')
    const [skuProfitDateTo, setSkuProfitDateTo] = useState('')
    const [skuProfitStore, setSkuProfitStore] = useState('')
    const [skuProfitSearch, setSkuProfitSearch] = useState('')
    const [skuProfitSort, setSkuProfitSort] = useState({ col: 'revenue', dir: 'desc' })
    const [skuProfitExpanded, setSkuProfitExpanded] = useState(null)
    const [newMktCost, setNewMktCost] = useState({ sku: '', label: '', amount: '', month: '' })
    const [addingMktFor, setAddingMktFor] = useState(null)

    const {
        visibleKeys,
        setVisibleKeys,
        defaultVisibleKeys,
    } = useColumnVisibility('profitabilitate-sku', SKU_PROFIT_COLUMNS)
    const colVisible = useMemo(
        () => (key) => visibleKeys.includes(key) || SKU_PROFIT_COLUMNS.find((c) => c.key === key)?.alwaysVisible,
        [visibleKeys],
    )

    const fetchData = async () => {
        setSkuProfitLoading(true)
        try {
            const params = {}
            if (skuProfitDateFrom && skuProfitDateTo) {
                params.date_from = skuProfitDateFrom
                params.date_to = skuProfitDateTo
            } else {
                params.days = skuProfitDays
            }
            if (skuProfitStore) params.store_uids = skuProfitStore
            const data = await analyticsApi.getSkuProfitability(params)
            setSkuProfitData(data)
        } catch (err) {
            console.error('SKU profitability error:', err)
        } finally {
            setSkuProfitLoading(false)
        }
    }

    const handleAddMktCost = async (sku) => {
        try {
            await skuMarketingCostsApi.create({
                sku,
                label: newMktCost.label,
                amount: parseFloat(newMktCost.amount) || 0,
                month: newMktCost.month || new Date().toISOString().slice(0, 7),
            })
            setNewMktCost({ sku: '', label: '', amount: '', month: '' })
            setAddingMktFor(null)
            // Refresh data
            fetchData()
        } catch (err) {
            console.error('Add marketing cost error:', err)
        }
    }

    const handleDeleteMktCost = async (id) => {
        try {
            await skuMarketingCostsApi.delete(id)
            fetchData()
        } catch (err) {
            console.error('Delete marketing cost error:', err)
        }
    }

    // Show empty state if no data and not loading
    if (!skuProfitData && !skuProfitLoading) {
        return (
            <div className="space-y-6">
                {/* Filter Bar */}
                <div className="bg-white dark:bg-zinc-800/80 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-4">
                    <div className="flex flex-wrap items-end gap-4">
                        <div>
                            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">Perioadă</label>
                            <div className="flex gap-1">
                                {[7, 30, 90, 180, 365].map(d => (
                                    <button key={d} onClick={() => { setSkuProfitDays(d); setSkuProfitDateFrom(''); setSkuProfitDateTo('') }}
                                        className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${skuProfitDays === d && !skuProfitDateFrom
                                            ? 'bg-amber-500 text-white shadow-sm' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'}`}>
                                        {d}z
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">Magazin</label>
                            <select value={skuProfitStore} onChange={e => setSkuProfitStore(e.target.value)}
                                className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white">
                                <option value="">Toate</option>
                                {stores.map(s => <option key={s.uid} value={s.uid}>{s.name}</option>)}
                            </select>
                        </div>
                        <button onClick={fetchData}
                            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 shadow-sm">
                            <TrendingUp className="w-4 h-4" /> Analizează
                        </button>
                    </div>
                </div>
                <div className="text-center py-16 text-zinc-500 dark:text-zinc-400">
                    <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-lg font-medium">Selectează filtrele și apasă Analizează</p>
                    <p className="text-sm mt-1">Profitabilitatea per SKU va fi calculată pe baza filtrelor selectate.</p>
                </div>
            </div>
        )
    }

    const products = skuProfitData?.products || []
    const summary = skuProfitData?.summary || {}

    // Filter
    const filtered = products.filter(p => {
        if (!skuProfitSearch) return true
        const q = skuProfitSearch.toLowerCase()
        return (p.sku || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q)
    })

    // Sort
    const sorted = [...filtered].sort((a, b) => {
        const col = skuProfitSort.col
        const dir = skuProfitSort.dir === 'asc' ? 1 : -1
        const av = a[col] ?? 0
        const bv = b[col] ?? 0
        if (typeof av === 'string') return av.localeCompare(bv) * dir
        return (av - bv) * dir
    })

    const toggleSort = (col) => {
        setSkuProfitSort(prev => ({
            col,
            dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc'
        }))
    }

    const sortIcon = (col) => {
        if (skuProfitSort.col !== col) return '↕'
        return skuProfitSort.dir === 'asc' ? '↑' : '↓'
    }

    const problems = sorted.filter(p => !p.has_cost || p.margin_pct < 0 || p.return_rate > 20)

    return (
        <div className="space-y-6">

            {/* Filter Bar */}
            <div className="bg-white dark:bg-zinc-800/80 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-4">
                <div className="flex flex-wrap items-end gap-4">
                    {/* Period presets */}
                    <div>
                        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">Perioadă</label>
                        <div className="flex gap-1">
                            {[7, 30, 90, 180, 365].map(d => (
                                <button key={d} onClick={() => { setSkuProfitDays(d); setSkuProfitDateFrom(''); setSkuProfitDateTo('') }}
                                    className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${skuProfitDays === d && !skuProfitDateFrom
                                        ? 'bg-amber-500 text-white shadow-sm' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'}`}>
                                    {d}z
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* Custom dates */}
                    <div>
                        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">De la</label>
                        <input type="date" value={skuProfitDateFrom} onChange={e => setSkuProfitDateFrom(e.target.value)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:[color-scheme:dark]" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">Până la</label>
                        <input type="date" value={skuProfitDateTo} onChange={e => setSkuProfitDateTo(e.target.value)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:[color-scheme:dark]" />
                    </div>
                    {/* Store filter */}
                    <div>
                        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">Magazin</label>
                        <select value={skuProfitStore} onChange={e => setSkuProfitStore(e.target.value)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white">
                            <option value="">Toate</option>
                            {stores.map(s => <option key={s.uid} value={s.uid}>{s.name}</option>)}
                        </select>
                    </div>
                    {/* Min units */}
                    <div>
                        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">Min. unități</label>
                        <input type="number" min="0" value={0}
                            className="w-16 px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white" readOnly />
                    </div>
                    {/* Analyze button */}
                    <button onClick={fetchData}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 shadow-sm">
                        <TrendingUp className="w-4 h-4" /> Analizează
                    </button>
                </div>
            </div>

            {skuProfitLoading ? (
                <div className="flex items-center justify-center py-20">
                    <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
                    <span className="ml-3 text-zinc-500 dark:text-zinc-300">Se calculează profitabilitatea per produs...</span>
                </div>
            ) : skuProfitData ? (
                <>
                    {/* KPI Summary */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">Produse Analizate</div>
                            <div className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">{formatNumber(summary.total_products || 0)}</div>
                            <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{formatNumber(summary.orders_processed || 0)} comenzi</div>
                        </div>
                        <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">Venituri Totale</div>
                            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{formatNumber(Math.round(summary.total_revenue || 0))} RON</div>
                        </div>
                        <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">Costuri Totale</div>
                            <div className="text-2xl font-bold text-red-500 dark:text-red-400 mt-1">{formatNumber(Math.round(summary.total_costs || 0))} RON</div>
                        </div>
                        <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">Contribuție Totală</div>
                            <div className={`text-2xl font-bold mt-1 ${(summary.total_contribution || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                {formatNumber(Math.round(summary.total_contribution || 0))} RON
                            </div>
                        </div>
                        <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">Marjă Medie</div>
                            <div className={`text-2xl font-bold mt-1 ${marginColor(summary.avg_margin || 0)}`}>{summary.avg_margin || 0}%</div>
                            {summary.products_without_cost > 0 && (
                                <div className="text-xs text-amber-500 mt-1">⚠ {summary.products_without_cost} fără cost</div>
                            )}
                        </div>
                    </div>

                    {/* Search + actions */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative flex-1 max-w-md">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                            <input
                                type="text"
                                placeholder="Caută SKU sau nume produs..."
                                value={skuProfitSearch}
                                onChange={e => setSkuProfitSearch(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-800 dark:text-white placeholder-zinc-400"
                            />
                        </div>
                        <div className="text-sm text-zinc-500 dark:text-zinc-400">
                            {sorted.length} produse afișate
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                            <ColumnsMenu
                                columns={SKU_PROFIT_COLUMNS}
                                visibleKeys={visibleKeys}
                                onChange={setVisibleKeys}
                                defaultVisibleKeys={defaultVisibleKeys}
                            />
                            <button
                                onClick={() => {
                                    const cols = SKU_PROFIT_COLUMNS.filter((c) => colVisible(c.key)).map((c) => ({
                                        key: c.key,
                                        label: c.header,
                                        accessor: (row) => {
                                            if (['revenue', 'cogs', 'transport', 'fees', 'marketing', 'contribution'].includes(c.key)) {
                                                return Math.round(row[c.key] || 0)
                                            }
                                            if (c.key === 'margin_pct' || c.key === 'return_rate') return `${row[c.key] ?? 0}%`
                                            return row[c.key] ?? ''
                                        },
                                    }))
                                    exportCsv({ filename: 'profitabilitate_sku', columns: cols, rows: sorted })
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                                title="Descarcă CSV cu coloanele vizibile">
                                <Download className="w-4 h-4" /> CSV
                            </button>
                        </div>
                    </div>

                    {/* Main Product Table */}
                    <div className="bg-white dark:bg-zinc-800/80 rounded-xl border border-zinc-200 dark:border-zinc-700/50 overflow-clip">
                        <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                    <tr className="border-b border-zinc-200 dark:border-zinc-700">
                                        <th className="text-left px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs w-8"></th>
                                        {colVisible('sku') && (
                                            <th onClick={() => toggleSort('sku')} className="text-left px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                                SKU {sortIcon('sku')}
                                            </th>
                                        )}
                                        {colVisible('name') && (
                                            <th onClick={() => toggleSort('name')} className="text-left px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                                Nume {sortIcon('name')}
                                            </th>
                                        )}
                                        {colVisible('units_sold') && (
                                            <th onClick={() => toggleSort('units_sold')} className="text-right px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                                Unități {sortIcon('units_sold')}
                                            </th>
                                        )}
                                        {colVisible('revenue') && (
                                            <th onClick={() => toggleSort('revenue')} className="text-right px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                                Venituri {sortIcon('revenue')}
                                            </th>
                                        )}
                                        {colVisible('cogs') && (
                                            <th onClick={() => toggleSort('cogs')} className="text-right px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                                COGS {sortIcon('cogs')}
                                            </th>
                                        )}
                                        {colVisible('transport') && (
                                            <th onClick={() => toggleSort('transport')} className="text-right px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                                Transport {sortIcon('transport')}
                                            </th>
                                        )}
                                        {colVisible('fees') && (
                                            <th onClick={() => toggleSort('fees')} className="text-right px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                                Taxe {sortIcon('fees')}
                                            </th>
                                        )}
                                        {colVisible('marketing') && (
                                            <th onClick={() => toggleSort('marketing')} className="text-right px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                                Marketing {sortIcon('marketing')}
                                            </th>
                                        )}
                                        {colVisible('contribution') && (
                                            <th onClick={() => toggleSort('contribution')} className="text-right px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                                Contribuție {sortIcon('contribution')}
                                            </th>
                                        )}
                                        {colVisible('margin_pct') && (
                                            <th onClick={() => toggleSort('margin_pct')} className="text-right px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                                Marjă % {sortIcon('margin_pct')}
                                            </th>
                                        )}
                                        {colVisible('return_rate') && (
                                            <th onClick={() => toggleSort('return_rate')} className="text-right px-3 py-2.5 font-semibold text-zinc-600 dark:text-zinc-200 text-xs cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                                Retur % {sortIcon('return_rate')}
                                            </th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((p) => (
                                        <Fragment key={p.sku}>
                                            <tr className={`border-b border-zinc-100 dark:border-zinc-700/30 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition-colors cursor-pointer ${!p.has_cost ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}
                                                onClick={() => setSkuProfitExpanded(skuProfitExpanded === p.sku ? null : p.sku)}>
                                                <td className="px-3 py-2">
                                                    <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${skuProfitExpanded === p.sku ? 'rotate-180' : ''}`} />
                                                </td>
                                                {colVisible('sku') && <td className="px-3 py-2 font-mono text-xs text-zinc-800 dark:text-zinc-100 font-medium">{p.sku}</td>}
                                                {colVisible('name') && <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200 text-xs max-w-[200px] truncate">{p.name || '—'}</td>}
                                                {colVisible('units_sold') && <td className="px-3 py-2 text-right text-zinc-800 dark:text-zinc-100">{formatNumber(p.units_sold)}</td>}
                                                {colVisible('revenue') && <td className="px-3 py-2 text-right font-medium text-zinc-900 dark:text-white">{formatNumber(Math.round(p.revenue))}</td>}
                                                {colVisible('cogs') && <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{formatNumber(Math.round(p.cogs))}</td>}
                                                {colVisible('transport') && <td className="px-3 py-2 text-right text-orange-600 dark:text-orange-400">{formatNumber(Math.round(p.transport))}</td>}
                                                {colVisible('fees') && <td className="px-3 py-2 text-right text-purple-600 dark:text-purple-400">{formatNumber(Math.round(p.fees))}</td>}
                                                {colVisible('marketing') && <td className="px-3 py-2 text-right text-blue-600 dark:text-blue-400">{formatNumber(Math.round(p.marketing))}</td>}
                                                {colVisible('contribution') && (
                                                    <td className={`px-3 py-2 text-right font-semibold ${p.contribution >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                                        {formatNumber(Math.round(p.contribution))}
                                                    </td>
                                                )}
                                                {colVisible('margin_pct') && (
                                                    <td className="px-3 py-2 text-right">
                                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${marginBg(p.margin_pct)} ${marginColor(p.margin_pct)}`}>
                                                            {p.margin_pct}%
                                                        </span>
                                                    </td>
                                                )}
                                                {colVisible('return_rate') && (
                                                    <td className="px-3 py-2 text-right">
                                                        <span className={`text-xs ${p.return_rate > 20 ? 'text-red-500 dark:text-red-400 font-semibold' : 'text-zinc-600 dark:text-zinc-300'}`}>
                                                            {p.return_rate}%
                                                        </span>
                                                    </td>
                                                )}
                                            </tr>
                                            {/* Expanded Row */}
                                            {skuProfitExpanded === p.sku && (
                                                <tr>
                                                    <td colSpan={1 + SKU_PROFIT_COLUMNS.filter(c => colVisible(c.key)).length} className="bg-zinc-50 dark:bg-zinc-900/40 px-6 py-4">
                                                        <div className="space-y-4">
                                                            {/* Detail cards */}
                                                            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                                                                <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
                                                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Preț Mediu</div>
                                                                    <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{p.avg_selling_price} RON</div>
                                                                </div>
                                                                <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
                                                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Cost/Unitate</div>
                                                                    <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{p.cost_per_unit} RON</div>
                                                                </div>
                                                                <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
                                                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Nr. Comenzi</div>
                                                                    <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{formatNumber(p.orders_count)}</div>
                                                                </div>
                                                                <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
                                                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Unități Returnate</div>
                                                                    <div className="text-sm font-bold text-red-500 dark:text-red-400">{formatNumber(p.units_returned)}</div>
                                                                </div>
                                                                <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
                                                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Total Costuri</div>
                                                                    <div className="text-sm font-bold text-red-500 dark:text-red-400">{formatNumber(Math.round(p.total_costs))} RON</div>
                                                                </div>
                                                                <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
                                                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Cost Produs</div>
                                                                    <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{p.has_cost ? 'âœ… Setat' : 'âŒ Lipsă'}</div>
                                                                </div>
                                                            </div>

                                                            {/* Per-store breakdown */}
                                                            {p.per_store && p.per_store.length > 0 && (
                                                                <div>
                                                                    <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-2">📊 Per Magazin</h4>
                                                                    <div className="overflow-x-auto">
                                                                        <table className="w-full text-xs">
                                                                            <thead className="bg-zinc-100 dark:bg-zinc-800">
                                                                                <tr>
                                                                                    <th className="text-left px-3 py-2 text-zinc-600 dark:text-zinc-300 font-semibold">Magazin</th>
                                                                                    <th className="text-right px-3 py-2 text-zinc-600 dark:text-zinc-300 font-semibold">Unități</th>
                                                                                    <th className="text-right px-3 py-2 text-zinc-600 dark:text-zinc-300 font-semibold">Venituri</th>
                                                                                    <th className="text-right px-3 py-2 text-zinc-600 dark:text-zinc-300 font-semibold">COGS</th>
                                                                                    <th className="text-right px-3 py-2 text-zinc-600 dark:text-zinc-300 font-semibold">Transport</th>
                                                                                    <th className="text-right px-3 py-2 text-zinc-600 dark:text-zinc-300 font-semibold">Taxe</th>
                                                                                    <th className="text-right px-3 py-2 text-zinc-600 dark:text-zinc-300 font-semibold">Contribuție</th>
                                                                                    <th className="text-right px-3 py-2 text-zinc-600 dark:text-zinc-300 font-semibold">Marjă %</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {p.per_store.map(s => (
                                                                                    <tr key={s.store_uid} className="border-b border-zinc-100 dark:border-zinc-700/30">
                                                                                        <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300 font-medium">{s.store_name}</td>
                                                                                        <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-300">{formatNumber(s.units_sold)}</td>
                                                                                        <td className="px-3 py-2 text-right text-zinc-700 dark:text-zinc-200">{formatNumber(Math.round(s.revenue))}</td>
                                                                                        <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{formatNumber(Math.round(s.cogs))}</td>
                                                                                        <td className="px-3 py-2 text-right text-orange-600 dark:text-orange-400">{formatNumber(Math.round(s.transport))}</td>
                                                                                        <td className="px-3 py-2 text-right text-purple-600 dark:text-purple-400">{formatNumber(Math.round(s.fees))}</td>
                                                                                        <td className={`px-3 py-2 text-right font-semibold ${s.contribution >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                                                                            {formatNumber(Math.round(s.contribution))}
                                                                                        </td>
                                                                                        <td className="px-3 py-2 text-right">
                                                                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${marginBg(s.margin_pct)} ${marginColor(s.margin_pct)}`}>
                                                                                                {s.margin_pct}%
                                                                                            </span>
                                                                                        </td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Marketing costs for this SKU */}
                                                            <div>
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">💰 Costuri Marketing</h4>
                                                                    <button onClick={(e) => { e.stopPropagation(); setAddingMktFor(addingMktFor === p.sku ? null : p.sku) }}
                                                                        className="text-xs px-2 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors">
                                                                        <Plus className="w-3 h-3 inline mr-1" />Adaugă
                                                                    </button>
                                                                </div>

                                                                {/* Existing entries */}
                                                                {p.marketing_entries && p.marketing_entries.length > 0 ? (
                                                                    <div className="space-y-1">
                                                                        {p.marketing_entries.map(m => (
                                                                            <div key={m.id} className="flex items-center justify-between bg-white dark:bg-zinc-800 rounded-lg px-3 py-2 border border-zinc-200 dark:border-zinc-700">
                                                                                <div className="flex items-center gap-3">
                                                                                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{m.month}</span>
                                                                                    <span className="text-xs text-zinc-700 dark:text-zinc-300">{m.label}</span>
                                                                                </div>
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">{m.amount} RON</span>
                                                                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteMktCost(m.id) }}
                                                                                        className="text-red-400 hover:text-red-600 transition-colors">
                                                                                        <Trash2 className="w-3 h-3" />
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">Niciun cost de marketing definit</p>
                                                                )}

                                                                {/* Add form */}
                                                                {addingMktFor === p.sku && (
                                                                    <div className="mt-2 flex items-end gap-2 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg p-3 border border-blue-200 dark:border-blue-800/30" onClick={e => e.stopPropagation()}>
                                                                        <div className="flex-1">
                                                                            <label className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Descriere</label>
                                                                            <input type="text" placeholder="Ex: Facebook Ads Martie" value={newMktCost.label}
                                                                                onChange={e => setNewMktCost(prev => ({ ...prev, label: e.target.value }))}
                                                                                className="w-full px-2 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white" />
                                                                        </div>
                                                                        <div className="w-24">
                                                                            <label className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Sumă (RON)</label>
                                                                            <input type="number" placeholder="0" value={newMktCost.amount}
                                                                                onChange={e => setNewMktCost(prev => ({ ...prev, amount: e.target.value }))}
                                                                                className="w-full px-2 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white" />
                                                                        </div>
                                                                        <div className="w-28">
                                                                            <label className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Lună</label>
                                                                            <input type="month" value={newMktCost.month || new Date().toISOString().slice(0, 7)}
                                                                                onChange={e => setNewMktCost(prev => ({ ...prev, month: e.target.value }))}
                                                                                className="w-full px-2 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white dark:[color-scheme:dark]" />
                                                                        </div>
                                                                        <button onClick={() => handleAddMktCost(p.sku)}
                                                                            className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-lg transition-colors font-medium">
                                                                            Salvează
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))}
                                    {sorted.length === 0 && (
                                        <tr>
                                            <td colSpan={1 + SKU_PROFIT_COLUMNS.filter(c => colVisible(c.key)).length} className="text-center py-12 text-zinc-500 dark:text-zinc-400">
                                                Niciun produs găsit
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Problems Section */}
                    {problems.length > 0 && (
                        <div className="bg-red-50/50 dark:bg-red-900/10 rounded-xl border border-red-200 dark:border-red-800/30 p-4">
                            <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-3 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />
                                Probleme Detectate ({problems.length} produse)
                            </h3>
                            <div className="space-y-1 max-h-[300px] overflow-y-auto">
                                {problems.map(p => (
                                    <div key={p.sku} className="flex items-center justify-between bg-white/50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-xs">
                                        <div className="flex items-center gap-3">
                                            <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">{p.sku}</span>
                                            <span className="text-zinc-500 dark:text-zinc-400 truncate max-w-[200px]">{p.name || '—'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {!p.has_cost && <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs">Cost Lipsă</span>}
                                            {p.margin_pct < 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs">Marjă Negativă ({p.margin_pct}%)</span>}
                                            {p.return_rate > 20 && <span className="px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-xs">Retur Ridicat ({p.return_rate}%)</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            ) : null}
        </div>
    )
}
