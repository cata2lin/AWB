import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.jsx'

// Create React Query client.
// staleTime keeps data fresh for 60s so navigating away and back to a tab reuses
// the cache instead of re-hitting the expensive full-table analytics endpoints;
// gcTime keeps it around 5 min. Mutations must invalidate their queries to refresh.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="top-right"
        richColors
        closeButton
        theme="system"
        toastOptions={{ duration: 3500 }}
      />
    </QueryClientProvider>
  </StrictMode>,
)
