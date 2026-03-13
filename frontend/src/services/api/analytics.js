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
}
