import React, { useState, useMemo, useEffect } from 'react'
import { useStores } from '../hooks/useApi'
import { ordersApi, printApi } from '../services/api'
import MultiSelectFilter from '../components/MultiSelectFilter'
import {
    Search, ArrowUpDown, Package, AlertCircle, ChevronDown, ChevronLeft, ChevronRight,
    User, MapPin, Mail, Filter, X, Printer, FileText, Calendar, Tag, Truck, Store, Save, Lock,
    DollarSign, RotateCcw, ExternalLink, Loader2, Download, RefreshCw
} from 'lucide-react'

export default function Orders() {
    // Stores data
    const { data: stores = [] } = useStores()

    // Couriers data
    const [couriers, setCouriers] = useState([])

    // Pagination state
    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(50)
    const [totalCount, setTotalCount] = useState(0)

    // Multi-select filter states
    const [selectedStores, setSelectedStores] = useState([])
    const [selectedFulfillment, setSelectedFulfillment] = useState([])
    const [selectedShipment, setSelectedShipment] = useState([])
    const [selectedWorkflow, setSelectedWorkflow] = useState([])
    const [selectedCouriers, setSelectedCouriers] = useState([])

    // Dynamic filter options from API
    const [filterOptions, setFilterOptions] = useState({
        shipment_statuses: [],
        fulfillment_statuses: [],
        workflow_statuses: [],
        couriers: []
    })

    // Simple filter states
    const [searchQuery, setSearchQuery] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [itemCountFilter, setItemCountFilter] = useState('all')
    const [printedFilter, setPrintedFilter] = useState('all')
    const [awbFilter, setAwbFilter] = useState('all')
    const [trackingFilter, setTrackingFilter] = useState('all')
    const [shippingCostFilter, setShippingCostFilter] = useState('all')
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

    // AWB details cache (lazy loaded on expand)
    const [awbCache, setAwbCache] = useState({})
    const [awbLoading, setAwbLoading] = useState({})

    // Date range filters
    const [createdDateFrom, setCreatedDateFrom] = useState('')
    const [createdDateTo, setCreatedDateTo] = useState('')

    // Sort state
    const [sortField, setSortField] = useState('frisbo_created_at')
    const [sortDirection, setSortDirection] = useState('desc')

    // Expand state
    const [expandedOrderUid, setExpandedOrderUid] = useState(null)

    // Per-order print/regenerate loading state
    const [printingOrder, setPrintingOrder] = useState(null)  // { uid, action: 'print'|'regen' }

    // Data state
    const [orders, setOrders] = useState([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState(null)
    const [orderTotals, setOrderTotals] = useState(null)

    // Fetch filter options on mount
    useEffect(() => {
        const fetchFilterOptions = async () => {
            try {
                const token = localStorage.getItem('awb_token')
                const response = await fetch('/api/orders/filter-options', {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                })
                const data = await response.json()
                setFilterOptions({
                    shipment_statuses: data.shipment_statuses || [],
                    fulfillment_statuses: data.fulfillment_statuses || [],
                    workflow_statuses: data.workflow_statuses || [],
                    couriers: data.couriers || []
                })
                setCouriers(data.couriers || [])
            } catch (err) {
                console.error('Failed to fetch filter options:', err)
            }
        }
        fetchFilterOptions()
    }, [])

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery)
            setPage(0)
        }, 300)
        return () => clearTimeout(timer)
    }, [searchQuery])

    // Compute effective date range — only changes when BOTH dates are set (or both empty)
    // This prevents double-reload when user navigates months in the date picker
    const effectiveDateFrom = (createdDateFrom && createdDateTo) ? createdDateFrom : (!createdDateFrom && !createdDateTo) ? '' : undefined
    const effectiveDateTo = (createdDateFrom && createdDateTo) ? createdDateTo : (!createdDateFrom && !createdDateTo) ? '' : undefined

    // Fetch orders when filters/pagination/sort change
    useEffect(() => {
        // Skip fetch if one date is set but not the other (user is still picking)
        if (effectiveDateFrom === undefined || effectiveDateTo === undefined) return

        const fetchOrders = async () => {
            setIsLoading(true)
            setError(null)
            try {
                const params = {
                    skip: page * pageSize,
                    limit: pageSize,
                    sort_field: sortField,
                    sort_direction: sortDirection,
                }

                if (debouncedSearch) params.search = debouncedSearch
                if (selectedStores.length > 0) params.store_uids = selectedStores
                if (printedFilter !== 'all') params.is_printed = printedFilter === 'printed'

                // Item count filter
                if (itemCountFilter === '1') {
                    params.min_items = 1
                    params.max_items = 1
                } else if (itemCountFilter === '2-3') {
                    params.min_items = 2
                    params.max_items = 3
                } else if (itemCountFilter === '4+') {
                    params.min_items = 4
                }

                // Multi-select status filters
                if (selectedFulfillment.length > 0) params.fulfillment_status = selectedFulfillment
                if (selectedShipment.length > 0) params.shipment_status = selectedShipment
                if (selectedWorkflow.length > 0) params.aggregated_status = selectedWorkflow
                if (selectedCouriers.length > 0) params.courier_names = selectedCouriers

                // Date filters — only applied when both are set
                if (effectiveDateFrom) params.date_from = effectiveDateFrom
                if (effectiveDateTo) params.date_to = effectiveDateTo

                // AWB filter
                if (awbFilter !== 'all') params.has_awb = awbFilter === 'has_awb'

                // Tracking filter
                if (trackingFilter !== 'all') params.has_tracking = trackingFilter === 'has_tracking'

                // Shipping cost filter
                if (shippingCostFilter !== 'all') params.has_shipping_cost = shippingCostFilter === 'has_cost'

                const data = await ordersApi.getOrders(params)
                setOrders(Array.isArray(data) ? data : [])

                // Fetch total count with same filters
                const countParams = { ...params }
                delete countParams.skip
                delete countParams.limit
                delete countParams.sort_field
                delete countParams.sort_direction
                const countData = await ordersApi.getOrderCount(countParams)
                setTotalCount(countData.count || 0)

                // Fetch totals (RON value) with same filters
                try {
                    const totalsData = await ordersApi.getOrderTotals(countParams)
                    setOrderTotals(totalsData)
                } catch { setOrderTotals(null) }
            } catch (err) {
                setError(err)
                setOrders([])
            } finally {
                setIsLoading(false)
            }
        }

        fetchOrders()
    }, [page, pageSize, debouncedSearch, selectedStores, printedFilter, itemCountFilter,
        selectedFulfillment, selectedShipment, selectedWorkflow, selectedCouriers,
        effectiveDateFrom, effectiveDateTo, awbFilter, trackingFilter, shippingCostFilter, sortField, sortDirection])

    // Lazy-load AWB details when a row is expanded
    const handleExpand = async (orderUid) => {
        if (expandedOrderUid === orderUid) {
            setExpandedOrderUid(null)
            return
        }
        setExpandedOrderUid(orderUid)
        // Fetch AWBs if not cached
        if (!awbCache[orderUid]) {
            setAwbLoading(prev => ({ ...prev, [orderUid]: true }))
            try {
                const data = await ordersApi.getOrderAwbs(orderUid)
                setAwbCache(prev => ({ ...prev, [orderUid]: data }))
            } catch (err) {
                console.error('Failed to fetch AWBs:', err)
            } finally {
                setAwbLoading(prev => ({ ...prev, [orderUid]: false }))
            }
        }
    }

    const getStoreColor = (storeUid) => {
        const store = stores.find(s => s.uid === storeUid)
        return store?.color_code || '#6B7280'
    }

    const toggleSort = (field) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDirection('asc')
        }
        setPage(0)
    }

    const clearAllFilters = () => {
        setSearchQuery('')
        setDebouncedSearch('')
        setSelectedStores([])
        setSelectedFulfillment([])
        setSelectedShipment([])
        setSelectedWorkflow([])
        setSelectedCouriers([])
        setItemCountFilter('all')
        setPrintedFilter('all')
        setAwbFilter('all')
        setTrackingFilter('all')
        setShippingCostFilter('all')
        setCreatedDateFrom('')
        setCreatedDateTo('')
        setPage(0)
    }

    const hasActiveFilters = searchQuery || selectedStores.length > 0 ||
        selectedFulfillment.length > 0 || selectedShipment.length > 0 ||
        selectedWorkflow.length > 0 || selectedCouriers.length > 0 ||
        itemCountFilter !== 'all' || printedFilter !== 'all' ||
        awbFilter !== 'all' || trackingFilter !== 'all' || shippingCostFilter !== 'all' || createdDateFrom || createdDateTo

    const totalPages = Math.ceil(totalCount / pageSize)
    const startItem = page * pageSize + 1
    const endItem = Math.min((page + 1) * pageSize, totalCount)

    // Filter options - dynamic from API
    const storeOptions = stores.map(s => ({ value: s.uid, label: s.name, color: s.color_code }))
    const courierOptions = filterOptions.couriers.map(c => ({ value: c, label: c }))

    // Dynamic filter options from the database
    const fulfillmentOptions = filterOptions.fulfillment_statuses.map(s => ({
        value: s,
        label: s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }))

    const shipmentOptions = filterOptions.shipment_statuses.map(s => ({
        value: s,
        label: s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }))

    const workflowOptions = filterOptions.workflow_statuses.map(s => ({
        value: s,
        label: s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }))

    // Status badge helpers
    const getShipmentStatusBadge = (status) => {
        const statusConfig = {
            'not_created': { label: 'Not Created', color: 'slate' },
            'created_awb': { label: 'AWB Created', color: 'blue' },
            'ready_for_courier': { label: 'Ready', color: 'indigo' },
            'waiting_for_courier': { label: 'Waiting Courier', color: 'amber' },
            'picked_up': { label: 'Picked Up', color: 'purple' },
            'in_transit': { label: 'In Transit', color: 'cyan' },
            'out_for_delivery': { label: 'Out for Delivery', color: 'orange' },
            'delivered': { label: 'Delivered', color: 'green' },
            'returned': { label: 'Returned', color: 'red' },
            'received_by_sender': { label: 'Back to Sender', color: 'rose' },
            'canceled': { label: 'Canceled', color: 'red' },
            'customer_pickup': { label: 'Customer Pickup', color: 'teal' },
            'returning_to_sender': { label: 'Returning', color: 'orange' },
            'unsuccessful_delivery': { label: 'Failed Delivery', color: 'rose' },
            'refused': { label: 'Refused', color: 'fuchsia' },
            'redirected': { label: 'Redirected', color: 'sky' },
            'incorrect_address': { label: 'Bad Address', color: 'amber' },
            'deferred_delivery': { label: 'Deferred', color: 'violet' },
        }
        const config = statusConfig[status] || { label: (status || 'Unknown').replace(/_/g, ' '), color: 'zinc' }
        const colorClasses = {
            zinc: 'bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300',
            slate: 'bg-slate-200 dark:bg-slate-600/30 text-slate-600 dark:text-slate-300',
            blue: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
            indigo: 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
            amber: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
            purple: 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300',
            cyan: 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
            orange: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300',
            green: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300',
            red: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
            rose: 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300',
            teal: 'bg-teal-100 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300',
            fuchsia: 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300',
            sky: 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300',
            violet: 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300',
        }
        return { label: config.label, className: colorClasses[config.color] || colorClasses.zinc }
    }

    const getFulfillmentStatusBadge = (status) => {
        const statusConfig = {
            'fulfilled': { label: 'Fulfilled', color: 'green' },
            'unfulfilled': { label: 'Unfulfilled', color: 'amber' },
            'not_fulfilled': { label: 'Not Fulfilled', color: 'amber' },
            'on_hold': { label: 'On Hold', color: 'orange' },
            'partial': { label: 'Partial', color: 'blue' },
            'cancelled': { label: 'Cancelled', color: 'red' },
            'restocked': { label: 'Restocked', color: 'purple' },
            'scheduled': { label: 'Scheduled', color: 'cyan' },
            'pending': { label: 'Pending', color: 'indigo' },
            'unknown': { label: 'Unknown', color: 'zinc' },
        }
        const config = statusConfig[status] || { label: (status || 'Unknown').replace(/_/g, ' '), color: 'zinc' }
        const colorClasses = {
            zinc: 'bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300',
            green: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300',
            amber: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
            orange: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300',
            blue: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
            red: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
            purple: 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300',
            cyan: 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
            indigo: 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
        }
        return { label: config.label, className: colorClasses[config.color] }
    }

    const getAggregatedStatusBadge = (status) => {
        const statusConfig = {
            'new': { label: 'New', color: 'blue' },
            'processing': { label: 'Processing', color: 'cyan' },
            'ready_to_ship': { label: 'Ready to Ship', color: 'indigo' },
            'shipped': { label: 'Shipped', color: 'purple' },
            'in_transit': { label: 'In Transit', color: 'sky' },
            'out_for_delivery': { label: 'Out for Delivery', color: 'orange' },
            'delivered': { label: 'Delivered', color: 'green' },
            'returned': { label: 'Returned', color: 'red' },
            'back_to_sender': { label: 'Back to Sender', color: 'rose' },
            'returning_to_sender': { label: 'Returning', color: 'orange' },
            'cancelled': { label: 'Cancelled', color: 'rose' },
            'on_hold': { label: 'On Hold', color: 'amber' },
            'refunded': { label: 'Refunded', color: 'fuchsia' },
            'partially_shipped': { label: 'Part. Shipped', color: 'teal' },
            'not_fulfilled': { label: 'Not Fulfilled', color: 'amber' },
            'fulfilled': { label: 'Fulfilled', color: 'green' },
            'waiting_for_courier': { label: 'Waiting Courier', color: 'yellow' },
            'customer_pickup': { label: 'Customer Pickup', color: 'teal' },
            'unsuccessful_delivery': { label: 'Failed Delivery', color: 'red' },
            'refused': { label: 'Refused', color: 'fuchsia' },
            'redirected': { label: 'Redirected', color: 'sky' },
            'incorrect_address': { label: 'Bad Address', color: 'amber' },
            'lost': { label: 'Lost', color: 'red' },
            'deferred_delivery': { label: 'Deferred', color: 'violet' },
            'error': { label: 'Error', color: 'red' },
        }
        const config = statusConfig[status] || { label: (status || '').replace(/_/g, ' '), color: 'zinc' }
        const colorClasses = {
            zinc: 'bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300',
            blue: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
            cyan: 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
            indigo: 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
            purple: 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300',
            sky: 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300',
            green: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300',
            red: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
            rose: 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300',
            amber: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
            yellow: 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
            fuchsia: 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300',
            teal: 'bg-teal-100 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300',
            orange: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300',
            violet: 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300',
        }
        return { label: config.label, className: colorClasses[config.color] || colorClasses.zinc }
    }

    const SortButton = ({ field, children }) => (
        <button
            onClick={() => toggleSort(field)}
            className="flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
        >
            {children}
            <ArrowUpDown className={`w-3 h-3 ${sortField === field ? 'text-indigo-500' : 'opacity-50'}`} />
        </button>
    )

    if (error) {
        return (
            <div className="p-6">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-red-600 dark:text-red-400 font-medium">Failed to load orders</p>
                        <p className="text-sm text-red-500 mt-1">{error.message}</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="p-6 space-y-4 animate-fade-in bg-zinc-50 dark:bg-zinc-950 min-h-screen">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Orders</h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                        {isLoading ? 'Loading...' : `${totalCount.toLocaleString()} total orders`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${showAdvancedFilters
                            ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500 text-indigo-600 dark:text-indigo-400'
                            : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
                            }`}
                    >
                        <Filter className="w-4 h-4" />
                        Filters
                        {hasActiveFilters && (
                            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                        )}
                    </button>
                </div>
            </div>

            {/* Primary Filters Row */}
            <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative flex-1 min-w-[280px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                        type="text"
                        placeholder="Search order #, tracking, customer, SKU..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/50 rounded-lg text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all placeholder:text-zinc-400"
                    />
                </div>

                {/* Store Multi-Select */}
                <MultiSelectFilter
                    label="Stores"
                    options={storeOptions}
                    selected={selectedStores}
                    onChange={(v) => { setSelectedStores(v); setPage(0) }}
                    icon={Store}
                    searchable={true}
                    allLabel="All Stores"
                />

                {/* Fulfillment Multi-Select */}
                <MultiSelectFilter
                    label="Fulfillment"
                    options={fulfillmentOptions}
                    selected={selectedFulfillment}
                    onChange={(v) => { setSelectedFulfillment(v); setPage(0) }}
                    icon={Package}
                    allLabel="All Fulfillment"
                />

                {/* Workflow Multi-Select */}
                <MultiSelectFilter
                    label="Workflow"
                    options={workflowOptions}
                    selected={selectedWorkflow}
                    onChange={(v) => { setSelectedWorkflow(v); setPage(0) }}
                    icon={FileText}
                    allLabel="All Workflow"
                />

                {/* Clear Filters */}
                {hasActiveFilters && (
                    <button
                        onClick={clearAllFilters}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                        <X className="w-4 h-4" />
                        Clear All
                    </button>
                )}
            </div>

            {/* Advanced Filters Panel */}
            {showAdvancedFilters && (
                <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800/60">
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {/* Courier Multi-Select */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                <Truck className="w-3 h-3" />
                                Courier
                            </label>
                            <MultiSelectFilter
                                label="Couriers"
                                options={courierOptions}
                                selected={selectedCouriers}
                                onChange={(v) => { setSelectedCouriers(v); setPage(0) }}
                                searchable={true}
                                allLabel="All Couriers"
                            />
                        </div>

                        {/* Shipment Status Multi-Select */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                <Truck className="w-3 h-3" />
                                Shipment Status
                            </label>
                            <MultiSelectFilter
                                label="Shipment"
                                options={shipmentOptions}
                                selected={selectedShipment}
                                onChange={(v) => { setSelectedShipment(v); setPage(0) }}
                                allLabel="All Shipment"
                            />
                        </div>

                        {/* Item Count Filter */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                <Package className="w-3 h-3" />
                                Item Count
                            </label>
                            <select
                                value={itemCountFilter}
                                onChange={(e) => { setItemCountFilter(e.target.value); setPage(0) }}
                                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm"
                            >
                                <option value="all">Any</option>
                                <option value="1">Single Item (1)</option>
                                <option value="2-3">2-3 Items</option>
                                <option value="4+">4+ Items</option>
                            </select>
                        </div>

                        {/* Printed Status */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                <Printer className="w-3 h-3" />
                                Print Status
                            </label>
                            <select
                                value={printedFilter}
                                onChange={(e) => { setPrintedFilter(e.target.value); setPage(0) }}
                                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm"
                            >
                                <option value="all">Any</option>
                                <option value="unprinted">Unprinted</option>
                                <option value="printed">Printed</option>
                            </select>
                        </div>

                        {/* Created Date From */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                Created From
                            </label>
                            <input
                                type="date"
                                value={createdDateFrom}
                                onChange={(e) => { setCreatedDateFrom(e.target.value); setPage(0) }}
                                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white dark:[color-scheme:dark] text-sm"
                            />
                        </div>

                        {/* Created Date To */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                Created To
                            </label>
                            <input
                                type="date"
                                value={createdDateTo}
                                onChange={(e) => { setCreatedDateTo(e.target.value); setPage(0) }}
                                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white dark:[color-scheme:dark] text-sm"
                            />
                        </div>
                    </div>

                    {/* Second row */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-4">
                        {/* AWB/Tracking Status */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                <Tag className="w-3 h-3" />
                                Tracking
                            </label>
                            <select
                                value={awbFilter}
                                onChange={(e) => { setAwbFilter(e.target.value); setPage(0) }}
                                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm"
                            >
                                <option value="all">All Tracking</option>
                                <option value="has_awb">📦 Has Tracking</option>
                                <option value="no_awb">⏳ No Tracking</option>
                            </select>
                        </div>

                        {/* Shipping Cost Filter */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                                <DollarSign className="w-3 h-3" />
                                Shipping Cost
                            </label>
                            <select
                                value={shippingCostFilter}
                                onChange={(e) => { setShippingCostFilter(e.target.value); setPage(0) }}
                                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm"
                            >
                                <option value="all">All</option>
                                <option value="has_cost">💰 Has Cost</option>
                                <option value="no_cost">❌ No Cost</option>
                            </select>
                        </div>

                        {/* Page Size */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                                Orders per page
                            </label>
                            <select
                                value={pageSize}
                                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
                                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white text-sm"
                            >
                                <option value={25}>25</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                                <option value={200}>200</option>
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {/* Loading State */}
            {isLoading && (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
            )}

            {/* Empty State */}
            {!isLoading && orders.length === 0 && (
                <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800/60 rounded-xl p-10 text-center">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 flex items-center justify-center mb-4">
                        <Package className="w-8 h-8 text-zinc-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-1">No orders found</h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {hasActiveFilters ? 'Try adjusting your filters.' : 'Sync orders from Frisbo on the Dashboard.'}
                    </p>
                </div>
            )}

            {/* Orders Table */}
            {!isLoading && orders.length > 0 && (
                <>
                    {/* Pagination Info */}
                    <div className="flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
                        <span>
                            Showing <strong className="text-zinc-900 dark:text-white">{startItem.toLocaleString()}</strong> to{' '}
                            <strong className="text-zinc-900 dark:text-white">{endItem.toLocaleString()}</strong> of{' '}
                            <strong className="text-zinc-900 dark:text-white">{totalCount.toLocaleString()}</strong> orders
                        </span>
                        {orderTotals && (
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
                                    <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Total:</span>
                                    <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">
                                        {orderTotals.total_ron?.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON
                                    </span>
                                </div>
                                {orderTotals.per_currency?.length > 1 && (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        {orderTotals.per_currency.map(c => (
                                            <span key={c.currency} className="text-xs px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                                                {c.count} × {c.currency}: {c.total?.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                {c.currency !== 'RON' && <span className="text-zinc-400"> (×{c.rate_to_ron})</span>}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                                className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg font-medium">
                                Page {page + 1} of {totalPages.toLocaleString() || 1}
                            </span>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1}
                                className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 overflow-hidden shadow-sm">
                      <div className="overflow-auto max-h-[75vh]">
                        <table className="w-full">
                            <thead className="bg-zinc-50 dark:bg-zinc-900/60 sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                        <SortButton field="order_number">Order</SortButton>
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                        <SortButton field="customer_name">Customer</SortButton>
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                        <SortButton field="store_name">Store</SortButton>
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                        <SortButton field="item_count">Items</SortButton>
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                        <SortButton field="total_price">Total</SortButton>
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                        <SortButton field="courier_name">Courier / Tracking</SortButton>
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                        <SortButton field="transport_cost">Transport</SortButton>
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                        <SortButton field="frisbo_created_at">Date</SortButton>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                {orders.map((order) => {
                                    const isExpanded = expandedOrderUid === order.uid
                                    const lineItems = Array.isArray(order.line_items) ? order.line_items : []
                                    const shippingAddress = order.shipping_address || {}
                                    const shipmentBadge = getShipmentStatusBadge(order.shipment_status)

                                    return (
                                        <React.Fragment key={order.uid}>
                                            <tr
                                                onClick={() => handleExpand(order.uid)}
                                                className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition-colors cursor-pointer table-row-hover"
                                            >
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                        <span className="font-medium text-zinc-900 dark:text-white">{order.order_number}</span>
                                                        {(() => {
                                                            const store = stores.find(s => s.uid === order.store_uid)
                                                            const domain = store?.shopify_domain || (store?.name ? `${store.name.replace(/\s+/g, '').toLowerCase()}.myshopify.com` : null)
                                                            if (!domain) return null
                                                            return (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); window.open(`https://${domain}/admin/orders?query=${encodeURIComponent(order.order_number)}`, '_blank') }}
                                                                    className="p-0.5 rounded hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                                                                    title="Deschide în Shopify"
                                                                >
                                                                    <ExternalLink className="w-3.5 h-3.5 text-indigo-500" />
                                                                </button>
                                                            )
                                                        })()}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate max-w-[150px] block">
                                                        {order.customer_name || '-'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <div
                                                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                            style={{ backgroundColor: getStoreColor(order.store_uid) }}
                                                        />
                                                        <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{order.store_name}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200">
                                                        {order.item_count} item{order.item_count !== 1 ? 's' : ''}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    {order.total_price != null ? (
                                                        <span className="text-sm font-medium text-zinc-900 dark:text-white">
                                                            {Number(order.total_price).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-zinc-500">{order.currency || 'RON'}</span>
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-zinc-400">—</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-col gap-1">
                                                        {(() => {
                                                            const fulfillBadge = getFulfillmentStatusBadge(order.fulfillment_status)
                                                            return (
                                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${fulfillBadge.className}`}>
                                                                    {fulfillBadge.label}
                                                                </span>
                                                            )
                                                        })()}
                                                        {order.shipment_status && (
                                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${shipmentBadge.className}`}>
                                                                <Truck className="w-3 h-3" />
                                                                {shipmentBadge.label}
                                                            </span>
                                                        )}
                                                        {order.aggregated_status && (() => {
                                                            const aggBadge = getAggregatedStatusBadge(order.aggregated_status)
                                                            return (
                                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${aggBadge.className}`}>
                                                                    <FileText className="w-3 h-3" />
                                                                    {aggBadge.label}
                                                                </span>
                                                            )
                                                        })()}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-1.5">
                                                            {order.courier_name && (
                                                                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                                                    {order.courier_name}
                                                                </span>
                                                            )}
                                                            {(awbCache[order.uid]?.awb_count > 1 || order.awb_count > 1) && (
                                                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300" title={`${awbCache[order.uid]?.awb_count || order.awb_count} AWBs`}>
                                                                    <Package className="w-2.5 h-2.5" />
                                                                    ×{awbCache[order.uid]?.awb_count || order.awb_count}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {order.tracking_number ? (
                                                            <code className="text-xs text-indigo-600 dark:text-indigo-400 font-mono">
                                                                {order.tracking_number}
                                                            </code>
                                                        ) : (
                                                            <span className="text-xs text-zinc-400">No tracking</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {order.transport_cost != null ? (
                                                        <div className="space-y-0.5">
                                                            <span className="text-sm font-medium text-zinc-900 dark:text-white">
                                                                {order.transport_cost.toFixed(2)} RON
                                                            </span>
                                                            {order.shipping_data_source && (
                                                                <span className={`block text-[10px] font-medium ${order.shipping_data_source === 'csv_import' ? 'text-green-600 dark:text-green-400' :
                                                                    order.shipping_data_source === 'historical_match' ? 'text-amber-600 dark:text-amber-400' :
                                                                        'text-blue-600 dark:text-blue-400'
                                                                    }`}>
                                                                    {order.shipping_data_source === 'csv_import' ? 'CSV' :
                                                                        order.shipping_data_source === 'historical_match' ? '≈ aprox' : 'manual'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-zinc-400">—</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="space-y-0.5">
                                                        <div className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                                                            <Calendar className="w-3 h-3" />
                                                            <span>{order.frisbo_created_at ? new Date(order.frisbo_created_at).toLocaleDateString() : '-'}</span>
                                                        </div>
                                                        {order.fulfilled_at && (
                                                            <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                                                                <span>✓ {new Date(order.fulfilled_at).toLocaleDateString()}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>

                                            {/* Expanded Details Row */}
                                            {isExpanded && (
                                                <tr className="bg-zinc-50 dark:bg-zinc-900/50">
                                                    <td colSpan={9} className="px-4 py-4">
                                                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
                                                            {/* Customer Info */}
                                                            <div className="space-y-3">
                                                                <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                                                                    <User className="w-4 h-4" />
                                                                    Customer
                                                                </h4>
                                                                <div className="space-y-1 text-sm">
                                                                    <p className="text-zinc-900 dark:text-white font-medium">{order.customer_name || 'N/A'}</p>
                                                                    {order.customer_email && (
                                                                        <p className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                                                            <Mail className="w-3 h-3" />
                                                                            {order.customer_email}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Shipping Address */}
                                                            <div className="space-y-3">
                                                                <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                                                                    <MapPin className="w-4 h-4" />
                                                                    Shipping Address
                                                                </h4>
                                                                <div className="text-sm text-zinc-600 dark:text-zinc-400 space-y-0.5">
                                                                    {shippingAddress.name && <p className="font-medium text-zinc-900 dark:text-white">{shippingAddress.name}</p>}
                                                                    {shippingAddress.address1 && <p>{shippingAddress.address1}</p>}
                                                                    {shippingAddress.address2 && <p>{shippingAddress.address2}</p>}
                                                                    {(shippingAddress.city || shippingAddress.province || shippingAddress.zip) && (
                                                                        <p>{[shippingAddress.city, shippingAddress.province, shippingAddress.zip].filter(Boolean).join(', ')}</p>
                                                                    )}
                                                                    {shippingAddress.country && <p>{shippingAddress.country}</p>}
                                                                    {shippingAddress.phone && <p className="mt-1">📞 {shippingAddress.phone}</p>}
                                                                    {!shippingAddress.address1 && !shippingAddress.city && (
                                                                        <p className="text-zinc-400 italic">No address available</p>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Status Details */}
                                                            <div className="space-y-3">
                                                                <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                                                                    <FileText className="w-4 h-4" />
                                                                    Status Details
                                                                </h4>
                                                                <div className="text-sm space-y-2">
                                                                    <p className="text-zinc-600 dark:text-zinc-400">
                                                                        Fulfillment: <span className="font-medium text-zinc-900 dark:text-white">{order.fulfillment_status?.replace(/_/g, ' ')}</span>
                                                                    </p>
                                                                    <p className="text-zinc-600 dark:text-zinc-400">
                                                                        Shipment: <span className="font-medium text-zinc-900 dark:text-white">{order.shipment_status?.replace(/_/g, ' ') || 'N/A'}</span>
                                                                    </p>
                                                                    <p className="text-zinc-600 dark:text-zinc-400">
                                                                        Workflow: <span className="font-medium text-zinc-900 dark:text-white">{order.aggregated_status?.replace(/_/g, ' ') || 'N/A'}</span>
                                                                    </p>
                                                                    <p className="text-zinc-600 dark:text-zinc-400">
                                                                        Printed: <span className={`font-medium ${order.is_printed ? 'text-green-600' : 'text-amber-600'}`}>
                                                                            {order.is_printed ? 'Yes' : 'No'}
                                                                        </span>
                                                                    </p>
                                                                </div>
                                                            </div>

                                                            {/* Line Items */}
                                                            <div className="space-y-3">
                                                                <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                                                                    <Package className="w-4 h-4" />
                                                                    Items ({lineItems.length})
                                                                </h4>
                                                                <div className="space-y-2 max-h-40 overflow-y-auto">
                                                                    {lineItems.length > 0 ? lineItems.map((item, idx) => (
                                                                        <div key={idx} className="flex justify-between items-start text-sm bg-white dark:bg-zinc-800 rounded-lg p-2 border border-zinc-200 dark:border-zinc-700">
                                                                            <div className="flex-1 min-w-0">
                                                                                <p className="font-medium text-zinc-900 dark:text-white truncate">
                                                                                    {item.inventory_item?.title_1 || item.inventory_item?.sku || 'Unknown Item'}
                                                                                </p>
                                                                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                                                    SKU: {item.inventory_item?.sku || 'N/A'}
                                                                                </p>
                                                                            </div>
                                                                            <div className="text-right ml-2">
                                                                                <p className="font-medium text-zinc-900 dark:text-white">×{item.quantity || 1}</p>
                                                                                {item.price && <p className="text-xs text-zinc-500">{Number(item.price).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {order.currency || 'RON'}</p>}
                                                                            </div>
                                                                        </div>
                                                                    )) : (
                                                                        <p className="text-sm text-zinc-400 italic">No items available</p>
                                                                    )}
                                                                </div>
                                                                {/* AOV (Order Value) — computed from line items */}
                                                                {lineItems.length > 0 && (() => {
                                                                    const orderTotal = lineItems.reduce((sum, item) => sum + ((Number(item.price) || 0) * (item.quantity || 1)), 0)
                                                                    if (orderTotal <= 0) return null
                                                                    return (
                                                                        <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                                                                            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">AOV (Total)</span>
                                                                            <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                                                                                {orderTotal.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {order.currency || 'RON'}
                                                                            </span>
                                                                        </div>
                                                                    )
                                                                })()}
                                                            </div>

                                                            {/* AWB Breakdown Panel */}
                                                            <div className="space-y-3 md:col-span-2">
                                                                <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                                                                    <Truck className="w-4 h-4" />
                                                                    AWB Breakdown
                                                                    {order.shipping_data_source && (
                                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${order.shipping_data_source === 'manual' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                                                                            order.shipping_data_source === 'csv_import' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                                                                                'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                                                            }`}>
                                                                            {order.shipping_data_source === 'manual' && <Lock className="w-3 h-3 inline mr-0.5" />}
                                                                            {order.shipping_data_source === 'csv_import' ? 'CSV' :
                                                                                order.shipping_data_source === 'historical_match' ? '≈ speculative' : 'manual'}
                                                                        </span>
                                                                    )}
                                                                </h4>

                                                                {/* AWB Table */}
                                                                {awbLoading[order.uid] ? (
                                                                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                                        Loading AWBs...
                                                                    </div>
                                                                ) : awbCache[order.uid]?.awbs?.length > 0 ? (
                                                                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                                                        <table className="w-full text-xs">
                                                                            <thead className="bg-zinc-100 dark:bg-zinc-800">
                                                                                <tr>
                                                                                    <th className="px-2 py-1.5 text-left text-zinc-500 dark:text-zinc-400 font-medium">Tracking</th>
                                                                                    <th className="px-2 py-1.5 text-left text-zinc-500 dark:text-zinc-400 font-medium">Type</th>
                                                                                    <th className="px-2 py-1.5 text-right text-zinc-500 dark:text-zinc-400 font-medium">Cost cu TVA</th>
                                                                                    <th className="px-2 py-1.5 text-right text-zinc-500 dark:text-zinc-400 font-medium">Fara TVA</th>
                                                                                    <th className="px-2 py-1.5 text-right text-zinc-500 dark:text-zinc-400 font-medium">TVA</th>
                                                                                    <th className="px-2 py-1.5 text-left text-zinc-500 dark:text-zinc-400 font-medium">Ref</th>
                                                                                    <th className="px-2 py-1.5 text-left text-zinc-500 dark:text-zinc-400 font-medium">Source</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                                                                {awbCache[order.uid].awbs.map((awb) => (
                                                                                    <tr key={awb.id} className={`${awb.awb_type === 'return' ? 'bg-red-50/50 dark:bg-red-900/10' : ''} ${awb.is_billable === false ? 'opacity-50' : ''}`}>
                                                                                        <td className="px-2 py-1.5">
                                                                                            <code className="text-indigo-600 dark:text-indigo-400 font-mono">{awb.tracking_number}</code>
                                                                                            {awb.original_awb && (
                                                                                                <div className="text-[10px] text-zinc-400 mt-0.5 flex items-center gap-0.5">
                                                                                                    <RotateCcw className="w-2.5 h-2.5" />
                                                                                                    {awb.original_awb}
                                                                                                </div>
                                                                                            )}
                                                                                        </td>
                                                                                        <td className="px-2 py-1.5">
                                                                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${awb.awb_type === 'return'
                                                                                                    ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300'
                                                                                                    : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                                                                                }`}>
                                                                                                {awb.awb_type === 'return' ? '↩ Return' : '📦 Outbound'}
                                                                                            </span>
                                                                                            {awb.csv_status && (
                                                                                                <span className={`block mt-0.5 text-[9px] px-1 py-0.5 rounded ${
                                                                                                    awb.is_billable === false
                                                                                                        ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                                                                                                        : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
                                                                                                }`}>
                                                                                                    {awb.is_billable === false && '⛔ '}{awb.csv_status}
                                                                                                </span>
                                                                                            )}
                                                                                        </td>
                                                                                        <td className={`px-2 py-1.5 text-right font-medium ${awb.is_billable === false ? 'line-through text-zinc-400 dark:text-zinc-600' : 'text-zinc-900 dark:text-white'}`}>
                                                                                            {awb.transport_cost != null ? `${awb.transport_cost.toFixed(2)}` : '—'}
                                                                                            {awb.is_billable === false && <span className="block text-[9px] text-red-500 no-underline" style={{textDecoration: 'none'}}>excluded</span>}
                                                                                        </td>
                                                                                        <td className="px-2 py-1.5 text-right text-zinc-600 dark:text-zinc-400">
                                                                                            {awb.transport_cost_fara_tva != null ? `${awb.transport_cost_fara_tva.toFixed(2)}` : '—'}
                                                                                        </td>
                                                                                        <td className="px-2 py-1.5 text-right text-zinc-500 dark:text-zinc-500">
                                                                                            {awb.transport_cost_tva != null ? `${awb.transport_cost_tva.toFixed(2)}` : '—'}
                                                                                        </td>
                                                                                        <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400 font-mono">
                                                                                            {awb.order_ref || '—'}
                                                                                        </td>
                                                                                        <td className="px-2 py-1.5">
                                                                                            <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${awb.data_source === 'csv_import'
                                                                                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                                                                                                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                                                                                }`}>
                                                                                                {awb.data_source === 'csv_import' ? 'CSV' : 'Sync'}
                                                                                            </span>
                                                                                        </td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                            {awbCache[order.uid].awbs.length > 1 && (
                                                                                <tfoot className="bg-zinc-50 dark:bg-zinc-800/80">
                                                                                    <tr>
                                                                                        <td colSpan={2} className="px-2 py-1.5 text-right font-semibold text-zinc-700 dark:text-zinc-300">
                                                                                            Billable ({awbCache[order.uid].awbs.filter(a => a.awb_type !== 'return' && a.is_billable !== false).length} of {awbCache[order.uid].awbs.filter(a => a.awb_type !== 'return').length} outbound)
                                                                                        </td>
                                                                                        <td className="px-2 py-1.5 text-right font-bold text-zinc-900 dark:text-white">
                                                                                            {awbCache[order.uid].awbs
                                                                                                .filter(a => a.awb_type !== 'return' && a.transport_cost != null && a.is_billable !== false)
                                                                                                .reduce((sum, a) => sum + a.transport_cost, 0)
                                                                                                .toFixed(2)}
                                                                                        </td>
                                                                                        <td className="px-2 py-1.5 text-right font-semibold text-zinc-600 dark:text-zinc-400">
                                                                                            {awbCache[order.uid].awbs
                                                                                                .filter(a => a.awb_type !== 'return' && a.transport_cost_fara_tva != null && a.is_billable !== false)
                                                                                                .reduce((sum, a) => sum + a.transport_cost_fara_tva, 0)
                                                                                                .toFixed(2)}
                                                                                        </td>
                                                                                        <td colSpan={3}></td>
                                                                                    </tr>
                                                                                </tfoot>
                                                                            )}
                                                                        </table>
                                                                    </div>
                                                                ) : (
                                                                    <p className="text-sm text-zinc-400 italic">No AWB data — import CSV to populate</p>
                                                                )}

                                                                {/* Manual override */}
                                                                <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
                                                                    <p className="text-[10px] text-zinc-400 mb-2 uppercase tracking-wider font-medium">Manual Override</p>
                                                                    <div className="grid grid-cols-3 gap-2">
                                                                        <div>
                                                                            <label className="text-[10px] text-zinc-500 dark:text-zinc-400">Cost (RON)</label>
                                                                            <input type="number" step="0.01" defaultValue={order.transport_cost ?? ''} id={`ship-cost-${order.uid}`}
                                                                                className="w-full px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-[10px] text-zinc-500 dark:text-zinc-400">Greutate</label>
                                                                            <input type="number" step="0.01" defaultValue={order.package_weight ?? ''} id={`ship-weight-${order.uid}`}
                                                                                className="w-full px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-[10px] text-zinc-500 dark:text-zinc-400">Colete</label>
                                                                            <input type="number" step="1" defaultValue={order.package_count ?? ''} id={`ship-pkg-${order.uid}`}
                                                                                className="w-full px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                                                        </div>
                                                                    </div>
                                                                    <button
                                                                        onClick={async () => {
                                                                            const costEl = document.getElementById(`ship-cost-${order.uid}`)
                                                                            const weightEl = document.getElementById(`ship-weight-${order.uid}`)
                                                                            const pkgEl = document.getElementById(`ship-pkg-${order.uid}`)
                                                                            try {
                                                                                const result = await ordersApi.updateShippingData(order.uid, {
                                                                                    transport_cost: costEl.value ? parseFloat(costEl.value) : undefined,
                                                                                    package_weight: weightEl.value ? parseFloat(weightEl.value) : undefined,
                                                                                    package_count: pkgEl.value ? parseInt(pkgEl.value) : undefined,
                                                                                })
                                                                                order.transport_cost = result.transport_cost
                                                                                order.package_weight = result.package_weight ?? order.package_weight
                                                                                order.package_count = result.package_count ?? order.package_count
                                                                                order.shipping_data_source = result.shipping_data_source
                                                                                order.shipping_data_manual = true
                                                                                setExpandedOrderUid(null)  // collapse + refresh
                                                                                setTimeout(() => handleExpand(order.uid), 100)
                                                                            } catch (err) {
                                                                                console.error('Failed to save shipping data:', err)
                                                                                alert('Eroare la salvare: ' + (err.response?.data?.detail || err.message))
                                                                            }
                                                                        }}
                                                                        className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                                                                    >
                                                                        <Save className="w-3 h-3" />
                                                                        Salvează (Manual)
                                                                    </button>
                                                                </div>

                                                                {/* ═══ Per-Order Print Actions ═══ */}
                                                                <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
                                                                    <p className="text-[10px] text-zinc-400 mb-2 uppercase tracking-wider font-medium">Acțiuni AWB</p>
                                                                    {(() => { const hasAwb = !!(order.awb_pdf_url || order.tracking_number); return (<>
                                                                    <div className="flex gap-2">
                                                                        {/* Print AWB button */}
                                                                        <button
                                                                            disabled={!hasAwb || (printingOrder?.uid === order.uid)}
                                                                            onClick={async () => {
                                                                                setPrintingOrder({ uid: order.uid, action: 'print' })
                                                                                try {
                                                                                    const result = await printApi.printSingle(order.uid)
                                                                                    // Trigger PDF download
                                                                                    const downloadUrl = printApi.getDownloadUrl(result.batch_id)
                                                                                    const link = document.createElement('a')
                                                                                    link.href = downloadUrl
                                                                                    link.download = `${order.order_number || order.uid}.pdf`
                                                                                    document.body.appendChild(link)
                                                                                    link.click()
                                                                                    document.body.removeChild(link)
                                                                                    // Refresh the row to show updated status
                                                                                    order.is_printed = true
                                                                                    order.printed_at = new Date().toISOString()
                                                                                    setExpandedOrderUid(null)
                                                                                    setTimeout(() => handleExpand(order.uid), 150)
                                                                                } catch (err) {
                                                                                    console.error('Print failed:', err)
                                                                                    alert('Eroare la printare: ' + (err.response?.data?.detail || err.message))
                                                                                } finally {
                                                                                    setPrintingOrder(null)
                                                                                }
                                                                            }}
                                                                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                                                                                !hasAwb
                                                                                    ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-400 cursor-not-allowed'
                                                                                    : 'bg-green-600 hover:bg-green-700 text-white'
                                                                            }`}
                                                                        >
                                                                            {printingOrder?.uid === order.uid && printingOrder?.action === 'print'
                                                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                                : <Printer className="w-3.5 h-3.5" />
                                                                            }
                                                                            {printingOrder?.uid === order.uid && printingOrder?.action === 'print'
                                                                                ? 'Se printează...'
                                                                                : 'Printează AWB'
                                                                            }
                                                                        </button>

                                                                        {/* Regenerate AWB button */}
                                                                        <button
                                                                            disabled={!hasAwb || (printingOrder?.uid === order.uid)}
                                                                            onClick={async () => {
                                                                                setPrintingOrder({ uid: order.uid, action: 'regen' })
                                                                                try {
                                                                                    const result = await printApi.regenerate(order.uid)
                                                                                    // Trigger PDF download
                                                                                    const downloadUrl = printApi.getDownloadUrl(result.batch_id)
                                                                                    const link = document.createElement('a')
                                                                                    link.href = downloadUrl
                                                                                    link.download = `${order.order_number || order.uid}_regen.pdf`
                                                                                    document.body.appendChild(link)
                                                                                    link.click()
                                                                                    document.body.removeChild(link)
                                                                                } catch (err) {
                                                                                    console.error('Regenerate failed:', err)
                                                                                    alert('Eroare la regenerare: ' + (err.response?.data?.detail || err.message))
                                                                                } finally {
                                                                                    setPrintingOrder(null)
                                                                                }
                                                                            }}
                                                                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                                                                                !hasAwb
                                                                                    ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-400 cursor-not-allowed'
                                                                                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                                                                            }`}
                                                                        >
                                                                            {printingOrder?.uid === order.uid && printingOrder?.action === 'regen'
                                                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                                : <RefreshCw className="w-3.5 h-3.5" />
                                                                            }
                                                                            {printingOrder?.uid === order.uid && printingOrder?.action === 'regen'
                                                                                ? 'Se regenerează...'
                                                                                : 'Regenerează AWB'
                                                                            }
                                                                        </button>
                                                                    </div>
                                                                    {!hasAwb && (
                                                                        <p className="text-[10px] text-amber-500 mt-1">⚠ Comanda nu are AWB — butoanele sunt dezactivate</p>
                                                                    )}
                                                                    </>)})()}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    )
                                })}
                            </tbody>
                        </table>
                      </div>

                        {orders.length === 0 && (
                            <div className="text-center py-12">
                                <p className="text-zinc-500 dark:text-zinc-400">No orders match your filters.</p>
                            </div>
                        )}
                    </div>

                    {/* Bottom Pagination */}
                    <div className="flex items-center justify-center gap-2">
                        <button
                            onClick={() => setPage(0)}
                            disabled={page === 0}
                            className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                        >
                            First
                        </button>
                        <button
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                            className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                        >
                            Previous
                        </button>
                        <span className="px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400">
                            Page {page + 1} of {totalPages.toLocaleString() || 1}
                        </span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={page >= totalPages - 1}
                            className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                        >
                            Next
                        </button>
                        <button
                            onClick={() => setPage(totalPages - 1)}
                            disabled={page >= totalPages - 1}
                            className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                        >
                            Last
                        </button>
                    </div>
                </>
            )}
        </div>
    )
}
