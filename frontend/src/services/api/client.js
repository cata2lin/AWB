/**
 * Shared Axios client — single source of truth for API base URL and config.
 * 
 * All API modules import this client instead of creating their own.
 */
import axios from 'axios'

// API base URL - uses nginx proxy in production, direct in dev
export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    // Custom serializer for arrays - FastAPI expects repeated param names, not brackets
    paramsSerializer: {
        serialize: (params) => {
            const searchParams = new URLSearchParams()
            for (const [key, value] of Object.entries(params)) {
                if (value === undefined || value === null || value === '') continue
                if (Array.isArray(value)) {
                    // Repeat the param for each array element
                    value.forEach(v => searchParams.append(key, v))
                } else {
                    searchParams.append(key, value)
                }
            }
            return searchParams.toString()
        }
    }
})

// ═══ Auth interceptor: attach JWT token to every request ═══
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('awb_token')
    if (token) {
        config.headers.Authorization = `Bearer ${token}`
    }
    return config
})

// ═══ Response interceptor: auto-logout on 401 ═══
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('awb_token')
            // Only reload if we're not already on a login-related path
            if (!window.location.pathname.includes('/login')) {
                window.location.reload()
            }
        }
        return Promise.reject(error)
    }
)

export default api

