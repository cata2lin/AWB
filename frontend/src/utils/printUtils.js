/**
 * Print Utilities — blob-based PDF printing with chunked spooling.
 *
 * Why blob-based?
 *   The frontend (Vite) and backend (FastAPI) run on different ports during
 *   development, so loading a backend URL into an iframe triggers CORS.
 *   Fetching the PDF as a blob and creating a same-origin blob:// URL
 *   avoids the cross-origin restriction entirely.
 *
 * Why chunked?
 *   Low-RAM printers (e.g. 180 MB) crash when the OS spools a 200-page
 *   batch all at once. Splitting into smaller sub-PDFs and printing them
 *   sequentially — with a cooldown between each — keeps the spooler
 *   within the printer's memory budget.
 */
import { PDFDocument } from 'pdf-lib'
import { API_BASE_URL } from '../services/api/client'

/* ═══════════════════════════════════════════════════════════════════
 * Core: fetch a batch PDF as a blob, authenticated
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Fetch a batch PDF from the backend as a Blob.
 * @param {number} batchId - The print batch ID
 * @returns {Promise<Blob>} The raw PDF blob
 */
async function fetchBatchBlob(batchId) {
    const token = localStorage.getItem('awb_token')
    const url = `${API_BASE_URL}/print/download/${batchId}${token ? `?token=${token}` : ''}`

    const resp = await fetch(url)
    if (!resp.ok) {
        throw new Error(`PDF download failed: HTTP ${resp.status}`)
    }
    return resp.blob()
}

/* ═══════════════════════════════════════════════════════════════════
 * Core: split a PDF blob into N-page chunks using pdf-lib
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Split a PDF blob into sub-PDF blobs of at most `chunkSize` pages each.
 * If totalPages <= chunkSize, returns [originalBlob] (no split needed).
 *
 * @param {Blob} blob       - The full PDF blob
 * @param {number} chunkSize - Max pages per chunk
 * @returns {Promise<Blob[]>} Array of PDF blobs
 */
async function splitPdfIntoChunks(blob, chunkSize) {
    const arrayBuffer = await blob.arrayBuffer()
    const srcDoc = await PDFDocument.load(arrayBuffer)
    const totalPages = srcDoc.getPageCount()

    // No splitting needed
    if (totalPages <= chunkSize) {
        return [blob]
    }

    const chunks = []
    for (let start = 0; start < totalPages; start += chunkSize) {
        const end = Math.min(start + chunkSize, totalPages)
        const indices = Array.from({ length: end - start }, (_, i) => start + i)

        const chunkDoc = await PDFDocument.create()
        const copiedPages = await chunkDoc.copyPages(srcDoc, indices)
        copiedPages.forEach(page => chunkDoc.addPage(page))

        const chunkBytes = await chunkDoc.save()
        chunks.push(new Blob([chunkBytes], { type: 'application/pdf' }))
    }

    return chunks
}

/* ═══════════════════════════════════════════════════════════════════
 * Core: print a single PDF blob via hidden iframe
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Print a single PDF blob by loading it into a hidden iframe
 * and calling the native print dialog.
 *
 * Returns a Promise that resolves after the print dialog is closed
 * (detected via iframe focus regain).
 *
 * @param {Blob} blob - A PDF blob to print
 * @returns {Promise<void>}
 */
function printBlob(blob) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(blob)

        // Clean up any previous print iframe
        const existing = document.getElementById('__awb_print_frame')
        if (existing) {
            document.body.removeChild(existing)
        }

        const iframe = document.createElement('iframe')
        iframe.id = '__awb_print_frame'
        iframe.style.position = 'fixed'
        iframe.style.right = '0'
        iframe.style.bottom = '0'
        iframe.style.width = '0'
        iframe.style.height = '0'
        iframe.style.border = 'none'
        iframe.style.opacity = '0'
        iframe.src = objectUrl

        document.body.appendChild(iframe)

        iframe.onload = () => {
            try {
                iframe.contentWindow.focus()
                iframe.contentWindow.print()
            } catch (err) {
                // Should not happen with blob:// URLs, but guard just in case
                reject(new Error(`Print dialog failed: ${err.message}`))
                cleanup()
                return
            }

            // Detect when the print dialog closes.
            // The window regains focus after the user closes/cancels the dialog.
            const onFocus = () => {
                window.removeEventListener('focus', onFocus)
                // Small delay to let the spooler queue the job
                setTimeout(() => {
                    cleanup()
                    resolve()
                }, 500)
            }
            window.addEventListener('focus', onFocus)

            // Safety timeout: if focus event never fires (e.g. some browsers),
            // resolve after 120 seconds so we don't hang forever
            setTimeout(() => {
                window.removeEventListener('focus', onFocus)
                cleanup()
                resolve()
            }, 120_000)
        }

        iframe.onerror = () => {
            cleanup()
            reject(new Error('Failed to load PDF into print frame'))
        }

        function cleanup() {
            URL.revokeObjectURL(objectUrl)
            try {
                if (iframe.parentNode) {
                    document.body.removeChild(iframe)
                }
            } catch (_) { /* already removed */ }
        }
    })
}

/* ═══════════════════════════════════════════════════════════════════
 * Public API: printBatchPdf
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Print a batch PDF with optional chunked splitting for printer RAM safety.
 *
 * @param {number} batchId - The batch ID to download and print
 * @param {object} options
 * @param {number}   [options.chunkSize=20]        - Max pages per print job
 * @param {number}   [options.delayBetweenMs=3000]  - Cooldown between chunks (ms)
 * @param {function} [options.onProgress]           - ({ current, total }) => void
 * @param {function} [options.onComplete]           - () => void
 * @param {function} [options.onError]              - (Error) => void
 * @returns {Promise<void>}
 */
export async function printBatchPdf(batchId, options = {}) {
    const {
        chunkSize = 20,
        delayBetweenMs = 3000,
        onProgress,
        onComplete,
        onError,
    } = options

    try {
        // 1. Fetch the full PDF as a blob
        const fullBlob = await fetchBatchBlob(batchId)

        // 2. Split into chunks
        const chunks = await splitPdfIntoChunks(fullBlob, chunkSize)
        const totalChunks = chunks.length

        // 3. Print each chunk sequentially
        for (let i = 0; i < totalChunks; i++) {
            onProgress?.({ current: i + 1, total: totalChunks })

            await printBlob(chunks[i])

            // Cooldown between chunks (skip after the last one)
            if (i < totalChunks - 1 && delayBetweenMs > 0) {
                await new Promise(r => setTimeout(r, delayBetweenMs))
            }
        }

        onComplete?.()
    } catch (err) {
        onError?.(err)
        throw err
    }
}

/**
 * Print a single-order AWB — convenience wrapper that skips chunking.
 * Still uses blob-based approach for direct print dialog.
 *
 * @param {number} batchId - The batch ID from the single-print API response
 * @returns {Promise<void>}
 */
export async function printSingleAwb(batchId) {
    const blob = await fetchBatchBlob(batchId)
    await printBlob(blob)
}

/**
 * Print any PDF by URL — fetches as blob and opens print dialog.
 * Useful for reprint-order endpoints that don't use the batch download URL pattern.
 *
 * @param {string} url - Full URL to the PDF endpoint (including auth token)
 * @returns {Promise<void>}
 */
export async function printFromUrl(url) {
    const resp = await fetch(url)
    if (!resp.ok) {
        throw new Error(`PDF download failed: HTTP ${resp.status}`)
    }
    const blob = await resp.blob()
    await printBlob(blob)
}
