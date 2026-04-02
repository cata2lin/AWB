import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ordersApi, storesApi, rulesApi, syncApi, printApi, analyticsApi, presetsApi } from '../services/api'

// ==================== Orders Hooks ====================

export const useOrders = (filters = {}) => {
    return useQuery({
        queryKey: ['orders', filters],
        queryFn: () => ordersApi.getOrders(filters),
        staleTime: 30 * 1000, // 30 seconds
    })
}

export const useOrderStats = () => {
    return useQuery({
        queryKey: ['orders', 'stats'],
        queryFn: ordersApi.getStats,
        staleTime: 30 * 1000,
    })
}

// ==================== Stores Hooks ====================

export const useStores = () => {
    return useQuery({
        queryKey: ['stores'],
        queryFn: storesApi.getStores,
        staleTime: 60 * 1000, // 1 minute
        retry: 3,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    })
}

export const useStoreStats = () => {
    return useQuery({
        queryKey: ['stores', 'stats'],
        queryFn: storesApi.getStats,
        staleTime: 30 * 1000,
    })
}

export const useUpdateStore = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: ({ uid, updates }) => storesApi.updateStore(uid, updates),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stores'] })
        },
    })
}

// ==================== Rules Hooks ====================

export const useRules = () => {
    return useQuery({
        queryKey: ['rules'],
        queryFn: rulesApi.getRules,
        staleTime: 60 * 1000,
    })
}

export const useCreateRule = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: rulesApi.createRule,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rules'] })
        },
    })
}

export const useUpdateRule = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: ({ id, updates }) => rulesApi.updateRule(id, updates),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rules'] })
        },
    })
}

export const useDeleteRule = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: rulesApi.deleteRule,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rules'] })
        },
    })
}

export const useReorderRules = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: rulesApi.reorderRules,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rules'] })
        },
    })
}

export const useToggleRule = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: rulesApi.toggleRule,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rules'] })
        },
    })
}

// ==================== Sync Hooks ====================

export const useSyncStatus = () => {
    return useQuery({
        queryKey: ['sync', 'status'],
        queryFn: syncApi.getStatus,
        refetchInterval: 10 * 1000, // Poll every 10 seconds
    })
}

export const useTriggerSync = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (params) => syncApi.triggerSync(params),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sync'] })
            queryClient.invalidateQueries({ queryKey: ['orders'] })
            queryClient.invalidateQueries({ queryKey: ['stores'] })
        },
    })
}

export const useSyncHistory = (limit = 20) => {
    return useQuery({
        queryKey: ['sync', 'history', limit],
        queryFn: () => syncApi.getHistory(limit),
        refetchInterval: 15 * 1000, // Poll every 15 seconds to catch running syncs
    })
}

// ==================== Print Hooks ====================

export const usePrintPreview = (storeUids = null) => {
    return useQuery({
        queryKey: ['print', 'preview', storeUids],
        queryFn: () => printApi.getPreview(storeUids),
        enabled: false, // Manual trigger only
    })
}

export const useGenerateBatch = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: printApi.generateBatch,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] })
            queryClient.invalidateQueries({ queryKey: ['print', 'history'] })
        },
    })
}

export const usePrintHistory = (skip = 0, limit = 20) => {
    return useQuery({
        queryKey: ['print', 'history', skip, limit],
        queryFn: () => printApi.getHistory({ skip, limit }),
    })
}

export const useBatchDetails = (batchId) => {
    return useQuery({
        queryKey: ['print', 'batch', batchId],
        queryFn: () => printApi.getBatchDetails(batchId),
        enabled: !!batchId,
    })
}

// ==================== Analytics Hooks ====================

export const useAnalytics = (days = 30) => {
    return useQuery({
        queryKey: ['analytics', days],
        queryFn: () => analyticsApi.getAnalytics(days),
        staleTime: 60 * 1000, // 1 minute
    })
}

export const useAnalyticsSummary = () => {
    return useQuery({
        queryKey: ['analytics', 'summary'],
        queryFn: analyticsApi.getSummary,
        staleTime: 30 * 1000,
    })
}

// ==================== Presets Hooks ====================

export const usePresets = () => {
    return useQuery({
        queryKey: ['presets'],
        queryFn: presetsApi.getPresets,
        staleTime: 60 * 1000,
    })
}

export const useActivePreset = () => {
    return useQuery({
        queryKey: ['presets', 'active'],
        queryFn: presetsApi.getActivePreset,
        staleTime: 60 * 1000,
    })
}

export const useSavePreset = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: presetsApi.savePreset,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['presets'] })
        },
    })
}

export const useLoadPreset = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: presetsApi.loadPreset,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rules'] })
            queryClient.invalidateQueries({ queryKey: ['presets'] })
        },
    })
}

export const useDeletePreset = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: presetsApi.deletePreset,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['presets'] })
        },
    })
}
