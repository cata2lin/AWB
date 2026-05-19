/**
 * SubsidiaryBadge — the amber "Subsidiary" callout row used inside the
 * ContributionMargin P&L table. Renders as a full-width `<tr>`; the caller is
 * responsible for nesting it inside a `<tbody>`.
 *
 * If you need it outside a table context, use the `inline` variant.
 */
export default function SubsidiaryBadge({ name, colSpan = 1, inline = false }) {
    const content = (
        <span className="inline-flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-200 dark:bg-amber-700/50 text-amber-800 dark:text-amber-300">
                Filială
            </span>
            <span className="font-bold text-sm text-amber-900 dark:text-amber-200">{name}</span>
        </span>
    )

    if (inline) {
        return (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                {content}
            </div>
        )
    }

    return (
        <tr className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
            <td colSpan={colSpan} className="py-2 px-3">
                {content}
            </td>
        </tr>
    )
}
