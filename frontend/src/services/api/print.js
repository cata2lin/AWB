/** Print API — preview, batch generation, download, history, and reprint. */
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
    getReprintUrl: (batchId) => {
        const token = localStorage.getItem('awb_token')
        return `${API_BASE_URL}/print/reprint/${batchId}${token ? `?token=${token}` : ''}`
    },
    /** Fetch batch history with optional filters */
    getHistory: async ({ skip = 0, limit = 20, search, status, date_from, date_to, sort_by, sort_dir } = {}) => {
        const params = { skip, limit }
        if (search) params.search = search
        if (status) params.status = status
        if (date_from) params.date_from = date_from
        if (date_to) params.date_to = date_to
        if (sort_by) params.sort_by = sort_by
        if (sort_dir) params.sort_dir = sort_dir
        const { data } = await api.get('/print/history', { params })
        return data
    },
    getBatchDetails: async (batchId) => {
        const { data } = await api.get(`/print/history/${batchId}`)
        return data
    },
    /** Reprint a single order (re-download AWB, no status change) */
    reprintOrder: (orderUid) => {
        const token = localStorage.getItem('awb_token')
        const url = `${API_BASE_URL}/print/reprint-order/${orderUid}${token ? `?token=${token}` : ''}`
        window.open(url, '_blank')
    },
}
