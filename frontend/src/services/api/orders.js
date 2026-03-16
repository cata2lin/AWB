/** Orders API — CRUD operations and shipping data updates. */
import api from './client'

export const ordersApi = {
    getOrders: async (params = {}) => {
        const { data } = await api.get('/orders', { params })
        return data
    },
    getOrderCount: async (params = {}) => {
        const { data } = await api.get('/orders/count', { params })
        return data
    },
    getOrderTotals: async (params = {}) => {
        const { data } = await api.get('/orders/totals', { params })
        return data
    },
    getStats: async () => {
        const { data } = await api.get('/orders/stats')
        return data
    },
    getOrder: async (uid) => {
        const { data } = await api.get(`/orders/${uid}`)
        return data
    },
    updateShippingData: async (uid, { package_count, package_weight, transport_cost }) => {
        const params = new URLSearchParams()
        if (package_count !== undefined && package_count !== null) params.set('package_count', package_count)
        if (package_weight !== undefined && package_weight !== null) params.set('package_weight', package_weight)
        if (transport_cost !== undefined && transport_cost !== null) params.set('transport_cost', transport_cost)
        const { data } = await api.patch(`/orders/${uid}/shipping?${params}`)
        return data
    },
    getOrderAwbs: async (uid) => {
        const { data } = await api.get(`/orders/${uid}/awbs`)
        return data
    },
}

export const orderActionsApi = {
    updateAwbCount: async (orderUid, awbCount) => {
        const { data } = await api.patch(`/orders/${orderUid}/awb-count`, null, {
            params: { awb_count: awbCount }
        })
        return data
    },
    updateShipping: async (orderUid, shippingData) => {
        const { data } = await api.patch(`/orders/${orderUid}/shipping`, null, {
            params: shippingData
        })
        return data
    },
    markAllPrinted: async () => {
        const { data } = await api.post('/orders/mark-all-printed')
        return data
    },
}
