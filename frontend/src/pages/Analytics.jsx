/**
 * Analytics Page - Print Analytics, Geographic Distribution & Deliverability Report
 * 
 * Features:
 * - Print analytics with charts
 * - Geographic distribution charts showing order distribution by country/city
 * - Deliverability report per store with period comparison
 */
import { useState, useEffect, useMemo, Fragment } from 'react'
import {
    Globe2, TrendingUp, Package, Truck, XCircle, RotateCcw,
    ChevronDown, ChevronUp, RefreshCw, Filter, BarChart3, Store, Printer,
    Calendar, ArrowRight, ArrowUpRight, ArrowDownRight, PieChart, MapPin,
    DollarSign, Tag, Save, Plus, Trash2, Search, AlertTriangle, Info, Edit2
} from 'lucide-react'
import { storesApi, analyticsApi, skuCostsApi, profitabilityConfigApi } from '../services/api'

// Country emoji flags for display
const COUNTRY_FLAGS = {
    'RO': '🇷🇴', 'BG': '🇧🇬', 'HU': '🇭🇺', 'DE': '🇩🇪', 'FR': '🇫🇷',
    'IT': '🇮🇹', 'ES': '🇪🇸', 'PL': '🇵🇱', 'AT': '🇦🇹', 'GR': '🇬🇷',
    'NL': '🇳🇱', 'BE': '🇧🇪', 'PT': '🇵🇹', 'SE': '🇸🇪', 'GB': '🇬🇧',
    'CZ': '🇨🇿', 'SK': '🇸🇰', 'HR': '🇭🇷', 'SI': '🇸🇮', 'MD': '🇲🇩',
    'UA': '🇺🇦', 'RS': '🇷🇸', 'IE': '🇮🇪'
}

// Color palette for charts
const CHART_COLORS = [
    '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
    '#ec4899', '#6366f1', '#14b8a6', '#84cc16', '#f97316'
]

