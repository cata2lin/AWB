import { toast } from 'sonner'

const extractMessage = (err) => {
    if (!err) return 'A apărut o eroare'
    if (typeof err === 'string') return err
    if (err.response?.data?.detail) return err.response.data.detail
    if (err.message) return err.message
    return 'A apărut o eroare'
}

export const toastSuccess = (msg) => toast.success(msg)

// Errors persist until dismissed (close button) — they carry actionable detail the
// user must read, per CLAUDE.md Tier 3. Overrides the global 3.5s auto-dismiss.
export const toastError = (err) => toast.error(extractMessage(err), { duration: Infinity })

export const toastInfo = (msg) => toast.info(msg)

export const toastWarning = (msg) => toast.warning(msg)

export const toastPromise = (promise, { loading, success, error }) =>
    toast.promise(promise, {
        loading: loading ?? 'Se procesează...',
        success: success ?? 'Salvat',
        error: typeof error === 'function' ? error : (e) => error ?? extractMessage(e),
    })

export { toast }
