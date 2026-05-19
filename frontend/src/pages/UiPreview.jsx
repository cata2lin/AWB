import { useState } from 'react'
import { Package, Save, Trash2, Search as SearchIcon, Plus } from 'lucide-react'
import {
    Button,
    SearchInput,
    DateInput,
    Select,
    EmptyState,
    ConfirmDialog,
    FormField,
    TextInput,
    KpiCard,
    StatusBadge,
    DataTable,
    PaginationFooter,
    ColumnsMenu,
    FilterBar,
    FilterChip,
    FilterDivider,
    PageHeader,
    PageContainer,
    Section,
} from '../components/ui'
import useColumnVisibility from '../hooks/useColumnVisibility'
import { toastSuccess, toastError, toastPromise } from '../utils/toast'

const SAMPLE_ROWS = [
    { id: 1, order: '#10421', customer: 'Maria Pop', status: 'delivered', total: 1450, profit: 320, margin: 22 },
    { id: 2, order: '#10422', customer: 'Ion Vasile', status: 'in_transit', total: 720, profit: 110, margin: 15 },
    { id: 3, order: '#10423', customer: 'Andrei C.', status: 'returned', total: 980, profit: -120, margin: -12 },
    { id: 4, order: '#10424', customer: 'Elena R.', status: 'cancelled', total: 320, profit: 0, margin: 0 },
    { id: 5, order: '#10425', customer: 'Mihai S.', status: 'delivered', total: 2350, profit: 540, margin: 23 },
]

const COLUMNS = [
    { key: 'order', header: 'Comandă', alwaysVisible: true, sortable: true },
    { key: 'customer', header: 'Client', sortable: true },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', header: 'Total', align: 'right', sortable: true, render: (r) => `${r.total} RON` },
    { key: 'profit', header: 'Profit', align: 'right', sortable: true, render: (r) => (
        <span className={r.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}>
            {r.profit} RON
        </span>
    ) },
    { key: 'margin', header: 'Marjă', align: 'right', sortable: true, render: (r) => `${r.margin}%` },
]

