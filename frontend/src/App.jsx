import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useAppStore } from './store/useAppStore'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import Rules from './pages/Rules'
import Settings from './pages/Settings'
import History from './pages/History'
import Analytics from './pages/Analytics'
import Logs from './pages/Logs'
import Login from './pages/Login'
import { Loader } from 'lucide-react'

function AppContent() {
  const { darkMode } = useAppStore()
  const { isAuthenticated, loading, user, logout } = useAuth()

  if (loading) {
    return (
      <div className="dark min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Login />
  }

  return (
    <div className={darkMode ? 'dark' : ''}>
      <BrowserRouter>
        <div className="flex h-screen bg-zinc-100 dark:bg-zinc-950">
          <Sidebar user={user} onLogout={logout} />
          <main className="flex-1 overflow-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/logs" element={<Logs />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