export default function Analytics() {
    // State
    const [stores, setStores] = useState([])
    const [selectedStores, setSelectedStores] = useState([])
    const [days, setDays] = useState(30)
    const [customDateFrom, setCustomDateFrom] = useState('')
    const [customDateTo, setCustomDateTo] = useState('')
    const [geoData, setGeoData] = useState(null)
    const [deliverabilityData, setDeliverabilityData] = useState(null)
    const [comparisonData, setComparisonData] = useState(null)
    const [printAnalytics, setPrintAnalytics] = useState(null)
    const [isLoading, setIsLoading] = useState(true)
    const [activeTab, setActiveTab] = useState('deliverability')
    const [showComparison, setShowComparison] = useState(false)

    // SKU Costs state
    const [skuCosts, setSkuCosts] = useState([])
    const [skuSearch, setSkuSearch] = useState('')
    const [editingSku, setEditingSku] = useState(null)
    const [newSku, setNewSku] = useState({ sku: '', name: '', cost: 0 })
    const [discoveredSkus, setDiscoveredSkus] = useState([])

    // Profitability state
    const [profitabilityData, setProfitabilityData] = useState(null)
    const [orderProfitData, setOrderProfitData] = useState(null)
    const [orderProfitPage, setOrderProfitPage] = useState(0)
    const [orderProfitStatus, setOrderProfitStatus] = useState('')
    const [orderProfitLoading, setOrderProfitLoading] = useState(false)

    // Profitability date period filter (independent of global date filter)
    const [profitPeriod, setProfitPeriod] = useState('30d') // '30d', '90d', 'lastMonth', 'thisMonth', 'custom', or 'YYYY-MM'
    const [profitDateFrom, setProfitDateFrom] = useState('')
    const [profitDateTo, setProfitDateTo] = useState('')
    const [profitLoading, setProfitLoading] = useState(false)
    const [expandedPnlSections, setExpandedPnlSections] = useState({})

    // SKU Risk state
    const [skuRiskData, setSkuRiskData] = useState(null)
    const [skuRiskLoading, setSkuRiskLoading] = useState(false)
    const [skuRiskDays, setSkuRiskDays] = useState(30)
    const [skuRiskStore, setSkuRiskStore] = useState('')
    const [skuRiskCourier, setSkuRiskCourier] = useState('')
    const [skuRiskMinUnits, setSkuRiskMinUnits] = useState(30)
    const [skuRiskMinOrders, setSkuRiskMinOrders] = useState(20)
    const [skuRiskInclDelivery, setSkuRiskInclDelivery] = useState(false)
    const [skuRiskSort, setSkuRiskSort] = useState({ col: 'risk_score', dir: 'desc' })
    const [skuRiskExpanded, setSkuRiskExpanded] = useState(null)
    const [skuRiskAnomalyPage, setSkuRiskAnomalyPage] = useState(0)
    const [expandedOrderUid, setExpandedOrderUid] = useState(null)
    const [showCalcLegend, setShowCalcLegend] = useState(false)

    // Sales Velocity state
    const [velocityData, setVelocityData] = useState(null)
    const [velocityLoading, setVelocityLoading] = useState(false)
    const [velocityDays, setVelocityDays] = useState(30)
    const [velocityDateFrom, setVelocityDateFrom] = useState('')
    const [velocityDateTo, setVelocityDateTo] = useState('')
    const [velocityStore, setVelocityStore] = useState('')
    const [velocityMinUnits, setVelocityMinUnits] = useState(1)
    const [velocitySearch, setVelocitySearch] = useState('')
    const [velocitySort, setVelocitySort] = useState({ col: 'velocity', dir: 'desc' })
    const [velocityExpanded, setVelocityExpanded] = useState(null)
    const [velocityView, setVelocityView] = useState('table') // 'table' | 'charts' | 'alerts'
    const [growthSearch, setGrowthSearch] = useState('')
    const [declineSearch, setDeclineSearch] = useState('')
    const [growthSort, setGrowthSort] = useState('velocity_change_pct')
    const [declineSort, setDeclineSort] = useState('velocity_change_pct')
    const [expandedStoreUid, setExpandedStoreUid] = useState(null)
    const [alertSearch, setAlertSearch] = useState('')
    const [hoveredTrendBar, setHoveredTrendBar] = useState(null)

    // Top SKUs table state

    // (Marketing costs moved to Business Costs management)

    // SKU costs filter & bulk edit state
    const [skuCostFilter, setSkuCostFilter] = useState('all') // 'all' | 'no_cost' | 'has_cost'
    const [bulkEditMode, setBulkEditMode] = useState(false)
    const [selectedSkus, setSelectedSkus] = useState(new Set())
    const [bulkCostValue, setBulkCostValue] = useState('')

    // Fetch stores on mount
    useEffect(() => {
        const fetchStores = async () => {
            try {
                const data = await storesApi.getStores()
                setStores(Array.isArray(data) ? data : [])
            } catch (err) {
                console.error('Failed to fetch stores:', err)
            }
        }
        fetchStores()
    }, [])

    // Fetch analytics data
    // Compute effective date range key — only changes when BOTH dates are set
    // This prevents double-reload when user sets one date at a time
    const effectiveDateRange = (customDateFrom && customDateTo) ? `${customDateFrom}_${customDateTo}` : null

    useEffect(() => {
        const fetchData = async () => {
            // If one custom date is set but not the other, skip fetching (wait for user to complete)
            if ((customDateFrom && !customDateTo) || (!customDateFrom && customDateTo)) {
                return
            }
            setIsLoading(true)
            try {
                const params = new URLSearchParams()
                if (selectedStores.length > 0) {
                    params.set('store_uids', selectedStores.join(','))
                }
                // Use custom date range if both dates are set, otherwise use days
                if (customDateFrom && customDateTo) {
                    params.set('date_from', customDateFrom)
                    params.set('date_to', customDateTo)
                } else if (days) {
                    params.set('days', days.toString())
                }

                // Build deliverability params with optional 3-day shift
                const delParams = new URLSearchParams(params)
                if (showComparison) {
                    // Shift date range back by 3 days for deliverability
                    // Orders from the last 3 days are likely still in transit
                    const shiftDays = 3
                    const today = new Date()
                    const shiftedEnd = new Date(today)
                    shiftedEnd.setDate(shiftedEnd.getDate() - shiftDays)
                    const shiftedEndStr = shiftedEnd.toISOString().split('T')[0]

                    if (customDateFrom && customDateTo) {
                        // Custom dates: shift end date back by 3 days
                        const origEnd = new Date(customDateTo)
                        origEnd.setDate(origEnd.getDate() - shiftDays)
                        delParams.set('date_to', origEnd.toISOString().split('T')[0])
                    } else if (days) {
                        // Predefined period: keep same window length but shift end to today-3
                        const shiftedStart = new Date(today)
                        shiftedStart.setDate(shiftedStart.getDate() - shiftDays - days)
                        delParams.delete('days')
                        delParams.set('date_from', shiftedStart.toISOString().split('T')[0])
                        delParams.set('date_to', shiftedEndStr)
                    }
                }

                const API_URL = import.meta.env.VITE_API_URL || '/api'

                // Fetch fast endpoints first (geo, deliverability, print) — these render other tabs
                const [geoRes, delRes, printRes] = await Promise.all([
                    fetch(`${API_URL}/analytics/geographic?${params}`).then(r => r.json()),
                    fetch(`${API_URL}/analytics/deliverability?${delParams}`).then(r => r.json()),
                    analyticsApi.getAnalytics(days || 30),
                ])

                setGeoData(geoRes)
                setDeliverabilityData(delRes)
                setPrintAnalytics(printRes)
                setIsLoading(false)

                // Fetch profitability in background (can take 30-60s for 100k+ orders)
                setProfitLoading(true)
                try {
                    const profitRes = await fetch(`${API_URL}/analytics/profitability?${params}`).then(r => r.json())
                    setProfitabilityData(profitRes)
                } catch (profitErr) {
                    console.error('Failed to fetch profitability:', profitErr)
                } finally {
                    setProfitLoading(false)
                }
            } catch (err) {
                console.error('Failed to fetch analytics:', err)
                setIsLoading(false)
            }
        }
        fetchData()
    }, [selectedStores, days, effectiveDateRange, showComparison])

    // Load saved marketing cost from profitability config
    useEffect(() => {
        if (profitabilityData?.config?.marketing_costs) {
            const now = new Date()
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
            const saved = profitabilityData.config.marketing_costs[monthKey] || 0
            setSavedMarketingCost(saved)
            if (saved > 0) setMonthlyMarketingCost(saved.toString())
        }
    }, [profitabilityData])

    // --- Profitability period refetch ---
    const fetchProfitability = async (period, customFrom, customTo) => {
        setProfitLoading(true)
        try {
            const API_URL = import.meta.env.VITE_API_URL || '/api'
            const params = new URLSearchParams()
            if (selectedStores.length > 0) {
                params.set('store_uids', selectedStores.join(','))
            }

            const now = new Date()
            let dateFrom, dateTo

            if (period === '30d') {
                const d = new Date(now); d.setDate(d.getDate() - 30)
                dateFrom = d.toISOString().split('T')[0]
                dateTo = now.toISOString().split('T')[0]
            } else if (period === '90d') {
                const d = new Date(now); d.setDate(d.getDate() - 90)
                dateFrom = d.toISOString().split('T')[0]
                dateTo = now.toISOString().split('T')[0]
            } else if (period === 'thisMonth') {
                dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
                dateTo = now.toISOString().split('T')[0]
            } else if (period === 'lastMonth') {
                const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
                const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0)
                dateFrom = lm.toISOString().split('T')[0]
                dateTo = lmEnd.toISOString().split('T')[0]
            } else if (period === 'custom') {
                if (!customFrom || !customTo) { setProfitLoading(false); return }
                dateFrom = customFrom
                dateTo = customTo
            } else if (/^\d{4}-\d{2}$/.test(period)) {
                // Specific month like '2026-01'
                const [y, m] = period.split('-').map(Number)
                dateFrom = `${y}-${String(m).padStart(2, '0')}-01`
                const lastDay = new Date(y, m, 0).getDate()
                dateTo = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
            }

            if (dateFrom) params.set('date_from', dateFrom)
            if (dateTo) params.set('date_to', dateTo)

            const res = await fetch(`${API_URL}/analytics/profitability?${params}`)
            const data = await res.json()
            setProfitabilityData(data)
        } catch (err) {
            console.error('Failed to fetch profitability:', err)
        } finally {
            setProfitLoading(false)
        }
    }

    // Refetch profitability when period changes
    useEffect(() => {
        if (activeTab === 'profitability' || activeTab === 'pnlCompare') {
            if (profitPeriod === 'custom') {
                if (profitDateFrom && profitDateTo) {
                    fetchProfitability('custom', profitDateFrom, profitDateTo)
                }
            } else {
                fetchProfitability(profitPeriod)
            }
        }
    }, [profitPeriod, profitDateFrom, profitDateTo, activeTab, selectedStores])

    // Fetch SKU costs when tab is activated
    useEffect(() => {
        if (activeTab === 'skuCosts') {
            loadSkuCosts()
        }
    }, [activeTab, skuCostFilter, skuSearch])

    const loadSkuCosts = async () => {
        try {
            const params = { limit: 10000 }
            if (skuSearch) params.search = skuSearch
            const data = await skuCostsApi.getSkuCosts(params)
            // Client-side filtering for has_cost since backend may not support it yet
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

    const handleDiscoverSkus = async () => {
        try {
            const result = await skuCostsApi.discoverSkus()
            const discovered = result.skus || []

            if (discovered.length === 0) {
                alert('No new SKUs found in orders. All SKUs already have costs assigned.')
                return
            }

            // Auto-add all discovered SKUs with cost of 10
            const skusToAdd = discovered.map(sku => ({
                sku: sku.sku,
                name: sku.name || '',
                cost: 10,
                currency: 'RON'
            }))

            await skuCostsApi.bulkUpsert(skusToAdd)
            await loadSkuCosts()
            setDiscoveredSkus([])

            alert(`Added ${discovered.length} SKUs from orders. Please update their costs.`)
        } catch (err) {
            console.error('Failed to discover SKUs:', err)
            alert('Failed to discover SKUs: ' + (err.message || 'Unknown error'))
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
        } catch (err) {
            console.error('Failed to save SKU cost:', err)
        }
    }

    const handleDeleteSkuCost = async (sku) => {
        if (!confirm(`Delete cost for SKU "${sku}"?`)) return
        try {
            await skuCostsApi.deleteSkuCost(sku)
            await loadSkuCosts()
        } catch (err) {
            console.error('Failed to delete SKU cost:', err)
        }
    }

    const handleCreateSku = async () => {
        if (!newSku.sku) return
        try {
            await skuCostsApi.createSkuCost(newSku)
            await loadSkuCosts()
            setNewSku({ sku: '', name: '', cost: 0 })
        } catch (err) {
            console.error('Failed to create SKU cost:', err)
        }
    }

    const handleAddDiscoveredSku = async (sku) => {
        try {
            await skuCostsApi.createSkuCost({ sku: sku.sku, name: sku.name || '', cost: 0, currency: 'RON' })
            await loadSkuCosts()
            setDiscoveredSkus(prev => prev.filter(s => s.sku !== sku.sku))
        } catch (err) {
            console.error('Failed to add SKU:', err)
        }
    }

    // Get color for deliverability rate
    const getRateColor = (rate) => {
        if (rate >= 80) return 'text-green-600 dark:text-green-400'
        if (rate >= 60) return 'text-yellow-600 dark:text-yellow-400'
        return 'text-red-600 dark:text-red-400'
    }

    const getRateBgColor = (rate) => {
        if (rate >= 80) return 'bg-green-500'
        if (rate >= 60) return 'bg-yellow-500'
        return 'bg-red-500'
    }

    // Format large numbers (for counts)
    const formatNumber = (num) => {
        if (num == null) return '0'
        return Number(num).toLocaleString('ro-RO')
    }

    // Format currency values (always 2 decimals, thousands separator)
    const formatMoney = (num) => {
        if (num == null) return '0.00'
        return Number(num).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }

    // Get all cities sorted by order count for charts
    const topCities = useMemo(() => {
        if (!geoData?.countries) return []
        return geoData.countries
            .flatMap(country =>
                (country.cities || []).map(city => ({
                    country: country.name,
                    countryCode: country.code,
                    city: city.name,
                    province: city.province,
                    count: city.count
                }))
            )
            .sort((a, b) => b.count - a.count)
            .slice(0, 50)
    }, [geoData])

    // Get county/province aggregation for Romania
    const countyData = useMemo(() => {
        if (!geoData?.countries) return []
        const romania = geoData.countries.find(c => c.code === 'RO')
        if (!romania?.cities) return []

        const counties = {}
        romania.cities.forEach(city => {
            const county = city.province || 'Unknown'
            if (!counties[county]) {
                counties[county] = { name: county, count: 0, cities: 0 }
            }
            counties[county].count += city.count
            counties[county].cities += 1
        })

        return Object.values(counties)
            .sort((a, b) => b.count - a.count)
            .slice(0, 20)
    }, [geoData])

    return (
        <div className="p-6 space-y-6 bg-zinc-50 dark:bg-zinc-950 min-h-screen animate-fade-in">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-3 tracking-tight">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                            <BarChart3 className="w-5 h-5 text-white" />
                        </div>
                        Analiză și Livrabilitate
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 mt-1">
                        Statistici tipărire, distribuție geografică și performanță livrare
                    </p>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex flex-wrap gap-1 bg-zinc-100 dark:bg-zinc-800/60 p-1.5 rounded-xl w-fit border border-zinc-200 dark:border-zinc-700/50">
                <button
                    onClick={() => setActiveTab('deliverability')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'deliverability'
                        ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <TrendingUp className="w-4 h-4 inline mr-2" />
                    Livrabilitate
                </button>
                <button
                    onClick={() => setActiveTab('profitability')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'profitability'
                        ? 'bg-white dark:bg-zinc-700 text-green-600 dark:text-green-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <DollarSign className="w-4 h-4 inline mr-2" />
                    Profitabilitate
                </button>
                <button
                    onClick={() => setActiveTab('pnlCompare')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'pnlCompare'
                        ? 'bg-white dark:bg-zinc-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <BarChart3 className="w-4 h-4 inline mr-2" />
                    P&L Comparativ
                </button>
                <button
                    onClick={() => setActiveTab('skuCosts')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'skuCosts'
                        ? 'bg-white dark:bg-zinc-700 text-purple-600 dark:text-purple-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <Tag className="w-4 h-4 inline mr-2" />
                    Costuri SKU
                </button>

                <button
                    onClick={() => setActiveTab('print')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'print'
                        ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <Printer className="w-4 h-4 inline mr-2" />
                    Print Analytics
                </button>
                <button
                    onClick={() => setActiveTab('skuRisk')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'skuRisk'
                        ? 'bg-white dark:bg-zinc-700 text-red-600 dark:text-red-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <AlertTriangle className="w-4 h-4 inline mr-2" />
                    SKU Risk
                </button>
                <button
                    onClick={() => setActiveTab('salesVelocity')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'salesVelocity'
                        ? 'bg-white dark:bg-zinc-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <TrendingUp className="w-4 h-4 inline mr-2" />
                    Viteză Vânzări
                </button>
            </div>

            {/* Loading State */}
            {isLoading ? (
                <div className="flex items-center justify-center py-20">
                    <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                    <span className="ml-3 text-zinc-500 dark:text-white">Se încarcă datele...</span>
                </div>
            ) : (
                <>
                    {/* Print Analytics Tab */}
                    {activeTab === 'print' && printAnalytics && (
                        <div className="space-y-6">
                            {/* KPI Cards */}
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
                                    <div className="text-sm text-zinc-500 dark:text-white">Total Printed</div>
                                    <div className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
                                        {formatNumber(printAnalytics.kpis?.total_printed || 0)}
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
                                    <div className="text-sm text-zinc-500 dark:text-white">Total Batches</div>
                                    <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                                        {formatNumber(printAnalytics.kpis?.total_batches || 0)}
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
                                    <div className="text-sm text-zinc-500 dark:text-white">Avg/Day</div>
                                    <div className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
                                        {printAnalytics.kpis?.avg_per_day || 0}
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
                                    <div className="text-sm text-zinc-500 dark:text-white">Batches Today</div>
                                    <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                                        {printAnalytics.kpis?.batches_today || 0}
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
                                    <div className="text-sm text-zinc-500 dark:text-white">Peak Hour</div>
                                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                                        {printAnalytics.kpis?.peak_hour || '--'}
                                    </div>
                                </div>
                            </div>

                            {/* Daily Chart */}
                            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                <h3 className="font-semibold text-zinc-900 dark:text-white mb-4">Daily Print Volume</h3>
                                <div className="h-48 flex items-end gap-1">
                                    {printAnalytics.daily_data?.slice(-30).map((day, idx) => (
                                        <div
                                            key={day.date}
                                            className="flex-1 bg-indigo-500 dark:bg-indigo-600 rounded-t hover:bg-indigo-600 dark:hover:bg-indigo-500 transition-colors cursor-pointer group relative"
                                            style={{
                                                height: `${Math.max(4, (day.printed / Math.max(...printAnalytics.daily_data.map(d => d.printed), 1)) * 100)}%`
                                            }}
                                            title={`${day.dateLabel}: ${day.printed} orders`}
                                        >
                                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                                                {day.dateLabel}: {day.printed}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Store Distribution */}
                            {printAnalytics.store_distribution?.length > 0 && (
                                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                    <h3 className="font-semibold text-zinc-900 dark:text-white mb-4">Print by Store</h3>
                                    <div className="space-y-2">
                                        {printAnalytics.store_distribution.map(store => {
                                            const total = printAnalytics.store_distribution.reduce((a, b) => a + b.count, 0)
                                            const pct = total > 0 ? (store.count / total * 100) : 0
                                            return (
                                                <div key={store.name} className="flex items-center gap-3">
                                                    <span className="text-sm text-zinc-600 dark:text-white w-32 truncate">{store.name}</span>
                                                    <div className="flex-1 h-2 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-indigo-500"
                                                            style={{ width: `${pct}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-sm font-medium text-zinc-900 dark:text-white w-16 text-right">
                                                        {formatNumber(store.count)}
                                                    </span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Deliverability Report Tab */}
                    {activeTab === 'deliverability' && deliverabilityData && (
                        <div className="space-y-6">
                            {/* Period Comparison Toggle */}
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={showComparison}
                                        onChange={(e) => setShowComparison(e.target.checked)}
                                        className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="text-sm text-zinc-600 dark:text-white">
                                        Exclude ultimele 3 zile (comenzi în tranzit)
                                    </span>
                                </label>

                                {/* Custom Date Range */}
                                <div className="flex items-center gap-2 ml-auto">
                                    <span className="text-sm text-zinc-500 dark:text-white">Interval personalizat:</span>
                                    <input
                                        type="date"
                                        value={customDateFrom}
                                        onChange={(e) => {
                                            setCustomDateFrom(e.target.value)
                                            // Clear predefined period when custom dates are used
                                            if (e.target.value && customDateTo) setDays(null)
                                        }}
                                        className="px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 dark:text-white dark:[color-scheme:dark] border border-zinc-200 dark:border-zinc-700 rounded-lg"
                                    />
                                    <ArrowRight className="w-4 h-4 text-zinc-400" />
                                    <input
                                        type="date"
                                        value={customDateTo}
                                        onChange={(e) => {
                                            setCustomDateTo(e.target.value)
                                            // Clear predefined period when custom dates are used
                                            if (customDateFrom && e.target.value) setDays(null)
                                        }}
                                        className="px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 dark:text-white dark:[color-scheme:dark] border border-zinc-200 dark:border-zinc-700 rounded-lg"
                                    />
                                    {(customDateFrom || customDateTo) && (
                                        <button
                                            onClick={() => {
                                                setCustomDateFrom('')
                                                setCustomDateTo('')
                                                if (!days) setDays(30)
                                            }}
                                            className="px-2 py-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                                        >
                                            Șterge
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Summary Cards */}
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-zinc-400">
                                    <div className="text-sm text-zinc-500 dark:text-zinc-400">Total Comenzi</div>
                                    <div className="text-2xl font-bold text-zinc-900 dark:text-white mt-1 tracking-tight">
                                        {formatNumber(deliverabilityData.totals?.total || 0)}
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-green-500">
                                    <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                        <Truck className="w-4 h-4 text-green-500" /> Livrate
                                    </div>
                                    <div className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1 tracking-tight">
                                        {formatNumber(deliverabilityData.totals?.delivered || 0)}
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-red-500">
                                    <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                        <XCircle className="w-4 h-4 text-red-500" /> Anulate
                                    </div>
                                    <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1 tracking-tight">
                                        {formatNumber(deliverabilityData.totals?.cancelled || 0)}
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-orange-500">
                                    <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                        <RotateCcw className="w-4 h-4 text-orange-500" /> Returnate / Refuzate
                                    </div>
                                    <div className="text-2xl font-bold text-orange-600 dark:text-orange-400 mt-1 tracking-tight">
                                        {formatNumber((deliverabilityData.totals?.returned || 0) + (deliverabilityData.totals?.refused || 0))}
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-blue-500">
                                    <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                        📦 Expediate
                                    </div>
                                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1 tracking-tight">
                                        {formatNumber(deliverabilityData.totals?.shipped || 0)}
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 border-l-4 border-l-indigo-500">
                                    <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                        <TrendingUp className="w-4 h-4 text-indigo-500" /> Livrabilitate
                                    </div>
                                    <div className={`text-2xl font-bold mt-1 tracking-tight ${getRateColor(deliverabilityData.totals?.deliverability_rate || 0)}`}>
                                        {deliverabilityData.totals?.deliverability_rate || 0}%
                                    </div>
                                </div>
                            </div>

                            {/* Per-Store Table */}
                            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 overflow-hidden shadow-sm">
                                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700/50">
                                    <h3 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2 tracking-tight">
                                        <Store className="w-5 h-5 text-indigo-500" />
                                        Livrabilitate per Magazin
                                    </h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                                            <tr>
                                                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Magazin</th>
                                                <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Total</th>
                                                <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Livrate</th>
                                                <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Anulate</th>
                                                <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Ret. / Ref.</th>
                                                <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">În Tranzit</th>
                                                <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Expediate</th>
                                                <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Rată Livrare</th>
                                                <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Rată Expediție</th>
                                                <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Rată Anulare</th>
                                                <th className="text-right px-3 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Livrabilitate</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                                            {deliverabilityData.stores?.map((store) => (
                                                <tr key={store.store_uid} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30">
                                                    <td className="px-4 py-3 text-sm font-medium text-zinc-900 dark:text-white">
                                                        {store.store_name}
                                                    </td>
                                                    <td className="px-3 py-3 text-sm text-right text-zinc-600 dark:text-white">
                                                        {formatNumber(store.total)}
                                                    </td>
                                                    <td className="px-3 py-3 text-sm text-right text-green-600 dark:text-green-400 font-medium">
                                                        {formatNumber(store.delivered)}
                                                    </td>
                                                    <td className="px-3 py-3 text-sm text-right text-red-600 dark:text-red-400">
                                                        {formatNumber(store.cancelled)}
                                                    </td>
                                                    <td className="px-3 py-3 text-sm text-right text-orange-600 dark:text-orange-400">
                                                        {formatNumber((store.returned || 0) + (store.refused || 0))}
                                                    </td>
                                                    <td className="px-3 py-3 text-sm text-right text-blue-600 dark:text-blue-400">
                                                        {formatNumber((store.in_transit || 0) + (store.out_for_delivery || 0))}
                                                    </td>
                                                    <td className="px-3 py-3 text-sm text-right text-indigo-600 dark:text-indigo-400 font-medium">
                                                        {formatNumber(store.shipped || 0)}
                                                    </td>
                                                    <td className="px-3 py-3 text-sm text-right">
                                                        <span className={getRateColor(store.delivery_rate || 0)}>{store.delivery_rate || 0}%</span>
                                                    </td>
                                                    <td className="px-3 py-3 text-sm text-right">
                                                        <span className="text-indigo-600 dark:text-indigo-400">{store.expedition_rate || 0}%</span>
                                                    </td>
                                                    <td className="px-3 py-3 text-sm text-right">
                                                        <span className="text-red-600 dark:text-red-400">{store.cancelled_rate || 0}%</span>
                                                    </td>
                                                    <td className="px-3 py-3 text-sm text-right">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <div className="w-16 h-2 bg-zinc-200 dark:bg-zinc-600 rounded-full overflow-hidden">
                                                                <div
                                                                    className={`h-full ${getRateBgColor(store.deliverability_rate)}`}
                                                                    style={{ width: `${Math.min(store.deliverability_rate, 100)}%` }}
                                                                />
                                                            </div>
                                                            <span className={`font-bold ${getRateColor(store.deliverability_rate)}`}>
                                                                {store.deliverability_rate}%
                                                            </span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Profitability Tab */}
                    {activeTab === 'profitability' && (
                        <div className="space-y-6">
                            {/* ═══ DATE PERIOD FILTER ═══ */}
                            <div className="bg-white dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mr-1">Perioadă:</span>
                                    {[
                                        { key: 'thisMonth', label: 'Luna curentă' },
                                        { key: 'lastMonth', label: 'Luna trecută' },
                                        { key: '30d', label: '30 zile' },
                                        { key: '90d', label: '90 zile' },
                                    ].map(p => (
                                        <button
                                            key={p.key}
                                            onClick={() => { setProfitPeriod(p.key); setProfitDateFrom(''); setProfitDateTo('') }}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${profitPeriod === p.key
                                                ? 'bg-indigo-600 text-white shadow-sm'
                                                : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                                                }`}
                                        >
                                            {p.label}
                                        </button>
                                    ))}

                                    {/* Month quick-select */}
                                    <select
                                        value={/^\d{4}-\d{2}$/.test(profitPeriod) ? profitPeriod : ''}
                                        onChange={(e) => { if (e.target.value) { setProfitPeriod(e.target.value); setProfitDateFrom(''); setProfitDateTo('') } }}
                                        className="px-3 py-1.5 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 border-0 cursor-pointer"
                                    >
                                        <option value="">Lună specifică...</option>
                                        {(() => {
                                            const months = []
                                            const now = new Date()
                                            for (let i = 0; i < 18; i++) {
                                                const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
                                                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                                                const label = d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })
                                                months.push(<option key={key} value={key}>{label}</option>)
                                            }
                                            return months
                                        })()}
                                    </select>

                                    <div className="h-6 w-px bg-zinc-300 dark:bg-zinc-600 mx-1" />

                                    {/* Custom range */}
                                    <button
                                        onClick={() => setProfitPeriod('custom')}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${profitPeriod === 'custom'
                                            ? 'bg-indigo-600 text-white shadow-sm'
                                            : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                                            }`}
                                    >
                                        Perioadă custom
                                    </button>
                                    {profitPeriod === 'custom' && (
                                        <>
                                            <input
                                                type="date"
                                                value={profitDateFrom}
                                                onChange={(e) => setProfitDateFrom(e.target.value)}
                                                className="px-2 py-1.5 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-700/50 text-zinc-700 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600"
                                            />
                                            <span className="text-zinc-400">→</span>
                                            <input
                                                type="date"
                                                value={profitDateTo}
                                                onChange={(e) => setProfitDateTo(e.target.value)}
                                                className="px-2 py-1.5 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-700/50 text-zinc-700 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600"
                                            />
                                        </>
                                    )}

                                    {profitLoading && (
                                        <div className="ml-2 animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
                                    )}
                                </div>
                            </div>


                            {profitabilityData && (
                                <>
                                    {/* ═══ P&L INCOME STATEMENT ═══ */}
                                    {(() => {
                                        const pnl = profitabilityData.pnl
                                        const vatRate = profitabilityData.config?.vat_rate || 0.21
                                        const fm = (val) => formatMoney(val)
                                        const pctColor = (pct) => pct >= 20 ? 'text-green-600 dark:text-green-400' : pct >= 10 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'

                                        const summary = profitabilityData.summary
                                        const cb = summary?.cost_breakdown || {}

                                        const getVal = (pnlObj, fallback) => {
                                            if (pnlObj) return pnlObj
                                            const v = fallback || 0
                                            return { cu_tva: v, fara_tva: vatRate > 0 ? v / (1 + vatRate) : v }
                                        }

                                        // P&L Row component — single value column
                                        const PnlRow = ({ label, value, isHeader, isBold, isTotal, isProfit, isNegative, indent, pct, className: extraClass }) => {
                                            const rowBg = isHeader ? 'bg-zinc-100 dark:bg-zinc-900/60' : isTotal ? 'bg-zinc-50 dark:bg-zinc-800/50' : ''
                                            const textStyle = isHeader ? 'font-bold text-zinc-900 dark:text-white uppercase text-xs tracking-wide' :
                                                isBold ? 'font-bold text-zinc-900 dark:text-white' :
                                                    isTotal ? 'font-semibold text-zinc-800 dark:text-white border-t border-zinc-300 dark:border-zinc-600' :
                                                        'text-zinc-700 dark:text-white'
                                            const valColor = isProfit ? (value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400') :
                                                isNegative ? 'text-red-600 dark:text-red-400' : ''
                                            const pl = indent ? `pl-${indent * 4 + 4}` : 'pl-4'

                                            return (
                                                <tr className={`${rowBg} ${extraClass || ''}`}>
                                                    <td className={`${pl} py-2.5 text-sm ${textStyle}`}>
                                                        {label}
                                                        {pct !== undefined && (
                                                            <span className={`ml-2 text-xs font-normal ${pctColor(pct)}`}>({typeof pct === 'number' ? pct.toFixed(1) : pct}%)</span>
                                                        )}
                                                    </td>
                                                    {isHeader ? (
                                                        <td className="px-4 py-2.5 text-xs font-bold text-right text-zinc-500 dark:text-white uppercase">RON</td>
                                                    ) : (
                                                        <td className={`px-4 py-2.5 text-sm text-right font-medium ${valColor || 'text-zinc-800 dark:text-white'}`}>
                                                            {value !== undefined && value !== null ? `${fm(value)} RON` : ''}
                                                        </td>
                                                    )}
                                                </tr>
                                            )
                                        }

                                        // Collapsible TVA deductions section
                                        const TvaSection = ({ title, items, totalTva }) => {
                                            const sectionKey = `tva-${title}`
                                            const isOpen = expandedPnlSections[sectionKey] === true // default closed
                                            const toggle = () => setExpandedPnlSections(prev => ({ ...prev, [sectionKey]: !isOpen }))
                                            // Filter out items with 0 TVA
                                            const validItems = items.filter(i => i.tva && Math.abs(i.tva) > 0.01)
                                            if (validItems.length === 0 && (!totalTva || Math.abs(totalTva) < 0.01)) return null
                                            return (
                                                <>
                                                    <tr className="cursor-pointer select-none hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-colors" onClick={toggle}>
                                                        <td className="pl-8 py-2 text-xs text-amber-700 dark:text-amber-400 font-medium">
                                                            <span className="inline-flex items-center gap-1">
                                                                <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                                                                📋 TVA Deduceri
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2 text-xs text-right text-amber-600 dark:text-amber-400 font-medium">
                                                            {!isOpen && totalTva ? `${fm(-Math.abs(totalTva))} RON` : ''}
                                                        </td>
                                                    </tr>
                                                    {isOpen && validItems.map((item, idx) => (
                                                        <tr key={idx} className="text-amber-600/80 dark:text-amber-500/80">
                                                            <td className="pl-12 py-1.5 text-xs">{item.label}</td>
                                                            <td className="px-4 py-1.5 text-xs text-right">{fm(-Math.abs(item.tva))} RON</td>
                                                        </tr>
                                                    ))}
                                                </>
                                            )
                                        }

                                        // Renders a P&L table for a given store or total
                                        const renderStorePnl = (sp, title, isTotal, extraContent) => {
                                            const inc = sp.income || {}
                                            const cg = sp.cogs || {}
                                            const op = sp.operational || {}
                                            const mkt = sp.marketing || {}
                                            const fc = sp.fixed_costs || {}
                                            const np = sp.net_profit || { cu_tva: 0, fara_tva: 0 }
                                            const npPct = sp.net_margin_pct ?? 0
                                            const statusBreakdown = sp.status_breakdown || {}
                                            const bizBySection = sp.business_costs_by_section || pnl?.business_costs_by_section || {}

                                            // Revenue calculations
                                            const grossSales = inc.gross_sales || { cu_tva: 0, fara_tva: 0 }
                                            const returnsCancelled = inc.returns_cancelled || { cu_tva: 0, fara_tva: 0 }
                                            const returnsCount = inc.returns_cancelled_count || 0
                                            const salesDelivered = inc.sales_delivered || { cu_tva: 0, fara_tva: 0 }
                                            const deliveredCount = inc.delivered_count || 0

                                            // Net revenue (Vânzări = only delivered)
                                            const netRevenue = salesDelivered
                                            // TVA amount
                                            const tvaAmount = (netRevenue.cu_tva || 0) - (netRevenue.fara_tva || 0)
                                            const vatPctDisplay = Math.round(vatRate * 100)

                                            // Intermediate profit metrics from backend
                                            const grossProfit = sp.gross_profit || { cu_tva: 0, fara_tva: 0 }
                                            const grossMarginPct = sp.gross_margin_pct ?? 0
                                            const operatingProfit = sp.operating_profit || { cu_tva: 0, fara_tva: 0 }
                                            const operatingMarginPct = sp.operating_margin_pct ?? 0

                                            // Cost values (cu_tva for display, fara_tva for totals)
                                            const cogsVal = cg.total_cogs?.cu_tva || 0
                                            const cogsFara = cg.total_cogs?.fara_tva || 0
                                            const cogsTva = cogsVal - cogsFara
                                            const transportVal = op.shipping?.cu_tva || 0
                                            const transportFara = op.shipping?.fara_tva || 0
                                            const transportTva = transportVal - transportFara
                                            const comisionVal = op.gt_commission?.cu_tva || 0
                                            const comisionFara = op.gt_commission?.fara_tva || 0
                                            const comisionTva = comisionVal - comisionFara
                                            const paymentVal = op.payment_fee?.cu_tva || 0
                                            const paymentFara = op.payment_fee?.fara_tva || 0
                                            const paymentTva = paymentVal - paymentFara
                                            const frisboVal = op.frisbo_fee?.cu_tva || 0
                                            const frisboFara = op.frisbo_fee?.fara_tva || 0
                                            const frisboTva = frisboVal - frisboFara
                                            const warehouseVal = op.warehouse_salary?.cu_tva || 0
                                            const warehouseFara = op.warehouse_salary?.fara_tva || 0
                                            const warehouseTva = warehouseVal - warehouseFara

                                            // Operational total (without packaging)
                                            const opTotalCu = transportVal + comisionVal + paymentVal + frisboVal + warehouseVal
                                            const opTotalFara = transportFara + comisionFara + paymentFara + frisboFara + warehouseFara
                                            const opTotalTva = opTotalCu - opTotalFara

                                            // Marketing — FB/TikTok have TVA, Google does NOT
                                            const fbVal = mkt.facebook?.cu_tva || 0
                                            const fbFara = mkt.facebook?.fara_tva || 0
                                            const fbTva = fbVal - fbFara
                                            const ttVal = mkt.tiktok?.cu_tva || 0
                                            const ttFara = mkt.tiktok?.fara_tva || 0
                                            const ttTva = ttVal - ttFara
                                            const gadsVal = mkt.google?.cu_tva || 0 // Google = no TVA, cu_tva == fara_tva
                                            const mktTotalCu = fbVal + ttVal + gadsVal
                                            const mktTotalFara = fbFara + ttFara + gadsVal // Google: fara = cu (no TVA)
                                            const mktTotalTva = fbTva + ttTva // only FB + TikTok

                                            // Fixed costs
                                            const fcTotalCu = fc.total?.cu_tva || 0
                                            const fcTotalFara = fc.total?.fara_tva || 0
                                            const fcTotalTva = fcTotalCu - fcTotalFara

                                            // Grand totals
                                            const totalCostsFara = cogsFara + opTotalFara + mktTotalFara + fcTotalFara
                                            const totalCostsCu = cogsVal + opTotalCu + mktTotalCu + fcTotalCu

                                            // Ref revenue for % calculations
                                            const refRev = netRevenue.fara_tva || 1

                                            // Status labels
                                            const statusLabels = {
                                                'in_transit': '📦 În curs de livrare',
                                                'returned': '↩️ Returnate',
                                                'cancelled': '❌ Anulate',
                                                'other': '❓ Altele',
                                            }

                                            // Collapsible section component (single-value)
                                            const PnlSection = ({ id, icon, label, totalValue, totalPct, children, isNeg }) => {
                                                const sectionKey = `${title}-${id}`
                                                const isOpen = expandedPnlSections[sectionKey] !== false // default open
                                                const toggle = () => setExpandedPnlSections(prev => ({ ...prev, [sectionKey]: !isOpen }))
                                                return (
                                                    <>
                                                        <tr className="bg-zinc-100 dark:bg-zinc-900/60 cursor-pointer select-none hover:bg-zinc-200 dark:hover:bg-zinc-800/80 transition-colors" onClick={toggle}>
                                                            <td className="pl-4 py-2.5 text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-wide">
                                                                <span className="inline-flex items-center gap-1.5">
                                                                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                                                                    {icon} {label}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-2.5 text-xs font-bold text-right text-zinc-500 dark:text-white uppercase">
                                                                {!isOpen && totalValue !== undefined ? (
                                                                    <span className={isNeg ? 'text-red-500 dark:text-red-400' : ''}>
                                                                        {fm(totalValue)} RON
                                                                        {totalPct !== undefined && <span className={`ml-1 ${pctColor(totalPct)}`}>({totalPct.toFixed(1)}%)</span>}
                                                                    </span>
                                                                ) : 'RON'}
                                                            </td>
                                                        </tr>
                                                        {isOpen && children}
                                                    </>
                                                )
                                            }

                                            return (
                                                <div key={title} className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                                    <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                                                        <h3 className="font-bold text-lg text-zinc-900 dark:text-white flex items-center gap-2">
                                                            {isTotal ? '📊' : <Store className="w-5 h-5" />} {title}
                                                        </h3>
                                                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                                            {deliveredCount} livrate | {returnsCount} retur/anulate
                                                        </div>
                                                    </div>
                                                    <div className="overflow-x-auto">
                                                        <table className="w-full border-collapse">
                                                            <tbody>
                                                                {/* ═══ VENITURI ═══ */}
                                                                <PnlSection id="income" icon="📈" label="VENITURI"
                                                                    totalValue={netRevenue.fara_tva}>

                                                                    <PnlRow label="Vânzări Brute (Gross Sales)" value={grossSales.cu_tva} indent={1} />

                                                                    {returnsCancelled.cu_tva > 0 && (
                                                                        <PnlRow label={`(-) Returnate/Anulate (${returnsCount})`}
                                                                            value={-returnsCancelled.cu_tva} indent={1} isNegative />
                                                                    )}

                                                                    {/* Show unrealized revenue (in_transit + other) to close the gap */}
                                                                    {(() => {
                                                                        const inTransitRev = statusBreakdown?.in_transit?.revenue?.cu_tva || 0;
                                                                        const otherRev = statusBreakdown?.other?.revenue?.cu_tva || 0;
                                                                        const unrealizedRev = inTransitRev + otherRev;
                                                                        const unrealizedCount = (statusBreakdown?.in_transit?.count || 0) + (statusBreakdown?.other?.count || 0);
                                                                        if (unrealizedRev > 0) return (
                                                                            <PnlRow label={`(-) Nerealizate/În tranzit (${unrealizedCount})`}
                                                                                value={-unrealizedRev} indent={1} isNegative />
                                                                        );
                                                                        return null;
                                                                    })()}

                                                                    <PnlRow label={`Vânzări Revenue (${deliveredCount} livrate)`}
                                                                        value={netRevenue.cu_tva} isTotal />

                                                                    <PnlRow label={`(-) TVA (${vatPctDisplay}%)`}
                                                                        value={-tvaAmount} indent={1} isNegative />

                                                                    <PnlRow label="Revenue net (fără TVA)"
                                                                        value={netRevenue.fara_tva} isBold />
                                                                </PnlSection>

                                                                <tr><td colSpan={2} className="py-1.5"></td></tr>

                                                                {/* ═══ COGS ═══ */}
                                                                <PnlSection id="cogs" icon="📦" label="COGS (Cost Produse)"
                                                                    totalValue={cogsFara}
                                                                    totalPct={refRev ? parseFloat(((cogsFara / refRev) * 100).toFixed(1)) : undefined} isNeg>

                                                                    <PnlRow label="(-) Cost produse vândute" value={cogsVal} indent={1} isNegative
                                                                        pct={refRev ? parseFloat(((cogsFara / refRev) * 100).toFixed(1)) : undefined} />

                                                                    <TvaSection title={`${title}-cogs`} totalTva={cogsTva}
                                                                        items={[{ label: 'TVA Produse', tva: cogsTva }]} />

                                                                    <PnlRow label="Total COGS (fără TVA)" value={cogsFara} isTotal isNegative />
                                                                </PnlSection>

                                                                <tr><td colSpan={2} className="py-1.5"></td></tr>

                                                                {/* ═══ GROSS PROFIT ═══ */}
                                                                <tr className="bg-emerald-50 dark:bg-emerald-900/20">
                                                                    <td className="pl-4 py-2.5 text-sm font-bold text-emerald-800 dark:text-emerald-300">
                                                                        💰 PROFIT BRUT
                                                                        <span className={`ml-2 text-xs font-normal ${pctColor(grossMarginPct)}`}>({grossMarginPct.toFixed(1)}%)</span>
                                                                    </td>
                                                                    <td className={`px-4 py-2.5 text-sm text-right font-bold ${grossProfit.fara_tva >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                                                        {fm(grossProfit.fara_tva)} RON
                                                                    </td>
                                                                </tr>

                                                                <tr><td colSpan={2} className="py-1.5"></td></tr>

                                                                {/* ═══ OPERATIONAL COSTS ═══ */}
                                                                <PnlSection id="operational" icon="🏢" label="COSTURI OPERAȚIONALE"
                                                                    totalValue={opTotalFara}
                                                                    totalPct={refRev ? parseFloat(((opTotalFara / refRev) * 100).toFixed(1)) : undefined} isNeg>

                                                                    {transportVal > 0 && (
                                                                        <PnlRow label="(-) Transport" value={transportVal} indent={1} isNegative
                                                                            pct={refRev ? parseFloat(((transportFara / refRev) * 100).toFixed(1)) : undefined} />
                                                                    )}
                                                                    {comisionVal > 0 && (
                                                                        <PnlRow label={`(-) Comision agenție (${profitabilityData.config?.gt_commission_pct || 0}%)`}
                                                                            value={comisionVal} indent={1} isNegative
                                                                            pct={refRev ? parseFloat(((comisionFara / refRev) * 100).toFixed(1)) : undefined} />
                                                                    )}
                                                                    {paymentVal > 0 && (
                                                                        <PnlRow label="(-) Procesare plată" value={paymentVal} indent={1} isNegative />
                                                                    )}
                                                                    {frisboVal > 0 && (
                                                                        <PnlRow label="(-) Fulfillment (Frisbo)" value={frisboVal} indent={1} isNegative />
                                                                    )}
                                                                    {warehouseVal > 0 && (
                                                                        <PnlRow label="(-) Salariu depozit" value={warehouseVal} indent={1} isNegative />
                                                                    )}

                                                                    <TvaSection title={`${title}-operational`} totalTva={opTotalTva}
                                                                        items={[
                                                                            { label: 'TVA Transport', tva: transportTva },
                                                                            { label: 'TVA Comision', tva: comisionTva },
                                                                            { label: 'TVA Procesare plată', tva: paymentTva },
                                                                            { label: 'TVA Fulfillment', tva: frisboTva },
                                                                            { label: 'TVA Salariu depozit', tva: warehouseTva },
                                                                        ]} />

                                                                    <PnlRow label="Total Operațional (fără TVA)" value={opTotalFara} isTotal isNegative
                                                                        pct={refRev ? parseFloat(((opTotalFara / refRev) * 100).toFixed(1)) : undefined} />
                                                                </PnlSection>

                                                                <tr><td colSpan={2} className="py-1.5"></td></tr>

                                                                {/* ═══ OPERATING PROFIT ═══ */}
                                                                <tr className="bg-blue-50 dark:bg-blue-900/20">
                                                                    <td className="pl-4 py-2.5 text-sm font-bold text-blue-800 dark:text-blue-300">
                                                                        📈 PROFIT OPERAȚIONAL
                                                                        <span className={`ml-2 text-xs font-normal ${pctColor(operatingMarginPct)}`}>({operatingMarginPct.toFixed(1)}%)</span>
                                                                    </td>
                                                                    <td className={`px-4 py-2.5 text-sm text-right font-bold ${operatingProfit.fara_tva >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
                                                                        {fm(operatingProfit.fara_tva)} RON
                                                                    </td>
                                                                </tr>

                                                                <tr><td colSpan={2} className="py-1.5"></td></tr>

                                                                {/* ═══ MARKETING ═══ */}
                                                                {mktTotalCu > 0 && (
                                                                    <>
                                                                        <PnlSection id="marketing" icon="📣" label="COSTURI MARKETING"
                                                                            totalValue={mktTotalFara}
                                                                            totalPct={refRev ? parseFloat(((mktTotalFara / refRev) * 100).toFixed(1)) : undefined} isNeg>

                                                                            {fbVal > 0 && (
                                                                                <PnlRow label="(-) Facebook Ads" value={fbVal} indent={1} isNegative
                                                                                    pct={refRev ? parseFloat(((fbFara / refRev) * 100).toFixed(1)) : undefined} />
                                                                            )}
                                                                            {ttVal > 0 && (
                                                                                <PnlRow label="(-) TikTok Ads" value={ttVal} indent={1} isNegative
                                                                                    pct={refRev ? parseFloat(((ttFara / refRev) * 100).toFixed(1)) : undefined} />
                                                                            )}
                                                                            {gadsVal > 0 && (
                                                                                <PnlRow label="(-) Google Ads" value={gadsVal} indent={1} isNegative
                                                                                    pct={refRev ? parseFloat(((gadsVal / refRev) * 100).toFixed(1)) : undefined} />
                                                                            )}

                                                                            <PnlRow label="Total Marketing" value={mktTotalFara} isTotal isNegative
                                                                                pct={refRev ? parseFloat(((mktTotalFara / refRev) * 100).toFixed(1)) : undefined} />
                                                                        </PnlSection>
                                                                        <tr><td colSpan={2} className="py-1.5"></td></tr>
                                                                    </>
                                                                )}

                                                                {/* ═══ FIXED COSTS ═══ */}
                                                                {(() => {
                                                                    const fixedEntries = bizBySection.fixed || []
                                                                    const hasFixed = fixedEntries.length > 0 || (fc.total && (fc.total.cu_tva > 0 || fc.total.fara_tva > 0))
                                                                    if (!hasFixed) return null
                                                                    return (
                                                                        <>
                                                                            <PnlSection id="fixed" icon="💼" label={`COSTURI FIXE (${pnl?.fixed_costs_month || ''})`}
                                                                                totalValue={fcTotalFara}
                                                                                totalPct={refRev ? parseFloat(((fcTotalFara / refRev) * 100).toFixed(1)) : undefined} isNeg>

                                                                                {fixedEntries.length > 0 ? (
                                                                                    fixedEntries.map(entry => (
                                                                                        <PnlRow key={`fc-${entry.id}`}
                                                                                            label={`(-) ${entry.label}`}
                                                                                            value={entry.cu_tva}
                                                                                            indent={1} isNegative
                                                                                            pct={refRev ? parseFloat(((entry.fara_tva / refRev) * 100).toFixed(1)) : undefined} />
                                                                                    ))
                                                                                ) : (
                                                                                    [{ key: 'salary', label: '👤 Salarii' }, { key: 'utility', label: '⚡ Utilități' },
                                                                                    { key: 'subscription', label: '📋 Subscripții' }, { key: 'marketing', label: '📣 Marketing (biz)' },
                                                                                    { key: 'rent', label: '🏠 Chirie' }, { key: 'other', label: '📦 Altele' }].map(cat => {
                                                                                        const val = fc[cat.key]
                                                                                        if (!val || (val.cu_tva === 0 && val.fara_tva === 0)) return null
                                                                                        return <PnlRow key={cat.key} label={`(-) ${cat.label}`} value={val.cu_tva} indent={1} isNegative
                                                                                            pct={refRev ? parseFloat(((val.fara_tva / refRev) * 100).toFixed(1)) : undefined} />
                                                                                    })
                                                                                )}

                                                                                {fcTotalTva > 0.01 && (
                                                                                    <TvaSection title={`${title}-fixed`} totalTva={fcTotalTva}
                                                                                        items={fixedEntries.length > 0
                                                                                            ? fixedEntries.map(e => ({ label: `TVA ${e.label}`, tva: (e.cu_tva || 0) - (e.fara_tva || 0) }))
                                                                                            : [{ label: 'TVA Costuri Fixe', tva: fcTotalTva }]
                                                                                        } />
                                                                                )}

                                                                                <PnlRow label="Total Costuri Fixe (fără TVA)" value={fcTotalFara} isTotal isNegative
                                                                                    pct={refRev ? parseFloat(((fcTotalFara / refRev) * 100).toFixed(1)) : undefined} />
                                                                            </PnlSection>
                                                                            <tr><td colSpan={2} className="py-1.5"></td></tr>
                                                                        </>
                                                                    )
                                                                })()}

                                                                {/* ═══ TOTAL COSTS ═══ */}
                                                                <PnlRow label="📋 Total costuri (fără TVA)" value={totalCostsFara} isTotal isNegative
                                                                    pct={refRev ? parseFloat(((totalCostsFara / refRev) * 100).toFixed(1)) : undefined} />

                                                                <tr><td colSpan={2} className="py-1.5"></td></tr>

                                                                {/* ═══ NET PROFIT ═══ */}
                                                                <tr className="bg-zinc-900 dark:bg-zinc-950">
                                                                    <td className="pl-4 py-3 text-sm font-bold text-white">
                                                                        💵 PROFIT NET
                                                                        <span className={`ml-2 text-xs font-normal ${pctColor(npPct)}`}>({typeof npPct === 'number' ? npPct.toFixed(1) : npPct}%)</span>
                                                                    </td>
                                                                    <td className={`px-4 py-3 text-sm text-right font-bold ${np.fara_tva >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                                        {fm(np.fara_tva)} RON
                                                                    </td>
                                                                </tr>

                                                                {/* % Profit */}
                                                                <tr className="bg-zinc-800 dark:bg-zinc-900">
                                                                    <td className="pl-4 py-2 text-xs text-zinc-400">% Profit (din revenue fără TVA)</td>
                                                                    <td className={`px-4 py-2 text-xs text-right font-semibold ${pctColor(npPct)}`}>
                                                                        {typeof npPct === 'number' ? npPct.toFixed(2) : npPct}%
                                                                    </td>
                                                                </tr>

                                                                {extraContent}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            )
                                        }

                                        // Returns data for total P&L extra content
                                        const returns = {
                                            count: pnl?.returns?.count || summary?.returned_orders || 0,
                                            loss: getVal(pnl?.returns?.loss, summary?.return_loss),
                                        }

                                        // Extra content for total P&L: just returns info
                                        const totalExtraContent = returns.count > 0 ? (
                                            <>
                                                <tr><td colSpan={2} className="py-1"></td></tr>
                                                <PnlRow label="📦 RETURURI" isHeader />
                                                <PnlRow label={`Retururi (${returns.count} comenzi)`} value={returns.loss.fara_tva} indent={1} isNegative />
                                            </>
                                        ) : null

                                        const storePnls = profitabilityData.pnl_by_store || []

                                        return (
                                            <div className="space-y-6">
                                                {/* Individual store P&L tables */}
                                                {storePnls.map(sp => renderStorePnl(sp, `P&L — ${sp.store_name}`, false, null))}

                                                {/* Aggregate total P&L (with marketing, net profit, returns) */}
                                                {renderStorePnl(
                                                    { ...pnl, income: { ...pnl?.income, sales_delivered: pnl?.income?.total_realized, delivered_count: pnl?.income?.delivered_count } },
                                                    storePnls.length > 1 ? '📊 TOTAL — Toate Magazinele' : '📊 Raport P&L Total',
                                                    true,
                                                    totalExtraContent
                                                )}
                                            </div>
                                        )

                                    })()}
                                </>
                            )}


                            {/* Order Profitability Table */}
                            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                                    <h3 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                                        <Package className="w-5 h-5 text-green-600" />
                                        Order Profitability Details
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <select
                                            value={orderProfitStatus}
                                            onChange={(e) => {
                                                setOrderProfitStatus(e.target.value)
                                                setOrderProfitPage(0)
                                            }}
                                            className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white"
                                        >
                                            <option value="">All Statuses</option>
                                            <option value="delivered">Delivered</option>
                                            <option value="in_transit">In Transit</option>
                                            <option value="returned">Returned</option>
                                            <option value="cancelled">Cancelled</option>
                                        </select>
                                        <button
                                            onClick={async () => {
                                                setOrderProfitLoading(true)
                                                try {
                                                    const API_URL = import.meta.env.VITE_API_URL || '/api'
                                                    const params = new URLSearchParams()
                                                    if (selectedStores.length > 0) params.set('store_uids', selectedStores.join(','))
                                                    if (days) params.set('days', days.toString())
                                                    if (orderProfitStatus) params.set('status', orderProfitStatus)
                                                    params.set('skip', (orderProfitPage * 25).toString())
                                                    params.set('limit', '25')
                                                    const res = await fetch(`${API_URL}/analytics/profitability/orders?${params}`)
                                                    const data = await res.json()
                                                    setOrderProfitData(data)
                                                } catch (err) {
                                                    console.error('Failed to fetch order profitability:', err)
                                                } finally {
                                                    setOrderProfitLoading(false)
                                                }
                                            }}
                                            disabled={orderProfitLoading}
                                            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"
                                        >
                                            {orderProfitLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                                            Load Orders
                                        </button>
                                    </div>
                                </div>

                                {orderProfitData?.orders?.length > 0 ? (
                                    <>
                                        <div className="overflow-x-auto">
                                            <table className="w-full">
                                                <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                                                    <tr>
                                                        <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Order</th>
                                                        <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Date</th>
                                                        <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Status</th>
                                                        <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Revenue</th>
                                                        <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Total Costs</th>
                                                        <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Gross Profit</th>
                                                        <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Net Profit</th>
                                                        <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 dark:text-white uppercase">Margin</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                                                    {orderProfitData.orders.map(order => (
                                                        <>
                                                            <tr
                                                                key={order.uid}
                                                                onClick={() => setExpandedOrderUid(expandedOrderUid === order.uid ? null : order.uid)}
                                                                className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 cursor-pointer"
                                                            >
                                                                <td className="px-4 py-3 text-sm">
                                                                    <div className="font-medium text-zinc-900 dark:text-white">#{order.order_number}</div>
                                                                    <div className="text-xs text-zinc-500 dark:text-white">{order.customer_name}</div>
                                                                    {order.has_missing_costs && (
                                                                        <span className="inline-flex items-center gap-1 text-xs text-amber-600" title="Some SKUs missing costs">
                                                                            <AlertTriangle className="w-3 h-3" />
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-3 text-sm text-zinc-600 dark:text-white">
                                                                    {order.created_at ? new Date(order.created_at).toLocaleDateString() : '-'}
                                                                </td>
                                                                <td className="px-4 py-3 text-sm">
                                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${order.status === 'delivered' ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' :
                                                                        order.status === 'in_transit' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' :
                                                                            order.status === 'back_to_sender' || order.status === 'returned' ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400' :
                                                                                order.status === 'cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400' :
                                                                                    'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-white'
                                                                        }`}>
                                                                        {order.status}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3 text-sm text-right text-zinc-900 dark:text-white font-medium">
                                                                    {formatMoney(order.total_price || order.revenue)} RON
                                                                </td>
                                                                <td className="px-4 py-3 text-sm text-right text-red-600 dark:text-red-400">
                                                                    {formatMoney(order.total_costs)} RON
                                                                </td>
                                                                <td className={`px-4 py-3 text-sm text-right font-bold ${(order.profit_gross || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                                    {formatMoney(order.profit_gross)} RON
                                                                </td>
                                                                <td className={`px-4 py-3 text-sm text-right ${(order.profit_net || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                                    {formatMoney(order.profit_net)} RON
                                                                </td>
                                                                <td className="px-4 py-3 text-sm text-right">
                                                                    <span className={order.margin_pct >= 20 ? 'text-green-600 dark:text-green-400' : order.margin_pct >= 10 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}>
                                                                        {order.margin_pct}%
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                            {expandedOrderUid === order.uid && (
                                                                <tr key={`${order.uid}-details`} className="bg-zinc-50 dark:bg-zinc-900/50">
                                                                    <td colSpan={8} className="px-4 py-3">
                                                                        {/* Currency conversion notice */}
                                                                        {order.original_currency && order.original_currency !== 'RON' && (
                                                                            <div className="mb-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-sm">
                                                                                <span className="font-medium text-amber-800 dark:text-amber-300">💱 Currency conversion:</span>
                                                                                <span className="text-amber-700 dark:text-amber-400 ml-1">
                                                                                    Original order in {order.original_currency} ({formatMoney(order.original_total_price)} {order.original_currency})
                                                                                    → converted at {order.exchange_rate} {order.original_currency}/RON
                                                                                </span>
                                                                            </div>
                                                                        )}

                                                                        {/* Revenue Breakdown */}
                                                                        <div className="mb-4 p-3 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                                                            <div className="text-xs font-medium text-zinc-500 dark:text-white uppercase mb-2">Revenue Breakdown (RON)</div>
                                                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                                                                <div>
                                                                                    <div className="text-zinc-500 dark:text-white">Subtotal (products)</div>
                                                                                    <div className="font-medium text-zinc-900 dark:text-white">{formatMoney(order.subtotal_price)} RON</div>
                                                                                    {order.original_currency && order.original_currency !== 'RON' && order.original_subtotal_price && (
                                                                                        <div className="text-xs text-zinc-400">{formatMoney(order.original_subtotal_price)} {order.original_currency}</div>
                                                                                    )}
                                                                                </div>
                                                                                <div>
                                                                                    <div className="text-zinc-500 dark:text-white">Discounts</div>
                                                                                    <div className="font-medium text-green-600 dark:text-green-400">{order.total_discounts > 0 ? '-' : ''}{formatMoney(order.total_discounts)} RON</div>
                                                                                </div>
                                                                                <div>
                                                                                    <div className="text-zinc-500 dark:text-white">Shipping (customer paid)</div>
                                                                                    <div className="font-medium text-orange-600 dark:text-orange-400">{formatMoney(order.shipping_cost)} RON</div>
                                                                                </div>
                                                                                <div>
                                                                                    <div className="text-zinc-500 dark:text-white">Total Price</div>
                                                                                    <div className="font-bold text-zinc-900 dark:text-white">{formatMoney(order.total_price)} RON</div>
                                                                                    {order.original_currency && order.original_currency !== 'RON' && order.original_total_price && (
                                                                                        <div className="text-xs text-zinc-400">{formatMoney(order.original_total_price)} {order.original_currency}</div>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        {/* Cost Breakdown */}
                                                                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/30">
                                                                            <div className="text-xs font-medium text-red-500 dark:text-red-400 uppercase mb-2">Cost Breakdown (all in RON)</div>
                                                                            <div className="space-y-2 text-sm">
                                                                                <div className="flex justify-between items-start">
                                                                                    <div>
                                                                                        <div className="text-zinc-700 dark:text-white">📦 SKU Costs</div>
                                                                                        <div className="text-[11px] text-zinc-400">Sum of (cost_per_unit × qty) for each product</div>
                                                                                    </div>
                                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.sku_costs)} RON</div>
                                                                                </div>
                                                                                <div className="flex justify-between items-start">
                                                                                    <div>
                                                                                        <div className="text-zinc-700 dark:text-white">📋 Packaging</div>
                                                                                        <div className="text-[11px] text-zinc-400">Fixed {formatMoney(profitabilityData?.config?.packaging_cost_per_order)} RON/order</div>
                                                                                    </div>
                                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.packaging_cost)} RON</div>
                                                                                </div>

                                                                                <div className="flex justify-between items-start">
                                                                                    <div>
                                                                                        <div className="text-zinc-700 dark:text-white">👤 GT Commission</div>
                                                                                        <div className="text-[11px] text-zinc-400">{profitabilityData?.config?.gt_commission_pct}% × {formatMoney(order.total_price)} (GT store only)</div>
                                                                                    </div>
                                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.gt_commission)} RON</div>
                                                                                </div>
                                                                                <div className="flex justify-between items-start">
                                                                                    <div>
                                                                                        <div className="text-zinc-700 dark:text-white">💳 Payment Processing</div>
                                                                                        <div className="text-[11px] text-zinc-400">{profitabilityData?.config?.payment_processing_pct}% × {formatMoney(order.total_price)} + {formatMoney(profitabilityData?.config?.payment_processing_fixed)} fixed</div>
                                                                                    </div>
                                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.payment_fee)} RON</div>
                                                                                </div>
                                                                                <div className="flex justify-between items-start">
                                                                                    <div>
                                                                                        <div className="text-zinc-700 dark:text-white">🏭 Frisbo Fee</div>
                                                                                        <div className="text-[11px] text-zinc-400">Fixed {formatMoney(profitabilityData?.config?.frisbo_fee_per_order)} RON/order</div>
                                                                                    </div>
                                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.frisbo_fee)} RON</div>
                                                                                </div>
                                                                                <div className="flex justify-between items-start">
                                                                                    <div>
                                                                                        <div className="text-zinc-700 dark:text-white">🚚 Shipping Cost</div>
                                                                                        <div className="text-[11px] text-zinc-400">Total Price − Subtotal (courier delivery cost)</div>
                                                                                    </div>
                                                                                    <div className="font-medium text-red-600 dark:text-red-400">{formatMoney(order.shipping_cost)} RON</div>
                                                                                </div>
                                                                                <div className="flex justify-between items-start pt-2 border-t border-red-200 dark:border-red-800">
                                                                                    <div className="font-bold text-zinc-900 dark:text-white">Total Costs</div>
                                                                                    <div className="font-bold text-red-700 dark:text-red-400">{formatMoney(order.total_costs)} RON</div>
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        {/* Profit Summary */}
                                                                        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-100 dark:border-green-900/30">
                                                                            <div className="text-xs font-medium text-green-500 dark:text-green-400 uppercase mb-2">Profit Summary</div>
                                                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                                                                <div>
                                                                                    <div className="text-zinc-500 dark:text-white">Gross Profit</div>
                                                                                    <div className={`font-bold ${(order.profit_gross || 0) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{formatMoney(order.profit_gross)} {order.currency || 'RON'}</div>
                                                                                </div>
                                                                                <div>
                                                                                    <div className="text-zinc-500 dark:text-white">Net Profit (after VAT)</div>
                                                                                    <div className={`font-bold ${(order.profit_net || 0) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{formatMoney(order.profit_net)} {order.currency || 'RON'}</div>
                                                                                </div>
                                                                                <div>
                                                                                    <div className="text-zinc-500 dark:text-white">Margin</div>
                                                                                    <div className={`font-bold ${order.margin_pct >= 20 ? 'text-green-700 dark:text-green-400' : order.margin_pct >= 10 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-700 dark:text-red-400'}`}>{order.margin_pct}%</div>
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        {/* Line Items */}
                                                                        {order.line_items?.length > 0 && (
                                                                            <div className="mt-3">
                                                                                <div className="text-xs font-medium text-zinc-500 dark:text-white uppercase mb-2">Line Items</div>
                                                                                <table className="w-full text-sm">
                                                                                    <thead>
                                                                                        <tr className="text-xs text-zinc-500 dark:text-white">
                                                                                            <th className="text-left py-1">SKU</th>
                                                                                            <th className="text-left py-1">Title</th>
                                                                                            <th className="text-right py-1">Qty</th>
                                                                                            <th className="text-right py-1">Price/Unit</th>
                                                                                            <th className="text-right py-1">Cost/Unit</th>
                                                                                            <th className="text-right py-1">Total Price</th>
                                                                                            <th className="text-right py-1">Total Cost</th>
                                                                                        </tr>
                                                                                    </thead>
                                                                                    <tbody>
                                                                                        {order.line_items.map((item, idx) => (
                                                                                            <tr key={idx} className="border-t border-zinc-200 dark:border-zinc-700">
                                                                                                <td className="py-2 font-mono text-zinc-700 dark:text-white">{item.sku}</td>
                                                                                                <td className="py-2 text-zinc-600 dark:text-white truncate max-w-[150px]">{item.title}</td>
                                                                                                <td className="py-2 text-right text-zinc-900 dark:text-white">{item.quantity}</td>
                                                                                                <td className="py-2 text-right text-zinc-900 dark:text-white">{item.price_per_unit?.toFixed(2) ?? '-'}</td>
                                                                                                <td className="py-2 text-right text-zinc-900 dark:text-white">
                                                                                                    {item.cost_per_unit != null ? (
                                                                                                        <span>{item.cost_per_unit.toFixed(2)}</span>
                                                                                                    ) : (
                                                                                                        <span className="text-amber-600 flex items-center justify-end gap-1">
                                                                                                            <AlertTriangle className="w-3 h-3" /> Missing
                                                                                                        </span>
                                                                                                    )}
                                                                                                </td>
                                                                                                <td className="py-2 text-right text-zinc-900 dark:text-white">{item.price_total?.toFixed(2) ?? '-'}</td>
                                                                                                <td className="py-2 text-right text-red-600 dark:text-red-400">{item.cost_total?.toFixed(2) ?? '-'}</td>
                                                                                            </tr>
                                                                                        ))}
                                                                                    </tbody>
                                                                                </table>
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Pagination */}
                                        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between text-sm text-zinc-600 dark:text-white">
                                            <div>
                                                Showing {orderProfitData.skip + 1}-{Math.min(orderProfitData.skip + orderProfitData.orders.length, orderProfitData.total)} of {orderProfitData.total}
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setOrderProfitPage(Math.max(0, orderProfitPage - 1))}
                                                    disabled={orderProfitPage === 0}
                                                    className="px-3 py-1 bg-zinc-100 dark:bg-zinc-700 rounded disabled:opacity-50"
                                                >
                                                    Prev
                                                </button>
                                                <button
                                                    onClick={() => setOrderProfitPage(orderProfitPage + 1)}
                                                    disabled={(orderProfitPage + 1) * 25 >= orderProfitData.total}
                                                    className="px-3 py-1 bg-zinc-100 dark:bg-zinc-700 rounded disabled:opacity-50"
                                                >
                                                    Next
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                ) : orderProfitLoading ? (
                                    <div className="p-8 text-center text-zinc-500">
                                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                                        Loading orders...
                                    </div>
                                ) : (
                                    <div className="p-8 text-center text-zinc-500">
                                        Click "Load Orders" to view individual order profitability
                                    </div>
                                )}
                            </div>
                        </div >
                    )
                    }

                    {/* P&L Comparison Tab */}
                    {activeTab === 'pnlCompare' && (
                        <div className="space-y-6">
                            {/* ═══ DATE PERIOD FILTER (shared with Profitabilitate) ═══ */}
                            <div className="bg-white dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mr-1">Perioadă:</span>
                                    {[
                                        { key: 'thisMonth', label: 'Luna curentă' },
                                        { key: 'lastMonth', label: 'Luna trecută' },
                                        { key: '30d', label: '30 zile' },
                                        { key: '90d', label: '90 zile' },
                                    ].map(p => (
                                        <button
                                            key={p.key}
                                            onClick={() => { setProfitPeriod(p.key); setProfitDateFrom(''); setProfitDateTo('') }}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${profitPeriod === p.key
                                                ? 'bg-indigo-600 text-white shadow-sm'
                                                : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                                                }`}
                                        >
                                            {p.label}
                                        </button>
                                    ))}

                                    {/* Month quick-select */}
                                    <select
                                        value={/^\d{4}-\d{2}$/.test(profitPeriod) ? profitPeriod : ''}
                                        onChange={(e) => { if (e.target.value) { setProfitPeriod(e.target.value); setProfitDateFrom(''); setProfitDateTo('') } }}
                                        className="px-3 py-1.5 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 border-0 cursor-pointer"
                                    >
                                        <option value="">Lună specifică...</option>
                                        {(() => {
                                            const months = []
                                            const now = new Date()
                                            for (let i = 0; i < 18; i++) {
                                                const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
                                                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                                                const label = d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })
                                                months.push(<option key={key} value={key}>{label}</option>)
                                            }
                                            return months
                                        })()}
                                    </select>

                                    <div className="h-6 w-px bg-zinc-300 dark:bg-zinc-600 mx-1" />

                                    {/* Custom range */}
                                    <button
                                        onClick={() => setProfitPeriod('custom')}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${profitPeriod === 'custom'
                                            ? 'bg-indigo-600 text-white shadow-sm'
                                            : 'bg-zinc-100 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                                            }`}
                                    >
                                        Perioadă custom
                                    </button>
                                    {profitPeriod === 'custom' && (
                                        <>
                                            <input
                                                type="date"
                                                value={profitDateFrom}
                                                onChange={(e) => setProfitDateFrom(e.target.value)}
                                                className="px-2 py-1.5 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-700/50 text-zinc-700 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600"
                                            />
                                            <span className="text-zinc-400">→</span>
                                            <input
                                                type="date"
                                                value={profitDateTo}
                                                onChange={(e) => setProfitDateTo(e.target.value)}
                                                className="px-2 py-1.5 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-700/50 text-zinc-700 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600"
                                            />
                                        </>
                                    )}

                                    {profitLoading && (
                                        <div className="ml-2 animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
                                    )}
                                </div>
                            </div>

                    {profitabilityData && (() => {
                        const pnl = profitabilityData.pnl
                        const storePnls = profitabilityData.pnl_by_store || []
                        const fm = (val) => formatMoney(val)
                        const config = profitabilityData.config || {}
                        const bizBySection = pnl?.business_costs_by_section || {}

                        // Build columns: each store + total
                        const columns = [
                            ...storePnls.map(sp => ({ key: sp.store_uid, label: sp.store_name, data: sp })),
                            { key: '_total', label: 'TOTAL', data: { ...pnl, income: { ...pnl?.income, sales_delivered: pnl?.income?.total_realized, delivered_count: pnl?.income?.delivered_count } } },
                        ]

                        // Row definitions
                        const getValue = (col, path) => {
                            // Handle computed paths for unrealized revenue
                            if (path === '__unrealized_revenue') {
                                const sb = col.data?.status_breakdown || {};
                                const inTransit = sb.in_transit?.revenue?.cu_tva || 0;
                                const other = sb.other?.revenue?.cu_tva || 0;
                                const total = inTransit + other;
                                return total > 0 ? { cu_tva: total, fara_tva: total / 1.21 } : { cu_tva: 0, fara_tva: 0 };
                            }
                            if (path === '__unrealized_count') {
                                const sb = col.data?.status_breakdown || {};
                                return (sb.in_transit?.count || 0) + (sb.other?.count || 0);
                            }
                            let obj = col.data
                            for (const p of path.split('.')) obj = obj?.[p]
                            return obj
                        }
                        const getNum = (col, path) => {
                            const v = getValue(col, path)
                            return typeof v === 'number' ? v : (v?.cu_tva || 0)
                        }

                        // Build dynamic fixed cost rows from business_costs_by_section
                        const fixedEntries = bizBySection.fixed || []
                        const fixedCostRows = fixedEntries.length > 0
                            ? fixedEntries.map(entry => ({
                                type: 'dynamic', label: `(-) ${entry.label}`, amount: entry.cu_tva, isNeg: true
                            }))
                            : []

                        const rows = [
                            { type: 'header', label: '📈 VENITURI' },
                            { type: 'row', label: 'Vânzări Brute (Gross Sales)', path: 'income.gross_sales' },
                            { type: 'row', label: '(-) Returnate/Anulate', path: 'income.returns_cancelled', isNeg: true, countPath: 'income.returns_cancelled_count' },
                            { type: 'row', label: '(-) Nerealizate/În tranzit', path: '__unrealized_revenue', isNeg: true, countPath: '__unrealized_count' },
                            { type: 'total', label: 'Vânzări Revenue (livrate)', path: 'income.sales_delivered', countPath: 'income.delivered_count' },
                            { type: 'spacer' },
                            { type: 'header', label: '📦 COSTURI DIRECTE (COGS)', checkPath: 'cogs.total_cogs' },
                            { type: 'row', label: 'Cost Produse (SKU)', path: 'cogs.sku_costs', isNeg: true },
                            { type: 'total', label: 'Total COGS', path: 'cogs.total_cogs', isNeg: true },
                            { type: 'spacer', checkPath: 'cogs.total_cogs' },
                            { type: 'profit', label: '💰 PROFIT BRUT', path: 'gross_profit', pctKey: 'gross_margin_pct' },
                            { type: 'spacer' },
                            { type: 'header', label: '🏢 COSTURI OPERAȚIONALE', checkPath: 'operational.total_operational' },
                            { type: 'row', label: 'Transport / Curierat', path: 'operational.shipping', isNeg: true },
                            { type: 'row', label: 'Taxă Frisbo (Fulfillment)', path: 'operational.frisbo_fee', isNeg: true },
                            { type: 'row', label: 'Salariu Depozit', path: 'operational.warehouse_salary', isNeg: true },
                            { type: 'row', label: `Comision GT (${config.gt_commission_pct || 0}%)`, path: 'operational.gt_commission', isNeg: true },
                            { type: 'row', label: `Procesare Plată (${config.payment_processing_pct || 0}%)`, path: 'operational.payment_fee', isNeg: true },
                            { type: 'total', label: 'Total Operațional', path: 'operational.total_operational', isNeg: true },
                            { type: 'spacer', checkPath: 'operational.total_operational' },
                            { type: 'profit', label: '📈 PROFIT OPERAȚIONAL', path: 'operating_profit', pctKey: 'operating_margin_pct' },
                            { type: 'spacer' },
                            // Marketing section
                            { type: 'header', label: '📣 COSTURI MARKETING', checkPath: 'marketing.total' },
                            { type: 'row', label: 'Facebook Ads', path: 'marketing.facebook', isNeg: true },
                            { type: 'row', label: 'TikTok Ads', path: 'marketing.tiktok', isNeg: true },
                            { type: 'row', label: 'Google Ads', path: 'marketing.google', isNeg: true },
                            { type: 'total', label: 'Total Marketing', path: 'marketing.total', isNeg: true },
                            { type: 'spacer', checkPath: 'marketing.total' },
                            // Fixed costs section — dynamic entries
                            { type: 'header', label: `💼 COSTURI FIXE (${pnl?.fixed_costs_month || ''})`, checkPath: 'fixed_costs.total' },
                            ...fixedCostRows,
                            { type: 'total', label: 'Total Costuri Fixe', path: 'fixed_costs.total', isNeg: true },
                            { type: 'spacer', checkPath: 'fixed_costs.total' },
                            { type: 'net', label: '💵 PROFIT NET', path: 'net_profit', pctKey: 'net_margin_pct' },
                        ]

                        // Filter: hide row if ALL columns have 0 for that path
                        const shouldShow = (row) => {
                            if (row.type === 'spacer') {
                                if (!row.checkPath) return true
                                return columns.some(c => {
                                    const v = getValue(c, row.checkPath)
                                    return v && (v.cu_tva !== 0 || v.fara_tva !== 0)
                                })
                            }
                            if (!row.path) return true
                            if (row.checkPath) {
                                return columns.some(c => {
                                    const v = getValue(c, row.checkPath)
                                    return v && (v.cu_tva !== 0 || v.fara_tva !== 0)
                                })
                            }
                            if (row.type === 'header') {
                                if (!row.checkPath) return true
                                return columns.some(c => {
                                    const v = getValue(c, row.checkPath)
                                    return v && (v.cu_tva !== 0 || v.fara_tva !== 0)
                                })
                            }
                            if (row.type === 'profit' || row.type === 'net') return true
                            return columns.some(c => {
                                const v = getValue(c, row.path)
                                return v && (v.cu_tva !== 0 || v.fara_tva !== 0)
                            })
                        }

                        const pctColor = (pct) => pct >= 20 ? 'text-green-600 dark:text-green-400' : pct >= 10 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'

                        return (
                            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-700">
                                    <h3 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                        📊 P&L Comparativ — Toate Magazinele
                                    </h3>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                        Comparație side-by-side a profitabilității per magazin. Valori cu TVA.
                                        <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium">
                                            💱 Toate valorile convertite în RON (curs BNR istoric)
                                        </span>
                                    </p>
                                    {profitabilityData?.unconvertible_currencies?.length > 0 && (
                                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                                            ⚠️ Curs BNR lipsă pentru: {profitabilityData.unconvertible_currencies.join(', ')} — valorile au rămas neconvertite
                                        </p>
                                    )}
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full border-collapse min-w-[600px]">
                                        <thead>
                                            <tr className="bg-zinc-100 dark:bg-zinc-900">
                                                <th className="text-left pl-4 pr-2 py-3 text-xs font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wide min-w-[200px] sticky left-0 bg-zinc-100 dark:bg-zinc-900 z-10">Indicator</th>
                                                {columns.map(col => (
                                                    <th key={col.key} className={`px-3 py-3 text-right text-xs font-bold uppercase tracking-wide min-w-[130px] ${col.key === '_total' ? 'text-zinc-900 dark:text-white bg-zinc-200 dark:bg-zinc-800' : 'text-zinc-600 dark:text-zinc-300'
                                                        }`}>{col.label}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.filter(shouldShow).map((row, idx) => {
                                                if (row.type === 'spacer') {
                                                    return <tr key={idx}><td colSpan={columns.length + 1} className="py-1"></td></tr>
                                                }
                                                if (row.type === 'header') {
                                                    return (
                                                        <tr key={idx} className="bg-zinc-100 dark:bg-zinc-900/60">
                                                            <td className="pl-4 py-2.5 text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-wide sticky left-0 bg-zinc-100 dark:bg-zinc-900/60 z-10">{row.label}</td>
                                                            {columns.map(col => (
                                                                <td key={col.key} className={`px-3 py-2.5 text-right text-xs font-bold text-zinc-500 dark:text-white uppercase ${col.key === '_total' ? 'bg-zinc-200/60 dark:bg-zinc-800/60' : ''
                                                                    }`}>Cu TVA</td>
                                                            ))}
                                                        </tr>
                                                    )
                                                }
                                                if (row.type === 'net') {
                                                    return (
                                                        <tr key={idx} className="bg-zinc-900 dark:bg-zinc-950">
                                                            <td className="pl-4 py-3 text-sm font-bold text-white sticky left-0 bg-zinc-900 dark:bg-zinc-950 z-10">{row.label}</td>
                                                            {columns.map(col => {
                                                                const v = getValue(col, row.path)
                                                                const pct = col.data?.[row.pctKey]
                                                                const val = v?.cu_tva ?? 0
                                                                return (
                                                                    <td key={col.key} className={`px-3 py-3 text-right text-sm font-bold ${col.key === '_total' ? 'bg-zinc-800 dark:bg-zinc-900' : ''
                                                                        } ${val >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                                        {fm(val)} RON
                                                                        {pct !== undefined && <div className={`text-[10px] font-normal ${pctColor(pct)}`}>({typeof pct === 'number' ? pct.toFixed(1) : pct}%)</div>}
                                                                    </td>
                                                                )
                                                            })}
                                                        </tr>
                                                    )
                                                }
                                                if (row.type === 'profit') {
                                                    return (
                                                        <tr key={idx} className="bg-zinc-50 dark:bg-zinc-800/60">
                                                            <td className="pl-4 py-2.5 text-sm font-bold text-zinc-900 dark:text-white sticky left-0 bg-zinc-50 dark:bg-zinc-800/60 z-10">{row.label}</td>
                                                            {columns.map(col => {
                                                                const v = getValue(col, row.path)
                                                                const pct = col.data?.[row.pctKey]
                                                                const val = v?.cu_tva ?? 0
                                                                return (
                                                                    <td key={col.key} className={`px-3 py-2.5 text-right text-sm font-bold ${col.key === '_total' ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                                                                        } ${val >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                                        {fm(val)} RON
                                                                        {pct !== undefined && <div className={`text-[10px] font-normal ${pctColor(pct)}`}>({typeof pct === 'number' ? pct.toFixed(1) : pct}%)</div>}
                                                                    </td>
                                                                )
                                                            })}
                                                        </tr>
                                                    )
                                                }
                                                if (row.type === 'dynamic') {
                                                    // Dynamic rows have a fixed amount, not a path
                                                    return (
                                                        <tr key={idx}>
                                                            <td className="pl-8 py-2 text-sm text-zinc-700 dark:text-white sticky left-0 bg-white dark:bg-zinc-800 z-10">
                                                                {row.label}
                                                            </td>
                                                            {columns.map(col => {
                                                                // For total column, show the full amount; for store columns show proportional or same
                                                                const val = col.key === '_total' ? (row.amount || 0) : 0
                                                                return (
                                                                    <td key={col.key} className={`px-3 py-2 text-sm text-right font-medium ${col.key === '_total' ? 'bg-zinc-50/50 dark:bg-zinc-800/30' : ''} text-red-600 dark:text-red-400`}>
                                                                        {val !== 0 ? `${fm(val)} RON` : '—'}
                                                                    </td>
                                                                )
                                                            })}
                                                        </tr>
                                                    )
                                                }
                                                // row or total
                                                const isTotal = row.type === 'total'
                                                return (
                                                    <tr key={idx} className={isTotal ? 'bg-zinc-50 dark:bg-zinc-800/50' : ''}>
                                                        <td className={`pl-${isTotal ? '4' : '8'} py-2 text-sm ${isTotal ? 'font-semibold text-zinc-800 dark:text-white border-t border-zinc-300 dark:border-zinc-600' : 'text-zinc-700 dark:text-white'
                                                            } sticky left-0 ${isTotal ? 'bg-zinc-50 dark:bg-zinc-800/50' : 'bg-white dark:bg-zinc-800'} z-10`}>
                                                            {row.label}
                                                            {row.countPath && <span className="text-xs text-zinc-400 ml-1">({columns.map(c => getValue(c, row.countPath) || 0).join('/')})</span>}
                                                        </td>
                                                        {columns.map(col => {
                                                            const v = getValue(col, row.path)
                                                            const val = v?.cu_tva ?? (typeof v === 'number' ? v : 0)
                                                            const valColor = row.isNeg ? 'text-red-600 dark:text-red-400' : 'text-zinc-800 dark:text-white'
                                                            return (
                                                                <td key={col.key} className={`px-3 py-2 text-sm text-right font-medium ${isTotal ? 'font-semibold border-t border-zinc-300 dark:border-zinc-600' : ''
                                                                    } ${col.key === '_total' ? (isTotal ? 'bg-zinc-100 dark:bg-zinc-800' : 'bg-zinc-50/50 dark:bg-zinc-800/30') : ''} ${valColor}`}>
                                                                    {val !== 0 ? `${fm(val)} RON` : '—'}
                                                                </td>
                                                            )
                                                        })}
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )
                    })()}
                        </div>
                    )}

                    {/* SKU Costs Tab */}
                    {
                        activeTab === 'skuCosts' && (
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
                                            {/* Filter dropdown */}
                                            <select
                                                value={skuCostFilter}
                                                onChange={(e) => setSkuCostFilter(e.target.value)}
                                                className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-700 dark:text-white border border-zinc-200 dark:border-zinc-600 rounded-lg text-sm"
                                            >
                                                <option value="all">Toate SKU-urile</option>
                                                <option value="no_cost">Fără cost setat</option>
                                                <option value="has_cost">Cu cost setat</option>
                                            </select>
                                            {/* Bulk edit toggle */}
                                            <button
                                                onClick={() => {
                                                    setBulkEditMode(!bulkEditMode)
                                                    setSelectedSkus(new Set())
                                                    setBulkCostValue('')
                                                }}
                                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${bulkEditMode
                                                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                                                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-white hover:bg-zinc-200'
                                                    }`}
                                            >
                                                <Edit2 className="w-4 h-4 inline mr-1" />
                                                {bulkEditMode ? 'Anulează Bulk Edit' : 'Bulk Edit'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Bulk edit bar */}
                                    {bulkEditMode && (
                                        <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-200 dark:border-amber-800 flex items-center gap-3 flex-wrap">
                                            <span className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                                                {selectedSkus.size} selectate
                                            </span>
                                            <button
                                                onClick={() => {
                                                    if (selectedSkus.size === skuCosts.length) {
                                                        setSelectedSkus(new Set())
                                                    } else {
                                                        setSelectedSkus(new Set(skuCosts.map(s => s.sku)))
                                                    }
                                                }}
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
                                                    onClick={async () => {
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
                                                        } catch (err) {
                                                            console.error('Bulk update failed:', err)
                                                        }
                                                    }}
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
                                            <thead className="bg-zinc-50 dark:bg-zinc-900/50 sticky top-0">
                                                <tr>
                                                    {bulkEditMode && (
                                                        <th className="w-10 px-3 py-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedSkus.size === skuCosts.length && skuCosts.length > 0}
                                                                onChange={() => {
                                                                    if (selectedSkus.size === skuCosts.length) {
                                                                        setSelectedSkus(new Set())
                                                                    } else {
                                                                        setSelectedSkus(new Set(skuCosts.map(s => s.sku)))
                                                                    }
                                                                }}
                                                                className="w-4 h-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                                                            />
                                                        </th>
                                                    )}
                                                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">SKU</th>
                                                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Nume</th>
                                                    <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Cost (RON)</th>
                                                    <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Acțiuni</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                                                {skuCosts.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={bulkEditMode ? 5 : 4} className="px-4 py-8 text-center text-zinc-500">
                                                            Niciun cost SKU configurat. Adaugă primul SKU sau descoperă din comenzi.
                                                        </td>
                                                    </tr>
                                                ) : skuCosts.map(sku => (
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
                                                        <td className="px-4 py-3 text-sm font-mono text-zinc-900 dark:text-white">
                                                            {sku.sku}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-zinc-600 dark:text-white">
                                                            {editingSku === sku.sku ? (
                                                                <input
                                                                    type="text"
                                                                    defaultValue={sku.name}
                                                                    id={`name-${sku.sku}`}
                                                                    className="w-full px-2 py-1 bg-zinc-50 dark:bg-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 rounded text-sm"
                                                                />
                                                            ) : (
                                                                sku.name || '-'
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-right text-zinc-900 dark:text-white">
                                                            {editingSku === sku.sku ? (
                                                                <input
                                                                    type="number"
                                                                    defaultValue={sku.cost}
                                                                    id={`cost-${sku.sku}`}
                                                                    step="0.01"
                                                                    className="w-24 px-2 py-1 bg-zinc-50 dark:bg-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 rounded text-sm text-right"
                                                                />
                                                            ) : (
                                                                <span className={sku.cost === 0 ? 'text-amber-500 font-medium' : ''}>
                                                                    {sku.cost === 0 ? '⚠ 0 RON' : `${sku.cost} RON`}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-right">
                                                            {editingSku === sku.sku ? (
                                                                <div className="flex gap-2 justify-end">
                                                                    <button
                                                                        onClick={() => {
                                                                            const name = document.getElementById(`name-${sku.sku}`)?.value
                                                                            const cost = parseFloat(document.getElementById(`cost-${sku.sku}`)?.value) || 0
                                                                            handleSaveSkuCost(sku.sku, { name, cost })
                                                                        }}
                                                                        className="p-1.5 bg-green-100 dark:bg-green-900/30 text-green-600 rounded hover:bg-green-200"
                                                                    >
                                                                        <Save className="w-4 h-4" />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setEditingSku(null)}
                                                                        className="p-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-white rounded hover:bg-zinc-200"
                                                                    >
                                                                        <XCircle className="w-4 h-4" />
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <div className="flex gap-2 justify-end">
                                                                    <button
                                                                        onClick={() => setEditingSku(sku.sku)}
                                                                        className="p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded hover:bg-blue-200"
                                                                    >
                                                                        <Tag className="w-4 h-4" />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDeleteSkuCost(sku.sku)}
                                                                        className="p-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 rounded hover:bg-red-200"
                                                                    >
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )
                    }


                    {/* ── SKU Risk & Shipping Anomalies Tab ── */}
                    {activeTab === 'skuRisk' && (() => {
                        const fetchSkuRisk = async () => {
                            setSkuRiskLoading(true)
                            try {
                                const params = { days: skuRiskDays, min_units_sold: skuRiskMinUnits, min_orders_with_sku: skuRiskMinOrders, include_delivery_problems: skuRiskInclDelivery }
                                if (skuRiskStore) params.store_uids = skuRiskStore
                                if (skuRiskCourier) params.courier_name = skuRiskCourier
                                const data = await analyticsApi.getSkuRisk(params)
                                setSkuRiskData(data)
                            } catch (e) { console.error('SKU Risk fetch error:', e) }
                            finally { setSkuRiskLoading(false) }
                        }

                        const sortedSkus = skuRiskData?.worst_skus ? [...skuRiskData.worst_skus].sort((a, b) => {
                            const col = skuRiskSort.col
                            const av = a[col] ?? -1, bv = b[col] ?? -1
                            return skuRiskSort.dir === 'desc' ? bv - av : av - bv
                        }) : []

                        const anomalyPage = skuRiskData?.anomaly_orders || []
                        const anomalyPerPage = 20
                        const anomalySlice = anomalyPage.slice(skuRiskAnomalyPage * anomalyPerPage, (skuRiskAnomalyPage + 1) * anomalyPerPage)
                        const anomalyTotalPages = Math.ceil(anomalyPage.length / anomalyPerPage)

                        const riskColor = (score) => {
                            if (score === null || score === undefined) return 'text-zinc-400'
                            if (score >= 60) return 'text-red-600 dark:text-red-400'
                            if (score >= 30) return 'text-amber-600 dark:text-amber-400'
                            return 'text-green-600 dark:text-green-400'
                        }
                        const riskBg = (score) => {
                            if (score === null || score === undefined) return 'bg-zinc-100 dark:bg-zinc-700'
                            if (score >= 60) return 'bg-red-50 dark:bg-red-900/20'
                            if (score >= 30) return 'bg-amber-50 dark:bg-amber-900/20'
                            return 'bg-green-50 dark:bg-green-900/20'
                        }

                        const SortHeader = ({ col, label, tip }) => (
                            <th
                                className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200 select-none"
                                onClick={() => setSkuRiskSort(prev => ({ col, dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc' }))}
                                title={tip || ''}
                            >
                                {label} {skuRiskSort.col === col ? (skuRiskSort.dir === 'desc' ? '↓' : '↑') : ''}
                            </th>
                        )

                        return (
                            <div className="space-y-6">
                                {/* Section A: Controls */}
                                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                    <div className="flex flex-wrap items-end gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Perioadă</label>
                                            <div className="flex gap-1">
                                                {[7, 30, 90, 180].map(d => (
                                                    <button key={d} onClick={() => setSkuRiskDays(d)}
                                                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${skuRiskDays === d ? 'bg-red-600 text-white border-red-600' : 'border-zinc-200 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'}`}
                                                    >{d}z</button>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Magazin</label>
                                            <select value={skuRiskStore} onChange={e => setSkuRiskStore(e.target.value)}
                                                className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white">
                                                <option value="">Toate</option>
                                                {stores.map(s => <option key={s.uid} value={s.uid}>{s.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Min. unități</label>
                                            <input type="number" value={skuRiskMinUnits} onChange={e => setSkuRiskMinUnits(Number(e.target.value) || 1)}
                                                className="w-20 px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Min. comenzi</label>
                                            <input type="number" value={skuRiskMinOrders} onChange={e => setSkuRiskMinOrders(Number(e.target.value) || 1)}
                                                className="w-20 px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                        </div>
                                        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300 cursor-pointer">
                                            <input type="checkbox" checked={skuRiskInclDelivery} onChange={e => setSkuRiskInclDelivery(e.target.checked)}
                                                className="rounded border-zinc-300" />
                                            +Delivery Problems
                                        </label>
                                        <button onClick={fetchSkuRisk} disabled={skuRiskLoading}
                                            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5">
                                            {skuRiskLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                                            Analizează
                                        </button>
                                    </div>
                                    {skuRiskData?.meta && (
                                        <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                                            <span>📦 {skuRiskData.meta.filtered_orders.toLocaleString()} comenzi</span>
                                            <span>🏷️ {skuRiskData.meta.unique_skus} SKU-uri ({skuRiskData.meta.skus_passing_volume} cu volum suficient)</span>
                                            <span>🚚 Acoperire shipping: {skuRiskData.meta.shipping_coverage_pct}%</span>
                                        </div>
                                    )}
                                </div>

                                {skuRiskLoading && (
                                    <div className="flex items-center justify-center py-12">
                                        <RefreshCw className="w-8 h-8 text-red-500 animate-spin" />
                                        <span className="ml-3 text-zinc-500 dark:text-white">Se analizează riscurile...</span>
                                    </div>
                                )}

                                {skuRiskData && !skuRiskLoading && (
                                    <>
                                        {/* Section B: Worst SKUs Table */}
                                        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
                                                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-2">
                                                    <AlertTriangle className="w-4 h-4 text-red-500" />
                                                    SKU-uri problematice — Ranked by Risk Score
                                                </h3>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="w-full">
                                                    <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                                                        <tr>
                                                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-8">#</th>
                                                            <SortHeader col="sku" label="SKU" />
                                                            <SortHeader col="units_sold" label="Unități" tip="Total unități vândute" />
                                                            <SortHeader col="orders_with_sku" label="Comenzi" tip="Comenzi care conțin acest SKU" />
                                                            <SortHeader col="problem_units" label="Prob. Units" tip="Unități în comenzi returnate/refuzate/anulate" />
                                                            <SortHeader col="problem_rate" label="Prob. Rate" tip="Problem units / total units × 100" />
                                                            <SortHeader col="contamination_rate" label="Contam. %" tip="% comenzi cu SKU care sunt problematice" />
                                                            <SortHeader col="units_back_to_sender" label="BTS" tip="Back to Sender" />
                                                            <SortHeader col="units_cancelled" label="Anul." />
                                                            <SortHeader col="units_refused" label="Refuz." />
                                                            <SortHeader col="shipping_anomaly_rate" label="Ship. Anom." tip="% comenzi cu anomalie de shipping" />
                                                            <SortHeader col="avg_ship_cost_per_unit" label="Avg Ship/u" tip="Cost mediu transport alocat / unitate" />
                                                            <SortHeader col="risk_score" label="Risk Score" tip="Scor 0–100: 45% problem rate + 25% contamination + 20% shipping anomaly + 10% delivery problems" />
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                                        {sortedSkus.length === 0 && (
                                                            <tr><td colSpan={13} className="px-4 py-8 text-center text-zinc-400">Nu sunt date. Apasă "Analizează".</td></tr>
                                                        )}
                                                        {sortedSkus.map((s, i) => (
                                                            <Fragment key={s.sku}>
                                                                <tr className={`hover:bg-zinc-50 dark:hover:bg-zinc-700/30 cursor-pointer ${skuRiskExpanded === s.sku ? 'bg-zinc-50 dark:bg-zinc-700/30' : ''}`}
                                                                    onClick={() => setSkuRiskExpanded(skuRiskExpanded === s.sku ? null : s.sku)}>
                                                                    <td className="px-3 py-2 text-xs text-zinc-400">{i + 1}</td>
                                                                    <td className="px-3 py-2">
                                                                        <div className="text-sm font-medium text-zinc-900 dark:text-white">{s.sku}</div>
                                                                        {s.product_name && <div className="text-xs text-zinc-500 truncate max-w-[200px]">{s.product_name}</div>}
                                                                        {s.stores_count > 1 && <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full">{s.stores_count} magazine</span>}
                                                                    </td>
                                                                    <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">{s.units_sold}</td>
                                                                    <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">{s.orders_with_sku}</td>
                                                                    <td className="px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400">{s.problem_units || '—'}</td>
                                                                    <td className="px-3 py-2 text-sm font-semibold"><span className={s.problem_rate > 15 ? 'text-red-600' : s.problem_rate > 5 ? 'text-amber-600' : 'text-green-600'}>{s.problem_rate}%</span></td>
                                                                    <td className="px-3 py-2 text-sm"><span className={s.contamination_rate > 15 ? 'text-red-600' : s.contamination_rate > 5 ? 'text-amber-600' : 'text-zinc-600 dark:text-zinc-300'}>{s.contamination_rate}%</span></td>
                                                                    <td className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400">{s.units_back_to_sender || '—'}</td>
                                                                    <td className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400">{s.units_cancelled || '—'}</td>
                                                                    <td className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400">{s.units_refused || '—'}</td>
                                                                    <td className="px-3 py-2 text-sm"><span className={s.shipping_anomaly_rate > 10 ? 'text-red-600' : 'text-zinc-600 dark:text-zinc-400'}>{s.shipping_anomaly_rate}%</span></td>
                                                                    <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">{s.avg_ship_cost_per_unit > 0 ? `${s.avg_ship_cost_per_unit} RON` : '—'}</td>
                                                                    <td className="px-3 py-2">
                                                                        {s.risk_score !== null ? (
                                                                            <span className={`text-sm font-bold ${riskColor(s.risk_score)} px-2 py-0.5 rounded-md ${riskBg(s.risk_score)}`}>{s.risk_score}</span>
                                                                        ) : (
                                                                            <span className="text-xs text-zinc-400 italic">low data</span>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                                {/* Expanded detail */}
                                                                {skuRiskExpanded === s.sku && (
                                                                    <tr className="bg-zinc-50 dark:bg-zinc-900/40">
                                                                        <td colSpan={13} className="px-4 py-4">
                                                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                                                {/* Per-store breakdown */}
                                                                                <div>
                                                                                    <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1"><Store className="w-3 h-3" /> Per Magazine</h5>
                                                                                    <div className="space-y-1">
                                                                                        {s.by_store.map(bs => (
                                                                                            <div key={bs.store_uid} className="flex justify-between text-xs bg-white dark:bg-zinc-800 rounded-lg px-2 py-1 border border-zinc-200 dark:border-zinc-700">
                                                                                                <span className="text-zinc-700 dark:text-zinc-300">{bs.store_name}</span>
                                                                                                <span>{bs.units_sold} u | <span className={bs.problem_rate > 10 ? 'text-red-600 font-medium' : 'text-zinc-500'}>{bs.problem_rate}%</span> prob.</span>
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                                {/* Outcome breakdown */}
                                                                                <div>
                                                                                    <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">📊 Outcome Breakdown</h5>
                                                                                    <div className="space-y-1 text-xs">
                                                                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Back to Sender</span><span className="font-medium text-zinc-900 dark:text-white">{s.units_back_to_sender} u</span></div>
                                                                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Anulate</span><span className="font-medium text-zinc-900 dark:text-white">{s.units_cancelled} u</span></div>
                                                                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Refuzate</span><span className="font-medium text-zinc-900 dark:text-white">{s.units_refused} u</span></div>
                                                                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Delivery Problems</span><span className="font-medium text-zinc-900 dark:text-white">{s.delivery_problem_orders} ord.</span></div>
                                                                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Not Shipped/Pending</span><span className="font-medium text-zinc-900 dark:text-white">{s.not_shipped_orders} ord.</span></div>
                                                                                    </div>
                                                                                </div>
                                                                                {/* Financial */}
                                                                                <div>
                                                                                    <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">💰 Financial</h5>
                                                                                    <div className="space-y-1 text-xs">
                                                                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Revenue total</span><span className="font-medium text-zinc-900 dark:text-white">{s.revenue_total.toLocaleString()} RON</span></div>
                                                                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">COGS total</span><span className="font-medium text-zinc-900 dark:text-white">{s.cogs_total.toLocaleString()} RON</span></div>
                                                                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Avg ship/unit</span><span className="font-medium text-zinc-900 dark:text-white">{s.avg_ship_cost_per_unit} RON</span></div>
                                                                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Avg ship margin/unit</span><span className={`font-medium ${s.avg_ship_margin_per_unit < 0 ? 'text-red-600' : 'text-green-600'}`}>{s.avg_ship_margin_per_unit} RON</span></div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </Fragment>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        {/* Section C: Shipping Anomaly Orders */}
                                        {anomalyPage.length > 0 && (
                                            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                                                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-2">
                                                        <Truck className="w-4 h-4 text-amber-500" />
                                                        Anomalii Shipping ({anomalyPage.length} comenzi)
                                                    </h3>
                                                    <div className="text-xs text-zinc-400">
                                                        Pagina {skuRiskAnomalyPage + 1} / {anomalyTotalPages}
                                                    </div>
                                                </div>
                                                <div className="overflow-x-auto">
                                                    <table className="w-full">
                                                        <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                                                            <tr>
                                                                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Comandă</th>
                                                                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Magazin</th>
                                                                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Data</th>
                                                                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Curier</th>
                                                                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Țară</th>
                                                                <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Total</th>
                                                                <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Ship. Taxat</th>
                                                                <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Cost Real</th>
                                                                <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Marjă</th>
                                                                <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">Cost %</th>
                                                                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Outcome</th>
                                                                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Motiv</th>
                                                                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">SKU-uri</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                                            {anomalySlice.map(ao => (
                                                                <tr key={ao.uid} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30">
                                                                    <td className="px-3 py-2 text-xs font-mono text-zinc-700 dark:text-zinc-300">{ao.order_number || ao.uid?.slice(0, 8)}</td>
                                                                    <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">{ao.store_name}</td>
                                                                    <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">{ao.date ? new Date(ao.date).toLocaleDateString() : '—'}</td>
                                                                    <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">{ao.courier_name || '—'}</td>
                                                                    <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">{ao.country_code || '—'}</td>
                                                                    <td className="px-3 py-2 text-xs text-right text-zinc-700 dark:text-zinc-300">{ao.order_total?.toFixed(2)}</td>
                                                                    <td className="px-3 py-2 text-xs text-right text-zinc-700 dark:text-zinc-300">{ao.shipping_charged?.toFixed(2) ?? '—'}</td>
                                                                    <td className="px-3 py-2 text-xs text-right font-medium text-zinc-900 dark:text-white">{ao.real_shipping_cost?.toFixed(2)}</td>
                                                                    <td className={`px-3 py-2 text-xs text-right font-semibold ${ao.shipping_margin < 0 ? 'text-red-600' : 'text-green-600'}`}>{ao.shipping_margin?.toFixed(2)}</td>
                                                                    <td className={`px-3 py-2 text-xs text-right ${ao.shipping_cost_pct > 25 ? 'text-red-600 font-medium' : 'text-zinc-600 dark:text-zinc-400'}`}>{ao.shipping_cost_pct}%</td>
                                                                    <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ao.final_outcome === 'DELIVERED' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ao.final_outcome === 'BACK_TO_SENDER' || ao.final_outcome === 'REFUSED' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'}`}>{ao.final_outcome}</span></td>
                                                                    <td className="px-3 py-2 text-xs text-amber-600 dark:text-amber-400 max-w-[200px]">
                                                                        {ao.anomaly_reasons?.map((r, i) => <div key={i}>⚠ {r}</div>)}
                                                                    </td>
                                                                    <td className="px-3 py-2 text-xs text-zinc-500 max-w-[150px] truncate" title={ao.skus?.join(', ')}>{ao.skus?.join(', ')}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                {anomalyTotalPages > 1 && (
                                                    <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-center gap-2">
                                                        <button onClick={() => setSkuRiskAnomalyPage(p => Math.max(0, p - 1))} disabled={skuRiskAnomalyPage === 0}
                                                            className="px-3 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 disabled:opacity-50">← Prev</button>
                                                        <span className="text-xs text-zinc-500">{skuRiskAnomalyPage + 1} / {anomalyTotalPages}</span>
                                                        <button onClick={() => setSkuRiskAnomalyPage(p => Math.min(anomalyTotalPages - 1, p + 1))} disabled={skuRiskAnomalyPage >= anomalyTotalPages - 1}
                                                            className="px-3 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 disabled:opacity-50">Next →</button>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Section D: Store Summary */}
                                        {skuRiskData.store_summary?.length > 0 && (
                                            <div>
                                                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3 flex items-center gap-2">
                                                    <Store className="w-4 h-4" />
                                                    Sumar per Magazin
                                                </h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    {skuRiskData.store_summary.map(ss => (
                                                        <div key={ss.store_uid} className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                                            <h4 className="text-sm font-semibold text-zinc-800 dark:text-white mb-3">{ss.store_name}</h4>
                                                            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                                                                <div className="bg-zinc-50 dark:bg-zinc-700/50 rounded-lg p-2">
                                                                    <div className="text-zinc-500 dark:text-zinc-400">Comenzi</div>
                                                                    <div className="text-lg font-bold text-zinc-900 dark:text-white">{ss.total_orders.toLocaleString()}</div>
                                                                </div>
                                                                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2">
                                                                    <div className="text-zinc-500 dark:text-zinc-400">Livrate</div>
                                                                    <div className="text-lg font-bold text-green-600">{ss.delivered_pct}%</div>
                                                                </div>
                                                                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
                                                                    <div className="text-zinc-500 dark:text-zinc-400">Probleme</div>
                                                                    <div className="text-lg font-bold text-red-600">{ss.problem_pct}%</div>
                                                                </div>
                                                                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
                                                                    <div className="text-zinc-500 dark:text-zinc-400">Ship. Anom.</div>
                                                                    <div className="text-lg font-bold text-amber-600">{ss.anomaly_pct}%</div>
                                                                </div>
                                                            </div>
                                                            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Avg shipping: <span className="font-medium text-zinc-900 dark:text-white">{ss.avg_shipping_cost} RON</span></div>
                                                            {ss.top5_worst_skus?.length > 0 && (
                                                                <div className="mt-2">
                                                                    <div className="text-[10px] font-semibold text-zinc-400 uppercase mb-1">Top SKU-uri risc</div>
                                                                    {ss.top5_worst_skus.map(ws => (
                                                                        <div key={ws.sku} className="flex justify-between text-xs py-0.5">
                                                                            <span className="text-zinc-600 dark:text-zinc-300 truncate mr-2">{ws.sku}</span>
                                                                            <span className={`font-medium ${riskColor(ws.risk_score)}`}>{ws.risk_score}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )
                    })()}

                    {/* ── Sales Velocity & Product Analytics Tab ── */}
                    {activeTab === 'salesVelocity' && (() => {
                        const fetchVelocity = async () => {
                            setVelocityLoading(true)
                            try {
                                const params = { min_units: velocityMinUnits }
                                if (velocityDateFrom && velocityDateTo) {
                                    params.date_from = velocityDateFrom
                                    params.date_to = velocityDateTo
                                } else {
                                    params.days = velocityDays
                                }
                                if (velocityStore) params.store_uids = velocityStore
                                const data = await analyticsApi.getSalesVelocity(params)
                                setVelocityData(data)
                            } catch (e) { console.error('Sales Velocity fetch error:', e) }
                            finally { setVelocityLoading(false) }
                        }

                        const isCustomDate = velocityDateFrom && velocityDateTo

                        const filteredProducts = velocityData?.products
                            ? velocityData.products.filter(p => {
                                if (!velocitySearch) return true
                                const q = velocitySearch.toLowerCase()
                                return p.sku.toLowerCase().includes(q) || (p.product_name || '').toLowerCase().includes(q)
                            })
                            : []

                        const sortedProducts = [...filteredProducts].sort((a, b) => {
                            const col = velocitySort.col
                            const av = a[col] ?? -1, bv = b[col] ?? -1
                            if (typeof av === 'string') return velocitySort.dir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv)
                            return velocitySort.dir === 'desc' ? bv - av : av - bv
                        })

                        const VSort = ({ col, label, tip }) => (
                            <th
                                className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200 select-none whitespace-nowrap"
                                onClick={() => setVelocitySort(prev => ({ col, dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc' }))}
                                title={tip || ''}
                            >
                                {label} {velocitySort.col === col ? (velocitySort.dir === 'desc' ? '↓' : '↑') : ''}
                            </th>
                        )

                        const trendIcon = (t) => t === 'up' ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" /> : t === 'down' ? <ArrowDownRight className="w-3.5 h-3.5 text-red-500" /> : <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />

                        // Simple SVG sparkline from daily_series
                        const Sparkline = ({ data, width = 120, height = 28 }) => {
                            if (!data || data.length === 0) return null
                            const vals = data.map(d => d.units)
                            const max = Math.max(...vals, 1)
                            const points = vals.map((v, i) => `${(i / (vals.length - 1 || 1)) * width},${height - (v / max) * (height - 4) - 2}`).join(' ')
                            return (
                                <svg width={width} height={height} className="inline-block">
                                    <polyline fill="none" stroke="#10b981" strokeWidth="1.5" points={points} />
                                </svg>
                            )
                        }

                        // Interactive SVG bar chart with hover tooltips
                        const TrendChart = ({ trends }) => {
                            if (!trends || trends.length === 0) return null
                            const maxUnits = Math.max(...trends.map(t => t.units), 1)
                            const w = Math.max(700, trends.length * 16)
                            const h = 260
                            const barW = Math.max(4, Math.min(14, (w - 60) / trends.length - 2))
                            return (
                                <div className="relative">
                                    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '300px' }}>
                                        {/* Grid lines */}
                                        {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                                            <g key={pct}>
                                                <line x1={50} y1={h - 30 - pct * (h - 50)} x2={w - 10} y2={h - 30 - pct * (h - 50)} stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="4 4" opacity={0.3} />
                                                <text x={4} y={h - 30 - pct * (h - 50) + 4} fontSize="9" fill="#a1a1aa" fontWeight="500">{Math.round(maxUnits * pct).toLocaleString()}</text>
                                            </g>
                                        ))}
                                        {trends.map((t, i) => {
                                            const barH = (t.units / maxUnits) * (h - 50)
                                            const x = 55 + i * ((w - 70) / trends.length)
                                            const isHovered = hoveredTrendBar === i
                                            return (
                                                <g key={t.date}
                                                    onMouseEnter={() => setHoveredTrendBar(i)}
                                                    onMouseLeave={() => setHoveredTrendBar(null)}
                                                    style={{ cursor: 'pointer' }}>
                                                    <rect x={x - 2} y={0} width={barW + 4} height={h} fill="transparent" />
                                                    <rect x={x} y={h - 30 - barH} width={barW} height={barH} rx={2}
                                                        fill={isHovered ? '#34d399' : '#10b981'} opacity={isHovered ? 1 : 0.8} />
                                                    {(i % Math.max(1, Math.ceil(trends.length / 15)) === 0) && (
                                                        <text x={x} y={h - 8} fontSize="8" fill="#a1a1aa" textAnchor="middle">{t.date.slice(5)}</text>
                                                    )}
                                                    {isHovered && (
                                                        <g>
                                                            <rect x={Math.min(x - 10, w - 140)} y={Math.max(5, h - 30 - barH - 68)} width={130} height={60} rx={6} fill="#18181b" stroke="#3f3f46" strokeWidth="1" />
                                                            <text x={Math.min(x - 10, w - 140) + 8} y={Math.max(5, h - 30 - barH - 68) + 16} fontSize="10" fill="#e4e4e7" fontWeight="600">{t.date}</text>
                                                            <text x={Math.min(x - 10, w - 140) + 8} y={Math.max(5, h - 30 - barH - 68) + 30} fontSize="9" fill="#10b981">📦 {t.units.toLocaleString()} unități</text>
                                                            <text x={Math.min(x - 10, w - 140) + 8} y={Math.max(5, h - 30 - barH - 68) + 43} fontSize="9" fill="#60a5fa">💰 {t.revenue.toLocaleString()} RON</text>
                                                            <text x={Math.min(x - 10, w - 140) + 8} y={Math.max(5, h - 30 - barH - 68) + 55} fontSize="9" fill="#fbbf24">📋 {t.orders} comenzi</text>
                                                        </g>
                                                    )}
                                                </g>
                                            )
                                        })}
                                    </svg>
                                </div>
                            )
                        }

                        return (
                            <div className="space-y-6">
                                {/* Section A: Controls */}
                                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                    <div className="flex flex-wrap items-end gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Perioadă</label>
                                            <div className="flex gap-1">
                                                {[7, 30, 90, 180, 365].map(d => (
                                                    <button key={d} onClick={() => { setVelocityDays(d); setVelocityDateFrom(''); setVelocityDateTo('') }}
                                                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${!isCustomDate && velocityDays === d ? 'bg-emerald-600 text-white border-emerald-600' : 'border-zinc-200 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'}`}
                                                    >{d}z</button>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">De la</label>
                                            <input type="date" value={velocityDateFrom} onChange={e => setVelocityDateFrom(e.target.value)}
                                                className={`px-2 py-1.5 text-sm rounded-lg border bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white ${isCustomDate ? 'border-emerald-500' : 'border-zinc-200 dark:border-zinc-600'}`} />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Până la</label>
                                            <input type="date" value={velocityDateTo} onChange={e => setVelocityDateTo(e.target.value)}
                                                className={`px-2 py-1.5 text-sm rounded-lg border bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white ${isCustomDate ? 'border-emerald-500' : 'border-zinc-200 dark:border-zinc-600'}`} />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Magazin</label>
                                            <select value={velocityStore} onChange={e => setVelocityStore(e.target.value)}
                                                className="px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white">
                                                <option value="">Toate</option>
                                                {stores.map(s => <option key={s.uid} value={s.uid}>{s.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Min. unități</label>
                                            <input type="number" value={velocityMinUnits} onChange={e => setVelocityMinUnits(Number(e.target.value) || 0)}
                                                className="w-20 px-2 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                        </div>
                                        <button onClick={fetchVelocity} disabled={velocityLoading}
                                            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5">
                                            {velocityLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                                            Analizează
                                        </button>
                                    </div>
                                    {velocityData?.meta && (
                                        <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                                            <span>📦 {velocityData.meta.total_orders?.toLocaleString()} comenzi totale</span>
                                            <span>📅 {velocityData.meta.period_days} zile</span>
                                            <span>🏷️ {velocityData.kpis?.unique_skus} SKU-uri active</span>
                                        </div>
                                    )}
                                </div>

                                {velocityLoading && (
                                    <div className="flex items-center justify-center py-12">
                                        <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
                                        <span className="ml-3 text-zinc-500 dark:text-white">Se analizează viteza vânzărilor...</span>
                                    </div>
                                )}

                                {velocityData && !velocityLoading && (
                                    <>
                                        {/* Section B: KPI Cards */}
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                                            {[
                                                { label: 'Unități Vândute', value: velocityData.kpis.total_units.toLocaleString(), icon: <Package className="w-5 h-5" />, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                                                { label: 'Revenue Total', value: `${velocityData.kpis.total_revenue.toLocaleString()} RON`, icon: <DollarSign className="w-5 h-5" />, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                                                { label: 'SKU-uri Active', value: velocityData.kpis.unique_skus, icon: <Tag className="w-5 h-5" />, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                                                { label: 'Unități / Zi', value: velocityData.kpis.avg_units_per_day, icon: <TrendingUp className="w-5 h-5" />, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
                                                { label: 'Avg Order Value', value: `${velocityData.kpis.avg_order_value} RON`, icon: <BarChart3 className="w-5 h-5" />, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                                                { label: 'Comenzi Livrate', value: velocityData.kpis.delivered_orders?.toLocaleString(), icon: <Truck className="w-5 h-5" />, color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
                                            ].map(kpi => (
                                                <div key={kpi.label} className={`${kpi.bg} rounded-xl border border-zinc-200 dark:border-zinc-700 p-4`}>
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className={kpi.color}>{kpi.icon}</span>
                                                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{kpi.label}</span>
                                                    </div>
                                                    <div className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Sub-navigation: Table / Charts / Alerts */}
                                        <div className="flex gap-2">
                                            {[
                                                { key: 'table', label: 'Tabel Produse', icon: <BarChart3 className="w-3.5 h-3.5" /> },
                                                { key: 'charts', label: 'Grafice & Tendințe', icon: <TrendingUp className="w-3.5 h-3.5" /> },
                                                { key: 'alerts', label: `Alerte (${velocityData.alerts?.length || 0})`, icon: <AlertTriangle className="w-3.5 h-3.5" /> },
                                            ].map(v => (
                                                <button key={v.key} onClick={() => setVelocityView(v.key)}
                                                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${velocityView === v.key ? 'bg-emerald-600 text-white border-emerald-600' : 'border-zinc-200 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'}`}>
                                                    {v.icon} {v.label}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Sub-view: PRODUCT TABLE */}
                                        {velocityView === 'table' && (
                                            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                                                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-2">
                                                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                                                        Performanță Produse — {sortedProducts.length} SKU-uri
                                                    </h3>
                                                    <div className="flex items-center gap-2">
                                                        <Search className="w-4 h-4 text-zinc-400" />
                                                        <input
                                                            type="text" value={velocitySearch} onChange={e => setVelocitySearch(e.target.value)}
                                                            placeholder="Caută SKU..."
                                                            className="w-48 px-2 py-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="overflow-x-auto">
                                                    <table className="w-full">
                                                        <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                                                            <tr>
                                                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-8">#</th>
                                                                <VSort col="sku" label="SKU" />
                                                                <VSort col="units_sold" label="Unități" tip="Total unități livrate" />
                                                                <VSort col="revenue" label="Revenue" tip="Venit total RON" />
                                                                <VSort col="margin" label="Marjă" tip="Revenue − COGS" />
                                                                <VSort col="margin_pct" label="Marjă %" />
                                                                <VSort col="orders" label="Comenzi" />
                                                                <VSort col="velocity" label="Viteză (u/zi)" tip="Unități vândute pe zi" />
                                                                <VSort col="velocity_change_pct" label="Trend" tip="Schimbare față de perioada anterioară" />
                                                                <VSort col="days_since_last_sale" label="Zile fără" tip="Zile de la ultima vânzare" />
                                                                <VSort col="revenue_share" label="Share %" tip="% din revenue total" />
                                                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Sparkline</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                                            {sortedProducts.length === 0 && (
                                                                <tr><td colSpan={12} className="px-4 py-8 text-center text-zinc-400">Nu sunt date. Apasă "Analizează".</td></tr>
                                                            )}
                                                            {sortedProducts.slice(0, 200).map((p, i) => (
                                                                <Fragment key={p.sku}>
                                                                    <tr className={`hover:bg-zinc-50 dark:hover:bg-zinc-700/30 cursor-pointer ${velocityExpanded === p.sku ? 'bg-zinc-50 dark:bg-zinc-700/30' : ''}`}
                                                                        onClick={() => setVelocityExpanded(velocityExpanded === p.sku ? null : p.sku)}>
                                                                        <td className="px-3 py-2 text-xs text-zinc-400">{i + 1}</td>
                                                                        <td className="px-3 py-2">
                                                                            <div className="text-sm font-medium text-zinc-900 dark:text-white">{p.sku}</div>
                                                                            {p.product_name && <div className="text-xs text-zinc-500 truncate max-w-[200px]">{p.product_name}</div>}
                                                                            {p.stores_count > 1 && <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full">{p.stores_count} magazine</span>}
                                                                        </td>
                                                                        <td className="px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">{p.units_sold.toLocaleString()}</td>
                                                                        <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">{p.revenue.toLocaleString()} <span className="text-[10px] text-zinc-400">RON</span></td>
                                                                        <td className={`px-3 py-2 text-sm font-medium ${p.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{p.margin.toLocaleString()}</td>
                                                                        <td className={`px-3 py-2 text-sm ${p.margin_pct >= 30 ? 'text-emerald-600' : p.margin_pct >= 10 ? 'text-amber-600' : 'text-red-600'}`}>{p.margin_pct}%</td>
                                                                        <td className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400">{p.orders}</td>
                                                                        <td className="px-3 py-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">{p.velocity}</td>
                                                                        <td className="px-3 py-2">
                                                                            <div className="flex items-center gap-1">
                                                                                {trendIcon(p.velocity_trend)}
                                                                                <span className={`text-xs font-medium ${p.velocity_change_pct > 0 ? 'text-emerald-600' : p.velocity_change_pct < 0 ? 'text-red-600' : 'text-zinc-400'}`}>
                                                                                    {p.velocity_change_pct > 0 ? '+' : ''}{p.velocity_change_pct}%
                                                                                </span>
                                                                            </div>
                                                                        </td>
                                                                        <td className={`px-3 py-2 text-sm ${p.days_since_last_sale !== null && p.days_since_last_sale >= 14 ? 'text-red-600 font-medium' : 'text-zinc-600 dark:text-zinc-400'}`}>
                                                                            {p.days_since_last_sale !== null ? `${p.days_since_last_sale}z` : '—'}
                                                                        </td>
                                                                        <td className="px-3 py-2 text-xs text-zinc-500">{p.revenue_share}%</td>
                                                                        <td className="px-3 py-2"><Sparkline data={p.daily_series} /></td>
                                                                    </tr>
                                                                    {/* Expanded detail */}
                                                                    {velocityExpanded === p.sku && (
                                                                        <tr className="bg-zinc-50 dark:bg-zinc-900/40">
                                                                            <td colSpan={12} className="px-4 py-4">
                                                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                                                    <div>
                                                                                        <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1"><Store className="w-3 h-3" /> Per Magazine</h5>
                                                                                        <div className="space-y-1">
                                                                                            {p.by_store.map(bs => (
                                                                                                <div key={bs.store_uid} className="flex justify-between text-xs bg-white dark:bg-zinc-800 rounded-lg px-2 py-1 border border-zinc-200 dark:border-zinc-700">
                                                                                                    <span className="text-zinc-700 dark:text-zinc-300">{bs.store_name}</span>
                                                                                                    <span className="text-zinc-600 dark:text-zinc-300">{bs.units} u | {bs.revenue.toLocaleString()} RON | {bs.orders} cmd.</span>
                                                                                                </div>
                                                                                            ))}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">🌍 Per Țară</h5>
                                                                                        <div className="space-y-1 text-xs">
                                                                                            {p.by_country.map(bc => (
                                                                                                <div key={bc.country} className="flex justify-between">
                                                                                                    <span className="text-zinc-600 dark:text-zinc-400">{COUNTRY_FLAGS[bc.country] || '🏳️'} {bc.country}</span>
                                                                                                    <span className="font-medium text-zinc-900 dark:text-white">{bc.units} u | {bc.revenue.toLocaleString()} RON</span>
                                                                                                </div>
                                                                                            ))}
                                                                                            {p.by_country.length === 0 && <div className="text-zinc-400">—</div>}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">📊 Detalii</h5>
                                                                                        <div className="space-y-1 text-xs">
                                                                                            <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Avg qty/order</span><span className="font-medium text-zinc-900 dark:text-white">{p.avg_qty_per_order}</span></div>
                                                                                            <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">COGS total</span><span className="font-medium text-zinc-900 dark:text-white">{p.cogs.toLocaleString()} RON</span></div>
                                                                                            <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Delivery rate</span><span className="font-medium text-zinc-900 dark:text-white">{p.delivery_rate}%</span></div>
                                                                                            <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Viteză anterioară</span><span className="font-medium text-zinc-900 dark:text-white">{p.prev_velocity} u/zi</span></div>
                                                                                            <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Viteză actuală</span><span className="font-medium text-emerald-600">{p.velocity} u/zi</span></div>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                </Fragment>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                {sortedProducts.length > 200 && (
                                                    <div className="px-4 py-2 text-xs text-zinc-400 text-center border-t border-zinc-200 dark:border-zinc-700">
                                                        Se afișează primele 200 din {sortedProducts.length} SKU-uri. Folosește filtrul pentru a restrânge lista.
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Sub-view: CHARTS & TRENDS */}
                                        {velocityView === 'charts' && (
                                            <div className="space-y-6">
                                                {/* Daily Sales Trend */}
                                                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-4 flex items-center gap-2">
                                                        <BarChart3 className="w-4 h-4 text-emerald-500" />
                                                        Trend Zilnic — Unități Vândute
                                                    </h3>
                                                    <TrendChart trends={velocityData.trends} />
                                                </div>

                                                {/* Top 10 Fastest-selling */}
                                                <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-4 flex items-center gap-2">
                                                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                                                        Top 10 — Cele mai rapide SKU-uri (u/zi)
                                                    </h3>
                                                    <div className="space-y-2">
                                                        {filteredProducts.slice(0, 10).map((p, i) => {
                                                            const maxV = filteredProducts[0]?.velocity || 1
                                                            const pct = (p.velocity / maxV) * 100
                                                            return (
                                                                <div key={p.sku} className="flex items-center gap-3">
                                                                    <span className="text-xs text-zinc-400 w-5 text-right">{i + 1}</span>
                                                                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 w-40 truncate" title={p.sku}>{p.sku}</span>
                                                                    <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                                                                        <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                                                    </div>
                                                                    <span className="text-xs font-bold text-emerald-600 w-16 text-right">{p.velocity} u/zi</span>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>

                                                {/* Growth vs Decline — Full tables with search/sort */}
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    {/* Growing */}
                                                    {(() => {
                                                        const allGrowing = filteredProducts.filter(p => p.velocity_change_pct > 0 && p.prev_velocity > 0)
                                                            .filter(p => !growthSearch || p.sku.toLowerCase().includes(growthSearch.toLowerCase()) || (p.product_name || '').toLowerCase().includes(growthSearch.toLowerCase()))
                                                            .sort((a, b) => growthSort === 'velocity_change_pct' ? b.velocity_change_pct - a.velocity_change_pct : growthSort === 'velocity' ? b.velocity - a.velocity : a.sku.localeCompare(b.sku))
                                                        return (
                                                            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                                                <h3 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-2">
                                                                    <ArrowUpRight className="w-4 h-4" /> 🚀 Cele mai în creștere ({allGrowing.length})
                                                                </h3>
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <input type="text" value={growthSearch} onChange={e => setGrowthSearch(e.target.value)} placeholder="Caută SKU..."
                                                                        className="flex-1 px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                                                    <select value={growthSort} onChange={e => setGrowthSort(e.target.value)}
                                                                        className="px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white">
                                                                        <option value="velocity_change_pct">% Schimbare</option>
                                                                        <option value="velocity">Viteză</option>
                                                                        <option value="sku">SKU</option>
                                                                    </select>
                                                                </div>
                                                                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                                                                    {allGrowing.map(p => (
                                                                        <div key={p.sku} className="flex items-center justify-between text-xs border-b border-zinc-100 dark:border-zinc-700/50 pb-1">
                                                                            <span className="text-zinc-700 dark:text-zinc-300 truncate mr-2" title={p.product_name}>{p.sku}</span>
                                                                            <div className="flex items-center gap-2 shrink-0">
                                                                                <span className="text-zinc-400">{p.prev_velocity} → {p.velocity}</span>
                                                                                <span className="font-bold text-emerald-600">+{p.velocity_change_pct}%</span>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                    {allGrowing.length === 0 && <div className="text-xs text-zinc-400 text-center py-2">Niciun produs</div>}
                                                                </div>
                                                            </div>
                                                        )
                                                    })()}
                                                    {/* Declining */}
                                                    {(() => {
                                                        const allDeclining = filteredProducts.filter(p => p.velocity_change_pct < 0 && p.prev_velocity > 0)
                                                            .filter(p => !declineSearch || p.sku.toLowerCase().includes(declineSearch.toLowerCase()) || (p.product_name || '').toLowerCase().includes(declineSearch.toLowerCase()))
                                                            .sort((a, b) => declineSort === 'velocity_change_pct' ? a.velocity_change_pct - b.velocity_change_pct : declineSort === 'velocity' ? b.velocity - a.velocity : a.sku.localeCompare(b.sku))
                                                        return (
                                                            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                                                                <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2 flex items-center gap-2">
                                                                    <ArrowDownRight className="w-4 h-4" /> 📉 Cele mai în scădere ({allDeclining.length})
                                                                </h3>
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <input type="text" value={declineSearch} onChange={e => setDeclineSearch(e.target.value)} placeholder="Caută SKU..."
                                                                        className="flex-1 px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                                                    <select value={declineSort} onChange={e => setDeclineSort(e.target.value)}
                                                                        className="px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white">
                                                                        <option value="velocity_change_pct">% Schimbare</option>
                                                                        <option value="velocity">Viteză</option>
                                                                        <option value="sku">SKU</option>
                                                                    </select>
                                                                </div>
                                                                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                                                                    {allDeclining.map(p => (
                                                                        <div key={p.sku} className="flex items-center justify-between text-xs border-b border-zinc-100 dark:border-zinc-700/50 pb-1">
                                                                            <span className="text-zinc-700 dark:text-zinc-300 truncate mr-2" title={p.product_name}>{p.sku}</span>
                                                                            <div className="flex items-center gap-2 shrink-0">
                                                                                <span className="text-zinc-400">{p.prev_velocity} → {p.velocity}</span>
                                                                                <span className="font-bold text-red-600">{p.velocity_change_pct}%</span>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                    {allDeclining.length === 0 && <div className="text-xs text-zinc-400 text-center py-2">Niciun produs</div>}
                                                                </div>
                                                            </div>
                                                        )
                                                    })()}
                                                </div>

                                                {/* Store Comparison — Expandable */}
                                                {velocityData.store_comparison?.length > 0 && (
                                                    <div>
                                                        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3 flex items-center gap-2">
                                                            <Store className="w-4 h-4" />
                                                            Comparație per Magazin
                                                        </h3>
                                                        <div className="space-y-3">
                                                            {velocityData.store_comparison.map(sc => {
                                                                const isExpanded = expandedStoreUid === sc.store_uid
                                                                const storeProducts = isExpanded ? filteredProducts
                                                                    .filter(p => p.by_store.some(bs => bs.store_uid === sc.store_uid))
                                                                    .map(p => {
                                                                        const bs = p.by_store.find(b => b.store_uid === sc.store_uid)
                                                                        return { ...p, store_units: bs?.units || 0, store_revenue: bs?.revenue || 0, store_orders: bs?.orders || 0 }
                                                                    })
                                                                    .sort((a, b) => b.store_units - a.store_units)
                                                                    : []
                                                                return (
                                                                    <div key={sc.store_uid} className={`bg-white dark:bg-zinc-800 rounded-xl border ${isExpanded ? 'border-emerald-500' : 'border-zinc-200 dark:border-zinc-700'} overflow-hidden transition-all`}>
                                                                        <div className="p-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/30" onClick={() => setExpandedStoreUid(isExpanded ? null : sc.store_uid)}>
                                                                            <div className="flex items-center justify-between mb-3">
                                                                                <h4 className="text-sm font-semibold text-zinc-800 dark:text-white flex items-center gap-2">
                                                                                    {sc.store_name}
                                                                                    {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                                                                                </h4>
                                                                                <span className="text-xs text-zinc-400">{sc.active_skus} SKU-uri</span>
                                                                            </div>
                                                                            <div className="grid grid-cols-4 gap-2 text-xs">
                                                                                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2">
                                                                                    <div className="text-zinc-500 dark:text-zinc-400">Unități</div>
                                                                                    <div className="text-lg font-bold text-emerald-600">{sc.units.toLocaleString()}</div>
                                                                                </div>
                                                                                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2">
                                                                                    <div className="text-zinc-500 dark:text-zinc-400">Revenue</div>
                                                                                    <div className="text-lg font-bold text-blue-600">{sc.revenue.toLocaleString()}</div>
                                                                                </div>
                                                                                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
                                                                                    <div className="text-zinc-500 dark:text-zinc-400">Viteză</div>
                                                                                    <div className="text-lg font-bold text-amber-600">{sc.velocity} u/zi</div>
                                                                                </div>
                                                                                <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-2">
                                                                                    <div className="text-zinc-500 dark:text-zinc-400">Comenzi</div>
                                                                                    <div className="text-lg font-bold text-indigo-600">{sc.orders.toLocaleString()}</div>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        {isExpanded && storeProducts.length > 0 && (
                                                                            <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-3">
                                                                                <div className="text-xs font-semibold text-zinc-400 uppercase mb-2">Toate produsele din {sc.store_name} ({storeProducts.length})</div>
                                                                                <div className="max-h-[350px] overflow-y-auto">
                                                                                    <table className="w-full text-xs">
                                                                                        <thead>
                                                                                            <tr className="text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
                                                                                                <th className="py-1 text-left">SKU</th>
                                                                                                <th className="py-1 text-right">Unități</th>
                                                                                                <th className="py-1 text-right">Revenue</th>
                                                                                                <th className="py-1 text-right">Comenzi</th>
                                                                                                <th className="py-1 text-right">Viteză</th>
                                                                                                <th className="py-1 text-right">Trend</th>
                                                                                            </tr>
                                                                                        </thead>
                                                                                        <tbody>
                                                                                            {storeProducts.map(p => (
                                                                                                <tr key={p.sku} className="border-b border-zinc-100 dark:border-zinc-700/50 hover:bg-zinc-50 dark:hover:bg-zinc-700/20">
                                                                                                    <td className="py-1.5 text-zinc-700 dark:text-zinc-300 font-medium">{p.sku}</td>
                                                                                                    <td className="py-1.5 text-right text-zinc-600 dark:text-zinc-400">{p.store_units.toLocaleString()}</td>
                                                                                                    <td className="py-1.5 text-right text-zinc-600 dark:text-zinc-400">{p.store_revenue.toLocaleString()} RON</td>
                                                                                                    <td className="py-1.5 text-right text-zinc-600 dark:text-zinc-400">{p.store_orders}</td>
                                                                                                    <td className="py-1.5 text-right font-bold text-emerald-600">{p.velocity}</td>
                                                                                                    <td className={`py-1.5 text-right font-medium ${p.velocity_change_pct > 0 ? 'text-emerald-600' : p.velocity_change_pct < 0 ? 'text-red-600' : 'text-zinc-400'}`}>
                                                                                                        {p.velocity_change_pct > 0 ? '+' : ''}{p.velocity_change_pct}%
                                                                                                    </td>
                                                                                                </tr>
                                                                                            ))}
                                                                                        </tbody>
                                                                                    </table>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Sub-view: ALERTS */}
                                        {velocityView === 'alerts' && (
                                            <div className="space-y-4">
                                                <div className="flex items-center gap-2">
                                                    <Search className="w-4 h-4 text-zinc-400" />
                                                    <input type="text" value={alertSearch} onChange={e => setAlertSearch(e.target.value)}
                                                        placeholder="Caută în alerte (SKU)..."
                                                        className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white" />
                                                </div>
                                                {(!velocityData.alerts || velocityData.alerts.length === 0) && (
                                                    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-8 text-center text-zinc-400">
                                                        Nu sunt alerte pentru perioada selectată.
                                                    </div>
                                                )}
                                                {['hot', 'new_star', 'declining', 'cold', 'dead_stock'].map(type => {
                                                    const typeAlerts = (velocityData.alerts || []).filter(a => a.type === type)
                                                        .filter(a => !alertSearch || a.sku.toLowerCase().includes(alertSearch.toLowerCase()))
                                                    if (typeAlerts.length === 0) return null
                                                    const config = {
                                                        hot: { emoji: '🔥', title: 'Produse Fierbinți', desc: 'Viteză crescută >50% vs. perioada anterioară', bg: 'bg-orange-50 dark:bg-orange-900/10', border: 'border-orange-200 dark:border-orange-800' },
                                                        new_star: { emoji: '🌟', title: 'Stele Noi', desc: 'Produse noi cu volum semnificativ de vânzări', bg: 'bg-yellow-50 dark:bg-yellow-900/10', border: 'border-yellow-200 dark:border-yellow-800' },
                                                        declining: { emoji: '⚠️', title: 'În Declin Rapid', desc: 'Viteză scăzută >40% vs. perioada anterioară', bg: 'bg-red-50 dark:bg-red-900/10', border: 'border-red-200 dark:border-red-800' },
                                                        cold: { emoji: '❄️', title: 'Produse Reci', desc: 'Fără vânzări în ultimele 14+ zile', bg: 'bg-blue-50 dark:bg-blue-900/10', border: 'border-blue-200 dark:border-blue-800' },
                                                        dead_stock: { emoji: '💀', title: 'Stoc Mort', desc: 'Au cost dar zero vânzări în perioadă', bg: 'bg-zinc-50 dark:bg-zinc-900/30', border: 'border-zinc-300 dark:border-zinc-600' },
                                                    }[type]
                                                    return (
                                                        <div key={type} className={`${config.bg} rounded-xl border ${config.border} p-4`}>
                                                            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
                                                                {config.emoji} {config.title} ({typeAlerts.length})
                                                            </h3>
                                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">{config.desc}</p>
                                                            <div className="space-y-1 max-h-[500px] overflow-y-auto">
                                                                {typeAlerts.map((a, i) => (
                                                                    <div key={`${a.sku}-${i}`} className="flex items-center justify-between text-xs bg-white/50 dark:bg-zinc-800/50 rounded-lg px-3 py-1.5">
                                                                        <span className="font-medium text-zinc-700 dark:text-zinc-300">{a.sku}</span>
                                                                        <span className="text-zinc-500 dark:text-zinc-400">{a.message}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )
                    })()}
                </>
            )
            }
        </div >
    )
}