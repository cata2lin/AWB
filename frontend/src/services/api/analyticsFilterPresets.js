/** Analytics filter presets API — shared (server-stored) named filter sets per report. */
import api from './client'

export const analyticsFilterPresetsApi = {
    list: async (reportKey) => {
        const { data } = await api.get('/analytics-filter-presets', {
            params: { report_key: reportKey },
        })
        return data
    },
    create: async (preset) => {
        const { data } = await api.post('/analytics-filter-presets', preset)
        return data
    },
    update: async (id, patch) => {
        const { data } = await api.put(`/analytics-filter-presets/${id}`, patch)
        return data
    },
    delete: async (id) => {
        const { data } = await api.delete(`/analytics-filter-presets/${id}`)
        return data
    },
    setDefault: async (id) => {
        const { data } = await api.post(`/analytics-filter-presets/${id}/set-default`)
        return data
    },
}
