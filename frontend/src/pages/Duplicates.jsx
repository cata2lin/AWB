import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useStores } from '../hooks/useApi'
import { ordersApi, printApi } from '../services/api'
import MultiSelectFilter from '../components/MultiSelectFilter'
import { toastError, toastSuccess } from '../utils/toast'
import {
    Search, Package, ChevronDown, AlertTriangle, Users, Globe, X, Loader2,
    ExternalLink, Mail, MapPin, Phone, Calendar, Truck, Copy, Filter,
    DollarSign, Tag, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown,
    Unlock, ShieldAlert
} from 'lucide-react'

const STATUS_CONFIG = {
    'new': { label: 'New', cls: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' },
    'processing': { label: 'Processing', cls: 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300' },
    'ready_to_ship': { label: 'Ready to Ship', cls: 'bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300' },
    'shipped': { label: 'Shipped', cls: 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300' },
    'in_transit': { label: 'In Transit', cls: 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300' },
    'out_for_delivery': { label: 'Out for Delivery', cls: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300' },
    'delivered': { label: 'Delivered', cls: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300' },
    'returned': { label: 'Returned', cls: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' },
    'back_to_sender': { label: 'Back to Sender', cls: 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300' },
    'cancelled': { label: 'Cancelled', cls: 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300' },
    'on_hold': { label: 'On Hold', cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' },
    'refunded': { label: 'Refunded', cls: 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300' },
    'not_fulfilled': { label: 'Not Fulfilled', cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' },
    'fulfilled': { label: 'Fulfilled', cls: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300' },
    'waiting_for_courier': { label: 'Waiting Courier', cls: 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-300' },
    'unsuccessful_delivery': { label: 'Failed Delivery', cls: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' },
    'refused': { label: 'Refused', cls: 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300' },
    'lost': { label: 'Lost', cls: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' },
}
const DEFAULT_CLS = 'bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300'

function StatusBadge({ status }) {
    const cfg = STATUS_CONFIG[status] || { label: (status || '').replace(/_/g, ' '), cls: DEFAULT_CLS }
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.cls}`}>{cfg.label}</span>
}

/**
 * Normalize phone for comparison: strip spaces, dashes, parens,
 * and unify Romanian prefix (+4, +40, 04, 4) to bare digits.
 */
function normalizePhone(raw) {
    if (!raw) return ''
    let d = raw.replace(/[\s\-().]/g, '')
    // Strip leading + for comparison
    if (d.startsWith('+40')) d = d.slice(3)
    else if (d.startsWith('+4')) d = d.slice(2)
    else if (d.startsWith('040')) d = d.slice(3)
    else if (d.startsWith('40') && d.length > 9) d = d.slice(2)
    else if (d.startsWith('04')) d = d.slice(2)
    return d
}

export default function Duplicates() {
    const { data: stores = [] } = useStores()
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [page, setPage] = useState(0)
    const [dupType, setDupType] = useState('all')
    const [selectedStores, setSelectedStores] = useState([])
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [search, setSearch] = useState('')
    const [phoneSearch, setPhoneSearch] = useState('')
    const [expandedGroup, setExpandedGroup] = useState(null)
    const [expandedOrder, setExpandedOrder] = useState(null)
    const [windowDays, setWindowDays] = useState(7)
    const [sortBy, setSortBy] = useState('date')
    const [sortDir, setSortDir] = useState('desc')

    // Debounced search — avoids spamming the API on every keystroke
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [debouncedPhone, setDebouncedPhone] = useState('')
    const searchTimer = useRef(null)
    const phoneTimer = useRef(null)

    const handleSearchChange = useCallback((val) => {
        setSearch(val)
        clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(() => {
            setDebouncedSearch(val)
            setPage(0)
            setExpandedGroup(null)
            setExpandedOrder(null)
        }, 400)
    }, [])

    const handlePhoneChange = useCallback((val) => {
        setPhoneSearch(val)
        clearTimeout(phoneTimer.current)
        phoneTimer.current = setTimeout(() => {
            setDebouncedPhone(val)
            setPage(0)
            setExpandedGroup(null)
            setExpandedOrder(null)
        }, 400)
    }, [])

    // Cleanup timers on unmount
    useEffect(() => () => {
        clearTimeout(searchTimer.current)
        clearTimeout(phoneTimer.current)
    }, [])

    // Compute effective dates: backend defaults to 14 days when no dates sent
    const hasCustomDates = dateFrom || dateTo

    const fetchData = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const params = { page, limit: 20, window_days: windowDays, sort_by: sortBy, sort_dir: sortDir }
            if (dateFrom) params.date_from = dateFrom
            if (dateTo) params.date_to = dateTo
            if (selectedStores.length) params.store_uids = selectedStores
            if (dupType !== 'all') params.dup_type = dupType
            if (debouncedSearch) params.search = debouncedSearch
            if (debouncedPhone) params.phone_search = debouncedPhone
            const d = await ordersApi.getDuplicates(params)
            setData(d)
        } catch (e) { setError(e) }
        finally { setLoading(false) }
    }, [page, dupType, dateFrom, dateTo, selectedStores, windowDays, sortBy, sortDir, debouncedSearch, debouncedPhone])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    const storeOptions = stores.map(s => ({ value: s.uid, label: s.name, color: s.color_code }))

    // Groups come pre-filtered from the backend — no client-side filtering needed
    const displayGroups = data?.groups || []

    const totalPages = data ? Math.ceil(data.total_groups / 20) : 1

    return (
        <div className="p-6 space-y-5 max-w-[1800px] mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
                        <Copy className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Duplicate Orders</h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            {data ? `${data.total_groups.toLocaleString()} groups · ${data.total_duplicate_orders.toLocaleString()} orders` : 'Loading...'}
                            {!hasCustomDates && <span className="ml-1 text-zinc-400">(last 14 days)</span>}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <select value={windowDays} onChange={e => { setWindowDays(+e.target.value); setPage(0) }}
                        className="px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white">
                        <option value={3}>3-day window</option>
                        <option value={7}>7-day window</option>
                        <option value={14}>14-day window</option>
                        <option value={30}>30-day window</option>
                    </select>
                    <select value={dupType} onChange={e => { setDupType(e.target.value); setPage(0) }}
                        className="px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white">
                        <option value="all">All Duplicates</option>
                        <option value="product_duplicate">🔴 Product Duplicates</option>
                        <option value="repeat_customer">🔵 Repeat Customers</option>
                    </select>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="flex items-center gap-3 flex-wrap bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 px-4 py-3">
                <div className="relative flex-1 min-w-[180px] max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input type="text" placeholder="Search customer, email, order #..." value={search}
                        onChange={e => handleSearchChange(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-900 dark:text-white placeholder-zinc-400" />
                </div>
                <div className="relative min-w-[160px] max-w-[200px]">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input type="text" placeholder="Search phone..." value={phoneSearch}
                        onChange={e => handlePhoneChange(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-900 dark:text-white placeholder-zinc-400" />
                </div>
                <MultiSelectFilter label="Stores" options={storeOptions} selected={selectedStores}
                    onChange={v => { setSelectedStores(v); setPage(0) }} />
                <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-zinc-400" />
                    <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }}
                        className="px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white dark:[color-scheme:dark]" />
                    <span className="text-zinc-400 text-xs">to</span>
                    <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }}
                        className="px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-white dark:[color-scheme:dark]" />
                </div>
            </div>

            {/* Sort Toolbar */}
            <div className="flex items-center gap-2 text-sm">
                <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <ArrowUpDown className="w-3.5 h-3.5" /> Sort by:
                </span>
                {[{ key: 'date', label: 'Date' }, { key: 'orders', label: 'Order Count' }, { key: 'type', label: 'Type' }].map(opt => (
                    <button key={opt.key}
                        onClick={() => {
                            if (sortBy === opt.key) {
                                setSortDir(d => d === 'desc' ? 'asc' : 'desc')
                            } else {
                                setSortBy(opt.key)
                                setSortDir('desc')
                            }
                            setPage(0)
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border transition-colors ${
                            sortBy === opt.key
                                ? 'bg-primary-50 dark:bg-primary-500/10 border-primary-300 dark:border-primary-600 text-primary-700 dark:text-primary-400 font-medium'
                                : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                        }`}>
                        {opt.label}
                        {sortBy === opt.key && (
                            sortDir === 'desc'
                                ? <ArrowDown className="w-3 h-3" />
                                : <ArrowUp className="w-3 h-3" />
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-7 h-7 animate-spin text-amber-500" />
                    <span className="ml-3 text-zinc-500">Scanning for duplicates...</span>
                </div>
            )}

            {error && <div className="p-8 text-center text-red-500 bg-white dark:bg-zinc-800/60 rounded-xl border border-red-200 dark:border-red-800">Failed to load duplicates</div>}

            {!loading && data && displayGroups.length === 0 && (
                <div className="p-16 text-center bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-green-100 dark:bg-green-500/10 flex items-center justify-center mb-4">
                        <Package className="w-8 h-8 text-green-500" />
                    </div>
                    <p className="text-lg font-medium text-zinc-700 dark:text-zinc-300">
                        {(debouncedSearch || debouncedPhone) ? 'No matching duplicates' : 'No duplicates found'}
                    </p>
                    <p className="text-sm text-zinc-500 mt-1">
                        {(debouncedSearch || debouncedPhone) ? 'Try adjusting your search criteria.' : 'All orders in this period are unique.'}
                    </p>
                </div>
            )}

            {!loading && displayGroups.length > 0 && (
                <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 overflow-hidden">
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-700/50 max-h-[75vh] overflow-y-auto">
                        {displayGroups.map((group, gi) => {
                            const isExp = expandedGroup === gi
                            const isProd = group.group_type === 'product_duplicate'
                            return (
                                <div key={group.customer_email + '-' + gi}>
                                    {/* Group Row */}
                                    <button onClick={() => { setExpandedGroup(isExp ? null : gi); setExpandedOrder(null) }}
                                        className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition-colors text-left">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform flex-shrink-0 ${isExp ? 'rotate-180' : ''}`} />
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide flex-shrink-0 ${isProd
                                                ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300'
                                                : 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'}`}>
                                                {isProd ? 'Product Match' : 'Repeat Customer'}
                                            </span>
                                            {group.is_cross_store && (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 flex items-center gap-1 flex-shrink-0">
                                                    <Globe className="w-3 h-3" /> Cross-Store
                                                </span>
                                            )}
                                            <Users className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                                            <span className="font-medium text-zinc-900 dark:text-white text-sm truncate">{group.customer_name}</span>
                                            <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{group.customer_email}</span>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {group.stores.map((s, si) => (
                                                <span key={si} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">{s}</span>
                                            ))}
                                            <span className="text-xs font-bold text-zinc-500 bg-zinc-100 dark:bg-zinc-700 px-2 py-1 rounded-lg">{group.order_count} orders</span>
                                        </div>
                                    </button>

                                    {/* Expanded Group */}
                                    {isExp && (
                                        <div className="px-5 pb-4 space-y-2">
                                            {group.orders.map((o, oi) => {
                                                const isOrderExp = expandedOrder === `${gi}-${oi}`
                                                const hasFpMatch = isProd && group.orders.some((x, xi) => xi !== oi && x.sku_fingerprint === o.sku_fingerprint && o.sku_fingerprint)
                                                return (
                                                    <div key={o.uid} className={`rounded-xl border overflow-hidden transition-all ${hasFpMatch
                                                        ? 'border-red-200 dark:border-red-700/50 bg-red-50/30 dark:bg-red-500/5'
                                                        : 'border-zinc-200 dark:border-zinc-700/50 bg-zinc-50 dark:bg-zinc-900/50'}`}>
                                                        {/* Order Summary Row */}
                                                        <button onClick={() => setExpandedOrder(isOrderExp ? null : `${gi}-${oi}`)}
                                                            className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/50 dark:hover:bg-zinc-800/50 transition-colors text-left">
                                                            <div className="flex items-center gap-3">
                                                                <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${isOrderExp ? 'rotate-180' : ''}`} />
                                                                <span className="font-semibold text-sm text-zinc-900 dark:text-white">{o.order_number}</span>
                                                                {hasFpMatch && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" title="Exact product match" />}
                                                                <div className="flex items-center gap-1.5">
                                                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: o.store_color }} />
                                                                    <span className="text-sm text-zinc-600 dark:text-zinc-400">{o.store_name}</span>
                                                                </div>
                                                                <StatusBadge status={o.aggregated_status} />
                                                            </div>
                                                            <div className="flex items-center gap-4">
                                                                <span className="text-sm font-medium text-zinc-900 dark:text-white">
                                                                    {o.total_price != null ? `${Number(o.total_price).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} ${o.currency}` : '—'}
                                                                </span>
                                                                <span className="text-xs text-zinc-500">{o.frisbo_created_at ? new Date(o.frisbo_created_at).toLocaleDateString('ro-RO') : '—'}</span>
                                                                {o.shopify_order_url ? (
                                                                    <a href={o.shopify_order_url} target="_blank" rel="noopener noreferrer"
                                                                        onClick={e => e.stopPropagation()}
                                                                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-[10px] font-medium hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors"
                                                                        title="Open in Shopify admin">
                                                                        <ExternalLink className="w-3 h-3" /> Shopify
                                                                    </a>
                                                                ) : null}
                                                            </div>
                                                        </button>

                                                        {/* Expanded Order Details */}
                                                        {isOrderExp && (
                                                            <div className="px-4 pb-4 pt-1 border-t border-zinc-200/50 dark:border-zinc-700/30">
                                                                <div className="grid grid-cols-3 gap-4">
                                                                    {/* Customer Info */}
                                                                    <div className="space-y-2">
                                                                        <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Customer</h4>
                                                                        <div className="space-y-1.5 text-sm">
                                                                            <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                                                                                <Users className="w-3.5 h-3.5 text-zinc-400" /> {o.customer_name}
                                                                            </div>
                                                                            <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                                                                                <Mail className="w-3.5 h-3.5 text-zinc-400" /> {o.customer_email}
                                                                            </div>
                                                                            {o.phone && <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                                                                                <Phone className="w-3.5 h-3.5 text-zinc-400" /> {o.phone}
                                                                            </div>}
                                                                            {o.address && <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                                                                                <MapPin className="w-3.5 h-3.5 text-zinc-400" /> {o.city}{o.country ? `, ${o.country}` : ''}
                                                                            </div>}
                                                                        </div>
                                                                    </div>
                                                                    {/* Products */}
                                                                    <div className="space-y-2">
                                                                        <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Products ({o.item_count} items)</h4>
                                                                        <div className="space-y-1">
                                                                            {o.items.map((item, ii) => (
                                                                                <div key={ii} className="flex items-center justify-between text-sm py-1 px-2 rounded-lg bg-white/50 dark:bg-zinc-800/50">
                                                                                    <div>
                                                                                        <span className="font-mono text-xs text-zinc-500">{item.sku}</span>
                                                                                        <span className="text-zinc-400 ml-1">×{item.quantity}</span>
                                                                                    </div>
                                                                                    <span className="text-xs text-zinc-600 dark:text-zinc-400">{Number(item.price).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} {o.currency}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                    {/* Shipping & Financial */}
                                                                    <div className="space-y-2">
                                                                        <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Shipping & Payment</h4>
                                                                        <div className="space-y-1.5 text-sm">
                                                                            <div className="flex items-center justify-between">
                                                                                <span className="text-zinc-500">Status</span>
                                                                                <StatusBadge status={o.aggregated_status} />
                                                                    {o.print_hold && (
                                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 animate-pulse">
                                                                            <ShieldAlert className="w-3 h-3" /> Print Hold
                                                                        </span>
                                                                    )}
                                                                            </div>
                                                                            {o.courier_name && <div className="flex items-center justify-between">
                                                                                <span className="text-zinc-500">Courier</span>
                                                                                <span className="text-zinc-700 dark:text-zinc-300">{o.courier_name}</span>
                                                                            </div>}
                                                                            {o.tracking_number && <div className="flex items-center justify-between">
                                                                                <span className="text-zinc-500">Tracking</span>
                                                                                <span className="font-mono text-xs text-primary-500">{o.tracking_number}</span>
                                                                            </div>}
                                                                            {o.payment_gateway && <div className="flex items-center justify-between">
                                                                                <span className="text-zinc-500">Payment</span>
                                                                                <span className="text-zinc-700 dark:text-zinc-300 text-xs">{o.payment_gateway}</span>
                                                                            </div>}
                                                                            <div className="flex items-center justify-between pt-1 border-t border-zinc-200/50 dark:border-zinc-700/30">
                                                                                <span className="text-zinc-500 font-medium">Total</span>
                                                                                <span className="font-bold text-zinc-900 dark:text-white">
                                                                                    {Number(o.total_price).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} {o.currency}
                                                                                </span>
                                                                            </div>
                                                                            {o.shopify_order_url ? (
                                                                                <a href={o.shopify_order_url} target="_blank" rel="noopener noreferrer"
                                                                                    className="flex items-center justify-center gap-2 mt-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors">
                                                                                    <ExternalLink className="w-3.5 h-3.5" /> View in Shopify
                                                                                </a>
                                                                            ) : null}
                                                                    {o.print_hold && (
                                                                        <button
                                                                            onClick={async (e) => {
                                                                                e.stopPropagation()
                                                                                try {
                                                                                    await printApi.releaseHold(o.uid)
                                                                                    toastSuccess('Hold eliberat')
                                                                                    // Refresh data
                                                                                    fetchData()
                                                                                } catch (err) {
                                                                                    console.error('Release hold failed:', err)
                                                                                    toastError(err)
                                                                                }
                                                                            }}
                                                                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 text-[10px] font-medium hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
                                                                            title="Release print hold"
                                                                        >
                                                                            <Unlock className="w-3 h-3" /> Release Hold
                                                                        </button>
                                                                    )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-700/50 flex items-center justify-between text-sm text-zinc-500">
                            <span>{data.total_groups} groups total</span>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                                    className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 disabled:opacity-50 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors">
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <span>Page {page + 1} of {totalPages}</span>
                                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}
                                    className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 disabled:opacity-50 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors">
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
