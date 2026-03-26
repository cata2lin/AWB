import { useAppStore } from '../store/useAppStore'

export default function StoreCard({ store }) {
    const { selectedStoreIds, toggleStoreSelection } = useAppStore()
    const isSelected = selectedStoreIds.includes(store.id)

    return (
        <button
            onClick={() => toggleStoreSelection(store.id)}
            className={`
                relative p-4 rounded-xl transition-all duration-200 text-left w-full border
                ${isSelected
                    ? 'bg-white dark:bg-zinc-900 shadow-lg scale-[1.02] border-transparent'
                    : 'bg-white dark:bg-zinc-900 hover:shadow-md border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'}
            `}
            style={{
                borderLeft: `4px solid ${store.color}`,
                ...(isSelected && { boxShadow: `0 4px 20px ${store.color}22` })
            }}
        >
            {/* Selection Indicator */}
            {isSelected && (
                <div
                    className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center shadow-sm"
                    style={{ backgroundColor: store.color }}
                >
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
            )}

            <h3 className="font-semibold text-zinc-900 dark:text-white truncate pr-6 text-sm">
                {store.name}
            </h3>
            <p className="text-2xl font-bold mt-2 tracking-tight" style={{ color: store.color }}>
                {store.unfulfilledCount.toLocaleString()}
            </p>
            <p className="text-xs text-zinc-400">ready to print</p>
        </button>
    )
}
