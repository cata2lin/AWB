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
    /** Print a single order — downloads AWB, marks printed, notifies Frisbo */
    printSingle: async (orderUid) => {
        const { data } = await api.post(`/print/single/${orderUid}`)
        return data
    },
    /** Re-download AWB without changing status — for reprinting */
    regenerate: async (orderUid) => {
        const { data } = await api.post(`/print/regenerate/${orderUid}`)
        return data
    },
    getDownloadUrl: (batchId) => {
        const token = localStorage.getItem('awb_token')
        return `${API_BASE_URL}/print/download/${batchId}${token ? `?token=${token}` : ''}`
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

