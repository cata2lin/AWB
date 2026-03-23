/** Sync API — sync status, trigger, cancel, and history. */
import api from './client'

export const syncApi = {
    getStatus: async () => {
        const { data } = await api.get('/sync/status')
        return data
    },
    triggerSync: async ({ sync_type = '45_day', store_uids, date_from, date_to } = {}) => {
        const { data } = await api.post('/sync/trigger', {
            sync_type,
            store_uids: store_uids || null,
            date_from: date_from || null,
            date_to: date_to || null,
        })
        return data
    },
    cancelSync: async () => {
        const { data } = await api.post('/sync/cancel')
        return data
    },
    getHistory: async (limit = 20) => {
        const { data } = await api.get('/sync/history', { params: { limit } })
        return data
    },
}
