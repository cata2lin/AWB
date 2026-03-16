/**
 * API Service barrel re-export — backward compatible.
 *
 * All API modules split into individual files for easy editing:
 *   client.js       → Shared Axios instance
 *   orders.js       → Orders + order actions
 *   stores.js       → Store management
 *   rules.js        → Rule CRUD
 *   sync.js         → Sync operations
 *   print.js        → Print batch operations
 *   analytics.js    → Analytics endpoints
 *   skuCosts.js     → SKU cost management
 *   presets.js      → Rule preset management
 *   config.js       → Profitability config + health
 *   courierCsv.js   → Courier CSV import
 *   businessCosts.js → Business cost management
 */
export { ordersApi, orderActionsApi } from './orders'
export { storesApi } from './stores'
export { rulesApi } from './rules'
export { syncApi } from './sync'
export { printApi } from './print'
export { analyticsApi, skuMarketingCostsApi } from './analytics'
export { skuCostsApi } from './skuCosts'
export { presetsApi } from './presets'
export { profitabilityConfigApi, healthApi } from './config'
export { courierCsvApi } from './courierCsv'
export { businessCostsApi } from './businessCosts'

// Default export: the shared Axios instance
export { default } from './client'
