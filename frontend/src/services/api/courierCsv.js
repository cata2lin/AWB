/** Courier CSV API — import, status polling, history, estimation, and re-import. */
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
    /** Re-import a previously archived CSV with current parsing logic */
    reimportCsv: async (importId) => {
        const { data } = await api.post(`/courier-csv/reimport/${importId}`)
        return data
    },
    /** Available courier presets */
    presets: ['sameday', 'packeta', 'speedy', 'dpd'],
    /** Scan the server's CSV folder for available files */
    scanFolder: async () => {
        const { data } = await api.get('/courier-csv/scan-folder')
        return data
    },
    /** Bulk-import all CSVs from the server's CSV folder */
    importFolder: async () => {
        const { data } = await api.post('/courier-csv/import-folder')
        return data
    },
}
