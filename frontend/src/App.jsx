import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useAppStore } from './store/useAppStore'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import Rules from './pages/Rules'
import Settings from './pages/Settings'
import History from './pages/History'
import Analytics from './pages/Analytics'

function App() {
  const { darkMode } = useAppStore()

  return (
    <div className={darkMode ? 'dark' : ''}>
      <BrowserRouter>
        <div className="flex h-screen bg-zinc-100 dark:bg-zinc-950">
          <Sidebar />
          <main className="flex-1 overflow-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </div>
  )
}

export default App
