import { useEffect, useMemo, useState } from 'react'
import {
    Search, RefreshCw, Plus, Save, Edit2, XCircle, Tag, Trash2, Download, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react'
import { skuCostsApi } from '../../services/api'
import { toastError, toastInfo, toastSuccess } from '../../utils/toast'
import ColumnsMenu from '../../components/ui/ColumnsMenu'
import { useColumnVisibility } from '../../hooks/useColumnVisibility'
import { exportCsv } from '../../utils/csvExport'

const SKU_COSTS_COLUMNS = [
    { key: 'sku',    header: 'SKU',         alwaysVisible: true },
    { key: 'name',   header: 'Nume' },
    { key: 'cost',   header: 'Cost (RON)' },
    { key: 'actions',header: 'Acțiuni',     alwaysVisible: true },
]

export default function SkuCostsTab() {
    const [skuCosts, setSkuCosts] = useState([])
    const [skuSearch, setSkuSearch] = useState('')
    const [editingSku, setEditingSku] = useState(null)
    const [newSku, setNewSku] = useState({ sku: '', name: '', cost: 0 })
    const [discoveredSkus, setDiscoveredSkus] = useState([])
    const [skuCostFilter, setSkuCostFilter] = useState('all') // 'all' | 'no_cost' | 'has_cost'
    const [bulkEditMode, setBulkEditMode] = useState(false)
    const [selectedSkus, setSelectedSkus] = useState(new Set())
    const [bulkCostValue, setBulkCostValue] = useState('')
    const [sort, setSort] = useState({ col: null, dir: 'asc' })

    const {
        visibleKeys,
        setVisibleKeys,
        defaultVisibleKeys,
    } = useColumnVisibility('costuri-sku', SKU_COSTS_COLUMNS)
    const colVisible = (key) => visibleKeys.includes(key) || SKU_COSTS_COLUMNS.find(c => c.key === key)?.alwaysVisible

    const sortedSkuCosts = useMemo(() => {
        if (!sort.col) return skuCosts
        const arr = [...skuCosts]
        arr.sort((a, b) => {
            const va = a[sort.col] ?? ''
            const vb = b[sort.col] ?? ''
            if (typeof va === 'number' && typeof vb === 'number') return sort.dir === 'asc' ? va - vb : vb - va
            return sort.dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
        })
        return arr
    }, [skuCosts, sort])

    const toggleSort = (col) => {
        setSort(prev => prev.col === col
            ? (prev.dir === 'asc' ? { col, dir: 'desc' } : { col: null, dir: 'asc' })
            : { col, dir: 'asc' })
    }
    const sortIcon = (col) => {
        if (sort.col !== col) return <ArrowUpDown className="w-3 h-3 opacity-40" />
        return sort.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
    }

    const loadSkuCosts = async () => {
        try {
            const params = { limit: 10000 }
            if (skuSearch) params.search = skuSearch
            const data = await skuCostsApi.getSkuCosts(params)
            let filtered = data
            if (skuCostFilter === 'no_cost') {
                filtered = data.filter(item => !item.cost || item.cost === 0)
            } else if (skuCostFilter === 'has_cost') {
                filtered = data.filter(item => item.cost && item.cost > 0)
            }
            setSkuCosts(filtered)
        } catch (err) {
            console.error('Failed to load SKU costs:', err)
        }
    }

    useEffect(() => {
        loadSkuCosts()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [skuCostFilter, skuSearch])

    const handleDiscoverSkus = async () => {
        try {
            const result = await skuCostsApi.discoverSkus()
            const discovered = result.skus || []
            if (discovered.length === 0) {
                toastInfo('Niciun SKU nou. Toate SKU-urile au costuri.')
                return
            }
            const skusToAdd = discovered.map(sku => ({
                sku: sku.sku,
                name: sku.name || '',
                cost: 10,
                currency: 'RON',
            }))
            await skuCostsApi.bulkUpsert(skusToAdd)
            await loadSkuCosts()
            setDiscoveredSkus([])
            toastSuccess(`${discovered.length} SKU-uri adăugate. Actualizează costurile.`)
        } catch (err) {
            console.error('Failed to discover SKUs:', err)
            toastError(err)
        }
    }

    const handleSaveSkuCost = async (sku, data) => {
        try {
            if (skuCosts.find(s => s.sku === sku)) {
                await skuCostsApi.updateSkuCost(sku, data)
            } else {
                await skuCostsApi.createSkuCost({ sku, ...data })
            }
            await loadSkuCosts()
            setEditingSku(null)
            toastSuccess('Cost SKU salvat')
        } catch (err) {
            console.error('Failed to save SKU cost:', err)
            toastError(err)
        }
    }

    const handleDeleteSkuCost = async (sku) => {
        if (!confirm(`Ștergi costul pentru SKU „${sku}”?`)) return
        try {
            await skuCostsApi.deleteSkuCost(sku)
            await loadSkuCosts()
            toastSuccess('Cost SKU șters')
        } catch (err) {
            console.error('Failed to delete SKU cost:', err)
            toastError(err)
        }
    }

    const handleCreateSku = async () => {
        if (!newSku.sku) return
        try {
            await skuCostsApi.createSkuCost(newSku)
            await loadSkuCosts()
            setNewSku({ sku: '', name: '', cost: 0 })
            toastSuccess('SKU creat')
        } catch (err) {
            console.error('Failed to create SKU cost:', err)
            toastError(err)
        }
    }

    const handleAddDiscoveredSku = async (sku) => {
        try {
            await skuCostsApi.createSkuCost({ sku: sku.sku, name: sku.name || '', cost: 0, currency: 'RON' })
            await loadSkuCosts()
            setDiscoveredSkus(prev => prev.filter(s => s.sku !== sku.sku))
            toastSuccess('SKU adăugat')
        } catch (err) {
            console.error('Failed to add SKU:', err)
            toastError(err)
        }
    }

    const handleBulkApply = async () => {
        if (selectedSkus.size === 0 || !bulkCostValue) return
        const cost = parseFloat(bulkCostValue) || 0
        const skusToUpdate = skuCosts
            .filter(s => selectedSkus.has(s.sku))
            .map(s => ({ sku: s.sku, name: s.name || '', cost, currency: 'RON' }))
        try {
            await skuCostsApi.bulkUpsert(skusToUpdate)
            await loadSkuCosts()
            setSelectedSkus(new Set())
            setBulkCostValue('')
            setBulkEditMode(false)
            toastSuccess(`${skusToUpdate.length} costuri actualizate`)
        } catch (err) {
            console.error('Bulk update failed:', err)
            toastError(err)
        }
    }

    const toggleAllSelected = () => {
        if (selectedSkus.size === skuCosts.length) {
            setSelectedSkus(new Set())
        } else {
            setSelectedSkus(new Set(skuCosts.map(s => s.sku)))
        }
    }

    return (
        <div className="space-y-6">
            {/* Header Actions */}
            <div className="flex flex-wrap gap-4 items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <input
                            type="text"
                            placeholder="Caută SKU..."
                            value={skuSearch}
                            onChange={(e) => setSkuSearch(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && loadSkuCosts()}
                            className="pl-10 pr-4 py-2 bg-white dark:bg-zinc-800 dark:text-white border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                    </div>
                    <button
                        onClick={loadSkuCosts}
                        className="px-4 py-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-white rounded-lg text-sm hover:bg-zinc-200 dark:hover:bg-zinc-600"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
                <button
                    onClick={handleDiscoverSkus}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-2"
                >
                    <Search className="w-4 h-4" />
                    Descoperă SKU-uri din Comenzi
                </button>
            </div>

            {/* Discovered SKUs */}
            {discoveredSkus.length > 0 && (
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-4">
                    <h3 className="font-medium text-purple-800 dark:text-purple-300 mb-3">
                        SKU-uri Descoperite ({discoveredSkus.length} fără costuri)
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {discoveredSkus.slice(0, 20).map(sku => (
                            <button
                                key={sku.sku}
                                onClick={() => handleAddDiscoveredSku(sku)}
                                className="px-3 py-1.5 bg-white dark:bg-zinc-800 dark:text-white border border-purple-300 dark:border-purple-700 rounded-lg text-sm hover:bg-purple-100 dark:hover:bg-purple-900/30 flex items-center gap-2"
                            >
                                <Plus className="w-3 h-3" />
                                <span className="font-mono">{sku.sku}</span>
                                <span className="text-xs text-zinc-500">({sku.order_quantity} comenzi)</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Add New SKU */}
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                <h3 className="font-medium text-zinc-900 dark:text-white mb-3">Adaugă Cost SKU Nou</h3>
                <div className="flex gap-3 items-end">
                    <div className="flex-1">
                        <label className="text-xs text-zinc-500 dark:text-white">SKU</label>
                        <input
                            type="text"
                            value={newSku.sku}
                            onChange={(e) => setNewSku({ ...newSku, sku: e.target.value })}
                            placeholder="SKU-123"
                            className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="text-xs text-zinc-500 dark:text-white">Nume (opțional)</label>
                        <input
                            type="text"
                            value={newSku.name}
                            onChange={(e) => setNewSku({ ...newSku, name: e.target.value })}
                            placeholder="Nume produs"
                            className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                    </div>
                    <div className="w-32">
                        <label className="text-xs text-zinc-500 dark:text-white">Cost (RON)</label>
                        <input
                            type="number"
                            value={newSku.cost}
                            onChange={(e) => setNewSku({ ...newSku, cost: parseFloat(e.target.value) || 0 })}
                            step="0.01"
                            className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                    </div>
                    <button
                        onClick={handleCreateSku}
                        disabled={!newSku.sku}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" /> Adaugă
                    </button>
                </div>
            </div>

            {/* SKU Costs Table */}
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between flex-wrap gap-3">
                    <h3 className="font-semibold text-zinc-900 dark:text-white">
                        Costuri SKU ({skuCosts.length})
                    </h3>
                    <div className="flex items-center gap-2">
                        <select
                            value={skuCostFilter}
                            onChange={(e) => setSkuCostFilter(e.target.value)}
                            className="px-3 py-1.5 bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white border border-zinc-200 dark:border-zinc-600 rounded-lg text-sm"
                        >
                            <option value="all">Toate SKU-urile</option>
                            <option value="no_cost">Fără cost setat</option>
                            <option value="has_cost">Cu cost setat</option>
                        </select>
                        <ColumnsMenu
                            columns={SKU_COSTS_COLUMNS}
                            visibleKeys={visibleKeys}
                            onChange={setVisibleKeys}
                            defaultVisibleKeys={defaultVisibleKeys}
                        />
                        <button
                            onClick={() => {
                                const cols = SKU_COSTS_COLUMNS.filter(c => colVisible(c.key) && c.key !== 'actions').map(c => ({
                                    key: c.key, label: c.header,
                                    accessor: (r) => c.key === 'cost' ? (r.cost ?? 0) : (r[c.key] ?? ''),
                                }))
                                exportCsv({ filename: 'costuri_sku', columns: cols, rows: sortedSkuCosts })
                            }}
                            title="Export CSV"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                        >
                            <Download className="w-4 h-4" /> CSV
                        </button>
                        <button
                            onClick={() => {
                                setBulkEditMode(!bulkEditMode)
                                setSelectedSkus(new Set())
                                setBulkCostValue('')
                            }}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${bulkEditMode
                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                                : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                                }`}
                        >
                            <Edit2 className="w-4 h-4 inline mr-1" />
                            {bulkEditMode ? 'Anulează Bulk Edit' : 'Bulk Edit'}
                        </button>
                    </div>
                </div>

                {bulkEditMode && (
                    <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-200 dark:border-amber-800 flex items-center gap-3 flex-wrap">
                        <span className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                            {selectedSkus.size} selectate
                        </span>
                        <button
                            onClick={toggleAllSelected}
                            className="text-sm text-amber-600 hover:text-amber-800 dark:text-amber-400 underline"
                        >
                            {selectedSkus.size === skuCosts.length ? 'Deselectează tot' : 'Selectează tot'}
                        </button>
                        <div className="flex items-center gap-2 ml-auto">
                            <label className="text-sm text-amber-700 dark:text-amber-400">Cost nou (RON):</label>
                            <input
                                type="number"
                                value={bulkCostValue}
                                onChange={(e) => setBulkCostValue(e.target.value)}
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                className="w-28 px-3 py-1.5 bg-white dark:bg-zinc-800 dark:text-white border border-amber-300 dark:border-amber-700 rounded-lg text-sm"
                            />
                            <button
                                onClick={handleBulkApply}
                                disabled={selectedSkus.size === 0 || !bulkCostValue}
                                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                            >
                                <Save className="w-4 h-4" />
                                Aplică ({selectedSkus.size})
                            </button>
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
                    <table className="w-full">
                        <thead className="bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
                            <tr>
                                {bulkEditMode && (
                                    <th className="w-10 px-3 py-3">
                                        <input
                                            type="checkbox"
                                            checked={selectedSkus.size === skuCosts.length && skuCosts.length > 0}
                                            onChange={toggleAllSelected}
                                            className="w-4 h-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                                        />
                                    </th>
                                )}
                                {colVisible('sku') && (
                                    <th onClick={() => toggleSort('sku')}
                                        className="text-left px-4 py-3 text-xs font-medium text-zinc-600 dark:text-zinc-200 uppercase cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                        <span className="inline-flex items-center gap-1">SKU {sortIcon('sku')}</span>
                                    </th>
                                )}
                                {colVisible('name') && (
                                    <th onClick={() => toggleSort('name')}
                                        className="text-left px-4 py-3 text-xs font-medium text-zinc-600 dark:text-zinc-200 uppercase cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                        <span className="inline-flex items-center gap-1">Nume {sortIcon('name')}</span>
                                    </th>
                                )}
                                {colVisible('cost') && (
                                    <th onClick={() => toggleSort('cost')}
                                        className="text-right px-4 py-3 text-xs font-medium text-zinc-600 dark:text-zinc-200 uppercase cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                                        <span className="inline-flex items-center gap-1 justify-end">Cost (RON) {sortIcon('cost')}</span>
                                    </th>
                                )}
                                {colVisible('actions') && (
                                    <th className="text-right px-4 py-3 text-xs font-medium text-zinc-600 dark:text-zinc-200 uppercase">Acțiuni</th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                            {sortedSkuCosts.length === 0 ? (
                                <tr>
                                    <td colSpan={(bulkEditMode ? 1 : 0) + SKU_COSTS_COLUMNS.filter(c => colVisible(c.key)).length}
                                        className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400">
                                        Niciun cost SKU configurat. Adaugă primul SKU sau descoperă din comenzi.
                                    </td>
                                </tr>
                            ) : sortedSkuCosts.map(sku => (
                                <tr key={sku.sku} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30">
                                    {bulkEditMode && (
                                        <td className="w-10 px-3 py-3">
                                            <input
                                                type="checkbox"
                                                checked={selectedSkus.has(sku.sku)}
                                                onChange={() => {
                                                    const next = new Set(selectedSkus)
                                                    if (next.has(sku.sku)) next.delete(sku.sku)
                                                    else next.add(sku.sku)
                                                    setSelectedSkus(next)
                                                }}
                                                className="w-4 h-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                                            />
                                        </td>
                                    )}
                                    {colVisible('sku') && (
                                        <td className="px-4 py-3 text-sm font-mono text-zinc-900 dark:text-white">
                                            {sku.sku}
                                        </td>
                                    )}
                                    {colVisible('name') && (
                                        <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200">
                                            {editingSku === sku.sku ? (
                                                <input
                                                    type="text"
                                                    defaultValue={sku.name}
                                                    id={`name-${sku.sku}`}
                                                    className="w-full px-2 py-1 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 rounded text-sm"
                                                />
                                            ) : (
                                                sku.name || '-'
                                            )}
                                        </td>
                                    )}
                                    {colVisible('cost') && (
                                        <td className="px-4 py-3 text-sm text-right text-zinc-900 dark:text-white">
                                            {editingSku === sku.sku ? (
                                                <input
                                                    type="number"
                                                    defaultValue={sku.cost}
                                                    id={`cost-${sku.sku}`}
                                                    step="0.01"
                                                    className="w-24 px-2 py-1 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 rounded text-sm text-right"
                                                />
                                            ) : (
                                                <span className={sku.cost === 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
                                                    {sku.cost === 0 ? '⚠ 0 RON' : `${sku.cost} RON`}
                                                </span>
                                            )}
                                        </td>
                                    )}
                                    {colVisible('actions') && (
                                    <td className="px-4 py-3 text-sm text-right">
                                        {editingSku === sku.sku ? (
                                            <div className="flex gap-2 justify-end">
                                                <button
                                                    onClick={() => {
                                                        const name = document.getElementById(`name-${sku.sku}`)?.value
                                                        const cost = parseFloat(document.getElementById(`cost-${sku.sku}`)?.value) || 0
                                                        handleSaveSkuCost(sku.sku, { name, cost })
                                                    }}
                                                    className="p-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded hover:bg-green-200 dark:hover:bg-green-900/50"
                                                >
                                                    <Save className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => setEditingSku(null)}
                                                    className="p-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 rounded hover:bg-zinc-200 dark:hover:bg-zinc-600"
                                                >
                                                    <XCircle className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2 justify-end">
                                                <button
                                                    onClick={() => setEditingSku(sku.sku)}
                                                    className="p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50"
                                                >
                                                    <Tag className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteSkuCost(sku.sku)}
                                                    className="p-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
