import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Boxes, ChevronDown, ChevronRight, Download, Package, Store as StoreIcon } from 'lucide-react'
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
    Select,
    Spinner,
} from '../components/ui'
import useColumnVisibility from '../hooks/useColumnVisibility'

const PAGE_SIZE = 100
const PERIODS = [30, 60, 90]
const ALL_STORES = '__toate__'
const ONE_YEAR = 365

const STATUS = {
    nu_se_vinde: { label: 'Nu se vinde', rank: 0, cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
    foarte_lent: { label: 'Foarte lent', rank: 1, cls: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' },
    lent: { label: 'Lent', rank: 2, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
    ok: { label: 'OK', rank: 3, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
    se_termina: { label: 'Se termină', rank: 4, cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
    fara_stoc: { label: 'Fără stoc', rank: 5, cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300' },
    fara_date: { label: 'Fără stoc în master', rank: 6, cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-400' },
}

const VIEWS = [
    { key: 'toate', label: 'Toate', match: () => true },
    { key: 'nu_se_vinde', label: 'Nu se vând', match: (r) => r.status === 'nu_se_vinde' },
    { key: 'lente', label: 'Lente (peste 6 luni)', match: (r) => r.status === 'lent' || r.status === 'foarte_lent' },
    { key: 'se_termina', label: 'Se termină', match: (r) => r.status === 'se_termina' },
]

const formatDateTime = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('ro-RO', {
        timeZone: 'Europe/Bucharest',
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
}

const formatCoverage = (r) => {
    if (r.stock == null || r.stock <= 0) return '—'
    if (r.coverage_days == null) return 'niciodată'
    if (r.coverage_days > ONE_YEAR) return '> 1 an'
    return `${formatNumber(Math.round(r.coverage_days))} zile`
}

const formatSinceSale = (r) => {
    if (r.days_since_last_sale == null) return '> 1 an'
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

    const [report, setReport] = useState(null)
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(0)
    const [sort, setSort] = useState({ key: 'status', direction: 'asc' })
    const [expandedKey, setExpandedKey] = useState(null)
    const [exporting, setExporting] = useState(false)
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

    const allRows = useMemo(() => report?.rows || [], [report])

    const rows = useMemo(() => {
        const filtered = allRows.filter(view.match)
        if (!sort.key || !sort.direction) return filtered
        const dir = sort.direction === 'asc' ? 1 : -1
        return [...filtered].sort((a, b) => compareRows(a, b, sort.key, dir))
    }, [allRows, view, sort])

    const kpis = useMemo(() => {
        const byProduct = new Map()
        allRows.filter((r) => (r.stock || 0) > 0).forEach((r) => {
            const key = r.master_product_id || `${r.store_uid}|${r.sku}`
            if (!byProduct.has(key)) byProduct.set(key, [])
            byProduct.get(key).push(r)
        })
        const withStock = [...byProduct.values()].flatMap((group) => {
            const pool = group.find((r) => r.stock_is_pool)
            return pool ? [pool] : group
        })
        const sum = (list) => list.reduce((s, r) => s + (r.stock_value || 0), 0)
        const notSelling = withStock.filter((r) => r.status === 'nu_se_vinde')
        const slow = withStock.filter((r) => r.status === 'lent' || r.status === 'foarte_lent')
        return {
            withStock: withStock.length,
            stockValue: sum(withStock),
            notSelling: notSelling.length,
            notSellingValue: sum(notSelling),
            slow: slow.length,
            slowValue: sum(slow),
        }
    }, [allRows])

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
            render: (r) => <StatusBadge status={r.status} />,
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
            key: 'stock_value', header: 'Valoare stoc', sortable: true, align: 'right',
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

    const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

    const handleStoresChange = (uids) => updateParams({ magazine: uids.join(',') })
    const handlePeriodChange = (value) => updateParams({ zile: value === '30' ? '' : value })
    const handleViewChange = (key) => updateParams({ arata: key === 'toate' ? '' : key })
    const handleSortChange = (next) => {
        setSort(next)
        setPage(0)
    }
    const handleRowClick = (r) => {
        if (!r.master_product_id) return
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
                'Valoare stoc (RON)': r.stock_value ?? '',
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

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="Produse cu stoc" value={formatNumber(kpis.withStock)} color="zinc" />
                <KpiCard label="Valoare stoc" value={`${formatNumber(Math.round(kpis.stockValue))} RON`} color="blue" />
                <KpiCard
                    label={`Nu se vând (0 în ${days} zile)`}
                    value={formatNumber(kpis.notSelling)}
                    trendLabel={`${formatNumber(Math.round(kpis.notSellingValue))} RON blocați`}
                    color="red"
                />
                <KpiCard
                    label="Lente (stoc peste 6 luni)"
                    value={formatNumber(kpis.slow)}
                    trendLabel={`${formatNumber(Math.round(kpis.slowValue))} RON blocați`}
                    color="amber"
                />
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {isAllStores
                    ? 'Un rând pe produs, cu stocul total din depozit și vânzările de pe toate magazinele. Click pe un rând pentru defalcarea pe magazine. '
                    : 'Stocul este cel alocat magazinului. '}
                {meta?.stores_without_master?.length > 0 && (
                    <>
                        <span className="text-zinc-700 dark:text-zinc-300">{meta.stores_without_master.join(', ')}</span> nu sunt în stock-sync și vând din stocul comun: la ele stocul și vânzările sunt pe toate magazinele.{' '}
                    </>
                )}
                Valoarea = stoc × cost din Costuri SKU. Stocul se actualizează la sincronizarea de la 02:00 și la rulările manuale.
            </p>

            <DataTable
                columns={tableColumns}
                rows={pageRows}
                rowKey={(r) => `${r.store_uid}|${r.master_product_id || r.sku}`}
                loading={loading}
                visibleColumnKeys={visibleKeys}
                sort={sort}
                onSort={handleSortChange}
                onRowClick={isAllStores ? handleRowClick : undefined}
                expandedKey={expandedKey ? `${ALL_STORES}|${expandedKey}` : null}
                renderExpanded={renderStoreBreakdown}
                maxHeight="calc(100vh - 380px)"
                empty={
                    <EmptyState
                        icon={Boxes}
                        title={report ? 'Niciun produs pentru filtrele alese' : 'Raportul nu s-a putut încărca'}
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
        </PageContainer>
    )
}
