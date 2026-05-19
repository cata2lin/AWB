import { Fragment, useState } from 'react'
import {
    AlertTriangle, Search, RefreshCw, Truck, Store, Download,
} from 'lucide-react'
import { analyticsApi } from '../../services/api'
import ColumnsMenu from '../../components/ui/ColumnsMenu'
import { useColumnVisibility } from '../../hooks/useColumnVisibility'
import { exportCsv } from '../../utils/csvExport'

const SKU_RISK_COLUMNS = [
    { key: 'sku',                    header: 'SKU',          alwaysVisible: true },
    { key: 'units_sold',             header: 'Unități' },
    { key: 'orders_with_sku',        header: 'Comenzi' },
    { key: 'problem_units',          header: 'Probl. Units' },
    { key: 'problem_rate',           header: 'Probl. Rate' },
    { key: 'contamination_rate',     header: 'Contaminare %' },
    { key: 'units_back_to_sender',   header: 'BTS' },
    { key: 'units_cancelled',        header: 'Anulate' },
    { key: 'units_refused',          header: 'Refuzate' },
    { key: 'shipping_anomaly_rate',  header: 'Anom. Shipping' },
    { key: 'avg_ship_cost_per_unit', header: 'Avg Ship/u' },
    { key: 'risk_score',             header: 'Risk Score',   alwaysVisible: true },
]

