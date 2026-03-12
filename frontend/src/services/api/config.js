/** Config APIs — profitability config, health check, exchange rates. */
import api from './client'

export const profitabilityConfigApi = {
    getConfig: async () => {
        const { data } = await api.get('/profitability-config')
        return data
    },
    updateConfig: async (configData) => {
        const { data } = await api.put('/profitability-config', configData)
        return data
    },
}

export const healthApi = {
    check: async () => {
        const { data } = await api.get('/health')
        return data
    },
}
