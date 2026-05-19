// Primitives
export { default as Button } from './Button'
export { default as SearchInput } from './SearchInput'
export { default as DateInput } from './DateInput'
export { default as Select } from './Select'
export { default as EmptyState } from './EmptyState'
export { default as ConfirmDialog } from './ConfirmDialog'
export { default as FormField, TextInput, TextArea } from './FormField'
export { default as KpiCard } from './KpiCard'
export { default as StatusBadge } from './StatusBadge'
export { default as DataTable, PaginationFooter } from './DataTable'
export { default as ColumnsMenu } from './ColumnsMenu'
export { default as FilterBar, FilterChip, FilterDivider } from './FilterBar'
export { default as PageHeader, PageContainer, Section } from './PageHeader'

// New (Phase 1) primitives
export { default as Modal } from './Modal'
export { default as Tabs } from './Tabs'
export { default as Spinner } from './Spinner'
export { default as LoadingOverlay } from './LoadingOverlay'
export { default as Toolbar, ToolbarDivider } from './Toolbar'
export { default as NumberInput } from './NumberInput'
export { default as Tooltip } from './Tooltip'
export { default as PeriodFilter } from './PeriodFilter'
export { default as RangeDatePicker } from './RangeDatePicker'
export { default as DensityToggle } from './DensityToggle'

// Profitabilitate extractions
export { default as ContributionMarginTable } from './ContributionMarginTable'
export { default as SubsidiaryBadge } from './SubsidiaryBadge'
export { default as CurrencyNotice } from './CurrencyNotice'

// Hooks (re-exported for ergonomics)
export { default as useConfirm } from '../../hooks/useConfirm'
export { default as useColumnVisibility } from '../../hooks/useColumnVisibility'
export { default as useTableDensity } from '../../hooks/useTableDensity'
