import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const API = import.meta.env.VITE_API_URL || ''

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null)
    const [token, setToken] = useState(() => localStorage.getItem('awb_token'))
    const [loading, setLoading] = useState(true)

    // Verify token on mount
    useEffect(() => {
        const verify = async () => {
            if (!token) {
                setLoading(false)
                return
            }
            try {
                const res = await fetch(`${API}/api/auth/me`, {
                    headers: { Authorization: `Bearer ${token}` }
                })
                if (res.ok) {
                    const data = await res.json()
                    setUser(data)
                } else {
                    // Token expired or invalid
                    localStorage.removeItem('awb_token')
                    setToken(null)
                    setUser(null)
                }
            } catch {
                // Server unreachable — keep token, user will see errors elsewhere
            }
            setLoading(false)
        }
        verify()
    }, [token])

    const login = useCallback(async (username, password) => {
        const res = await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.detail || 'Login failed')
        }
        const data = await res.json()
        localStorage.setItem('awb_token', data.token)
        setToken(data.token)
        setUser(data.user)
        return data
    }, [])

    const logout = useCallback(() => {
        localStorage.removeItem('awb_token')
        setToken(null)
        setUser(null)
    }, [])

    // Helper: get auth headers for fetch calls
    const getAuthHeaders = useCallback(() => {
        if (!token) return {}
        return { Authorization: `Bearer ${token}` }
    }, [token])

    return (
        <AuthContext.Provider value={{
            user,
            token,
            loading,
            isAuthenticated: !!user,
            login,
            logout,
            getAuthHeaders,
        }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be inside AuthProvider')
    return ctx
}

export default AuthContext
