import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Mock data for stores
const mockStores = [
    { id: 'store-1', name: 'Esteban', color: '#EF4444', unfulfilledCount: 156 },
    { id: 'store-2', name: 'Nocturna', color: '#8B5CF6', unfulfilledCount: 89 },
    { id: 'store-3', name: 'Nocturna Lux', color: '#6366F1', unfulfilledCount: 42 },
    { id: 'store-4', name: 'GT Collection', color: '#10B981', unfulfilledCount: 234 },
    { id: 'store-5', name: 'Covoria', color: '#F59E0B', unfulfilledCount: 18 },
    { id: 'store-6', name: 'Carpetto', color: '#EC4899', unfulfilledCount: 27 },
]

// Mock orders
const mockOrders = [
    { id: 'ord-1', reference: '#10421', storeId: 'store-1', storeName: 'Esteban', itemCount: 1, items: [{ sku: 'EST-001', title: 'Parfum Signature 100ml', qty: 1 }], trackingNumber: 'FAN123456789', courier: 'FAN Courier', createdAt: '2026-01-22T10:00:00Z', status: 'unfulfilled' },
    { id: 'ord-2', reference: '#10422', storeId: 'store-1', storeName: 'Esteban', itemCount: 3, items: [{ sku: 'EST-002', title: 'Parfum Collection Set', qty: 3 }], trackingNumber: 'FAN123456790', courier: 'FAN Courier', createdAt: '2026-01-22T09:30:00Z', status: 'unfulfilled' },
    { id: 'ord-3', reference: '#10423', storeId: 'store-2', storeName: 'Nocturna', itemCount: 1, items: [{ sku: 'NOC-001', title: 'Pijama Set S', qty: 1 }], trackingNumber: 'DPD987654321', courier: 'DPD', createdAt: '2026-01-22T08:15:00Z', status: 'unfulfilled' },
    { id: 'ord-4', reference: '#10424', storeId: 'store-5', storeName: 'Covoria', itemCount: 1, items: [{ sku: 'COV-BLUE-01', title: 'Covor Albastru 200x300', qty: 1 }], trackingNumber: 'SAM111222333', courier: 'Sameday', createdAt: '2026-01-21T14:00:00Z', status: 'unfulfilled' },
    { id: 'ord-5', reference: '#10425', storeId: 'store-6', storeName: 'Carpetto', itemCount: 1, items: [{ sku: 'COV-BLUE-01', title: 'Covor Albastru 200x300', qty: 1 }], trackingNumber: 'SAM111222334', courier: 'Sameday', createdAt: '2026-01-21T12:00:00Z', status: 'unfulfilled' },
    { id: 'ord-6', reference: '#10426', storeId: 'store-4', storeName: 'GT Collection', itemCount: 6, items: [{ sku: 'GT-MIX-01', title: 'Mixed Bundle', qty: 6 }], trackingNumber: 'FAN999888777', courier: 'FAN Courier', createdAt: '2026-01-20T16:00:00Z', status: 'unfulfilled' },
]

// Default rules
const defaultRules = [
    { id: 'rule-1', priority: 1, name: 'Esteban Single Items', conditions: { storeIds: ['store-1'], itemCount: 1 }, groupName: 'Esteban - Single Items', enabled: true },
    { id: 'rule-2', priority: 2, name: 'Esteban 3-Pack', conditions: { storeIds: ['store-1'], itemCount: 3 }, groupName: 'Esteban - 3 Pack', enabled: true },
    { id: 'rule-3', priority: 3, name: 'All Carpets', conditions: { skuPatterns: ['COV-'] }, groupName: 'Carpets - All Stores', enabled: true },
    { id: 'rule-4', priority: 4, name: 'Large Orders (6+)', conditions: { itemCountMin: 6 }, groupName: 'Large Orders', enabled: false },
]

// Default presets
const defaultPresets = [
    { id: 'preset-default', name: 'Default', rules: defaultRules, createdAt: new Date().toISOString() },
]