export default function UiPreview() {
    const [search, setSearch] = useState('')
    const [date, setDate] = useState('')
    const [statusFilter, setStatusFilter] = useState('')
    const [sort, setSort] = useState({ key: null, direction: null })
    const [expanded, setExpanded] = useState(null)
    const [page, setPage] = useState(0)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [confirmLoading, setConfirmLoading] = useState(false)
    const [formName, setFormName] = useState('')
    const [formError, setFormError] = useState('')

    const { visibleKeys, setVisibleKeys, defaultVisibleKeys } = useColumnVisibility(
        'ui-preview-orders', COLUMNS,
    )

    const handleFormSubmit = (e) => {
        e.preventDefault()
        if (!formName.trim()) {
            setFormError('Numele este obligatoriu')
            return
        }
        setFormError('')
        toastSuccess(`Salvat: ${formName}`)
        setFormName('')
    }

    const handleConfirm = async () => {
        setConfirmLoading(true)
        await new Promise((r) => setTimeout(r, 800))
        setConfirmLoading(false)
        setConfirmOpen(false)
        toastSuccess('Șters cu succes')
    }

    const fakePromise = () => toastPromise(
        new Promise((res) => setTimeout(res, 1200)),
        { loading: 'Se sincronizează...', success: 'Sincronizat', error: 'Eroare' }
    )

    return (
        <PageContainer>
            <PageHeader
                title="UI Preview"
                subtitle="Galerie de componente comune — light/dark/responsive"
                icon={Package}
                actions={
                    <>
                        <Button variant="ghost" onClick={() => toastError('Eroare exemplu')}>Test eroare</Button>
                        <Button variant="primary" icon={Save} onClick={fakePromise}>Test promise</Button>
                    </>
                }
            />

            <Section title="KPI Cards" icon={Package}>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <KpiCard label="Venit Net" value="124.500 RON" color="blue" trend={5} trendLabel="+5% vs lună trecută" />
                    <KpiCard label="CM1" value="42.300 RON" color="green" trend={2} trendLabel="+2%" />
                    <KpiCard label="CM2" value="28.700 RON" color="violet" />
                    <KpiCard label="CM3" value="-3.200 RON" color="red" negative trendLabel="−12%" trend={-12} />
                    <KpiCard label="Livrate" value="1.245" color="amber" />
                    <KpiCard label="Returnări" value="8%" color="zinc" />
                </div>
            </Section>

            <Section title="Buttons" icon={Plus} contentClassName="flex flex-wrap gap-2">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="success" icon={Save}>Salvează</Button>
                <Button variant="danger" icon={Trash2}>Șterge</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="outline">Outline</Button>
                <Button loading>Se încarcă</Button>
                <Button disabled>Disabled</Button>
                <Button size="xs">XS</Button>
                <Button size="lg" variant="primary">Large</Button>
            </Section>

            <Section title="Badges" contentClassName="flex flex-wrap gap-2">
                <StatusBadge status="delivered" />
                <StatusBadge status="in_transit" />
                <StatusBadge status="returned" />
                <StatusBadge status="cancelled" />
                <StatusBadge status="pending" />
                <StatusBadge tone="violet">Custom violet</StatusBadge>
                <StatusBadge tone="indigo" uppercase size="xs">Tag</StatusBadge>
            </Section>

            <Section title="Inputs și filtre" icon={SearchIcon}>
                <FilterBar>
                    <SearchInput
                        value={search}
                        onChange={setSearch}
                        placeholder="Caută clienți, comenzi..."
                        debounce={300}
                        onDebouncedChange={(v) => console.log('debounced', v)}
                        className="min-w-[220px] flex-1"
                    />
                    <FilterDivider />
                    <DateInput value={date} onChange={setDate} ariaLabel="De la" />
                    <Select
                        value={statusFilter}
                        onChange={setStatusFilter}
                        placeholder="Toate statusurile"
                        options={[
                            { value: 'delivered', label: 'Livrate' },
                            { value: 'in_transit', label: 'În tranzit' },
                            { value: 'returned', label: 'Returnate' },
                        ]}
                    />
                    <FilterDivider />
                    <FilterChip active={statusFilter === 'delivered'} onClick={() => setStatusFilter('delivered')}>Doar livrate</FilterChip>
                    {statusFilter && <FilterChip onRemove={() => setStatusFilter('')}>Status: {statusFilter}</FilterChip>}
                </FilterBar>

                <form onSubmit={handleFormSubmit} className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <FormField label="Nume preset" required error={formError}>
                        <TextInput value={formName} onChange={setFormName} placeholder="ex. Preset Q1" error={formError} />
                    </FormField>
                    <FormField label="Data" hint="Format ISO YYYY-MM-DD">
                        <DateInput value={date} onChange={setDate} />
                    </FormField>
                    <Button type="submit" variant="success" icon={Save}>Salvează preset</Button>
                </form>
            </Section>

            <Section
                title="Tabel cu sticky header, sort, coloane ascunse, paginare"
                icon={Package}
                padded={false}
                actions={
                    <ColumnsMenu
                        columns={COLUMNS}
                        visibleKeys={visibleKeys}
                        onChange={setVisibleKeys}
                        defaultVisibleKeys={defaultVisibleKeys}
                    />
                }
            >
                <DataTable
                    columns={COLUMNS}
                    rows={SAMPLE_ROWS}
                    rowKey="id"
                    visibleColumnKeys={visibleKeys}
                    sort={sort}
                    onSort={setSort}
                    onRowClick={(r) => setExpanded(expanded === r.id ? null : r.id)}
                    expandedKey={expanded}
                    renderExpanded={(r) => (
                        <div className="text-xs grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div><div className="text-zinc-500">Comandă</div><div className="font-semibold">{r.order}</div></div>
                            <div><div className="text-zinc-500">Client</div><div className="font-semibold">{r.customer}</div></div>
                            <div><div className="text-zinc-500">Total</div><div className="font-semibold">{r.total} RON</div></div>
                            <div><div className="text-zinc-500">Marjă</div><div className="font-semibold">{r.margin}%</div></div>
                        </div>
                    )}
                    maxHeight="40vh"
                    footer={
                        <PaginationFooter
                            page={page}
                            pageSize={5}
                            total={45}
                            onPageChange={setPage}
                        />
                    }
                />
            </Section>

            <Section title="Empty state">
                <EmptyState
                    title="Niciun rezultat"
                    description="Modifică filtrele sau adaugă elemente noi pentru a începe."
                    action={<Button icon={Plus}>Adaugă element</Button>}
                />
            </Section>

            <Section title="Confirm dialog">
                <Button variant="danger" icon={Trash2} onClick={() => setConfirmOpen(true)}>Șterge ceva</Button>
                <ConfirmDialog
                    open={confirmOpen}
                    title="Confirmă ștergerea"
                    description="Această acțiune este ireversibilă. Continui?"
                    confirmLabel="Da, șterge"
                    cancelLabel="Renunță"
                    variant="danger"
                    loading={confirmLoading}
                    onConfirm={handleConfirm}
                    onCancel={() => setConfirmOpen(false)}
                />
            </Section>
        </PageContainer>
    )
}
