import { useState } from 'react'
import { X, Loader2, ChevronDown, ChevronRight, Package, Tag, Truck, MapPin, DollarSign } from 'lucide-react'
import { useStores, useCreateRule } from '../hooks/useApi'

const SECTION_ICONS = {
    size: Package,
    sku: Tag,
    logistics: Truck,
    location: MapPin,
    price: DollarSign,
}

function ConditionSection({ id, title, icon: Icon, children, expanded, onToggle, activeCount }) {
    return (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
                {expanded ?
                    <ChevronDown className="w-4 h-4 text-zinc-400 flex-shrink-0" /> :
                    <ChevronRight className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                }
                <Icon className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex-1 text-left">
                    {title}
                </span>
                {activeCount > 0 && (
                    <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-xs font-medium rounded-full">
                        {activeCount}
                    </span>
                )}
            </button>
            {expanded && (
                <div className="p-4 space-y-4 border-t border-zinc-200 dark:border-zinc-700">
                    {children}
                </div>
            )}
        </div>
    )
}

function FormField({ label, hint, children }) {
    return (
        <div>
            <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                {label}
            </label>
            {children}
            {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">{hint}</p>}
        </div>
    )
}

const inputClass = "w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder-zinc-400 dark:placeholder-zinc-600"

export default function AddRuleModal({ isOpen, onClose }) {
    const { data: stores = [] } = useStores()
    const createRuleMutation = useCreateRule()

    const [name, setName] = useState('')
    const [groupName, setGroupName] = useState('')
    const [groupColor, setGroupColor] = useState('#6366f1')

    // Condition state — all optional
    const [conditions, setConditions] = useState({
        // Order Size
        minItems: '',
        maxItems: '',
        minLineItems: '',
        maxLineItems: '',
        // SKU
        skuContains: '',
        skuExact: '',
        skuExcludes: '',
        // Logistics
        storeUids: [],
        courierName: '',
        paymentGateway: '',
        // Location
        cityContains: '',
        countyContains: '',
        countryCode: '',
        // Price
        minTotalPrice: '',
        maxTotalPrice: '',
    })

    const [expandedSections, setExpandedSections] = useState({})

    if (!isOpen) return null

    const toggleSection = (id) => {
        setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }))
    }

    const toggleStore = (uid) => {
        setConditions(prev => ({
            ...prev,
            storeUids: prev.storeUids.includes(uid)
                ? prev.storeUids.filter(u => u !== uid)
                : [...prev.storeUids, uid]
        }))
    }

    const updateCondition = (key, value) => {
        setConditions(prev => ({ ...prev, [key]: value }))
    }

    // Count active conditions per section
    const countActive = (keys) =>
        keys.filter(k => {
            const v = conditions[k]
            if (Array.isArray(v)) return v.length > 0
            return v !== '' && v !== null && v !== undefined
        }).length

    const sectionCounts = {
        size: countActive(['minItems', 'maxItems', 'minLineItems', 'maxLineItems']),
        sku: countActive(['skuContains', 'skuExact', 'skuExcludes']),
        logistics: countActive(['storeUids', 'courierName', 'paymentGateway']),
        location: countActive(['cityContains', 'countyContains', 'countryCode']),
        price: countActive(['minTotalPrice', 'maxTotalPrice']),
    }

    const handleSubmit = async (e) => {
        e.preventDefault()

        // Build conditions object — only include non-empty values
        const cond = {}
        if (conditions.minItems) cond.min_items = parseInt(conditions.minItems)
        if (conditions.maxItems) cond.max_items = parseInt(conditions.maxItems)
        if (conditions.minLineItems) cond.min_line_items = parseInt(conditions.minLineItems)
        if (conditions.maxLineItems) cond.max_line_items = parseInt(conditions.maxLineItems)
        if (conditions.skuContains) cond.sku_contains = conditions.skuContains.trim()
        if (conditions.skuExact) cond.sku_exact = conditions.skuExact.split(',').map(s => s.trim()).filter(Boolean)
        if (conditions.skuExcludes) cond.sku_excludes = conditions.skuExcludes.trim()
        if (conditions.storeUids.length > 0) cond.store_uids = conditions.storeUids
        if (conditions.courierName) cond.courier_name = conditions.courierName.trim()
        if (conditions.paymentGateway) cond.payment_gateway = conditions.paymentGateway.trim()
        if (conditions.cityContains) cond.city_contains = conditions.cityContains.trim()
        if (conditions.countyContains) cond.county_contains = conditions.countyContains.trim()
        if (conditions.countryCode) cond.country_code = conditions.countryCode.trim()
        if (conditions.minTotalPrice) cond.min_total_price = parseFloat(conditions.minTotalPrice)
        if (conditions.maxTotalPrice) cond.max_total_price = parseFloat(conditions.maxTotalPrice)

        try {
            await createRuleMutation.mutateAsync({
                name,
                group_config: { name: groupName, color: groupColor },
                conditions: cond,
            })
            // Reset
            setName('')
            setGroupName('')
            setGroupColor('#6366f1')
            setConditions({
                minItems: '', maxItems: '', minLineItems: '', maxLineItems: '',
                skuContains: '', skuExact: '', skuExcludes: '',
                storeUids: [], courierName: '', paymentGateway: '',
                cityContains: '', countyContains: '', countryCode: '',
                minTotalPrice: '', maxTotalPrice: '',
            })
            setExpandedSections({})
            onClose()
        } catch (error) {
            console.error('Failed to create rule:', error)
        }
    }

    const totalConditions = Object.values(sectionCounts).reduce((a, b) => a + b, 0)

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />

            <div className="relative bg-white dark:bg-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
                    <div>
                        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Add New Rule</h2>
                        <p className="text-xs text-zinc-500 mt-0.5">All conditions are optional (AND logic)</p>
                    </div>
                    <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Scrollable Form */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
                    <div className="p-5 space-y-4">
                        {/* Basic: Rule Name + Group Name */}
                        <div className="grid grid-cols-1 gap-4">
                            <FormField label="Rule Name *">
                                <input
                                    type="text" required value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className={inputClass}
                                    placeholder="e.g., Esteban Single Items"
                                />
                            </FormField>
                            <div className="grid grid-cols-[1fr,auto] gap-3">
                                <FormField label="Output Group Name *">
                                    <input
                                        type="text" required value={groupName}
                                        onChange={(e) => setGroupName(e.target.value)}
                                        className={inputClass}
                                        placeholder="e.g., 📦 Single Items"
                                    />
                                </FormField>
                                <FormField label="Color">
                                    <input
                                        type="color" value={groupColor}
                                        onChange={(e) => setGroupColor(e.target.value)}
                                        className="w-10 h-[38px] rounded-lg border border-zinc-200 dark:border-zinc-700 cursor-pointer bg-zinc-50 dark:bg-zinc-900"
                                    />
                                </FormField>
                            </div>
                        </div>

                        {/* Divider */}
                        <div className="flex items-center gap-2 pt-1">
                            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
                            <span className="text-xs text-zinc-400 font-medium">
                                CONDITIONS {totalConditions > 0 && `(${totalConditions} active)`}
                            </span>
                            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
                        </div>

                        {/* Section: Order Size */}
                        <ConditionSection
                            id="size" title="Order Size" icon={SECTION_ICONS.size}
                            expanded={expandedSections.size} onToggle={() => toggleSection('size')}
                            activeCount={sectionCounts.size}
                        >
                            <div className="grid grid-cols-2 gap-3">
                                <FormField label="Min Total Items" hint="Total quantity across all SKUs">
                                    <input type="number" min="1" value={conditions.minItems}
                                        onChange={(e) => updateCondition('minItems', e.target.value)}
                                        className={inputClass} placeholder="e.g., 1"
                                    />
                                </FormField>
                                <FormField label="Max Total Items">
                                    <input type="number" min="1" value={conditions.maxItems}
                                        onChange={(e) => updateCondition('maxItems', e.target.value)}
                                        className={inputClass} placeholder="e.g., 5"
                                    />
                                </FormField>
                                <FormField label="Min Unique SKUs" hint="Distinct products in the order">
                                    <input type="number" min="1" value={conditions.minLineItems}
                                        onChange={(e) => updateCondition('minLineItems', e.target.value)}
                                        className={inputClass} placeholder="e.g., 1"
                                    />
                                </FormField>
                                <FormField label="Max Unique SKUs">
                                    <input type="number" min="1" value={conditions.maxLineItems}
                                        onChange={(e) => updateCondition('maxLineItems', e.target.value)}
                                        className={inputClass} placeholder="e.g., 3"
                                    />
                                </FormField>
                            </div>
                        </ConditionSection>

                        {/* Section: SKU Filters */}
                        <ConditionSection
                            id="sku" title="SKU Filters" icon={SECTION_ICONS.sku}
                            expanded={expandedSections.sku} onToggle={() => toggleSection('sku')}
                            activeCount={sectionCounts.sku}
                        >
                            <FormField label="SKU Contains" hint="Match orders with a SKU containing this text">
                                <input type="text" value={conditions.skuContains}
                                    onChange={(e) => updateCondition('skuContains', e.target.value)}
                                    className={inputClass} placeholder="e.g., COV-"
                                />
                            </FormField>
                            <FormField label="Exact SKUs (comma-separated)" hint="Match orders with at least one of these exact SKUs">
                                <input type="text" value={conditions.skuExact}
                                    onChange={(e) => updateCondition('skuExact', e.target.value)}
                                    className={inputClass} placeholder="e.g., 71, 73, 2"
                                />
                            </FormField>
                            <FormField label="SKU Excludes" hint="Exclude orders with any SKU containing this text">
                                <input type="text" value={conditions.skuExcludes}
                                    onChange={(e) => updateCondition('skuExcludes', e.target.value)}
                                    className={inputClass} placeholder="e.g., surpriza"
                                />
                            </FormField>
                        </ConditionSection>

                        {/* Section: Logistics */}
                        <ConditionSection
                            id="logistics" title="Logistics" icon={SECTION_ICONS.logistics}
                            expanded={expandedSections.logistics} onToggle={() => toggleSection('logistics')}
                            activeCount={sectionCounts.logistics}
                        >
                            {/* Store Selection */}
                            <FormField label="Filter by Stores">
                                {stores.length === 0 ? (
                                    <p className="text-sm text-zinc-500">No stores available. Sync orders first.</p>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {stores.map((store) => (
                                            <button
                                                key={store.uid} type="button"
                                                onClick={() => toggleStore(store.uid)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${conditions.storeUids.includes(store.uid)
                                                    ? 'bg-indigo-500 text-white'
                                                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                                                    }`}
                                            >
                                                {store.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </FormField>
                            <div className="grid grid-cols-2 gap-3">
                                <FormField label="Courier Name" hint="e.g., DPD, FAN Courier">
                                    <input type="text" value={conditions.courierName}
                                        onChange={(e) => updateCondition('courierName', e.target.value)}
                                        className={inputClass} placeholder="e.g., DPD"
                                    />
                                </FormField>
                                <FormField label="Payment Type" hint="e.g., ramburs (COD)">
                                    <input type="text" value={conditions.paymentGateway}
                                        onChange={(e) => updateCondition('paymentGateway', e.target.value)}
                                        className={inputClass} placeholder="e.g., ramburs"
                                    />
                                </FormField>
                            </div>
                        </ConditionSection>

                        {/* Section: Location */}
                        <ConditionSection
                            id="location" title="Location" icon={SECTION_ICONS.location}
                            expanded={expandedSections.location} onToggle={() => toggleSection('location')}
                            activeCount={sectionCounts.location}
                        >
                            <div className="grid grid-cols-2 gap-3">
                                <FormField label="City Contains">
                                    <input type="text" value={conditions.cityContains}
                                        onChange={(e) => updateCondition('cityContains', e.target.value)}
                                        className={inputClass} placeholder="e.g., Bucuresti"
                                    />
                                </FormField>
                                <FormField label="County Contains">
                                    <input type="text" value={conditions.countyContains}
                                        onChange={(e) => updateCondition('countyContains', e.target.value)}
                                        className={inputClass} placeholder="e.g., Ilfov"
                                    />
                                </FormField>
                            </div>
                            <FormField label="Country Code" hint="ISO code, e.g., RO, HU, BG">
                                <input type="text" value={conditions.countryCode}
                                    onChange={(e) => updateCondition('countryCode', e.target.value)}
                                    className={inputClass} placeholder="e.g., RO" maxLength={3}
                                />
                            </FormField>
                        </ConditionSection>

                        {/* Section: Price Range */}
                        <ConditionSection
                            id="price" title="Price Range" icon={SECTION_ICONS.price}
                            expanded={expandedSections.price} onToggle={() => toggleSection('price')}
                            activeCount={sectionCounts.price}
                        >
                            <div className="grid grid-cols-2 gap-3">
                                <FormField label="Min Order Total">
                                    <input type="number" min="0" step="0.01" value={conditions.minTotalPrice}
                                        onChange={(e) => updateCondition('minTotalPrice', e.target.value)}
                                        className={inputClass} placeholder="e.g., 50"
                                    />
                                </FormField>
                                <FormField label="Max Order Total">
                                    <input type="number" min="0" step="0.01" value={conditions.maxTotalPrice}
                                        onChange={(e) => updateCondition('maxTotalPrice', e.target.value)}
                                        className={inputClass} placeholder="e.g., 200"
                                    />
                                </FormField>
                            </div>
                        </ConditionSection>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex justify-end gap-3 p-5 border-t border-zinc-200 dark:border-zinc-700 flex-shrink-0">
                        <button
                            type="button" onClick={onClose}
                            className="px-5 py-2.5 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={createRuleMutation.isPending}
                            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                        >
                            {createRuleMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                            Add Rule
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