export default function SkuRiskTab({ stores = [] }) {
    const [skuRiskData, setSkuRiskData] = useState(null)
    const [skuRiskLoading, setSkuRiskLoading] = useState(false)
    const [skuRiskDays, setSkuRiskDays] = useState(30)
    const [skuRiskStore, setSkuRiskStore] = useState('')
    const [skuRiskCourier] = useState('')
    const [skuRiskMinUnits, setSkuRiskMinUnits] = useState(30)
    const [skuRiskMinOrders, setSkuRiskMinOrders] = useState(20)
    const [skuRiskInclDelivery, setSkuRiskInclDelivery] = useState(false)
    const [skuRiskSort, setSkuRiskSort] = useState({ col: 'risk_score', dir: 'desc' })
    const [skuRiskExpanded, setSkuRiskExpanded] = useState(null)
    const [skuRiskAnomalyPage, setSkuRiskAnomalyPage] = useState(0)
    const [skuRiskSearch, setSkuRiskSearch] = useState('')

    const {
        visibleKeys,
        setVisibleKeys,
        defaultVisibleKeys,
    } = useColumnVisibility('sku-risk', SKU_RISK_COLUMNS)
    const colVisible = (key) => visibleKeys.includes(key) || SKU_RISK_COLUMNS.find(c => c.key === key)?.alwaysVisible

    const fetchSkuRisk = async () => {
        setSkuRiskLoading(true)
        try {
            const params = { days: skuRiskDays, min_units_sold: skuRiskMinUnits, min_orders_with_sku: skuRiskMinOrders, include_delivery_problems: skuRiskInclDelivery }
            if (skuRiskStore) params.store_uids = skuRiskStore
            if (skuRiskCourier) params.courier_name = skuRiskCourier
            const data = await analyticsApi.getSkuRisk(params)
            setSkuRiskData(data)
        } catch (e) { console.error('SKU Risk fetch error:', e) }
        finally { setSkuRiskLoading(false) }
    }

    const sortedSkus = skuRiskData?.worst_skus ? [...skuRiskData.worst_skus]
        .filter(s => {
            if (!skuRiskSearch) return true
            const q = skuRiskSearch.toLowerCase()
            return (s.sku || '').toLowerCase().includes(q) || (s.product_name || '').toLowerCase().includes(q)
        })
        .sort((a, b) => {
            const col = skuRiskSort.col
            const av = a[col] ?? -1, bv = b[col] ?? -1
            return skuRiskSort.dir === 'desc' ? bv - av : av - bv
        }) : []

    const anomalyPage = skuRiskData?.anomaly_orders || []
    const anomalyPerPage = 20
    const anomalySlice = anomalyPage.slice(skuRiskAnomalyPage * anomalyPerPage, (skuRiskAnomalyPage + 1) * anomalyPerPage)
    const anomalyTotalPages = Math.ceil(anomalyPage.length / anomalyPerPage)

    const riskColor = (score) => {
        if (score === null || score === undefined) return 'text-zinc-400'
        if (score >= 60) return 'text-red-600 dark:text-red-400'
        if (score >= 30) return 'text-amber-600 dark:text-amber-400'
        return 'text-green-600 dark:text-green-400'
    }
    const riskBg = (score) => {
        if (score === null || score === undefined) return 'bg-zinc-100 dark:bg-zinc-700'
        if (score >= 60) return 'bg-red-50 dark:bg-red-900/20'
        if (score >= 30) return 'bg-amber-50 dark:bg-amber-900/20'
        return 'bg-green-50 dark:bg-green-900/20'
    }

    const SortHeader = ({ col, label, tip }) => (
        <th
            className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200 select-none bg-zinc-50 dark:bg-zinc-900"
            onClick={() => setSkuRiskSort(prev => ({ col, dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc' }))}
            title={tip || ''}
        >
            {label} {skuRiskSort.col === col ? (skuRiskSort.dir === 'desc' ? '↓' : '↑') : ''}
        </th>
    )

    return (
        <div className="space-y-6">
            {/* Section A: Controls */}
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                <div className="flex flex-wrap items-end gap-4">
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Perioadă</label>
                        <div className="flex gap-1">
                            {[7, 30, 90, 180].map(d => (
                                <button key={d} onClick={() => setSkuRiskDays(d)}
                                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${skuRiskDays === d ? 'bg-red-600 text-white border-red-600' : 'border-zinc-200 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'}`}
                                >{d}z</button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Magazin</label>
                        <select value={skuRiskStore} onChange={e => setSkuRiskStore(e.target.value)}
                            className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white">
                            <option value="">Toate</option>
                            {stores.map(s => <option key={s.uid} value={s.uid}>{s.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Min. unități</label>
                        <input type="number" value={skuRiskMinUnits} onChange={e => setSkuRiskMinUnits(Number(e.target.value) || 1)}
                            className="w-20 px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Min. comenzi</label>
                        <input type="number" value={skuRiskMinOrders} onChange={e => setSkuRiskMinOrders(Number(e.target.value) || 1)}
                            className="w-20 px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300 cursor-pointer">
                        <input type="checkbox" checked={skuRiskInclDelivery} onChange={e => setSkuRiskInclDelivery(e.target.checked)}
                            className="rounded border-zinc-300" />
                        +Delivery Problems
                    </label>
                    <div>
                        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Caută SKU</label>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                            <input type="text" value={skuRiskSearch} onChange={e => setSkuRiskSearch(e.target.value)}
                                placeholder="SKU sau produs..."
                                className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white w-44" />
                        </div>
                    </div>
                    <button onClick={fetchSkuRisk} disabled={skuRiskLoading}
                        className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5">
                        {skuRiskLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                        Analizează
                    </button>
                </div>
                {skuRiskData?.meta && (
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>📦 {skuRiskData.meta.filtered_orders.toLocaleString()} comenzi</span>
                        <span>🏷️ {skuRiskData.meta.unique_skus} SKU-uri ({skuRiskData.meta.skus_passing_volume} cu volum suficient)</span>
                        <span>🚚 Acoperire shipping: {skuRiskData.meta.shipping_coverage_pct}%</span>
                    </div>
                )}
            </div>

            {skuRiskLoading && (
                <div className="flex items-center justify-center py-12">
                    <RefreshCw className="w-8 h-8 text-red-500 animate-spin" />
                    <span className="ml-3 text-zinc-500 dark:text-white">Se analizează riscurile...</span>
                </div>
            )}

            {skuRiskData && !skuRiskLoading && (
                <>
                    {/* Section B: Worst SKUs Table */}
                    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-500" />
                                SKU-uri problematice — Ranked by Risk Score
                            </h3>
                            <div className="flex items-center gap-2">
                                <ColumnsMenu
                                    columns={SKU_RISK_COLUMNS}
                                    visibleKeys={visibleKeys}
                                    onChange={setVisibleKeys}
                                    defaultVisibleKeys={defaultVisibleKeys}
                                />
                                <button
                                    onClick={() => {
                                        const cols = SKU_RISK_COLUMNS.filter(c => colVisible(c.key)).map(c => ({
                                            key: c.key,
                                            label: c.header,
                                            accessor: (s) => {
                                                if (c.key === 'risk_score') return s.risk_score ?? ''
                                                if (c.key.endsWith('_rate')) return `${s[c.key] ?? 0}%`
                                                return s[c.key] ?? ''
                                            },
                                        }))
                                        exportCsv({ filename: `sku_risk_${skuRiskDays}z`, columns: cols, rows: sortedSkus })
                                    }}
                                    title="Export CSV"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700">
                                    <Download className="w-4 h-4" /> CSV
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
                            <table className="w-full">
                                <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-300 w-8">#</th>
                                        {colVisible('sku') && <SortHeader col="sku" label="SKU" />}
                                        {colVisible('units_sold') && <SortHeader col="units_sold" label="Unități" tip="Total unități vândute" />}
                                        {colVisible('orders_with_sku') && <SortHeader col="orders_with_sku" label="Comenzi" tip="Comenzi care conțin acest SKU" />}
                                        {colVisible('problem_units') && <SortHeader col="problem_units" label="Prob. Units" tip="Unități în comenzi returnate/refuzate/anulate" />}
                                        {colVisible('problem_rate') && <SortHeader col="problem_rate" label="Prob. Rate" tip="Problem units / total units × 100" />}
                                        {colVisible('contamination_rate') && <SortHeader col="contamination_rate" label="Contam. %" tip="% comenzi cu SKU care sunt problematice" />}
                                        {colVisible('units_back_to_sender') && <SortHeader col="units_back_to_sender" label="BTS" tip="Back to Sender" />}
                                        {colVisible('units_cancelled') && <SortHeader col="units_cancelled" label="Anul." />}
                                        {colVisible('units_refused') && <SortHeader col="units_refused" label="Refuz." />}
                                        {colVisible('shipping_anomaly_rate') && <SortHeader col="shipping_anomaly_rate" label="Ship. Anom." tip="% comenzi cu anomalie de shipping" />}
                                        {colVisible('avg_ship_cost_per_unit') && <SortHeader col="avg_ship_cost_per_unit" label="Avg Ship/u" tip="Cost mediu transport alocat / unitate" />}
                                        {colVisible('risk_score') && <SortHeader col="risk_score" label="Risk Score" tip="Scor 0–100: 45% problem rate + 25% contamination + 20% shipping anomaly + 10% delivery problems" />}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                    {sortedSkus.length === 0 && (
                                        <tr><td colSpan={1 + SKU_RISK_COLUMNS.filter(c => colVisible(c.key)).length} className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400">Nu sunt date. Apasă "Analizează".</td></tr>
                                    )}
                                    {sortedSkus.map((s, i) => (
                                        <Fragment key={s.sku}>
                                            <tr className={`hover:bg-zinc-50 dark:hover:bg-zinc-700/30 cursor-pointer ${skuRiskExpanded === s.sku ? 'bg-zinc-50 dark:bg-zinc-700/30' : ''}`}
                                                onClick={() => setSkuRiskExpanded(skuRiskExpanded === s.sku ? null : s.sku)}>
                                                <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{i + 1}</td>
                                                {colVisible('sku') && (
                                                    <td className="px-3 py-2">
                                                        <div className="text-sm font-medium text-zinc-900 dark:text-white">{s.sku}</div>
                                                        {s.product_name && <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[200px]">{s.product_name}</div>}
                                                        {s.stores_count > 1 && <span className="text-[10px] px-1.5 py-0.5 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded-full">{s.stores_count} magazine</span>}
                                                    </td>
                                                )}
                                                {colVisible('units_sold') && <td className="px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100">{s.units_sold}</td>}
                                                {colVisible('orders_with_sku') && <td className="px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100">{s.orders_with_sku}</td>}
                                                {colVisible('problem_units') && <td className="px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400">{s.problem_units || '—'}</td>}
                                                {colVisible('problem_rate') && <td className="px-3 py-2 text-sm font-semibold"><span className={s.problem_rate > 15 ? 'text-red-600 dark:text-red-400' : s.problem_rate > 5 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}>{s.problem_rate}%</span></td>}
                                                {colVisible('contamination_rate') && <td className="px-3 py-2 text-sm"><span className={s.contamination_rate > 15 ? 'text-red-600 dark:text-red-400' : s.contamination_rate > 5 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-700 dark:text-zinc-200'}>{s.contamination_rate}%</span></td>}
                                                {colVisible('units_back_to_sender') && <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200">{s.units_back_to_sender || '—'}</td>}
                                                {colVisible('units_cancelled') && <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200">{s.units_cancelled || '—'}</td>}
                                                {colVisible('units_refused') && <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200">{s.units_refused || '—'}</td>}
                                                {colVisible('shipping_anomaly_rate') && <td className="px-3 py-2 text-sm"><span className={s.shipping_anomaly_rate > 10 ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-200'}>{s.shipping_anomaly_rate}%</span></td>}
                                                {colVisible('avg_ship_cost_per_unit') && <td className="px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100">{s.avg_ship_cost_per_unit > 0 ? `${s.avg_ship_cost_per_unit} RON` : '—'}</td>}
                                                {colVisible('risk_score') && (
                                                    <td className="px-3 py-2">
                                                        {s.risk_score !== null ? (
                                                            <span className={`text-sm font-bold ${riskColor(s.risk_score)} px-2 py-0.5 rounded-md ${riskBg(s.risk_score)}`}>{s.risk_score}</span>
                                                        ) : (
                                                            <span className="text-xs text-zinc-500 dark:text-zinc-400 italic">low data</span>
                                                        )}
                                                    </td>
                                                )}
                                            </tr>
                                            {/* Expanded detail */}
                                            {skuRiskExpanded === s.sku && (
                                                <tr className="bg-zinc-50 dark:bg-zinc-900/40">
                                                    <td colSpan={1 + SKU_RISK_COLUMNS.filter(c => colVisible(c.key)).length} className="px-4 py-4">
                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                            {/* Per-store breakdown */}
                                                            <div>
                                                                <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1"><Store className="w-3 h-3" /> Per Magazine</h5>
                                                                <div className="space-y-1">
                                                                    {s.by_store.map(bs => (
                                                                        <div key={bs.store_uid} className="flex justify-between text-xs bg-white dark:bg-zinc-800 rounded-lg px-2 py-1 border border-zinc-200 dark:border-zinc-700">
                                                                            <span className="text-zinc-700 dark:text-zinc-300">{bs.store_name}</span>
                                                                            <span>{bs.units_sold} u | <span className={bs.problem_rate > 10 ? 'text-red-600 font-medium' : 'text-zinc-500'}>{bs.problem_rate}%</span> prob.</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            {/* Outcome breakdown */}
                                                            <div>
                                                                <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">📊 Outcome Breakdown</h5>
                                                                <div className="space-y-1 text-xs">
                                                                    <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Back to Sender</span><span className="font-medium text-zinc-900 dark:text-white">{s.units_back_to_sender} u</span></div>
                                                                    <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Anulate</span><span className="font-medium text-zinc-900 dark:text-white">{s.units_cancelled} u</span></div>
                                                                    <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Refuzate</span><span className="font-medium text-zinc-900 dark:text-white">{s.units_refused} u</span></div>
                                                                    <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Delivery Problems</span><span className="font-medium text-zinc-900 dark:text-white">{s.delivery_problem_orders} ord.</span></div>
                                                                    <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Not Shipped/Pending</span><span className="font-medium text-zinc-900 dark:text-white">{s.not_shipped_orders} ord.</span></div>
                                                                </div>
                                                            </div>
                                                            {/* Financial */}
                                                            <div>
                                                                <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">💰 Financial</h5>
                                                                <div className="space-y-1 text-xs">
                                                                    <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Revenue total</span><span className="font-medium text-zinc-900 dark:text-white">{s.revenue_total.toLocaleString()} RON</span></div>
                                                                    <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">COGS total</span><span className="font-medium text-zinc-900 dark:text-white">{s.cogs_total.toLocaleString()} RON</span></div>
                                                                    <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Avg ship/unit</span><span className="font-medium text-zinc-900 dark:text-white">{s.avg_ship_cost_per_unit} RON</span></div>
                                                                    <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Avg ship margin/unit</span><span className={`font-medium ${s.avg_ship_margin_per_unit < 0 ? 'text-red-600' : 'text-green-600'}`}>{s.avg_ship_margin_per_unit} RON</span></div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Section C: Shipping Anomaly Orders */}
                    {anomalyPage.length > 0 && (
                        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-clip">
                            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-2">
                                    <Truck className="w-4 h-4 text-amber-500" />
                                    Anomalii Shipping ({anomalyPage.length} comenzi)
                                </h3>
                                <div className="text-xs text-zinc-400">
                                    Pagina {skuRiskAnomalyPage + 1} / {anomalyTotalPages}
                                </div>
                            </div>
                            <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
                                <table className="w-full">
                                    <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                                        <tr>
                                            <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Comandă</th>
                                            <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Magazin</th>
                                            <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Data</th>
                                            <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Curier</th>
                                            <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Țară</th>
                                            <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Total</th>
                                            <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Ship. Taxat</th>
                                            <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Cost Real</th>
                                            <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Marjă</th>
                                            <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Cost %</th>
                                            <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Outcome</th>
                                            <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Motiv</th>
                                            <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">SKU-uri</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                        {anomalySlice.map(ao => (
                                            <tr key={ao.uid} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30">
                                                <td className="px-3 py-2 text-xs font-mono text-zinc-700 dark:text-zinc-300">{ao.order_number || ao.uid?.slice(0, 8)}</td>
                                                <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">{ao.store_name}</td>
                                                <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">{ao.date ? new Date(ao.date).toLocaleDateString() : '—'}</td>
                                                <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">{ao.courier_name || '—'}</td>
                                                <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">{ao.country_code || '—'}</td>
                                                <td className="px-3 py-2 text-xs text-right text-zinc-700 dark:text-zinc-300">{ao.order_total?.toFixed(2)}</td>
                                                <td className="px-3 py-2 text-xs text-right text-zinc-700 dark:text-zinc-300">{ao.shipping_charged?.toFixed(2) ?? '—'}</td>
                                                <td className="px-3 py-2 text-xs text-right font-medium text-zinc-900 dark:text-white">{ao.real_shipping_cost?.toFixed(2)}</td>
                                                <td className={`px-3 py-2 text-xs text-right font-semibold ${ao.shipping_margin < 0 ? 'text-red-600' : 'text-green-600'}`}>{ao.shipping_margin?.toFixed(2)}</td>
                                                <td className={`px-3 py-2 text-xs text-right ${ao.shipping_cost_pct > 25 ? 'text-red-600 font-medium' : 'text-zinc-600 dark:text-zinc-400'}`}>{ao.shipping_cost_pct}%</td>
                                                <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ao.final_outcome === 'DELIVERED' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ao.final_outcome === 'BACK_TO_SENDER' || ao.final_outcome === 'REFUSED' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'}`}>{ao.final_outcome}</span></td>
                                                <td className="px-3 py-2 text-xs text-amber-600 dark:text-amber-400 max-w-[200px]">
                                                    {ao.anomaly_reasons?.map((r, i) => <div key={i}>⚠ {r}</div>)}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-zinc-500 max-w-[150px] truncate" title={ao.skus?.join(', ')}>{ao.skus?.join(', ')}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {anomalyTotalPages > 1 && (
                                <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-center gap-2">
                                    <button onClick={() => setSkuRiskAnomalyPage(p => Math.max(0, p - 1))} disabled={skuRiskAnomalyPage === 0}
                                        className="px-3 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 disabled:opacity-50">â† Prev</button>
                                    <span className="text-xs text-zinc-500">{skuRiskAnomalyPage + 1} / {anomalyTotalPages}</span>
                                    <button onClick={() => setSkuRiskAnomalyPage(p => Math.min(anomalyTotalPages - 1, p + 1))} disabled={skuRiskAnomalyPage >= anomalyTotalPages - 1}
                                        className="px-3 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 disabled:opacity-50">Next →</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Section D: Store Summary */}
                    {skuRiskData.store_summary?.length > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3 flex items-center gap-2">
                                <Store className="w-4 h-4" />
                                Sumar per Magazin
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {skuRiskData.store_summary.map(ss => (
                                    <div key={ss.store_uid} className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                        <h4 className="text-sm font-semibold text-zinc-800 dark:text-white mb-3">{ss.store_name}</h4>
                                        <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                                            <div className="bg-zinc-50 dark:bg-zinc-700/50 rounded-lg p-2">
                                                <div className="text-zinc-500 dark:text-zinc-400">Comenzi</div>
                                                <div className="text-lg font-bold text-zinc-900 dark:text-white">{ss.total_orders.toLocaleString()}</div>
                                            </div>
                                            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2">
                                                <div className="text-zinc-500 dark:text-zinc-400">Livrate</div>
                                                <div className="text-lg font-bold text-green-600">{ss.delivered_pct}%</div>
                                            </div>
                                            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
                                                <div className="text-zinc-500 dark:text-zinc-400">Probleme</div>
                                                <div className="text-lg font-bold text-red-600">{ss.problem_pct}%</div>
                                            </div>
                                            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
                                                <div className="text-zinc-500 dark:text-zinc-400">Ship. Anom.</div>
                                                <div className="text-lg font-bold text-amber-600">{ss.anomaly_pct}%</div>
                                            </div>
                                        </div>
                                        <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Avg shipping: <span className="font-medium text-zinc-900 dark:text-white">{ss.avg_shipping_cost} RON</span></div>
                                        {ss.top5_worst_skus?.length > 0 && (
                                            <div className="mt-2">
                                                <div className="text-[10px] font-semibold text-zinc-400 uppercase mb-1">Top SKU-uri risc</div>
                                                {ss.top5_worst_skus.map(ws => (
                                                    <div key={ws.sku} className="flex justify-between text-xs py-0.5">
                                                        <span className="text-zinc-600 dark:text-zinc-300 truncate mr-2">{ws.sku}</span>
                                                        <span className={`font-medium ${riskColor(ws.risk_score)}`}>{ws.risk_score}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
