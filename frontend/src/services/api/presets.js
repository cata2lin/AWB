/** Presets API — rule preset CRUD and loading. */
import api from './client'

export const presetsApi = {
    getPresets: async () => {
        const { data } = await api.get('/presets')
        return data
    },
    getActivePreset: async () => {
        const { data } = await api.get('/presets/active')
        return data
    },
    getPreset: async (id) => {
        const { data } = await api.get(`/presets/${id}`)
        return data
    },
    savePreset: async (preset) => {
        const { data } = await api.post('/presets', preset)
        return data
    },
    loadPreset: async (id) => {
        const { data } = await api.post(`/presets/${id}/load`)
        return data
    },
    deletePreset: async (id) => {
        const { data } = await api.delete(`/presets/${id}`)
        return data
    },
}