export const useAppStore = create(
    persist(
        (set, get) => ({
            // Theme
            darkMode: true,
            toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),

            // Stores
            stores: mockStores,
            selectedStoreIds: [],
            setSelectedStoreIds: (ids) => set({ selectedStoreIds: ids }),
            toggleStoreSelection: (id) => set((state) => ({
                selectedStoreIds: state.selectedStoreIds.includes(id)
                    ? state.selectedStoreIds.filter((sid) => sid !== id)
                    : [...state.selectedStoreIds, id]
            })),

            // Orders
            orders: mockOrders,
            setOrders: (orders) => set({ orders }),

            // Rules
            rules: defaultRules,
            setRules: (rules) => set({ rules }),
            reorderRules: (startIndex, endIndex) => set((state) => {
                const result = Array.from(state.rules)
                const [removed] = result.splice(startIndex, 1)
                result.splice(endIndex, 0, removed)
                const updated = result.map((rule, idx) => ({ ...rule, priority: idx + 1 }))
                return { rules: updated }
            }),
            addRule: (rule) => set((state) => {
                const newRule = {
                    ...rule,
                    id: `rule-${Date.now()}`,
                    priority: state.rules.length + 1,
                    enabled: true,
                }
                return { rules: [...state.rules, newRule] }
            }),
            deleteRule: (id) => set((state) => {
                const filtered = state.rules.filter((r) => r.id !== id)
                const updated = filtered.map((rule, idx) => ({ ...rule, priority: idx + 1 }))
                return { rules: updated }
            }),
            toggleRuleEnabled: (id) => set((state) => ({
                rules: state.rules.map((r) =>
                    r.id === id ? { ...r, enabled: !r.enabled } : r
                ),
            })),

            // Rule Presets
            presets: defaultPresets,
            activePresetId: 'preset-default',
            saveAsPreset: (name) => set((state) => {
                const newPreset = {
                    id: `preset-${Date.now()}`,
                    name,
                    rules: JSON.parse(JSON.stringify(state.rules)), // Deep copy
                    createdAt: new Date().toISOString(),
                }
                return {
                    presets: [...state.presets, newPreset],
                    activePresetId: newPreset.id,
                }
            }),
            loadPreset: (presetId) => set((state) => {
                const preset = state.presets.find((p) => p.id === presetId)
                if (!preset) return {}
                return {
                    rules: JSON.parse(JSON.stringify(preset.rules)), // Deep copy
                    activePresetId: presetId,
                }
            }),
            deletePreset: (presetId) => set((state) => {
                if (presetId === 'preset-default') return {} // Can't delete default
                const filtered = state.presets.filter((p) => p.id !== presetId)
                return {
                    presets: filtered,
                    activePresetId: state.activePresetId === presetId ? 'preset-default' : state.activePresetId,
                }
            }),
            updatePreset: (presetId) => set((state) => {
                return {
                    presets: state.presets.map((p) =>
                        p.id === presetId
                            ? { ...p, rules: JSON.parse(JSON.stringify(state.rules)), createdAt: new Date().toISOString() }
                            : p
                    ),
                }
            }),

            // Sync
            lastSyncAt: null,
            isSyncing: false,
            syncOrders: async () => {
                const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
                set({ isSyncing: true })
                try {
                    const res = await fetch(`${API}/api/sync/trigger`, { method: 'POST' })
                    if (!res.ok) throw new Error('Sync trigger failed')
                    // Poll sync status until completed
                    let status = 'running'
                    while (status === 'running') {
                        await new Promise(r => setTimeout(r, 2000))
                        const statusRes = await fetch(`${API}/api/sync/status`)
                        const data = await statusRes.json()
                        status = data.status
                    }
                    set({ isSyncing: false, lastSyncAt: new Date().toISOString() })
                } catch (e) {
                    console.error('Sync failed:', e)
                    set({ isSyncing: false })
                }
            },
            fullSyncOrders: async () => {
                const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
                set({ isSyncing: true })
                try {
                    const res = await fetch(`${API}/api/sync/trigger?full_sync=true`, { method: 'POST' })
                    if (!res.ok) throw new Error('Full sync trigger failed')
                    // Poll sync status until completed
                    let status = 'running'
                    while (status === 'running') {
                        await new Promise(r => setTimeout(r, 3000))
                        const statusRes = await fetch(`${API}/api/sync/status`)
                        const data = await statusRes.json()
                        status = data.status
                    }
                    set({ isSyncing: false, lastSyncAt: new Date().toISOString() })
                } catch (e) {
                    console.error('Full sync failed:', e)
                    set({ isSyncing: false })
                }
            },

            // Print batch config
            batchSize: 200,
            setBatchSize: (size) => set({ batchSize: size }),
        }),
        {
            name: 'awb-print-storage',
            partialize: (state) => ({
                darkMode: state.darkMode,
                selectedStoreIds: state.selectedStoreIds,
                rules: state.rules,
                presets: state.presets,
                activePresetId: state.activePresetId,
                batchSize: state.batchSize,
            }),
        }
    )
)
