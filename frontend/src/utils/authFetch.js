// Auth helper for raw fetch calls — adds JWT bearer token from localStorage.
export const authFetch = (url, opts = {}) => {
    const token = localStorage.getItem('awb_token')
    return fetch(url, {
        ...opts,
        headers: {
            ...opts.headers,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    })
}

// API base URL resolved from Vite env (dev: http://localhost:8000/api, prod: /api via nginx).
export const API_URL = import.meta.env.VITE_API_URL || '/api'
