/** Analytics API — all analytics endpoints (summary, geographic, deliverability, profitability, sku-risk). */
import api from './client'

export const analyticsApi = {
    getAnalytics: async (days = 30) => {
        const { data } = await api.get('/analytics', { params: { days } })
        return data
    },
    getSummary: async () => {
        const { data } = await api.get('/analytics/summary')
        return data
    },
    getGeographic: async (params = {}) => {
        const { data } = await api.get('/analytics/geographic', { params })
        return data
    },
    getDeliverability: async (params = {}) => {
        const { data } = await api.get('/analytics/deliverability', { params })
        return data
    },
    getProfitability: async (params = {}) => {
        const { data } = await api.get('/analytics/profitability', { params })
        return data
    },
    getSkuRisk: async (params = {}) => {
        const { data } = await api.get('/analytics/sku-risk', { params })
        return data
    },
    getSalesVelocity: async (params = {}) => {
        const { data } = await api.get('/analytics/sales-velocity', { params })
        return data
    },
    getSkuProfitability: async (params = {}) => {
        const { data } = await api.get('/analytics/sku-profitability', { params })
        return data
    },
    getCsvCoverageGaps: async (params = {}) => {
        const { data } = await api.get('/analytics/csv-coverage-gaps', { params })
        return data
    },
    getPurchaseOrders: async (params = {}) => {
        const { data } = await api.get('/analytics/purchase-orders', { params })
        return data
    },
}

/** Purchase Order management — CRUD operations. */
export const purchaseOrdersMgmtApi = {
    list: async (params = {}) => {
        const { data } = await api.get('/purchase-orders-mgmt/list', { params })
        return data
    },
    get: async (id) => {
        const { data } = await api.get(`/purchase-orders-mgmt/${id}`)
        return data
    },
    create: async (body) => {
        const { data } = await api.post('/purchase-orders-mgmt/create', body)
        return data
    },
    update: async (id, body) => {
        const { data } = await api.put(`/purchase-orders-mgmt/${id}`, body)
        return data
    },
    updateItems: async (id, items) => {
        const { data } = await api.put(`/purchase-orders-mgmt/${id}/items`, items)
        return data
    },
    receive: async (id, items) => {
        const { data } = await api.put(`/purchase-orders-mgmt/${id}/receive`, items)
        return data
    },
    delete: async (id) => {
        const { data } = await api.delete(`/purchase-orders-mgmt/${id}`)
        return data
    },
    getIncomingStock: async () => {
        const { data } = await api.get('/purchase-orders-mgmt/incoming-stock')
        return data
    },
}

/** Barcode management — generation and registry. */
export const barcodesApi = {
    getMissing: async (params = {}) => {
        const { data } = await api.get('/purchase-orders-mgmt/barcodes/missing', { params })
        return data
    },
    generate: async (skus) => {
        const { data } = await api.post('/purchase-orders-mgmt/barcodes/generate', { skus })
        return data
    },
    getRegistry: async () => {
        const { data } = await api.get('/purchase-orders-mgmt/barcodes/registry')
        return data
    },
}

export const skuMarketingCostsApi = {
    list: async (params = {}) => {
        const { data } = await api.get('/sku-marketing-costs', { params })
        return data
    },
    create: async (entry) => {
        const { data } = await api.post('/sku-marketing-costs', entry)
        return data
    },
    update: async (id, entry) => {
        const { data } = await api.put(`/sku-marketing-costs/${id}`, entry)
        return data
    },
    delete: async (id) => {
        const { data } = await api.delete(`/sku-marketing-costs/${id}`)
        return data
    },
}
