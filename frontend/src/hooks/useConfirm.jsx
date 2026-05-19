import { useCallback, useState } from 'react'
import ConfirmDialog from '../components/ui/ConfirmDialog'

export function useConfirm() {
    const [state, setState] = useState({ open: false })

    const confirm = useCallback((opts = {}) => new Promise((resolve) => {
        setState({ open: true, ...opts, _resolve: resolve })
    }), [])

    const handleCancel = useCallback(() => {
        state._resolve?.(false)
        setState({ open: false })
    }, [state])

    const handleConfirm = useCallback(() => {
        state._resolve?.(true)
        setState({ open: false })
    }, [state])

    const dialog = (
        <ConfirmDialog
            open={state.open}
            title={state.title}
            description={state.description}
            confirmLabel={state.confirmLabel}
            cancelLabel={state.cancelLabel}
            variant={state.variant}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
        />
    )

    return { confirm, dialog }
}

export default useConfirm
