import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw, Terminal, Server, Database, Clock, Search, Filter, AlertTriangle, CheckCircle, XCircle, Loader, Activity, Wifi, WifiOff, Users, UserCheck, UserX, Trash2, Plus } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const getAuthHeaders = () => {
    const token = localStorage.getItem('awb_token')
    return token ? { Authorization: `Bearer ${token}` } : {}
}

const LEVEL_STYLES = {
    DEBUG: 'text-zinc-400',
    INFO: 'text-blue-400',
    WARNING: 'text-amber-400',
    ERROR: 'text-red-400',
    CRITICAL: 'text-red-500 font-bold',
}

const LEVEL_BG = {
    DEBUG: 'bg-zinc-800',
    INFO: 'bg-blue-900/30',
    WARNING: 'bg-amber-900/30',
    ERROR: 'bg-red-900/30',
    CRITICAL: 'bg-red-900/50',
}

export default function Logs() {
    const [logs, setLogs] = useState([])
    const [systemInfo, setSystemInfo] = useState(null)
    const [syncHistory, setSyncHistory] = useState([])
    const [userActivity, setUserActivity] = useState(null)
    const [loading, setLoading] = useState(true)
    const [autoRefresh, setAutoRefresh] = useState(true)
    const [levelFilter, setLevelFilter] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [activeTab, setActiveTab] = useState('logs')
    const [showAddUser, setShowAddUser] = useState(false)
    const [newUser, setNewUser] = useState({ username: '', password: '', display_name: '', role: 'admin' })
    const logEndRef = useRef(null)
    const intervalRef = useRef(null)

    const fetchLogs = useCallback(async () => {
        try {
            const params = new URLSearchParams({ limit: '200' })
            if (levelFilter) params.set('level', levelFilter)
            if (searchQuery) params.set('search', searchQuery)
            const res = await fetch(`${API}/api/system/logs?${params}`, { headers: getAuthHeaders() })
            const data = await res.json()
            setLogs(data.logs || [])
        } catch (err) {
            console.error('Failed to fetch logs:', err)
        }
    }, [levelFilter, searchQuery])

    const fetchSystemInfo = useCallback(async () => {
        try {
            const res = await fetch(`${API}/api/system/info`, { headers: getAuthHeaders() })
            const data = await res.json()
            setSystemInfo(data)
        } catch (err) {
            console.error('Failed to fetch system info:', err)
        }
    }, [])

    const fetchSyncHistory = useCallback(async () => {
        try {
            const res = await fetch(`${API}/api/system/sync-history?limit=30`, { headers: getAuthHeaders() })
            const data = await res.json()
            setSyncHistory(data.history || [])
        } catch (err) {
            console.error('Failed to fetch sync history:', err)
        }
    }, [])

    const fetchUserActivity = useCallback(async () => {
        try {
            const res = await fetch(`${API}/api/system/user-activity`, { headers: getAuthHeaders() })
            const data = await res.json()
            setUserActivity(data)
        } catch (err) {
            console.error('Failed to fetch user activity:', err)
        }
    }, [])

    const fetchAll = useCallback(async () => {
        await Promise.all([fetchLogs(), fetchSystemInfo(), fetchSyncHistory(), fetchUserActivity()])
        setLoading(false)
    }, [fetchLogs, fetchSystemInfo, fetchSyncHistory, fetchUserActivity])

    useEffect(() => {
        fetchAll()
    }, [fetchAll])

    useEffect(() => {
        if (autoRefresh) {
            intervalRef.current = setInterval(fetchAll, 5000)
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
        }
    }, [autoRefresh, fetchAll])

    const handleCreateUser = async () => {
        try {
            const res = await fetch(`${API}/api/auth/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify(newUser),
            })
            if (res.ok) {
                setShowAddUser(false)
                setNewUser({ username: '', password: '', display_name: '', role: 'admin' })
                fetchUserActivity()
            } else {
                const err = await res.json()
                alert(err.detail || 'Failed to create user')
            }
        } catch (err) {
            alert('Error creating user: ' + err.message)
        }
    }

    const handleDeleteUser = async (userId, username) => {
        if (!confirm(`Delete user "${username}"?`)) return
        try {
            const res = await fetch(`${API}/api/auth/users/${userId}`, {
                method: 'DELETE',
                headers: getAuthHeaders(),
            })
            if (res.ok) {
                fetchUserActivity()
            } else {
                const err = await res.json()
                alert(err.detail || 'Failed to delete user')
            }
        } catch (err) {
            alert('Error: ' + err.message)
        }
    }

    const formatTime = (iso) => {
        if (!iso) return '-'
        return new Date(iso).toLocaleString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' })
    }

    const formatDuration = (seconds) => {
        if (!seconds && seconds !== 0) return '-'
        if (seconds < 60) return `${seconds}s`
        const m = Math.floor(seconds / 60)
        const s = seconds % 60
        return `${m}m ${s}s`
    }

    const syncStatusIcon = (status) => {
        switch (status) {
            case 'completed': return <CheckCircle className="w-3.5 h-3.5 text-green-400" />
            case 'running': return <Loader className="w-3.5 h-3.5 text-blue-400 animate-spin" />
            case 'failed': return <XCircle className="w-3.5 h-3.5 text-red-400" />
            default: return <Clock className="w-3.5 h-3.5 text-zinc-400" />
        }
    }

    const syncStatusColor = (status) => {
        switch (status) {
            case 'completed': return 'text-green-400'
            case 'running': return 'text-blue-400'
            case 'failed': return 'text-red-400'
            default: return 'text-zinc-400'
        }
    }

    const tabs = [
        { id: 'logs', label: 'Live Logs', icon: Terminal },
        { id: 'sync', label: 'Sync History', icon: RefreshCw },
        { id: 'users', label: 'Users', icon: Users },
        { id: 'system', label: 'System Info', icon: Server },
    ]

    return (
        <div className="p-6 space-y-4 animate-fade-in bg-zinc-50 dark:bg-zinc-950 min-h-screen">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
                        <Activity className="w-6 h-6 text-indigo-500" /> System Monitor
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                        Live logs, sync status, users & system health
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${autoRefresh
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700'
                            }`}
                    >
                        {autoRefresh ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                        {autoRefresh ? 'Live (5s)' : 'Paused'}
                    </button>
                    <button
                        onClick={fetchAll}
                        className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" /> Refresh
                    </button>
                </div>
            </div>

            {/* Quick status cards */}
            {systemInfo && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-3">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Uptime</p>
                        <p className="text-lg font-bold text-zinc-900 dark:text-white">{systemInfo.uptime}</p>
                    </div>
                    <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-3">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Sync Status</p>
                        <p className={`text-lg font-bold ${systemInfo.sync.status === 'running' ? 'text-blue-400' : 'text-green-400'}`}>
                            {systemInfo.sync.status === 'running' ? '🔄 Running' : '✅ Idle'}
                        </p>
                    </div>
                    <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-3">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Orders in DB</p>
                        <p className="text-lg font-bold text-zinc-900 dark:text-white">{systemInfo.database.orders.toLocaleString()}</p>
                    </div>
                    <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-3">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Users Online</p>
                        <p className="text-lg font-bold text-green-400">{userActivity?.active_now || 0} / {userActivity?.total_users || 0}</p>
                    </div>
                    <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-3">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Next Sync</p>
                        <p className="text-sm font-bold text-zinc-900 dark:text-white">
                            {systemInfo.sync.next_scheduled ? formatTime(systemInfo.sync.next_scheduled) : '-'}
                        </p>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-1">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${activeTab === tab.id
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                            : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700/50'
                            }`}
                    >
                        <tab.icon className="w-4 h-4" /> {tab.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader className="w-8 h-8 text-indigo-500 animate-spin" />
                </div>
            ) : (
                <>
                    {/* ═══ LIVE LOGS TAB ═══ */}
                    {activeTab === 'logs' && (
                        <div className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-hidden">
                            <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-700 bg-zinc-800/50">
                                <Terminal className="w-4 h-4 text-green-400" />
                                <span className="text-sm font-medium text-green-400">Application Logs</span>
                                <div className="flex-1" />
                                <div className="flex items-center gap-2">
                                    <div className="relative">
                                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                                        <input
                                            type="text"
                                            placeholder="Search logs..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-600 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 w-48 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </div>
                                    <select
                                        value={levelFilter}
                                        onChange={(e) => setLevelFilter(e.target.value)}
                                        className="px-2 py-1.5 bg-zinc-900 border border-zinc-600 rounded-lg text-xs text-zinc-300"
                                    >
                                        <option value="">All Levels</option>
                                        <option value="DEBUG">DEBUG</option>
                                        <option value="INFO">INFO</option>
                                        <option value="WARNING">WARNING</option>
                                        <option value="ERROR">ERROR</option>
                                    </select>
                                    <span className="text-xs text-zinc-500">{logs.length} entries</span>
                                </div>
                            </div>
                            <div className="max-h-[65vh] overflow-y-auto font-mono text-xs p-1">
                                {logs.length === 0 ? (
                                    <div className="text-center py-10 text-zinc-500">No log entries matching your filters</div>
                                ) : (
                                    logs.map((log, i) => (
                                        <div
                                            key={i}
                                            className={`flex gap-2 px-3 py-0.5 hover:bg-zinc-800/50 ${log.level === 'ERROR' || log.level === 'CRITICAL' ? LEVEL_BG[log.level] : ''}`}
                                        >
                                            <span className="text-zinc-600 whitespace-nowrap select-none min-w-[130px]">
                                                {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 1 }) : ''}
                                            </span>
                                            <span className={`min-w-[55px] font-bold ${LEVEL_STYLES[log.level] || 'text-zinc-400'}`}>
                                                {log.level}
                                            </span>
                                            <span className="text-zinc-500 min-w-[120px] max-w-[180px] truncate" title={log.logger}>
                                                {log.logger}
                                            </span>
                                            <span className="text-zinc-200 break-all flex-1">
                                                {log.message}
                                            </span>
                                        </div>
                                    ))
                                )}
                                <div ref={logEndRef} />
                            </div>
                        </div>
                    )}

                    {/* ═══ SYNC HISTORY TAB ═══ */}
                    {activeTab === 'sync' && (
                        <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 overflow-hidden">
                            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-2">
                                <RefreshCw className="w-5 h-5 text-indigo-500" />
                                <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Sync History</h3>
                                <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">{syncHistory.length} entries</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50">
                                            <th className="px-4 py-2.5 font-medium">Status</th>
                                            <th className="px-4 py-2.5 font-medium">Started</th>
                                            <th className="px-4 py-2.5 font-medium">Completed</th>
                                            <th className="px-4 py-2.5 font-medium">Duration</th>
                                            <th className="px-4 py-2.5 font-medium text-right">Fetched</th>
                                            <th className="px-4 py-2.5 font-medium text-right">New</th>
                                            <th className="px-4 py-2.5 font-medium text-right">Updated</th>
                                            <th className="px-4 py-2.5 font-medium">Error</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                        {syncHistory.map(sync => (
                                            <tr key={sync.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/20">
                                                <td className="px-4 py-2.5">
                                                    <span className="inline-flex items-center gap-1.5">
                                                        {syncStatusIcon(sync.status)}
                                                        <span className={`text-xs font-medium ${syncStatusColor(sync.status)}`}>{sync.status}</span>
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">{formatTime(sync.started_at)}</td>
                                                <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">{formatTime(sync.completed_at)}</td>
                                                <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-300 font-mono">{formatDuration(sync.duration_seconds)}</td>
                                                <td className="px-4 py-2.5 text-xs text-right font-medium text-zinc-800 dark:text-zinc-200">{(sync.orders_fetched || 0).toLocaleString()}</td>
                                                <td className="px-4 py-2.5 text-xs text-right font-medium text-green-600 dark:text-green-400">{sync.orders_new || 0}</td>
                                                <td className="px-4 py-2.5 text-xs text-right font-medium text-blue-600 dark:text-blue-400">{sync.orders_updated || 0}</td>
                                                <td className="px-4 py-2.5 text-xs text-red-500 dark:text-red-400 max-w-[200px] truncate" title={sync.error_message}>
                                                    {sync.error_message || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ═══ USERS TAB ═══ */}
                    {activeTab === 'users' && userActivity && (
                        <div className="space-y-4">
                            {/* User stats cards */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-4 text-center">
                                    <p className="text-3xl font-bold text-zinc-900 dark:text-white">{userActivity.total_users}</p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Total Users</p>
                                </div>
                                <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-4 text-center">
                                    <p className="text-3xl font-bold text-green-400">{userActivity.active_now}</p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Online Now</p>
                                </div>
                                <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-4 text-center">
                                    <p className="text-3xl font-bold text-zinc-900 dark:text-white">
                                        {userActivity.users.reduce((s, u) => s + u.requests_today, 0).toLocaleString()}
                                    </p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Requests Today</p>
                                </div>
                            </div>

                            {/* Users Table */}
                            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 overflow-hidden">
                                <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-2">
                                    <Users className="w-5 h-5 text-indigo-500" />
                                    <h3 className="text-lg font-bold text-zinc-900 dark:text-white">User Activity</h3>
                                    <div className="flex-1" />
                                    <button
                                        onClick={() => setShowAddUser(!showAddUser)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors"
                                    >
                                        <Plus className="w-3.5 h-3.5" /> Add User
                                    </button>
                                </div>

                                {/* Add user form */}
                                {showAddUser && (
                                    <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50">
                                        <div className="flex items-end gap-3">
                                            <div>
                                                <label className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Username</label>
                                                <input
                                                    value={newUser.username}
                                                    onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                                                    className="px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white w-36"
                                                    placeholder="username"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Display Name</label>
                                                <input
                                                    value={newUser.display_name}
                                                    onChange={e => setNewUser({ ...newUser, display_name: e.target.value })}
                                                    className="px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white w-36"
                                                    placeholder="Display Name"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Password</label>
                                                <input
                                                    type="password"
                                                    value={newUser.password}
                                                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                                    className="px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white w-36"
                                                    placeholder="password"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Role</label>
                                                <select
                                                    value={newUser.role}
                                                    onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                                                    className="px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm text-zinc-900 dark:text-white"
                                                >
                                                    <option value="admin">Admin</option>
                                                    <option value="viewer">Viewer</option>
                                                </select>
                                            </div>
                                            <button
                                                onClick={handleCreateUser}
                                                disabled={!newUser.username || !newUser.password}
                                                className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-zinc-400 text-white rounded-lg text-sm font-medium transition-colors"
                                            >
                                                Create
                                            </button>
                                            <button
                                                onClick={() => setShowAddUser(false)}
                                                className="px-3 py-1.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 text-sm"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50">
                                                <th className="px-4 py-2.5 font-medium">User</th>
                                                <th className="px-4 py-2.5 font-medium">Status</th>
                                                <th className="px-4 py-2.5 font-medium">Role</th>
                                                <th className="px-4 py-2.5 font-medium">Last Activity</th>
                                                <th className="px-4 py-2.5 font-medium">Last Login</th>
                                                <th className="px-4 py-2.5 font-medium text-right">Today</th>
                                                <th className="px-4 py-2.5 font-medium text-right">24h</th>
                                                <th className="px-4 py-2.5 font-medium text-right">Total</th>
                                                <th className="px-4 py-2.5 font-medium text-right">Avg/hr</th>
                                                <th className="px-4 py-2.5 font-medium"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                            {userActivity.users.map(u => (
                                                <tr key={u.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/20">
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2.5">
                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${u.is_online ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-zinc-500 to-zinc-600'}`}>
                                                                {(u.display_name || u.username)[0].toUpperCase()}
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-medium text-zinc-900 dark:text-white">{u.display_name}</p>
                                                                <p className="text-xs text-zinc-400">@{u.username}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${u.is_online ? 'text-green-500' : 'text-zinc-400'}`}>
                                                            {u.is_online ? <UserCheck className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
                                                            {u.is_online ? 'Online' : 'Offline'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${u.role === 'admin' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'}`}>
                                                            {u.role}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">{formatTime(u.last_activity)}</td>
                                                    <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">{formatTime(u.last_login)}</td>
                                                    <td className="px-4 py-3 text-xs text-right font-medium text-zinc-800 dark:text-zinc-200">{u.requests_today.toLocaleString()}</td>
                                                    <td className="px-4 py-3 text-xs text-right font-medium text-zinc-800 dark:text-zinc-200">{u.requests_24h.toLocaleString()}</td>
                                                    <td className="px-4 py-3 text-xs text-right font-medium text-zinc-800 dark:text-zinc-200">{u.requests_total.toLocaleString()}</td>
                                                    <td className="px-4 py-3 text-xs text-right font-medium text-indigo-600 dark:text-indigo-400">{u.avg_requests_per_hour}</td>
                                                    <td className="px-4 py-3 text-right">
                                                        <button
                                                            onClick={() => handleDeleteUser(u.id, u.username)}
                                                            className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                                                            title="Delete user"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ═══ SYSTEM INFO TAB ═══ */}
                    {activeTab === 'system' && systemInfo && (
                        <div className="space-y-4">
                            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-5">
                                <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
                                    <Server className="w-5 h-5 text-indigo-500" /> Server
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Uptime</p>
                                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">{systemInfo.uptime}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Started At</p>
                                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">{formatTime(systemInfo.started_at)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">PID</p>
                                        <p className="text-sm font-semibold text-zinc-900 dark:text-white font-mono">{systemInfo.environment.python_pid}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Log Buffer</p>
                                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">{systemInfo.environment.log_buffer_size} / 500</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-5">
                                <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
                                    <Database className="w-5 h-5 text-emerald-500" /> Database
                                </h3>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3 text-center">
                                        <p className="text-2xl font-bold text-zinc-900 dark:text-white">{systemInfo.database.orders.toLocaleString()}</p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Orders</p>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3 text-center">
                                        <p className="text-2xl font-bold text-zinc-900 dark:text-white">{systemInfo.database.stores}</p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Stores</p>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3 text-center">
                                        <p className="text-2xl font-bold text-zinc-900 dark:text-white">{systemInfo.database.awbs.toLocaleString()}</p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">AWBs</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-5">
                                <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
                                    <RefreshCw className="w-5 h-5 text-blue-500" /> Sync Details
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Current Status</p>
                                        <p className={`text-sm font-semibold ${systemInfo.sync.status === 'running' ? 'text-blue-400' : 'text-green-400'}`}>
                                            {systemInfo.sync.status}
                                        </p>
                                    </div>
                                    {systemInfo.sync.running_since && (
                                        <div>
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400">Running Since</p>
                                            <p className="text-sm font-semibold text-zinc-900 dark:text-white">{formatTime(systemInfo.sync.running_since)}</p>
                                        </div>
                                    )}
                                    <div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Last Completed</p>
                                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">{formatTime(systemInfo.sync.last_completed)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Next Scheduled</p>
                                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">{formatTime(systemInfo.sync.next_scheduled)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Last Fetched</p>
                                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">{(systemInfo.sync.last_fetched || 0).toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Last New</p>
                                        <p className="text-sm font-semibold text-green-500">{systemInfo.sync.last_new || 0}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Last Updated</p>
                                        <p className="text-sm font-semibold text-blue-500">{systemInfo.sync.last_updated || 0}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-5">
                                <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
                                    <Clock className="w-5 h-5 text-amber-500" /> Scheduled Jobs
                                </h3>
                                {systemInfo.scheduler.jobs.length === 0 ? (
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">No scheduled jobs</p>
                                ) : (
                                    <div className="space-y-2">
                                        {systemInfo.scheduler.jobs.map(job => (
                                            <div key={job.id} className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg">
                                                <div>
                                                    <p className="text-sm font-medium text-zinc-900 dark:text-white">{job.name}</p>
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{job.trigger}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Next Run</p>
                                                    <p className="text-sm font-medium text-zinc-900 dark:text-white">{formatTime(job.next_run)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                                    Scheduler: {systemInfo.scheduler.running ? '🟢 Running' : '🔴 Stopped'}
                                </p>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
