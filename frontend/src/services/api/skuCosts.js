/** SKU Costs API — CRUD, bulk upsert, and discovery. */
import api from './client'

export const skuCostsApi = {
    getSkuCosts: async (params = {}) => {
        const { data } = await api.get('/sku-costs', { params })
        return data
    },
    createSkuCost: async (skuCost) => {
        const { data } = await api.post('/sku-costs', skuCost)
        return data
    },
    updateSkuCost: async (sku, updates) => {
        const { data } = await api.put(`/sku-costs/${sku}`, updates)
        return data
    },
    deleteSkuCost: async (sku) => {
        const { data } = await api.delete(`/sku-costs/${sku}`)
        return data
    },
    bulkUpsert: async (skus) => {
        const { data } = await api.post('/sku-costs/bulk', { skus })
        return data
    },
    discoverSkus: async () => {
        const { data } = await api.get('/sku-costs/discover')
        return data
    },
}
