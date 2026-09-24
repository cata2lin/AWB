import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Boxes, ChevronDown, ChevronRight, Download, Package, PackageSearch, Store as StoreIcon } from 'lucide-react'
import { authFetch, API_URL } from '../utils/authFetch'
import { toastError } from '../utils/toast'
import { formatNumber, formatMoney } from '../utils/analyticsHelpers'
import MultiSelectFilter from '../components/MultiSelectFilter'
import {
    Button,
    ColumnsMenu,
    DataTable,
    EmptyState,
    FilterBar,
    FilterChip,
    FilterDivider,
    KpiCard,
    PageContainer,
    PageHeader,
    PaginationFooter,
    SearchInput,
    Select,
    Spinner,
} from '../components/ui'
import useColumnVisibility from '../hooks/useColumnVisibility'

const PAGE_SIZE = 100
const PERIODS = [30, 60, 90]
const ALL_STORES = '__toate__'
const ONE_YEAR = 365

const DEAD_DAYS = 90

const STATUS = {
    mort: { label: 'Stoc mort', rank: -2, cls: 'bg-red-600 text-white dark:bg-red-500/80 dark:text-white' },
    nelistat: { label: 'Nelistat', rank: -1, cls: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300' },
    legatura_neaprobata: { label: 'Legătură neaprobată', rank: -0.5, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
    nu_se_vinde: { label: 'Nu se vinde', rank: 0, cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
    foarte_lent: { label: 'Foarte lent', rank: 1, cls: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' },
    lent: { label: 'Lent', rank: 2, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
    ok: { label: 'OK', rank: 3, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
    nou: { label: 'Marfă intrată recent', rank: 3.5, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
    se_termina: { label: 'Se termină', rank: 4, cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
    fara_stoc: { label: 'Fără stoc', rank: 5, cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300' },
    date_incomplete: { label: 'Date incomplete', rank: 5.5, cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300' },
    fara_date: { label: 'Fără stoc în master', rank: 6, cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-400' },
}

const VIEWS = [
    { key: 'toate', label: 'Toate', match: () => true },
    { key: 'mort', label: `Stoc mort (${DEAD_DAYS}+ zile)`, match: (r) => r.status === 'mort' },
    { key: 'nelistat', label: 'Nelistate / nelegate', match: (r) => r.status === 'nelistat' || r.status === 'legatura_neaprobata' },
    { key: 'nu_se_vinde', label: 'Nu se vând', match: (r) => r.status === 'nu_se_vinde' },
    { key: 'lente', label: 'Lente (peste 6 luni)', match: (r) => r.status === 'lent' || r.status === 'foarte_lent' },
    { key: 'se_termina', label: 'Se termină', match: (r) => r.status === 'se_termina' },
    { key: 'nou', label: `Marfă intrată recent (sub ${DEAD_DAYS} zile)`, match: (r) => r.status === 'nou' },
]

const productKey = (r) => r.master_product_id || `sku:${r.sku}`
const TOTAL_KEY = '__total__'

// Case- and diacritics-insensitive, so „covoras” finds „Covoraș”.
const normalizeText = (text) => (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// "RON blocați" only counts products with a cost in Costuri SKU — say how many are missing.
const blockedLabel = (value, missing) => {
    const text = `${formatNumber(Math.round(value))} RON blocați`
    return missing ? `${text} · ${formatNumber(missing)} fără cost` : text
}

const formatDateTime = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('ro-RO', {
        timeZone: 'Europe/Bucharest',
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
}

const formatCoverage = (r) => {
    if (r.stock == null || r.stock <= 0) return '—'
    if (r.coverage_days == null) return r.status === 'nou' ? 'nou, încă nevândut' : 'fără vânzări în 1 an'
    const days = r.coverage_days > ONE_YEAR ? '> 1 an' : `${formatNumber(Math.round(r.coverage_days))} zile`
    // Nothing sold in the period: the estimate uses the last year's pace instead.
    return r.velocity_basis === 'an' ? `${days} (ritm pe 1 an)` : days
}

const formatSinceSale = (r) => {
    if (r.days_since_last_sale == null) {
        // A store or product younger than the lookback simply hasn't had a sale yet.
        if (r.history_days != null && r.history_days < ONE_YEAR) return `niciodată (în ${formatNumber(r.history_days)} zile)`
        return '> 1 an'
    }
    if (r.days_since_last_sale === 0) return 'azi'
    if (r.days_since_last_sale === 1) return '1 zi'
    return `${formatNumber(r.days_since_last_sale)} zile`
}

const sinceSaleClass = (days) => {
    if (days == null || days >= 90) return 'text-red-600 dark:text-red-400 font-medium'
    if (days >= 30) return 'text-amber-600 dark:text-amber-400'
    return 'text-zinc-600 dark:text-zinc-400'
}

const sortValue = (r, key) => {
    if (key === 'status') return STATUS[r.status]?.rank ?? 9
    if (key === 'days_since_last_sale') return r.days_since_last_sale ?? Number.MAX_SAFE_INTEGER
    if (key === 'coverage_days') {
        if (r.stock == null || r.stock <= 0) return null
        return r.coverage_days ?? Number.MAX_SAFE_INTEGER
    }
    return r[key]
}

// Nulls always sort last; ties on status fall back to the money blocked (highest first).
const compareRows = (a, b, key, dir) => {
    const av = sortValue(a, key)
    const bv = sortValue(b, key)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = typeof av === 'number' && typeof bv === 'number'
        ? (av - bv) * dir
        : String(av).localeCompare(String(bv), 'ro') * dir
    if (cmp !== 0 || key !== 'status') return cmp
    return (b.stock_value || 0) - (a.stock_value || 0)
}

function StatusBadge({ status }) {
    const s = STATUS[status] || STATUS.fara_date
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${s.cls}`}>{s.label}</span>
}

function StoreBreakdown({ masterId, days }) {
    const [rows, setRows] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        let cancelled = false
        authFetch(`${API_URL}/analytics/stock-coverage?days=${days}&master_product_id=${encodeURIComponent(masterId)}`)
            .then(async (res) => {
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`)
                return res.json()
            })
            .then((data) => { if (!cancelled) setRows(data.rows || []) })
            .catch((e) => {
                if (cancelled) return
                console.error(e)
                toastError(e)
                setError(e.message || 'Eroare la încărcare')
            })
        return () => { cancelled = true }
    }, [masterId, days])

    if (error) return <p className="text-xs text-red-600 dark:text-red-400">Nu s-au putut încărca magazinele: {error}</p>
    if (rows == null) return <div className="py-2"><Spinner size="sm" /></div>
    if (rows.length === 0) return <p className="text-xs text-zinc-500 dark:text-zinc-400">Nu e listat pe niciun magazin.</p>
    const sorted = [...rows].sort((a, b) => (b.stock || 0) - (a.stock || 0))
    return (
        <table className="w-full max-w-3xl text-xs">
            <thead>
                <tr className="text-zinc-500 dark:text-zinc-400 text-left">
                    <th className="py-1 pr-3 font-medium">Magazin</th>
                    <th className="py-1 px-2 font-medium">Stare</th>
                    <th className="py-1 px-2 font-medium text-right">Stoc</th>
                    <th className="py-1 px-2 font-medium text-right">Vândute {days} zile</th>
                    <th className="py-1 px-2 font-medium text-right">Fără vânzare de</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                {sorted.map((r) => (
                    <tr key={r.store_uid}>
                        <td className="py-1.5 pr-3 text-zinc-800 dark:text-zinc-200">
                            {r.store_name}{r.stock_is_pool && <span className="ml-1 text-zinc-400">(stoc comun)</span>}
                        </td>
                        <td className="py-1.5 px-2"><StatusBadge status={r.status} /></td>
                        <td className="py-1.5 px-2 text-right font-mono text-zinc-800 dark:text-zinc-200">{r.stock == null ? '—' : formatNumber(r.stock)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-zinc-800 dark:text-zinc-200">{formatNumber(r.stock_is_pool ? r.store_sold_units : r.sold_units)}</td>
                        <td className={`py-1.5 px-2 text-right ${sinceSaleClass(r.days_since_last_sale)}`}>{formatSinceSale(r)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

export default function StockCoverage() {
    const [searchParams, setSearchParams] = useSearchParams()
    const days = PERIODS.includes(Number(searchParams.get('zile'))) ? Number(searchParams.get('zile')) : 30
    const view = VIEWS.find((v) => v.key === searchParams.get('arata')) || VIEWS[0]
    const selectedStores = useMemo(
        () => (searchParams.get('magazine') || '').split(',').filter(Boolean),
        [searchParams],
    )
    const isAllStores = selectedStores.length === 0
    const searchQuery = searchParams.get('cauta') || ''
    const selectedProducts = useMemo(
        () => (searchParams.get('produse') || '').split(',').filter(Boolean),
        [searchParams],
    )

    const [report, setReport] = useState(null)
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(0)
    const [sort, setSort] = useState({ key: 'status', direction: 'asc' })
    const [expandedKey, setExpandedKey] = useState(null)
    const [exporting, setExporting] = useState(false)
    const [searchText, setSearchText] = useState(searchQuery)
    const requestId = useRef(0)

    const updateParams = (next) => {
        const params = new URLSearchParams(searchParams)
        Object.entries(next).forEach(([k, v]) => (v ? params.set(k, v) : params.delete(k)))
        setSearchParams(params, { replace: true })
        setPage(0)
        setExpandedKey(null)
    }

    const storeParam = isAllStores ? ALL_STORES : selectedStores.join(',')

    const fetchReport = useCallback(async () => {
        const id = ++requestId.current
        setLoading(true)
        try {
            const res = await authFetch(`${API_URL}/analytics/stock-coverage?days=${days}&store_uids=${encodeURIComponent(storeParam)}`)
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.detail || `HTTP ${res.status}`)
            }
            const data = await res.json()
            if (id === requestId.current) setReport(data)
        } catch (e) {
            if (id === requestId.current) {
                console.error(e)
                toastError(e)
                setReport(null)
            }
        } finally {
            if (id === requestId.current) setLoading(false)
        }
    }, [days, storeParam])

    useEffect(() => { fetchReport() }, [fetchReport])

    const storeOptions = useMemo(
        () => (report?.stores || [])
            .filter((s) => s.uid !== ALL_STORES)
            .map((s) => ({ value: s.uid, label: s.name })),
        [report],
    )

    // The search narrows everything below it, KPIs included — typing "HA-" gives the
    // HA-only dead stock and money blocked.
    const allRows = useMemo(() => {
        const all = report?.rows || []
        const needle = normalizeText(searchQuery.trim())
        if (!needle) return all
        // 1–2 characters ("ha") would hit names like "Phantom" or "Haine": match SKU prefixes only.
        if (needle.length < 3) {
            return all.filter((r) => (r.sku || '').split(', ').some((sku) => normalizeText(sku).startsWith(needle)))
        }
        return all.filter((r) => normalizeText(`${r.sku} ${r.product_name}`).includes(needle))
    }, [report, searchQuery])

    const productOptions = useMemo(() => {
        const seen = new Map()
        ;(report?.rows || []).forEach((r) => {
            const key = productKey(r)
            if (!seen.has(key)) seen.set(key, { value: key, label: `${r.product_name || '—'} · ${r.sku || '—'}` })
        })
        return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'ro'))
    }, [report])

    const scopedRows = useMemo(() => {
        if (!selectedProducts.length) return allRows
        const wanted = new Set(selectedProducts)
        return allRows.filter((r) => wanted.has(productKey(r)))
    }, [allRows, selectedProducts])

    const rows = useMemo(() => {
        const filtered = scopedRows.filter(view.match)
        if (!sort.key || !sort.direction) return filtered
        const dir = sort.direction === 'asc' ? 1 : -1
        return [...filtered].sort((a, b) => compareRows(a, b, sort.key, dir))
    }, [scopedRows, view, sort])

    const kpis = useMemo(() => {
        const byProduct = new Map()
        scopedRows.filter((r) => (r.stock || 0) > 0).forEach((r) => {
            const key = r.master_product_id || `${r.store_uid}|${r.sku}`
            if (!byProduct.has(key)) byProduct.set(key, [])
            byProduct.get(key).push(r)
        })
        const withStock = [...byProduct.values()].flatMap((group) => {
            const pool = group.find((r) => r.stock_is_pool)
            return pool ? [pool] : group
        })
        const sum = (list) => list.reduce((s, r) => s + (r.stock_value || 0), 0)
        const noCost = (list) => list.filter((r) => r.stock_value == null).length
        const dead = withStock.filter((r) => r.status === 'mort')
        const unlisted = withStock.filter((r) => r.status === 'nelistat' || r.status === 'legatura_neaprobata')
        const notSelling = withStock.filter((r) => r.status === 'nu_se_vinde')
        const slow = withStock.filter((r) => r.status === 'lent' || r.status === 'foarte_lent')
        return {
            withStock: withStock.length,
            withStockNoCost: noCost(withStock),
            dead: dead.length,
            deadValue: sum(dead),
            deadNoCost: noCost(dead),
            unlisted: unlisted.length,
            unlistedUnits: unlisted.reduce((s, r) => s + (r.stock || 0), 0),
            unlistedValue: sum(unlisted),
            unlistedNoCost: noCost(unlisted),
            stockValue: sum(withStock),
            notSelling: notSelling.length,
            notSellingValue: sum(notSelling),
            notSellingNoCost: noCost(notSelling),
            slow: slow.length,
            slowValue: sum(slow),
            slowNoCost: noCost(slow),
        }
    }, [scopedRows])

    const soldLabel = `Vândute ${days} zile`
    const showStoreColumn = selectedStores.length > 1

    const columns = [
        {
            key: 'expand', header: '', width: 28, alwaysVisible: true, hidden: !isAllStores,
            render: (r) => (expandedKey === r.master_product_id
                ? <ChevronDown className="w-4 h-4 text-zinc-400" />
                : <ChevronRight className="w-4 h-4 text-zinc-400" />),
        },
        {
            key: 'store_name', header: 'Magazin', sortable: true, hidden: !showStoreColumn,
            render: (r) => <span className="text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{r.store_name}</span>,
        },
        {
            key: 'product_name', header: 'Produs', sortable: true, alwaysVisible: true,
            render: (r) => (
                <div className="flex items-center gap-2.5 min-w-[260px]">
                    {r.image_url ? (
                        <img src={r.image_url} alt="" loading="lazy" className="w-9 h-9 flex-shrink-0 object-cover rounded-md border border-zinc-200 dark:border-zinc-700" />
                    ) : (
                        <div className="w-9 h-9 flex-shrink-0 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center">
                            <Package className="w-4 h-4 text-zinc-400" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <div className="text-zinc-900 dark:text-white leading-snug">{r.product_name || '—'}</div>
                        <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                            {r.sku || '—'}
                            {r.stock_is_pool && <span className="ml-1.5 font-sans text-zinc-400">· stoc comun</span>}
                        </div>
                    </div>
                </div>
            ),
        },
        {
            key: 'status', header: 'Stare', sortable: true, alwaysVisible: true,
            render: (r) => (
                <div className="flex flex-col items-start gap-0.5">
                    <StatusBadge status={r.status} />
                    {r.total_status && r.total_status !== r.status && (
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                            pe total: {STATUS[r.total_status]?.label || '—'}
                        </span>
                    )}
                    {r.status === 'nou' && r.arrived_at && (
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                            intrată {formatDateTime(r.arrived_at).split(',')[0]}
                        </span>
                    )}
                    {r.listing_note && (
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-56">{r.listing_note}</span>
                    )}
                </div>
            ),
        },
        {
            key: 'stock', header: 'Stoc', sortable: true, align: 'right',
            render: (r) => <span className="font-mono">{r.stock == null ? '—' : formatNumber(r.stock)}</span>,
        },
        {
            key: 'sold_units', header: soldLabel, sortable: true, align: 'right',
            render: (r) => (
                <span className="font-mono whitespace-nowrap">
                    {formatNumber(r.sold_units)}
                    {r.stock_is_pool && (
                        <span className="block text-[11px] font-sans text-zinc-500 dark:text-zinc-400">
                            {formatNumber(r.store_sold_units)} pe acest magazin
                        </span>
                    )}
                </span>
            ),
        },
        {
            key: 'days_since_last_sale', header: 'Fără vânzare de', sortable: true, align: 'right',
            render: (r) => <span className={`whitespace-nowrap ${sinceSaleClass(r.days_since_last_sale)}`}>{formatSinceSale(r)}</span>,
        },
        {
            key: 'coverage_days', header: 'Se termină în', sortable: true, align: 'right',
            render: (r) => <span className="whitespace-nowrap text-zinc-700 dark:text-zinc-300">{formatCoverage(r)}</span>,
        },
        {
            key: 'stock_value', header: 'Valoare stoc (fără TVA)', sortable: true, align: 'right',
            render: (r) => <span className="font-mono whitespace-nowrap">{r.stock_value == null ? '—' : `${formatMoney(r.stock_value)} RON`}</span>,
        },
        {
            key: 'velocity', header: 'Buc/zi', sortable: true, align: 'right',
            render: (r) => <span className="font-mono">{r.velocity.toLocaleString('ro-RO', { maximumFractionDigits: 2 })}</span>,
        },
        {
            key: 'pool_sold_units', header: 'Vândute pe toate magazinele', sortable: true, align: 'right',
            render: (r) => <span className="font-mono">{formatNumber(r.pool_sold_units)}</span>,
        },
        {
            key: 'total_units', header: 'Stoc total depozit', sortable: true, align: 'right',
            render: (r) => <span className="font-mono">{r.total_units == null ? '—' : formatNumber(r.total_units)}</span>,
        },
    ]

    const defaultVisible = ['expand', 'store_name', 'product_name', 'status', 'stock', 'sold_units', 'days_since_last_sale', 'coverage_days', 'stock_value']
    const { visibleKeys, setVisibleKeys, defaultVisibleKeys } =
        useColumnVisibility('stock-coverage-v2', columns, defaultVisible)
    const tableColumns = columns.filter((c) => !c.hidden)

    const totals = useMemo(() => {
        const sum = (key) => rows.reduce((s, r) => s + (r[key] || 0), 0)
        return {
            count: rows.length,
            stock: sum('stock'),
            sold_units: sum('sold_units'),
            stock_value: sum('stock_value'),
            velocity: sum('velocity'),
            pool_sold_units: sum('pool_sold_units'),
        }
    }, [rows])

    const TOTAL_CELLS = {
        product_name: () => <span className="font-semibold text-zinc-900 dark:text-white">TOTAL · {formatNumber(totals.count)} produse</span>,
        stock: () => <span className="font-mono font-semibold">{formatNumber(totals.stock)}</span>,
        sold_units: () => <span className="font-mono font-semibold">{formatNumber(totals.sold_units)}</span>,
        stock_value: () => <span className="font-mono font-semibold whitespace-nowrap">{formatMoney(totals.stock_value)} RON</span>,
        velocity: () => <span className="font-mono font-semibold">{totals.velocity.toLocaleString('ro-RO', { maximumFractionDigits: 2 })}</span>,
        pool_sold_units: () => <span className="font-mono font-semibold">{formatNumber(totals.pool_sold_units)}</span>,
    }
    const columnsWithTotal = tableColumns.map((c) => ({
        ...c,
        sortable: c.sortable,
        render: (r) => (r[TOTAL_KEY] ? (TOTAL_CELLS[c.key]?.() ?? null) : c.render(r)),
    }))

    const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    const tableRows = rows.length ? [...pageRows, { [TOTAL_KEY]: true }] : pageRows

    const handleStoresChange = (uids) => updateParams({ magazine: uids.join(',') })
    const handlePeriodChange = (value) => updateParams({ zile: value === '30' ? '' : value })
    const handleViewChange = (key) => updateParams({ arata: key === 'toate' ? '' : key })
    const handleSearchCommit = (text) => updateParams({ cauta: text.trim() })
    const handleSortChange = (next) => {
        setSort(next)
        setPage(0)
    }
    const handleProductsChange = (keys) => updateParams({ produse: keys.join(',') })
    const handleRowClick = (r) => {
        if (r[TOTAL_KEY] || !r.master_product_id) return
        setExpandedKey((cur) => (cur === r.master_product_id ? null : r.master_product_id))
    }
    const renderStoreBreakdown = (r) => <StoreBreakdown masterId={r.master_product_id} days={days} />

    const handleExportExcel = async () => {
        setExporting(true)
        try {
            const XLSX = await import('xlsx').then((m) => m.default || m)
            const data = rows.map((r) => ({
                'Magazin': r.store_name,
                'SKU': r.sku,
                'Produs': r.product_name,
                'Stare': STATUS[r.status]?.label || '',
                'Stoc': r.stock ?? '',
                'Stoc comun (toate magazinele)': r.stock_is_pool ? 'da' : '',
                [soldLabel]: r.stock_is_pool ? r.store_sold_units : r.sold_units,
                'Fără vânzare de (zile)': r.days_since_last_sale ?? '> 365',
                'Se termină în (zile)': r.coverage_days ?? formatCoverage(r),
                'Valoare stoc fără TVA (RON)': r.stock_value ?? '',
                'Stare pe total': r.total_status ? (STATUS[r.total_status]?.label || '') : '',
                'Buc/zi': r.velocity,
                'Vândute pe toate magazinele': r.pool_sold_units,
                'Stoc total depozit': r.total_units ?? '',
                'Cod de bare': r.barcode ?? '',
            }))
            const ws = XLSX.utils.json_to_sheet(data)
            ws['!cols'] = Object.keys(data[0] || {}).map((k) => ({ wch: k === 'Produs' ? 60 : Math.max(k.length + 2, 12) }))
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, ws, 'Stoc & Viteza')
            XLSX.writeFile(wb, `stoc-viteza-${view.key}-${days}z-${new Date().toISOString().slice(0, 10)}.xlsx`)
        } catch (e) {
            console.error(e)
            toastError(e)
        } finally {
            setExporting(false)
        }
    }

    const meta = report?.meta

    return (
        <PageContainer>
            <PageHeader
                title="Stoc & Viteză"
                subtitle="Ce nu se vinde: stocul din master, cât s-a vândut și de când n-a mai ieșit nimic"
                icon={Boxes}
                actions={
                    <Button
                        variant="secondary"
                        icon={Download}
                        onClick={handleExportExcel}
                        loading={exporting}
                        disabled={loading || rows.length === 0}
                        data-action="export-stock-coverage"
                    >
                        Export Excel
                    </Button>
                }
            />

            <FilterBar>
                <MultiSelectFilter
                    label="Magazine"
                    options={storeOptions}
                    selected={selectedStores}
                    onChange={handleStoresChange}
                    icon={StoreIcon}
                    searchable
                    allLabel="Toate magazinele"
                />
                <Select
                    value={String(days)}
                    onChange={handlePeriodChange}
                    ariaLabel="Perioadă"
                    options={PERIODS.map((d) => ({ value: String(d), label: `Ultimele ${d} zile` }))}
                />
                <MultiSelectFilter
                    label="Produse"
                    options={productOptions}
                    selected={selectedProducts}
                    onChange={handleProductsChange}
                    icon={PackageSearch}
                    searchable
                    allLabel="Toate produsele"
                />
                <SearchInput
                    value={searchText}
                    onChange={setSearchText}
                    onDebouncedChange={handleSearchCommit}
                    debounce={300}
                    placeholder="Caută SKU sau produs (ex: HA-)"
                    className="min-w-[220px]"
                />
                <FilterDivider />
                {VIEWS.map((v) => (
                    <FilterChip
                        key={v.key}
                        active={view.key === v.key}
                        onClick={() => handleViewChange(v.key)}
                        label={v.label}
                    />
                ))}
                <div className="ml-auto flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                    <span>Stoc la: <span className="font-medium text-zinc-700 dark:text-zinc-300">{formatDateTime(meta?.stock_as_of)}</span></span>
                    <ColumnsMenu
                        columns={tableColumns}
                        visibleKeys={visibleKeys}
                        onChange={setVisibleKeys}
                        defaultVisibleKeys={defaultVisibleKeys}
                    />
                </div>
            </FilterBar>

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <KpiCard
                    label="Valoare stoc (fără TVA)"
                    value={`${formatNumber(Math.round(kpis.stockValue))} RON`}
                    trendLabel={`${formatNumber(kpis.withStock)} produse cu stoc${kpis.withStockNoCost ? ` · ${formatNumber(kpis.withStockNoCost)} fără cost` : ''}`}
                    color="blue"
                />
                <KpiCard
                    label={`Stoc mort (nimic vândut în ${DEAD_DAYS} zile)`}
                    value={formatNumber(kpis.dead)}
                    trendLabel={blockedLabel(kpis.deadValue, kpis.deadNoCost)}
                    color="red"
                />
                <KpiCard
                    label="Nelistate / nelegate de master"
                    value={formatNumber(kpis.unlisted)}
                    trendLabel={`${formatNumber(kpis.unlistedUnits)} buc · ${blockedLabel(kpis.unlistedValue, kpis.unlistedNoCost)}`}
                    color="violet"
                />
                <KpiCard
                    label={`Nu se vând (0 în ${days} zile)`}
                    value={formatNumber(kpis.notSelling)}
                    trendLabel={blockedLabel(kpis.notSellingValue, kpis.notSellingNoCost)}
                    color="amber"
                />
                <KpiCard
                    label="Lente (stoc peste 6 luni)"
                    value={formatNumber(kpis.slow)}
                    trendLabel={blockedLabel(kpis.slowValue, kpis.slowNoCost)}
                    color="zinc"
                />
            </div>

            <DataTable
                columns={columnsWithTotal}
                rows={tableRows}
                rowKey={(r) => (r[TOTAL_KEY] ? TOTAL_KEY : `${r.store_uid}|${r.master_product_id || r.sku}`)}
                rowClassName={(r) => (r[TOTAL_KEY] ? '*:sticky *:bottom-0 *:z-10 *:bg-zinc-100 dark:*:bg-zinc-900 *:border-t-2 *:border-zinc-300 dark:*:border-zinc-600' : '')}
                loading={loading}
                visibleColumnKeys={visibleKeys}
                sort={sort}
                onSort={handleSortChange}
                onRowClick={isAllStores ? handleRowClick : undefined}
                expandedKey={expandedKey ? `${ALL_STORES}|${expandedKey}` : null}
                renderExpanded={renderStoreBreakdown}
                maxHeight="max(360px, calc(100vh - 480px))"
                empty={
                    <EmptyState
                        icon={Boxes}
                        title={report ? (searchQuery ? `Niciun produs pentru „${searchQuery}”` : 'Niciun produs pentru filtrele alese') : 'Raportul nu s-a putut încărca'}
                        description={report ? 'Alege alt magazin, altă perioadă sau „Toate”.' : 'Verifică conexiunea la stock-sync și încearcă din nou.'}
                        action={!report && <Button variant="primary" onClick={fetchReport} data-action="retry-stock-coverage">Reîncearcă</Button>}
                    />
                }
                footer={
                    <PaginationFooter
                        page={page}
                        pageSize={PAGE_SIZE}
                        total={rows.length}
                        onPageChange={setPage}
                        loading={loading}
                    />
                }
            />

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {isAllStores
                    ? 'Un rând pe produs, cu stocul total din depozit și vânzările de pe toate magazinele. Click pe un rând pentru defalcarea pe magazine. '
                    : 'Stocul este cel alocat magazinului. '}
                {meta?.stores_without_master?.length > 0 && (
                    <>
                        <span className="text-zinc-700 dark:text-zinc-300">{meta.stores_without_master.join(', ')}</span> nu sunt în stock-sync și vând din stocul comun: la ele stocul și vânzările sunt pe toate magazinele.{' '}
                    </>
                )}
                <span className="text-zinc-700 dark:text-zinc-300">Stoc mort</span> = nimic vândut în {DEAD_DAYS} de zile (doar pentru produse și magazine mai vechi de {DEAD_DAYS} de zile); <span className="text-zinc-700 dark:text-zinc-300">Nelistat</span> = are stoc, dar nu e activ pe niciun magazin; <span className="text-zinc-700 dark:text-zinc-300">Legătură neaprobată</span> = e pe magazin, dar legătura cu masterul așteaptă aprobare în stock-sync; <span className="text-zinc-700 dark:text-zinc-300">Nu se vinde</span> = 0 în perioada aleasă. „Vândute” = toate comenzile din perioadă în afară de cele anulate, iar viteza (buc/zi) se împarte la zilele de la prima vânzare din perioadă — la fel ca în Viteză Vânzări. „Se termină în” = stoc ÷ buc/zi; dacă produsul n-a vândut nimic în perioadă, se folosește ritmul din ultimul an. <span className="text-zinc-700 dark:text-zinc-300">Marfă intrată recent</span> = recepție (container, livrare) sau stoc pornit de la 0 în ultimele {DEAD_DAYS} de zile, după stock-sync — prea devreme pentru mort sau lent. Valoarea = stoc × cost din Costuri SKU, fără TVA; produsele fără cost acolo nu intră în sume. Nu sunt incluse parfumurile{meta?.excluded_perfume_stores?.length ? ` (${meta.excluded_perfume_stores.join(', ')})` : ''}, produsele aflate încă în test (doar comenzi de test) și SKU-urile placeholder.{meta?.stale_stores?.length ? ` Fără comenzi de peste 7 zile (date incomplete, nejudecate): ${meta.stale_stores.join(', ')}.` : ''} Stocul se actualizează la sincronizarea de la 02:00 și la rulările manuale.
            </p>
        </PageContainer>
    )
}
