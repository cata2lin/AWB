import { useCallback, useEffect, useState } from 'react'
import { Plus, Edit2, Trash2, Save, Package } from 'lucide-react'
import { authFetch, API_URL } from '../utils/authFetch'
import { toastError, toastSuccess } from '../utils/toast'
import {
    Button,
    SearchInput,
    DataTable,
    PaginationFooter,
    ColumnsMenu,
    EmptyState,
    FormField,
    TextInput,
    PageContainer,
    PageHeader,
    Section,
    FilterBar,
} from '../components/ui'
import useColumnVisibility from '../hooks/useColumnVisibility'
import useConfirm from '../hooks/useConfirm'

const PAGE_SIZE = 50
const EMPTY_FORM = {
    id: null, sku: '', product_name: '', barcode: '', image_url: '',
    default_unit_cost: 0, hs_code: '', weight_grams: 0,
    tom_variant_1: '', tom_variant_2: '',
}

export default function CustomProducts() {
    const [products, setProducts] = useState([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [page, setPage] = useState(0)
    const [sort, setSort] = useState({ key: null, direction: null })

    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [form, setForm] = useState(EMPTY_FORM)
    const [errors, setErrors] = useState({})

    const { confirm, dialog: confirmDialog } = useConfirm()

    const fetchProducts = useCallback(async () => {
        try {
            setLoading(true)
            const q = new URLSearchParams({
                limit: String(PAGE_SIZE),
                offset: String(page * PAGE_SIZE),
            })
            if (debouncedSearch) q.set('search', debouncedSearch)
            const res = await authFetch(`${API_URL}/custom-products?${q.toString()}`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            setProducts(data.items || [])
            setTotal(data.total || 0)
        } catch (e) {
            console.error(e)
            toastError(e)
        } finally {
            setLoading(false)
        }
    }, [debouncedSearch, page])

    useEffect(() => { fetchProducts() }, [fetchProducts])

    const handleSearchChange = (val) => {
        setSearch(val)
    }
    const handleDebouncedSearch = (val) => {
        setDebouncedSearch(val)
        setPage(0)
    }

    const openCreate = () => {
        setForm(EMPTY_FORM)
        setErrors({})
        setIsModalOpen(true)
    }

    const openEdit = (p) => {
        setForm({
            id: p.id,
            sku: p.sku || '',
            product_name: p.product_name || '',
            barcode: p.barcode || '',
            image_url: p.image_url || '',
            default_unit_cost: p.default_unit_cost || 0,
            hs_code: p.hs_code || '',
            weight_grams: p.weight_grams || 0,
            tom_variant_1: p.tom_variant_1 || '',
            tom_variant_2: p.tom_variant_2 || '',
        })
        setErrors({})
        setIsModalOpen(true)
    }

    const validate = () => {
        const next = {}
        if (!form.sku.trim()) next.sku = 'SKU este obligatoriu'
        if (!form.product_name.trim()) next.product_name = 'Numele produsului este obligatoriu'
        setErrors(next)
        return Object.keys(next).length === 0
    }

    const handleSave = async (e) => {
        e?.preventDefault?.()
        if (!validate()) return
        try {
            setIsSaving(true)
            const method = form.id ? 'PUT' : 'POST'
            const url = form.id
                ? `${API_URL}/custom-products/${form.id}`
                : `${API_URL}/custom-products`
            const res = await authFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            })
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                throw new Error(errData.detail || `HTTP ${res.status}`)
            }
            toastSuccess(form.id ? 'Produs actualizat' : 'Produs creat')
            setIsModalOpen(false)
            fetchProducts()
        } catch (err) {
            toastError(err)
        } finally {
            setIsSaving(false)
        }
    }

    const handleDelete = async (product) => {
        const ok = await confirm({
            title: 'Șterge produsul',
            description: `Sigur dorești să ștergi "${product.product_name || product.sku}"? Această acțiune este ireversibilă.`,
            confirmLabel: 'Da, șterge',
            cancelLabel: 'Anulează',
            variant: 'danger',
        })
        if (!ok) return
        try {
            const res = await authFetch(`${API_URL}/custom-products/${product.id}`, { method: 'DELETE' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            toastSuccess('Produs șters')
            fetchProducts()
        } catch (err) {
            toastError(err)
        }
    }

    // Client-side sort (server doesn't support sort yet, sort the visible page)
    const sortedProducts = (() => {
        if (!sort.key || !sort.direction) return products
        const dir = sort.direction === 'asc' ? 1 : -1
        return [...products].sort((a, b) => {
            const av = a[sort.key]
            const bv = b[sort.key]
            if (av == null) return 1
            if (bv == null) return -1
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
            return String(av).localeCompare(String(bv)) * dir
        })
    })()

    const columns = [
        {
            key: 'image', header: 'Imagine', alwaysVisible: true, width: 64,
            render: (p) => p.image_url ? (
                <img src={p.image_url} alt="" className="w-10 h-10 object-cover rounded-lg border border-zinc-200 dark:border-zinc-700" />
            ) : (
                <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                    <Package className="w-5 h-5 text-zinc-400" />
                </div>
            )
        },
        { key: 'sku', header: 'SKU', sortable: true, alwaysVisible: true, render: (p) => <span className="font-mono text-zinc-900 dark:text-white">{p.sku}</span> },
        { key: 'product_name', header: 'Nume produs', sortable: true, render: (p) => <span className="font-medium text-zinc-900 dark:text-white">{p.product_name}</span> },
        { key: 'barcode', header: 'Cod de bare', render: (p) => <span className="font-mono text-zinc-500 dark:text-zinc-400">{p.barcode || '—'}</span> },
        { key: 'default_unit_cost', header: 'Cost (RON)', sortable: true, align: 'right', render: (p) => <span className="font-mono">{(p.default_unit_cost ?? 0).toFixed(2)}</span> },
        { key: 'weight_grams', header: 'Greutate (g)', sortable: true, align: 'right', render: (p) => p.weight_grams || '—' },
        { key: 'hs_code', header: 'HS Code', render: (p) => p.hs_code || '—' },
        { key: 'tom_variant_1', header: 'Variantă 1', render: (p) => p.tom_variant_1 || '—' },
        { key: 'tom_variant_2', header: 'Variantă 2', render: (p) => p.tom_variant_2 || '—' },
        {
            key: 'actions', header: '', alwaysVisible: true, align: 'right', width: 80,
            render: (p) => (
                <div className="flex items-center justify-end gap-1">
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openEdit(p) }}
                        className="p-1.5 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-colors"
                        aria-label="Editează"
                    >
                        <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDelete(p) }}
                        className="p-1.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"
                        aria-label="Șterge"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            ),
        },
    ]

    const defaultVisible = ['image', 'sku', 'product_name', 'barcode', 'default_unit_cost', 'actions']
    const { visibleKeys, setVisibleKeys, defaultVisibleKeys } =
        useColumnVisibility('custom-products', columns, defaultVisible)

    return (
        <PageContainer>
            <PageHeader
                title="Produse Custom"
                subtitle="Gestionează produsele care nu sunt sincronizate din magazine"
                icon={Package}
                actions={<Button variant="primary" icon={Plus} onClick={openCreate}>Adaugă produs</Button>}
            />

            <FilterBar>
                <SearchInput
                    value={search}
                    onChange={handleSearchChange}
                    onDebouncedChange={handleDebouncedSearch}
                    debounce={300}
                    placeholder="Caută după nume, SKU sau cod de bare..."
                    className="min-w-[260px] flex-1"
                />
                <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="hidden sm:inline">{total} produse</span>
                    <ColumnsMenu
                        columns={columns}
                        visibleKeys={visibleKeys}
                        onChange={setVisibleKeys}
                        defaultVisibleKeys={defaultVisibleKeys}
                    />
                </div>
            </FilterBar>

            <DataTable
                columns={columns}
                rows={sortedProducts}
                rowKey="id"
                loading={loading}
                visibleColumnKeys={visibleKeys}
                sort={sort}
                onSort={setSort}
                maxHeight="calc(100vh - 280px)"
                empty={
                    <EmptyState
                        icon={Package}
                        title={debouncedSearch ? 'Niciun produs găsit' : 'Niciun produs custom'}
                        description={debouncedSearch ? 'Modifică termenul de căutare sau adaugă un produs nou.' : 'Adaugă primul produs pentru a începe.'}
                        action={<Button icon={Plus} variant="primary" onClick={openCreate}>Adaugă produs</Button>}
                    />
                }
                footer={
                    <PaginationFooter
                        page={page}
                        pageSize={PAGE_SIZE}
                        total={total}
                        onPageChange={setPage}
                        loading={loading}
                    />
                }
            />

            {isModalOpen && (
                <div
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
                    onClick={(e) => e.target === e.currentTarget && !isSaving && setIsModalOpen(false)}
                >
                    <div className="bg-white dark:bg-zinc-800 rounded-xl shadow-2xl w-full max-w-2xl border border-zinc-200 dark:border-zinc-700">
                        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                            <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
                                {form.id ? 'Editează produs' : 'Adaugă produs custom'}
                            </h3>
                        </div>
                        <form onSubmit={handleSave}>
                            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto">
                                <FormField label="Nume produs" required error={errors.product_name} className="sm:col-span-2">
                                    <TextInput
                                        id="form-product-name"
                                        value={form.product_name}
                                        onChange={(v) => setForm({ ...form, product_name: v })}
                                        error={errors.product_name}
                                        autoFocus
                                    />
                                </FormField>
                                <FormField label="SKU" required error={errors.sku}>
                                    <TextInput
                                        id="form-sku"
                                        value={form.sku}
                                        onChange={(v) => setForm({ ...form, sku: v })}
                                        error={errors.sku}
                                        className="font-mono"
                                    />
                                </FormField>
                                <FormField label="Cod de bare">
                                    <TextInput
                                        id="form-barcode"
                                        value={form.barcode}
                                        onChange={(v) => setForm({ ...form, barcode: v })}
                                        className="font-mono"
                                    />
                                </FormField>
                                <FormField label="URL imagine" hint="Link direct către imaginea produsului" className="sm:col-span-2">
                                    <TextInput
                                        id="form-image"
                                        value={form.image_url}
                                        onChange={(v) => setForm({ ...form, image_url: v })}
                                        placeholder="https://..."
                                    />
                                </FormField>
                                <FormField label="Cost unitar (RON)">
                                    <TextInput
                                        id="form-cost"
                                        type="number"
                                        step="0.01"
                                        value={form.default_unit_cost}
                                        onChange={(v) => setForm({ ...form, default_unit_cost: parseFloat(v) || 0 })}
                                        className="font-mono"
                                    />
                                </FormField>
                                <FormField label="Greutate (grame)">
                                    <TextInput
                                        id="form-weight"
                                        type="number"
                                        value={form.weight_grams}
                                        onChange={(v) => setForm({ ...form, weight_grams: parseInt(v) || 0 })}
                                    />
                                </FormField>
                                <FormField label="HS Code (vamă)" className="sm:col-span-2">
                                    <TextInput
                                        id="form-hs"
                                        value={form.hs_code}
                                        onChange={(v) => setForm({ ...form, hs_code: v })}
                                    />
                                </FormField>
                                <FormField label="Variantă 1 (culoare/stil)">
                                    <TextInput
                                        id="form-v1"
                                        value={form.tom_variant_1}
                                        onChange={(v) => setForm({ ...form, tom_variant_1: v })}
                                    />
                                </FormField>
                                <FormField label="Variantă 2 (mărime)">
                                    <TextInput
                                        id="form-v2"
                                        value={form.tom_variant_2}
                                        onChange={(v) => setForm({ ...form, tom_variant_2: v })}
                                    />
                                </FormField>
                            </div>
                            <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-end gap-2 bg-zinc-50 dark:bg-zinc-900/50 rounded-b-xl">
                                <Button variant="ghost" onClick={() => setIsModalOpen(false)} disabled={isSaving}>Anulează</Button>
                                <Button type="submit" variant="primary" icon={Save} loading={isSaving}>
                                    {form.id ? 'Salvează' : 'Creează'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {confirmDialog}
        </PageContainer>
    )
}
