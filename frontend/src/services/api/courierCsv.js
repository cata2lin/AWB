/** Courier CSV API — import, status polling, history, and estimation. */
import api from './client'

export const courierCsvApi = {
    importCsv: async (file, courierName, onProgress = null) => {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('courier_name', courierName)

        const { data } = await api.post('/courier-csv/import', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000,
            onUploadProgress: onProgress ? (e) => {
                const pct = Math.round((e.loaded * 100) / (e.total || 1))
                onProgress(pct)
            } : undefined,
        })
        return data
    },
    getImportStatus: async (importId) => {
        const { data } = await api.get(`/courier-csv/import/${importId}/status`)
        return data
    },
    getImportHistory: async (limit = 20) => {
        const { data } = await api.get('/courier-csv/imports', { params: { limit } })
        return data
    },
    triggerEstimation: async () => {
        const { data } = await api.post('/courier-csv/estimate-missing')
        return data
    },
    /** Available courier presets */
    presets: ['sameday', 'packeta', 'speedy', 'dpd'],
}
