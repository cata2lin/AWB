/** Business Costs API — monthly cost management. */
import api from './client'

export const businessCostsApi = {
    getCosts: async (month = null) => {
        const params = {}
        if (month) params.month = month
        const { data } = await api.get('/business-costs', { params })
        return data
    },
    createCost: async (costData) => {
        const { data } = await api.post('/business-costs', costData)
        return data
    },
    updateCost: async (id, updates) => {
        const { data } = await api.put(`/business-costs/${id}`, updates)
        return data
    },
    deleteCost: async (id) => {
        const { data } = await api.delete(`/business-costs/${id}`)
        return data
    },
    cloneMonth: async (fromMonth, toMonth) => {
        const { data } = await api.post('/business-costs/clone-month', {
            from_month: fromMonth,
            to_month: toMonth,
        })
        return data
    },
    getCategories: async () => {
        const { data } = await api.get('/business-costs/categories')
        return data
    },
    getMonths: async () => {
        const { data } = await api.get('/business-costs/months')
        return data
    },
    reorder: async (items) => {
        const { data } = await api.patch('/business-costs/reorder', items)
        return data
    },
    getPnlSections: async () => {
        const { data } = await api.get('/business-costs/pnl-sections')
        return data
    },
}
