import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Lock, User, AlertCircle, Loader } from 'lucide-react'

export default function Login() {
    const { login } = useAuth()
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            await login(username, password)
        } catch (err) {
            setError(err.message || 'Login failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="dark min-h-screen bg-zinc-950 flex items-center justify-center p-4">
            <div className="relative w-full max-w-md">
                {/* Logo / Brand */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-600 rounded-2xl mb-4">
                        <Lock className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-white tracking-tight">AWB Print Manager</h1>
                    <p className="text-zinc-400 text-sm mt-1">Autentifică-te pentru a accesa dashboardul</p>
                </div>

                {/* Login Form */}
                <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl">
                    {error && (
                        <div className="mb-4 flex items-center gap-2 p-3 bg-red-900/30 border border-red-800/50 rounded-lg text-red-300 text-sm">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Utilizator</label>
                            <div className="relative">
                                <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="Introdu utilizatorul"
                                    autoFocus
                                    required
                                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-colors"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Parolă</label>
                            <div className="relative">
                                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Introdu parola"
                                    required
                                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-colors"
                                />
                            </div>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !username || !password}
                        className="w-full mt-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
                    >
                        {loading ? (
                            <><Loader className="w-4 h-4 animate-spin" /> Se autentifică...</>
                        ) : (
                            'Autentificare'
                        )}
                    </button>
                </form>

                <p className="text-center text-zinc-600 text-xs mt-6">
                    AWB Print Manager — acces securizat
                </p>
            </div>
        </div>
    )
}
