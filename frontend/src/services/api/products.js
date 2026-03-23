/**
 * Products API service — grouped inventory from Frisbo.
 */
import api from './client'

export const productsApi = {
    /** List products (ungrouped) */
    getProducts: async (params = {}) => {
        const { data } = await api.get('/products/', { params })
        return data
    },

    /** List products grouped by barcode/SKU */
    getGroupedProducts: async (params = {}) => {
        const { data } = await api.get('/products/grouped/', { params })
        return data
    },

    /** Stats/KPIs */
    getStats: async () => {
        const { data } = await api.get('/products/stats/')
        return data
    },

    /** Single product */
    getProduct: async (uid) => {
        const { data } = await api.get(`/products/${uid}`)
        return data
    },

    /** Toggle exclude_from_stock */
    toggleExclude: async (uid, exclude) => {
        const { data } = await api.patch(`/products/${uid}/exclude`, { exclude })
        return data
    },

    /** Set primary listing for a group */
    setPrimary: async (productUid, primaryUid) => {
        const { data } = await api.patch(`/products/${productUid}/set-primary`, { primary_uid: primaryUid })
        return data
    },

    /** Trigger product sync */
    triggerSync: async () => {
        const { data } = await api.post('/sync/trigger-products')
        return data
    },

    /** Export to Excel (returns blob) */
    exportExcel: async (params = {}) => {
        const response = await api.get('/products/export/excel', {
            params,
            responseType: 'blob',
        })
        // Trigger download
        const url = window.URL.createObjectURL(new Blob([response.data]))
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', 'produse_export.xlsx')
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.URL.revokeObjectURL(url)
    },

    /** Download COGS import template */
    downloadCogsTemplate: async () => {
        const response = await api.get('/products/import/cogs-template', {
            responseType: 'blob',
        })
        const url = window.URL.createObjectURL(new Blob([response.data]))
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', 'cogs_template.xlsx')
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.URL.revokeObjectURL(url)
    },

    /** Import COGS from Excel file */
    importCogsExcel: async (file) => {
        const formData = new FormData()
        formData.append('file', file)
        const { data } = await api.post('/products/import/cogs', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        })
        return data
    },
}

