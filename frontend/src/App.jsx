import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useAppStore } from './store/useAppStore'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import ErrorBoundary from './components/ErrorBoundary'
import { Loader2 } from 'lucide-react'

// Route components are code-split so the initial bundle only ships the shell +
// login; each page (and its heavy deps: recharts, leaflet, xlsx, pdf-lib, dnd)
// downloads on first navigation. Cuts first-load JS dramatically.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Orders = lazy(() => import('./pages/Orders'))
const Duplicates = lazy(() => import('./pages/Duplicates'))
const Rules = lazy(() => import('./pages/Rules'))
const Settings = lazy(() => import('./pages/Settings'))
const History = lazy(() => import('./pages/History'))
const Analytics = lazy(() => import('./pages/Analytics'))
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'))
const Logs = lazy(() => import('./pages/Logs'))
const ComisionAgentie = lazy(() => import('./pages/ComisionAgentie'))
const CustomProducts = lazy(() => import('./pages/CustomProducts'))
const UiPreview = lazy(() => import('./pages/UiPreview'))

// Centered spinner shown while a lazy route chunk loads.
function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-32">
      <Loader2 className="w-7 h-7 text-primary-500 animate-spin" />
    </div>
  )
}

function AppContent() {
  const { darkMode } = useAppStore()
  const { isAuthenticated, loading, user, logout } = useAuth()

  if (loading) {
    return (
      <div className="dark min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Login />
  }

  return (
    <div className={darkMode ? 'dark' : ''}>
      <BrowserRouter>
        <AppShell user={user} onLogout={logout}>
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/duplicates" element={<Duplicates />} />
                <Route path="/rules" element={<Rules />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/purchase-orders" element={<PurchaseOrders />} />
                <Route path="/purchase-orders/:poNumber" element={<PurchaseOrders />} />
                <Route path="/history" element={<History />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/comision-agentie" element={<ComisionAgentie />} />
                <Route path="/custom-products" element={<CustomProducts />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/__ui" element={<UiPreview />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </AppShell>
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
