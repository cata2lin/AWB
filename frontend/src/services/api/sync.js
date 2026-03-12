/** Sync API — sync status, trigger, and history. */
import api from './client'

export const syncApi = {
    getStatus: async () => {
        const { data } = await api.get('/sync/status')
        return data
    },
    triggerSync: async () => {
        const { data } = await api.post('/sync/trigger')
        return data
    },
    getHistory: async (limit = 10) => {
        const { data } = await api.get('/sync/history', { params: { limit } })
        return data
    },
}
