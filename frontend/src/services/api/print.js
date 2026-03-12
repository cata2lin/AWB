/** Print API — preview, batch generation, download, and history. */
import api, { API_BASE_URL } from './client'

export const printApi = {
    getPreview: async (storeUids = null, orderUids = null, limit = null) => {
        const { data } = await api.post('/print/preview', {
            store_uids: storeUids,
            order_uids: orderUids,
            limit: limit,
        })
        return data
    },
    generateBatch: async (orderUids) => {
        const { data } = await api.post('/print/generate', orderUids)
        return data
    },
    getDownloadUrl: (batchId) => {
        return `${API_BASE_URL}/print/download/${batchId}`
    },
    getHistory: async (skip = 0, limit = 20) => {
        const { data } = await api.get('/print/history', { params: { skip, limit } })
        return data
    },
    getBatchDetails: async (batchId) => {
        const { data } = await api.get(`/print/history/${batchId}`)
        return data
    },
}
