/** Rules API — rule CRUD, reordering, and toggle. */
import api from './client'

export const rulesApi = {
    getRules: async () => {
        const { data } = await api.get('/rules')
        return data
    },
    getRule: async (id) => {
        const { data } = await api.get(`/rules/${id}`)
        return data
    },
    createRule: async (rule) => {
        const { data } = await api.post('/rules', rule)
        return data
    },
    updateRule: async (id, updates) => {
        const { data } = await api.patch(`/rules/${id}`, updates)
        return data
    },
    deleteRule: async (id) => {
        const { data } = await api.delete(`/rules/${id}`)
        return data
    },
    reorderRules: async (ruleIds) => {
        const { data } = await api.post('/rules/reorder', { rule_ids: ruleIds })
        return data
    },
    toggleRule: async (id) => {
        const { data } = await api.post(`/rules/${id}/toggle`)
        return data
    },
}
