/**
 * Analytics Page - Print Analytics, Geographic Distribution & Deliverability Report
 * 
 * Features:
 * - Print analytics with charts
 * - Geographic distribution charts showing order distribution by country/city
 * - Deliverability report per store with period comparison
 */

// Auth helper for raw fetch calls
const authFetch = (url, opts = {}) => {
    const token = localStorage.getItem('awb_token')
    return fetch(url, {
        ...opts,
        headers: {
            ...opts.headers,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    })
}
import { useState, useEffect, useMemo, Fragment, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
    Globe2, TrendingUp, Package, Truck, XCircle, RotateCcw,
    ChevronDown, ChevronUp, RefreshCw, Filter, BarChart3, Store, Printer,
    Calendar, ArrowRight, ArrowUpRight, ArrowDownRight, PieChart, MapPin,
    DollarSign, Tag, Save, Plus, Trash2, Search, AlertTriangle, Info, Edit2,
    Eye, EyeOff, Settings2, Download, ArrowUpDown, Bookmark, X, TrendingDown
} from 'lucide-react'
import { exportPnlToExcel } from '../utils/pnlExport'
import {
    getRateColor, getRateBgColor, formatNumber, formatMoney,
    marginColor, marginBg, getLastCompleteMonth,
} from '../utils/analyticsHelpers'
import { storesApi, analyticsApi, profitabilityConfigApi } from '../services/api'
import ProductsTab from '../components/ProductsTab'
import PrintHistoryTab from '../components/PrintHistoryTab'

import ContributionMarginPnl from '../components/ContributionMarginPnl'
import DetailedPnl from '../components/DetailedPnl'
import ProductDeliverabilityTab from '../components/ProductDeliverabilityTab'
import SkuCostsTab from './analytics/SkuCostsTab'
import DeliverabilityTab from './analytics/DeliverabilityTab'
import SkuRiskTab from './analytics/SkuRiskTab'
import ProfitabilityTab from './analytics/ProfitabilityTab'
import SkuProfitabilityTab from './analytics/SkuProfitabilityTab'
import SalesVelocityTab from './analytics/SalesVelocityTab'

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
    // deliverabilityData, comparisonData moved into DeliverabilityTab
    const [printAnalytics, setPrintAnalytics] = useState(null)
    const [isLoading, setIsLoading] = useState(true)
    const [searchParams, setSearchParams] = useSearchParams()
    const [activeTab, _setActiveTab] = useState(() => searchParams.get('tab') || 'deliverability')
    const setActiveTab = useCallback((tab) => {
        _setActiveTab(tab)
        setSearchParams(prev => {
            const next = new URLSearchParams(prev)
            if (tab === 'deliverability') next.delete('tab')
            else next.set('tab', tab)
            return next
        }, { replace: true })
    }, [setSearchParams])

    // Sync tab from URL on back/forward navigation
    useEffect(() => {
        const urlTab = searchParams.get('tab') || 'deliverability'
        _setActiveTab(urlTab)
    }, [searchParams])

    // Helper: returns true for all columns (column visibility is always on)
    const isColVisible = useCallback(() => true, [])
    // showComparison moved into DeliverabilityTab

    // SKU Costs state moved into SkuCostsTab

    // Profitability state moved into ProfitabilityTab
    const [showCalcLegend, setShowCalcLegend] = useState(false)

    // Deliverability state moved into DeliverabilityTab
    // Sales Velocity state (incl. draft POs, advanced filters, saved views,
    // PO-generation selection, and selectedVariantOrders modal) moved into SalesVelocityTab

    // SKU Profitability state moved into SkuProfitabilityTab

    // Top SKUs table state

    // (Marketing costs moved to Business Costs management)

    // SKU costs filter & bulk edit state moved into SkuCostsTab

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

                const API_URL = import.meta.env.VITE_API_URL || '/api'

                // Fetch geo & print (deliverability has its own dedicated fetch now)
                const [geoRes, printRes] = await Promise.all([
                    authFetch(`${API_URL}/analytics/geographic?${params}`).then(r => r.json()),
                    analyticsApi.getAnalytics(days || 30),
                ])

                setGeoData(geoRes)
                setPrintAnalytics(printRes)
                setIsLoading(false)

                // Profitability is NOT auto-fetched — user must click "Analizează"
            } catch (err) {
                console.error('Failed to fetch analytics:', err)
                setIsLoading(false)
            }
        }
        fetchData()
    }, [selectedStores, days, effectiveDateRange])

    // Velocity auto-load useEffect moved into SalesVelocityTab

    // fetchDeliverability + its useEffect moved into DeliverabilityTab

    // Profitability fetchers + marketing-cost useEffect moved into ProfitabilityTab

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
                <a
                    href="/analytics"
                    onClick={(e) => { e.preventDefault(); setActiveTab('deliverability') }}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'deliverability'
                        ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <TrendingUp className="w-4 h-4 inline mr-2" />
                    Livrabilitate
                </a>
                <a
                    href="/analytics?tab=profitability"
                    onClick={(e) => { e.preventDefault(); setActiveTab('profitability') }}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'profitability'
                        ? 'bg-white dark:bg-zinc-700 text-green-600 dark:text-green-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <DollarSign className="w-4 h-4 inline mr-2" />
                    Profitabilitate
                </a>
                <a
                    href="/analytics?tab=pnlDetailed"
                    onClick={(e) => { e.preventDefault(); setActiveTab('pnlDetailed') }}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'pnlDetailed'
                        ? 'bg-white dark:bg-zinc-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <BarChart3 className="w-4 h-4 inline mr-2" />
                    P&L Detaliat
                </a>
                <a
                    href="/analytics?tab=skuCosts"
                    onClick={(e) => { e.preventDefault(); setActiveTab('skuCosts') }}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'skuCosts'
                        ? 'bg-white dark:bg-zinc-700 text-purple-600 dark:text-purple-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <Tag className="w-4 h-4 inline mr-2" />
                    Costuri SKU
                </a>

                <a
                    href="/analytics?tab=print"
                    onClick={(e) => { e.preventDefault(); setActiveTab('print') }}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'print'
                        ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <Printer className="w-4 h-4 inline mr-2" />
                    Print Analytics
                </a>

                <a
                    href="/analytics?tab=skuRisk"
                    onClick={(e) => { e.preventDefault(); setActiveTab('skuRisk') }}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'skuRisk'
                        ? 'bg-white dark:bg-zinc-700 text-red-600 dark:text-red-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <AlertTriangle className="w-4 h-4 inline mr-2" />
                    SKU Risk
                </a>
                <a
                    href="/analytics?tab=salesVelocity"
                    onClick={(e) => { e.preventDefault(); setActiveTab('salesVelocity') }}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'salesVelocity'
                        ? 'bg-white dark:bg-zinc-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <TrendingUp className="w-4 h-4 inline mr-2" />
                    Viteză Vânzări
                </a>
                <a
                    href="/analytics?tab=skuProfit"
                    onClick={(e) => { e.preventDefault(); setActiveTab('skuProfit') }}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'skuProfit'
                        ? 'bg-white dark:bg-zinc-700 text-amber-600 dark:text-amber-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <PieChart className="w-4 h-4 inline mr-2" />
                    Profitabilitate SKU
                </a>
                <a
                    href="/analytics?tab=products"
                    onClick={(e) => { e.preventDefault(); setActiveTab('products') }}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'products'
                        ? 'bg-white dark:bg-zinc-700 text-cyan-600 dark:text-cyan-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <Package className="w-4 h-4 inline mr-2" />
                    Produse
                </a>
                <a
                    href="/analytics?tab=productDeliverability"
                    onClick={(e) => { e.preventDefault(); setActiveTab('productDeliverability') }}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${activeTab === 'productDeliverability'
                        ? 'bg-white dark:bg-zinc-700 text-rose-600 dark:text-rose-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-700/30'
                        }`}
                >
                    <TrendingDown className="w-4 h-4 inline mr-2" />
                    Livrabilitate Produse
                </a>
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
                    {activeTab === 'print' && <PrintHistoryTab />}

                    {/* Deliverability Report Tab */}
                    {activeTab === 'deliverability' && <DeliverabilityTab selectedStores={selectedStores} />}

                    {/* Profitability Tab */}
                    {activeTab === 'profitability' && <ProfitabilityTab stores={stores} selectedStores={selectedStores} days={days} />}

                    {/* P&L Detaliat Tab */}
                    {activeTab === 'pnlDetailed' && (
                        <DetailedPnl authFetch={authFetch} />
                    )}

                    {/* SKU Costs Tab */}
                    {activeTab === 'skuCosts' && <SkuCostsTab />}


                    {/* ══ SKU Risk & Shipping Anomalies Tab ══ */}
                    {activeTab === 'skuRisk' && <SkuRiskTab stores={stores} />}

                    {/* ══ Sales Velocity & Product Analytics Tab ══ */}
                    {activeTab === 'salesVelocity' && <SalesVelocityTab stores={stores} />}
                    {/* === SKU Profitability Tab === */}
                    {activeTab === 'skuProfit' && <SkuProfitabilityTab stores={stores} />}
                    {/* Products/Inventory Tab */}
                    {activeTab === 'products' && (
                        <ProductsTab stores={stores} />
                    )}

                </>
            )
            }
            {activeTab === 'productDeliverability' && (
                <div className="space-y-5 mt-4">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/20 flex-shrink-0">
                            <TrendingDown className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Livrabilitate Produse</h2>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">Rata de livrare, return și anulare per produs individual</p>
                        </div>
                    </div>
                    <ProductDeliverabilityTab selectedStores={selectedStores} />
                </div>
            )}
        </div >
    )
}
