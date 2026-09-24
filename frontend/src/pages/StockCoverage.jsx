import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Boxes, Download, Package, Store as StoreIcon } from 'lucide-react'
import { authFetch, API_URL } from '../utils/authFetch'
import { toastError } from '../utils/toast'
import { formatNumber } from '../utils/analyticsHelpers'
import MultiSelectFilter from '../components/MultiSelectFilter'
import {
    Button,
    ColumnsMenu,
    DataTable,
    EmptyState,
    FilterBar,
    KpiCard,
    PageContainer,
    PageHeader,
    PaginationFooter,
    Select,
} from '../components/ui'
import useColumnVisibility from '../hooks/useColumnVisibility'

const PAGE_SIZE = 100
const PERIODS = [30, 60, 90]
const SOON_DAYS = 14
const WARN_DAYS = 30

const formatDateTime = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('ro-RO', {
        timeZone: 'Europe/Bucharest',
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
}

const formatDays = (row, key, unitsKey) => {
    const days = row[key]
    if (days != null) return formatNumber(Math.round(days))
    if (row[unitsKey] == null) return '—'
    return row[unitsKey] > 0 ? 'nu se vinde' : '—'
}

const daysClass = (days) => {
    if (days == null) return 'text-zinc-400 dark:text-zinc-500'
    if (days < SOON_DAYS) return 'text-red-600 dark:text-red-400 font-semibold'
    if (days < WARN_DAYS) return 'text-amber-600 dark:text-amber-400 font-medium'
    return 'text-zinc-900 dark:text-zinc-100'
}

// Nulls ("—" / "nu se vinde") always sort last, whatever the direction.
const compareRows = (a, b, key, dir) => {
    const av = a[key]
    const bv = b[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    return String(av).localeCompare(String(bv), 'ro') * dir
}

export default function StockCoverage() {
    const [searchParams, setSearchParams] = useSearchParams()
    const days = PERIODS.includes(Number(searchParams.get('zile'))) ? Number(searchParams.get('zile')) : 30
    const selectedStores = useMemo(
        () => (searchParams.get('magazine') || '').split(',').filter(Boolean),
        [searchParams],
    )

    const [report, setReport] = useState(null)
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(0)
    const [sort, setSort] = useState({ key: 'sold_units', direction: 'desc' })
    const [exporting, setExporting] = useState(false)
    const requestId = useRef(0)

    const updateParams = (next) => {
        const params = new URLSearchParams(searchParams)
        Object.entries(next).forEach(([k, v]) => (v ? params.set(k, v) : params.delete(k)))
        setSearchParams(params, { replace: true })
        setPage(0)
    }

    const fetchReport = useCallback(async () => {
        const id = ++requestId.current
        setLoading(true)
        try {
            const res = await authFetch(`${API_URL}/analytics/stock-coverage?days=${days}`)
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
    }, [days])

    useEffect(() => { fetchReport() }, [fetchReport])

    const storeOptions = useMemo(
        () => (report?.stores || []).map((s) => ({ value: s.uid, label: s.name })),
        [report],
    )

    const rows = useMemo(() => {
        const all = report?.rows || []
        const wanted = new Set(selectedStores)
        const filtered = wanted.size ? all.filter((r) => wanted.has(r.store_uid)) : all
        if (!sort.key || !sort.direction) return filtered
        const dir = sort.direction === 'asc' ? 1 : -1
        return [...filtered].sort((a, b) => compareRows(a, b, sort.key, dir))
    }, [report, selectedStores, sort])

    const kpis = useMemo(() => ({
        products: rows.length,
        storeUnits: rows.some((r) => r.store_units != null)
            ? rows.reduce((s, r) => s + (r.store_units || 0), 0)
            : null,
        runningOut: rows.filter((r) => r.days_left != null && r.days_left < SOON_DAYS).length,
        notSelling: rows.filter((r) => r.sold_units === 0 && (r.store_units || 0) > 0).length,
    }), [rows])

    const soldLabel = `Vândute ${days} zile`
    const showStoreColumn = selectedStores.length !== 1

    const columns = [
        {
            key: 'store_name', header: 'Magazin', sortable: true, hidden: !showStoreColumn,
            render: (r) => <span className="text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{r.store_name}</span>,
        },
        {
            key: 'image', header: '', width: 52,
            render: (r) => r.image_url ? (
                <img src={r.image_url} alt="" loading="lazy" className="w-9 h-9 object-cover rounded-md border border-zinc-200 dark:border-zinc-700" />
            ) : (
                <div className="w-9 h-9 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center">
                    <Package className="w-4 h-4 text-zinc-400" />
                </div>
            ),
        },
        {
            key: 'sku', header: 'SKU', sortable: true, alwaysVisible: true,
            render: (r) => <span className="font-mono text-xs text-zinc-900 dark:text-white">{r.sku || '—'}</span>,
        },
        {
            key: 'product_name', header: 'Produs', sortable: true, alwaysVisible: true,
            render: (r) => (
                <div className="min-w-[220px]">
                    <div className="text-zinc-900 dark:text-white">{r.product_name || '—'}</div>
                    {!r.in_master && (
                        <div className="text-[11px] text-amber-600 dark:text-amber-400">nelegat de master — fără stoc</div>
                    )}
                </div>
            ),
        },
        {
            key: 'store_units', header: 'Stoc magazin', sortable: true, align: 'right',
            render: (r) => <span className="font-mono">{r.store_units == null ? '—' : formatNumber(r.store_units)}</span>,
        },
        {
            key: 'total_units', header: 'Stoc total', sortable: true, align: 'right',
            render: (r) => <span className="font-mono text-zinc-600 dark:text-zinc-400">{r.total_units == null ? '—' : formatNumber(r.total_units)}</span>,
        },
        {
            key: 'sold_units', header: soldLabel, sortable: true, align: 'right',
            render: (r) => <span className="font-mono">{formatNumber(r.sold_units)}</span>,
        },
        {
            key: 'velocity', header: 'Buc/zi', sortable: true, align: 'right',
            render: (r) => <span className="font-mono">{r.velocity.toLocaleString('ro-RO', { maximumFractionDigits: 2 })}</span>,
        },
        {
            key: 'days_left', header: 'Zile stoc magazin', sortable: true, align: 'right',
            render: (r) => <span className={`font-mono ${daysClass(r.days_left)}`}>{formatDays(r, 'days_left', 'store_units')}</span>,
        },
        {
            key: 'days_left_total', header: 'Zile stoc total', sortable: true, align: 'right',
            render: (r) => <span className={`font-mono ${daysClass(r.days_left_total)}`}>{formatDays(r, 'days_left_total', 'total_units')}</span>,
        },
    ]

    const defaultVisible = ['store_name', 'image', 'sku', 'product_name', 'store_units', 'total_units', 'sold_units', 'velocity', 'days_left', 'days_left_total']
    const { visibleKeys, setVisibleKeys, defaultVisibleKeys } =
        useColumnVisibility('stock-coverage', columns, defaultVisible)
    const tableColumns = columns.filter((c) => !c.hidden)

    const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

    const handleStoresChange = (uids) => updateParams({ magazine: uids.join(',') })
    const handlePeriodChange = (value) => updateParams({ zile: value === '30' ? '' : value })
    const handleSortChange = (next) => {
        setSort(next)
        setPage(0)
    }

    const handleExportExcel = async () => {
        setExporting(true)
        try {
            const XLSX = await import('xlsx').then((m) => m.default || m)
            const data = rows.map((r) => ({
                'Magazin': r.store_name,
                'SKU': r.sku,
                'Produs': r.product_name,
                'Stoc magazin': r.store_units ?? '',
                'Stoc total': r.total_units ?? '',
                [soldLabel]: r.sold_units,
                'Buc/zi': r.velocity,
                'Zile stoc magazin': r.days_left ?? formatDays(r, 'days_left', 'store_units'),
                'Zile stoc total': r.days_left_total ?? formatDays(r, 'days_left_total', 'total_units'),
                'Cod de bare': r.barcode ?? '',
            }))
            const ws = XLSX.utils.json_to_sheet(data)
            ws['!cols'] = Object.keys(data[0] || {}).map((k) => ({ wch: k === 'Produs' ? 60 : Math.max(k.length + 2, 12) }))
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, ws, 'Stoc & Viteza')
            XLSX.writeFile(wb, `stoc-viteza-${days}z-${new Date().toISOString().slice(0, 10)}.xlsx`)
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
                subtitle="Stocul din master pe fiecare magazin și în câte zile se vinde, la ritmul din ultimele zile"
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
                <KpiCard label="Produse" value={formatNumber(kpis.products)} color="zinc" />
                <KpiCard label="Stoc pe magazin" value={kpis.storeUnits == null ? '—' : formatNumber(kpis.storeUnits)} color="blue" />
                <KpiCard label={`Se termină în < ${SOON_DAYS} zile`} value={formatNumber(kpis.runningOut)} color="red" />
                <KpiCard label="Cu stoc, fără vânzări" value={formatNumber(kpis.notSelling)} color="amber" />
            </div>

            {meta?.stores_without_master?.length > 0 && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Fără stoc pe magazin (nu sunt în stock-sync, vând din stocul comun):{' '}
                    <span className="text-zinc-700 dark:text-zinc-300">{meta.stores_without_master.join(', ')}</span>.
                    {' '}Stocul pe magazin se actualizează la sincronizarea de la 02:00 și la rulările manuale.
                </p>
            )}

            <DataTable
                columns={tableColumns}
                rows={pageRows}
                rowKey={(r) => `${r.store_uid}|${r.master_product_id || r.sku}`}
                loading={loading}
                visibleColumnKeys={visibleKeys}
                sort={sort}
                onSort={handleSortChange}
                maxHeight="calc(100vh - 360px)"
                empty={
                    <EmptyState
                        icon={Boxes}
                        title={report ? 'Niciun produs pentru magazinele alese' : 'Raportul nu s-a putut încărca'}
                        description={report ? 'Alege alt magazin sau altă perioadă.' : 'Verifică conexiunea la stock-sync și încearcă din nou.'}
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
