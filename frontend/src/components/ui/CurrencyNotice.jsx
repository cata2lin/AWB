/**
 * CurrencyNotice — the amber "💱 Currency conversion" callout block used in
 * Profitabilitate's expanded order rows. Lifted into a primitive so the same
 * notice can be used on Orders, PO Detail, and SKU Profitability.
 */
export default function CurrencyNotice({
    originalCurrency,
    originalAmount,
    exchangeRate,
    targetCurrency = 'RON',
    className = '',
}) {
    if (!originalCurrency || originalCurrency === targetCurrency) return null
    const amountFormatted =
        typeof originalAmount === 'number'
            ? originalAmount.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : originalAmount
    return (
        <div className={`px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-sm ${className}`}>
            <span className="font-medium text-amber-800 dark:text-amber-300">💱 Conversie valutară:</span>
            <span className="text-amber-700 dark:text-amber-400 ml-1">
                Comandă în {originalCurrency} ({amountFormatted} {originalCurrency})
                {exchangeRate != null && (
                    <> → convertită la cursul {exchangeRate} {originalCurrency}/{targetCurrency}</>
                )}
            </span>
        </div>
    )
}
