/**
 * Analytics Page - Tab Router
 *
 * Thin parent that owns the active-tab URL state and the shared `stores` list,
 * then delegates rendering to per-tab components under `pages/analytics/`.
 */

// Auth helper for raw fetch calls (still used by DetailedPnl)
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
import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
    TrendingUp, Package, BarChart3, Printer, PieChart,
    DollarSign, Tag, AlertTriangle, TrendingDown
} from 'lucide-react'
import { storesApi } from '../services/api'
import ProductsTab from '../components/ProductsTab'
import PrintHistoryTab from '../components/PrintHistoryTab'

import DetailedPnl from '../components/DetailedPnl'
import ProductDeliverabilityTab from '../components/ProductDeliverabilityTab'
import SkuCostsTab from './analytics/SkuCostsTab'
import DeliverabilityTab from './analytics/DeliverabilityTab'
import SkuRiskTab from './analytics/SkuRiskTab'
import ProfitabilityTab from './analytics/ProfitabilityTab'
import SkuProfitabilityTab from './analytics/SkuProfitabilityTab'
import SalesVelocityTab from './analytics/SalesVelocityTab'

export default function Analytics() {
    // Stores list shared with every tab
    const [stores, setStores] = useState([])

    // Filters: read-only at the parent level (tabs that need to mutate them own
    // their own state). Kept here purely to pass stable defaults down.
    const [selectedStores] = useState([])
    const [days] = useState(30)

    // Active tab synced to ?tab= query param
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

    // Sync tab from URL on back/forward navigation. The set-state-in-effect
    // rule is overly conservative here — this *is* the external-system sync
    // (URL <-> tab state) the rule's docs describe.
    useEffect(() => {
        const urlTab = searchParams.get('tab') || 'deliverability'
        // eslint-disable-next-line react-hooks/set-state-in-effect
        _setActiveTab(urlTab)
    }, [searchParams])

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

            {/* Tab Router — each tab is self-contained and manages its own loading state */}
            {activeTab === 'print' && <PrintHistoryTab />}
            {activeTab === 'deliverability' && <DeliverabilityTab selectedStores={selectedStores} />}
            {activeTab === 'profitability' && <ProfitabilityTab stores={stores} selectedStores={selectedStores} days={days} />}
            {activeTab === 'pnlDetailed' && <DetailedPnl authFetch={authFetch} />}
            {activeTab === 'skuCosts' && <SkuCostsTab />}
            {activeTab === 'skuRisk' && <SkuRiskTab stores={stores} />}
            {activeTab === 'salesVelocity' && <SalesVelocityTab stores={stores} />}
            {activeTab === 'skuProfit' && <SkuProfitabilityTab stores={stores} />}
            {activeTab === 'products' && <ProductsTab stores={stores} />}
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
        </div>
    )
}
