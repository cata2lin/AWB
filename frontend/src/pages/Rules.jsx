import { useState } from 'react'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { useRules, useCreateRule, useDeleteRule, useToggleRule, useReorderRules, useStores, usePresets, useActivePreset, useSavePreset, useLoadPreset, useDeletePreset } from '../hooks/useApi'
import { GripVertical, Trash2, Plus, Power, AlertCircle, Loader2, Save, FolderOpen, ChevronDown, Check, X } from 'lucide-react'
import AddRuleModal from '../components/AddRuleModal'

export default function Rules() {
    // Fetch from API
    const { data: rules = [], isLoading, error } = useRules()
    const { data: stores = [] } = useStores()
    const { data: presets = [] } = usePresets()
    const { data: activePreset } = useActivePreset()

    const deleteRuleMutation = useDeleteRule()
    const toggleRuleMutation = useToggleRule()
    const reorderRulesMutation = useReorderRules()
    const savePresetMutation = useSavePreset()
    const loadPresetMutation = useLoadPreset()
    const deletePresetMutation = useDeletePreset()

    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isSavePresetOpen, setIsSavePresetOpen] = useState(false)
    const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false)
    const [newPresetName, setNewPresetName] = useState('')
    const [newPresetDescription, setNewPresetDescription] = useState('')

    const handleDragEnd = (result) => {
        if (!result.destination) return

        // Create new order
        const newRules = Array.from(rules)
        const [removed] = newRules.splice(result.source.index, 1)
        newRules.splice(result.destination.index, 0, removed)

        // Send new order to API
        const ruleIds = newRules.map(r => r.id)
        reorderRulesMutation.mutate(ruleIds)
    }

    const handleDelete = (id) => {
        if (confirm('Are you sure you want to delete this rule?')) {
            deleteRuleMutation.mutate(id)
        }
    }

    const handleToggle = (id) => {
        toggleRuleMutation.mutate(id)
    }

    const handleSavePreset = () => {
        if (!newPresetName.trim()) return

        savePresetMutation.mutate({
            name: newPresetName.trim(),
            description: newPresetDescription.trim() || null
        }, {
            onSuccess: () => {
                setIsSavePresetOpen(false)
                setNewPresetName('')
                setNewPresetDescription('')
            }
        })
    }

    const handleLoadPreset = (presetId) => {
        if (confirm('This will replace all current rules with the preset. Continue?')) {
            loadPresetMutation.mutate(presetId)
            setIsPresetDropdownOpen(false)
        }
    }

    const handleDeletePreset = (e, presetId, presetName) => {
        e.stopPropagation()
        if (confirm(`Delete preset "${presetName}"?`)) {
            deletePresetMutation.mutate(presetId)
        }
    }

    // Get store names for condition display
    const getStoreNames = (storeUids) => {
        if (!storeUids || storeUids.length === 0) return null
        const names = storeUids.map(uid => {
            const store = stores.find(s => s.uid === uid)
            return store?.name || uid
        })
        return names.join(', ')
    }

    if (isLoading) {
        return (
            <div className="p-6 flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="p-6">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-red-600 dark:text-red-400 font-medium">Failed to load rules</p>
                        <p className="text-sm text-red-500 mt-1">{error.message}</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6 animate-fade-in bg-zinc-50 dark:bg-zinc-950 min-h-screen">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Rules Configuration</h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                        Drag and drop to set priority. Higher priority rules are applied first.
                    </p>
                    {activePreset && (
                        <p className="text-indigo-600 dark:text-indigo-400 text-sm mt-1 flex items-center gap-1">
                            <Check className="w-4 h-4" />
                            Active preset: <span className="font-medium">{activePreset.name}</span>
                        </p>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Presets Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
                            className="px-4 py-2 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-colors flex items-center gap-2"
                        >
                            <FolderOpen className="w-4 h-4" />
                            Presets
                            <ChevronDown className={`w-4 h-4 transition-transform ${isPresetDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isPresetDropdownOpen && (
                            <>
                                <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setIsPresetDropdownOpen(false)}
                                />
                                <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-zinc-800 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 z-20 overflow-hidden">
                                    <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 px-2">
                                            {presets.length} saved preset{presets.length !== 1 ? 's' : ''}
                                        </p>
                                    </div>

                                    {presets.length === 0 ? (
                                        <div className="p-4 text-center text-zinc-500 dark:text-zinc-400 text-sm">
                                            No presets saved yet
                                        </div>
                                    ) : (
                                        <div className="max-h-64 overflow-y-auto">
                                            {presets.map(preset => (
                                                <div
                                                    key={preset.id}
                                                    onClick={() => handleLoadPreset(preset.id)}
                                                    className={`px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-700 cursor-pointer flex items-center justify-between group ${preset.is_active ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-medium text-zinc-900 dark:text-white truncate">
                                                                {preset.name}
                                                            </p>
                                                            {preset.is_active && (
                                                                <span className="px-1.5 py-0.5 text-xs bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded">
                                                                    Active
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                                            {preset.rule_count} rule{preset.rule_count !== 1 ? 's' : ''}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={(e) => handleDeletePreset(e, preset.id, preset.name)}
                                                        className="p-1 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Save Preset Button */}
                    <button
                        onClick={() => setIsSavePresetOpen(true)}
                        disabled={rules.length === 0}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                    >
                        <Save className="w-4 h-4" />
                        Save Preset
                    </button>

                    {/* Add Rule Button */}
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg font-medium transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20 glow-btn"
                    >
                        <Plus className="w-4 h-4" />
                        Add Rule
                    </button>
                </div>
            </div>

            {/* Save Preset Modal */}
            {isSavePresetOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-zinc-800 rounded-xl shadow-xl w-full max-w-md mx-4">
                        <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                            <h3 className="font-semibold text-zinc-900 dark:text-white">Save Rules as Preset</h3>
                            <button
                                onClick={() => setIsSavePresetOpen(false)}
                                className="text-zinc-400 hover:text-zinc-600"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                    Preset Name *
                                </label>
                                <input
                                    type="text"
                                    value={newPresetName}
                                    onChange={(e) => setNewPresetName(e.target.value)}
                                    placeholder="e.g., Weekend Configuration"
                                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                    Description (optional)
                                </label>
                                <input
                                    type="text"
                                    value={newPresetDescription}
                                    onChange={(e) => setNewPresetDescription(e.target.value)}
                                    placeholder="e.g., Optimized for weekend orders"
                                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                />
                            </div>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                This will save your current {rules.length} rule{rules.length !== 1 ? 's' : ''} as a preset.
                            </p>
                        </div>
                        <div className="p-4 border-t border-zinc-200 dark:border-zinc-700 flex justify-end gap-2">
                            <button
                                onClick={() => setIsSavePresetOpen(false)}
                                className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSavePreset}
                                disabled={!newPresetName.trim() || savePresetMutation.isPending}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white rounded-lg font-medium flex items-center gap-2"
                            >
                                {savePresetMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Save className="w-4 h-4" />
                                )}
                                Save Preset
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Loading indicator for preset operations */}
            {(loadPresetMutation.isPending || deletePresetMutation.isPending) && (
                <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                    <p className="text-indigo-600 dark:text-indigo-400">
                        {loadPresetMutation.isPending ? 'Loading preset...' : 'Deleting preset...'}
                    </p>
                </div>
            )}

            {/* Rules List */}
            <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="rules">
                    {(provided) => (
                        <div
                            {...provided.droppableProps}
                            ref={provided.innerRef}
                            className="space-y-3"
                        >
                            {rules.map((rule, index) => (
                                <Draggable key={rule.id.toString()} draggableId={rule.id.toString()} index={index}>
                                    {(provided, snapshot) => (
                                        <div
                                            ref={provided.innerRef}
                                            {...provided.draggableProps}
                                            className={`bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-4 flex items-center gap-4 transition-all shadow-sm ${snapshot.isDragging ? 'shadow-lg ring-2 ring-indigo-500' : ''
                                                } ${!rule.is_active ? 'opacity-50' : ''}`}
                                        >
                                            {/* Drag Handle */}
                                            <div
                                                {...provided.dragHandleProps}
                                                className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-grab"
                                            >
                                                <GripVertical className="w-5 h-5" />
                                            </div>

                                            {/* Priority Badge */}
                                            <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                                                <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                                                    {rule.priority}
                                                </span>
                                            </div>

                                            {/* Rule Info */}
                                            <div className="flex-1">
                                                <h3 className="font-medium text-zinc-900 dark:text-white">{rule.name}</h3>
                                                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                                    → {rule.group_config?.name || rule.group_name || '(unnamed group)'}
                                                </p>
                                            </div>

                                            {/* Conditions Preview */}
                                            <div className="flex gap-1.5 flex-wrap">
                                                {(() => {
                                                    const c = rule.conditions || {}
                                                    const badges = []

                                                    // Order Size
                                                    if (c.min_items || c.max_items || c.item_count || c.item_count_min) {
                                                        const parts = []
                                                        if (c.item_count) parts.push(`=${c.item_count}`)
                                                        else {
                                                            if (c.min_items || c.item_count_min) parts.push(`≥${c.min_items || c.item_count_min}`)
                                                            if (c.max_items) parts.push(`≤${c.max_items}`)
                                                        }
                                                        badges.push({ color: 'green', label: `Items ${parts.join(' ')}` })
                                                    }

                                                    if (c.min_line_items || c.max_line_items) {
                                                        const parts = []
                                                        if (c.min_line_items) parts.push(`≥${c.min_line_items}`)
                                                        if (c.max_line_items) parts.push(`≤${c.max_line_items}`)
                                                        badges.push({ color: 'emerald', label: `SKUs ${parts.join(' ')}` })
                                                    }

                                                    // SKU
                                                    if (c.sku_contains) badges.push({ color: 'purple', label: `SKU ∋ ${c.sku_contains}` })
                                                    if (c.sku_exact?.length) badges.push({ color: 'violet', label: `SKU = ${c.sku_exact.length}` })
                                                    if (c.sku_excludes) badges.push({ color: 'red', label: `SKU ∌ ${c.sku_excludes}` })

                                                    // Logistics
                                                    if (c.store_uids?.length) {
                                                        const names = getStoreNames(c.store_uids)
                                                        badges.push({ color: 'blue', label: `Store: ${names || c.store_uids.length}` })
                                                    }
                                                    if (c.courier_name) badges.push({ color: 'pink', label: `Courier: ${c.courier_name}` })
                                                    if (c.courier_names?.length) badges.push({ color: 'pink', label: `Courier: ${c.courier_names.join(', ')}` })
                                                    if (c.payment_gateway) badges.push({ color: 'amber', label: `Pay: ${c.payment_gateway}` })

                                                    // Location
                                                    if (c.city_contains) badges.push({ color: 'cyan', label: `City: ${c.city_contains}` })
                                                    if (c.county_contains) badges.push({ color: 'teal', label: `County: ${c.county_contains}` })
                                                    if (c.country_code) badges.push({ color: 'sky', label: `Country: ${c.country_code}` })

                                                    // Price
                                                    if (c.min_total_price != null || c.max_total_price != null) {
                                                        const parts = []
                                                        if (c.min_total_price != null) parts.push(`≥${c.min_total_price}`)
                                                        if (c.max_total_price != null) parts.push(`≤${c.max_total_price}`)
                                                        badges.push({ color: 'orange', label: `Price ${parts.join(' ')}` })
                                                    }

                                                    // Legacy sku_patterns
                                                    if (c.sku_patterns?.length) badges.push({ color: 'purple', label: `SKU pattern` })

                                                    if (badges.length === 0) {
                                                        return <span className="text-xs text-zinc-400 italic">No conditions (matches all)</span>
                                                    }

                                                    const colorMap = {
                                                        green: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300',
                                                        emerald: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
                                                        purple: 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300',
                                                        violet: 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300',
                                                        red: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
                                                        blue: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
                                                        pink: 'bg-pink-100 dark:bg-pink-500/20 text-pink-700 dark:text-pink-300',
                                                        amber: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
                                                        cyan: 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
                                                        teal: 'bg-teal-100 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300',
                                                        sky: 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300',
                                                        orange: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300',
                                                    }

                                                    return badges.map((b, i) => (
                                                        <span key={i} className={`px-2 py-0.5 rounded text-xs font-medium ${colorMap[b.color] || colorMap.blue}`}>
                                                            {b.label}
                                                        </span>
                                                    ))
                                                })()}
                                            </div>

                                            {/* Enable/Disable Toggle */}
                                            <button
                                                onClick={() => handleToggle(rule.id)}
                                                disabled={toggleRuleMutation.isPending}
                                                className={`p-2 rounded-lg transition-colors ${rule.is_active
                                                    ? 'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-500/30'
                                                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                                                    }`}
                                                title={rule.is_active ? 'Disable Rule' : 'Enable Rule'}
                                            >
                                                {toggleRuleMutation.isPending ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <Power className="w-4 h-4" />
                                                )}
                                            </button>

                                            {/* Delete */}
                                            <button
                                                onClick={() => handleDelete(rule.id)}
                                                disabled={deleteRuleMutation.isPending}
                                                className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                                                title="Delete Rule"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </Draggable>
                            ))}
                            {provided.placeholder}
                        </div>
                    )}
                </Droppable>
            </DragDropContext>

            {/* Empty State */}
            {rules.length === 0 && (
                <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-900 rounded-xl">
                    <p className="text-zinc-500 dark:text-zinc-400">No rules configured yet.</p>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="mt-4 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg font-medium transition-all shadow-lg shadow-indigo-500/25 glow-btn"
                    >
                        Create your first rule
                    </button>
                </div>
            )}

            {/* Add Rule Modal */}
            <AddRuleModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        </div>
    )
}
