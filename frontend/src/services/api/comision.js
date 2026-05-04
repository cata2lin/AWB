/**
 * Comision Agentie API service — agency commission report endpoints.
 */
import client from './client'

export const comisionApi = {
    /**
     * Get commission data for a given month.
     * @param {string} month - YYYY-MM format
     * @param {number} [comisionPct] - Override commission percentage
     */
    async getComision(month, comisionPct) {
        const params = {}
        if (month) params.month = month
        if (comisionPct != null) params.comision_pct = comisionPct
        const { data } = await client.get('/comision-agentie', { params })
        return data
    },

    /** Get saved commission configuration + all stores for toggles. */
    async getConfig() {
        const { data } = await client.get('/comision-agentie/config')
        return data
    },

    /**
     * Update commission configuration.
     * @param {{ comision_pct: number, enabled_store_uids: string[] }} config
     */
    async updateConfig(config) {
        const { data } = await client.put('/comision-agentie/config', config)
        return data
    },

    /**
     * Get CSV export URL for download.
     * @param {string} month
     * @param {number} [comisionPct]
     */
    getExportUrl(month, comisionPct) {
        const params = new URLSearchParams()
        if (month) params.set('month', month)
        if (comisionPct != null) params.set('comision_pct', comisionPct)
        const token = localStorage.getItem('awb_token')
        if (token) params.set('token', token)
        return `/api/comision-agentie/export?${params.toString()}`
    },
}

