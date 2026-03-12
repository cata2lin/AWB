/** Stores API — store listing and management. */
import api from './client'

export const storesApi = {
    getStores: async () => {
        const { data } = await api.get('/stores')
        return data
    },
    getStats: async () => {
        const { data } = await api.get('/stores/stats')
        return data
    },
    createStore: async (store) => {
        const { data } = await api.post('/stores', store)
        return data
    },
    updateStore: async (uid, updates) => {
        const { data } = await api.patch(`/stores/${uid}`, updates)
        return data
    },
}
