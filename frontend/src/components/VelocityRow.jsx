import React, { Fragment, memo } from 'react';
import { Package, ArrowUpRight, ArrowDownRight, ArrowRight } from 'lucide-react';

const TrendIcon = ({ t }) => 
    t === 'up' ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" /> : 
    t === 'down' ? <ArrowDownRight className="w-3.5 h-3.5 text-red-500" /> : 
    <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />;

const VelocityRow = memo(({
    p, i, rowKey, isSelected, isExpanded,
    velocityMetricsType, velocityTargetCoverage,
    isColVisible, onToggleSelect, onToggleExpand,
    COUNTRY_FLAGS, Sparkline, setSelectedVariantOrders
}) => {
    const sales = velocityMetricsType === 'net' ? p.units_sold : (p.gross_units || 0);
    const revenue = velocityMetricsType === 'net' ? p.revenue : (p.gross_revenue || 0);
    const velocity = velocityMetricsType === 'net' ? p.velocity : (p.gross_velocity || 0);
    const necesar = Math.max(0, Math.ceil((velocityTargetCoverage * velocity) - (p.effective_stock || (p.stock_available || 0) + (p.po_incoming || 0))));

    return (
        <Fragment>
            <tr className={`hover:bg-zinc-50 dark:hover:bg-zinc-700/30 cursor-pointer ${isExpanded ? 'bg-zinc-50 dark:bg-zinc-700/30' : ''} ${isSelected ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''}`}
                onClick={() => onToggleExpand(rowKey)}>
                <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected}
                        onChange={e => onToggleSelect(rowKey, e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 text-emerald-600 focus:ring-emerald-500" />
                </td>
                <td className="px-3 py-2 text-xs text-zinc-400">{i + 1}</td>
                
                {isColVisible('image') && (
                    <td className="px-3 py-2">
                        <div className="w-10 h-10 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                            {p.image_url ? (
                                <img src={p.image_url} alt={p.sku} className="w-full h-full object-cover" />
                            ) : (
                                <Package className="w-5 h-5 text-zinc-400" />
                            )}
                        </div>
                    </td>
                )}

                {isColVisible('sku') && (
                    <td className="px-3 py-2">
                        <div className="text-sm font-medium text-zinc-900 dark:text-white">{p.sku}</div>
                        {p.product_name && <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[200px]">{p.product_name}</div>}
                    </td>
                )}

                {isColVisible('sales') && <td className="px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">{sales.toLocaleString()}</td>}
                {isColVisible('orders') && <td className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400">{p.orders}</td>}
                {isColVisible('revenue') && <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">{revenue.toLocaleString()} <span className="text-[10px] text-zinc-400">RON</span></td>}
                {isColVisible('velocity') && <td className="px-3 py-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">{velocity}</td>}
                
                {isColVisible('trend') && (
                    <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                            <TrendIcon t={p.velocity_trend} />
                            <span className={`text-xs font-medium ${p.velocity_change_pct > 0 ? 'text-emerald-600' : p.velocity_change_pct < 0 ? 'text-red-600' : 'text-zinc-400'}`}>
                                {p.velocity_change_pct > 0 ? '+' : ''}{p.velocity_change_pct}%
                            </span>
                        </div>
                    </td>
                )}

                {isColVisible('days_without') && (
                    <td className={`px-3 py-2 text-sm ${p.days_since_last_sale !== null && p.days_since_last_sale >= 14 ? 'text-red-600 font-medium' : 'text-zinc-600 dark:text-zinc-400'}`}>
                        {p.days_since_last_sale !== null ? `${p.days_since_last_sale}z` : '—'}
                    </td>
                )}

                {isColVisible('stock') && <td className={`px-3 py-2 text-sm ${p.stock_available > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'} font-medium`}>{(p.stock_available || 0).toLocaleString()}</td>}
                
                {isColVisible('unit_cost') && <td className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400">{(p.unit_cost || 0).toFixed(2)}</td>}
                {isColVisible('inventory_value') && <td className="px-3 py-2 text-sm font-medium text-amber-600 dark:text-amber-400">{(p.inventory_value || 0).toLocaleString()}</td>}

                {isColVisible('po_incoming') && (
                    <td className={`px-3 py-2 text-sm font-medium ${(p.po_incoming || 0) > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`}>
                        {(p.po_incoming || 0).toLocaleString()}
                    </td>
                )}
                
                {isColVisible('days_left') && (
                    <td className={`px-3 py-2 text-sm ${p.days_left_of_stock !== null && p.days_left_of_stock <= 7 ? 'text-red-600 font-medium' : 'text-zinc-600 dark:text-zinc-400'}`}>
                        {p.days_left_of_stock === 9999 ? '∞' : p.days_left_of_stock}
                    </td>
                )}

                {isColVisible('recommended') && (
                    <td className={`px-3 py-2 text-sm font-medium ${necesar > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'}`}>
                        {necesar}
                    </td>
                )}

                {isColVisible('share_pct') && <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{p.revenue_share}%</td>}
            </tr>
            {/* Expanded detail */}
            {isExpanded && (
                <tr className="bg-zinc-50 dark:bg-zinc-900/40">
                    <td colSpan={16} className="px-4 py-4">
                        <div className="space-y-4">
                            {/* Per-Variant Breakdown */}
                            {p.by_variant && p.by_variant.length > 0 && (
                                <div>
                                    <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">📦 Variante & Magazine</h5>
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
                                                <th className="text-left py-1.5 pr-3">Variantă (SKU)</th>
                                                <th className="text-left py-1.5 pr-3">Magazin</th>
                                                <th className="text-right py-1.5 px-2">Brut</th>
                                                <th className="text-right py-1.5 px-2">Net</th>
                                                <th className="text-right py-1.5 px-2">Rev. Brut</th>
                                                <th className="text-right py-1.5 px-2">Rev. Net</th>
                                                <th className="text-right py-1.5 px-2">Comenzi</th>
                                                <th className="text-right py-1.5 px-2">V (u/zi)</th>
                                                <th className="text-left py-1.5 pl-3 w-[120px]">Trend</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                                            {p.by_variant.map(var_data => (
                                                <tr key={var_data.variant_key} 
                                                    className="hover:bg-zinc-100 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                                                    onClick={() => setSelectedVariantOrders({ sku: var_data.sku, orders: var_data.orders_list || [] })}
                                                    title="Click pentru a vedea comenzile componente"
                                                >
                                                    <td className="py-1.5 pr-3">
                                                        <span className="font-medium text-emerald-600 dark:text-emerald-400 border-b border-emerald-600/30 border-dashed">{var_data.sku}</span>
                                                    </td>
                                                    <td className="py-1.5 pr-3">
                                                        <span className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full">{var_data.store_name}</span>
                                                    </td>
                                                    <td className="text-right py-1.5 px-2 text-zinc-500 dark:text-zinc-400">{var_data.gross_units.toLocaleString()}</td>
                                                    <td className="text-right py-1.5 px-2 font-medium text-zinc-700 dark:text-zinc-300">{var_data.units_sold.toLocaleString()}</td>
                                                    <td className="text-right py-1.5 px-2 text-zinc-500 dark:text-zinc-400">{var_data.gross_revenue.toLocaleString()}</td>
                                                    <td className="text-right py-1.5 px-2 text-zinc-700 dark:text-zinc-300">{var_data.revenue.toLocaleString()}</td>
                                                    <td className="text-right py-1.5 px-2 text-zinc-600 dark:text-zinc-400">{var_data.orders}</td>
                                                    <td className="text-right py-1.5 px-2 font-bold text-emerald-600 dark:text-emerald-400">{var_data.velocity}</td>
                                                    <td className="py-1.5 pl-3"><Sparkline data={var_data.daily_series} /></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">🌍 Per Țară</h5>
                                    <div className="space-y-1 text-xs">
                                        {p.by_country.map(bc => (
                                            <div key={bc.country} className="flex justify-between">
                                                <span className="text-zinc-600 dark:text-zinc-400">{COUNTRY_FLAGS[bc.country] || 'ðŸ ³️'} {bc.country}</span>
                                                <span className="font-medium text-zinc-700 dark:text-zinc-200">{bc.units} u | {bc.revenue.toLocaleString()} RON</span>
                                            </div>
                                        ))}
                                        {p.by_country.length === 0 && <div className="text-zinc-400">—</div>}
                                    </div>
                                </div>
                                <div>
                                    <h5 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">📊 Detalii</h5>
                                    <div className="space-y-1 text-xs">
                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Avg qty/order</span><span className="font-medium text-zinc-700 dark:text-zinc-200">{p.avg_qty_per_order}</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Zile Stoc Rămas</span><span className={`font-medium ${p.days_left_of_stock <= 7 ? 'text-red-600' : 'text-zinc-700 dark:text-zinc-200'}`}>{p.days_left_of_stock === 9999 ? '∞' : p.days_left_of_stock}</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Necesar Recomandat</span><span className="font-medium text-amber-600 dark:text-amber-400">{Math.max(0, Math.ceil((velocityTargetCoverage * p.velocity) - ((p.stock_available || 0) + (p.po_incoming || 0))))}</span></div>
                                        {(p.po_incoming || 0) > 0 && (
                                            <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">PO Incoming</span><span className="font-medium text-blue-600 dark:text-blue-400">{p.po_incoming}</span></div>
                                        )}
                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Delivery rate</span><span className="font-medium text-zinc-700 dark:text-zinc-200">{p.delivery_rate}%</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Viteză anterioară</span><span className="font-medium text-zinc-700 dark:text-zinc-200">{p.prev_velocity} u/zi</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-600 dark:text-zinc-400">Viteză actuală</span><span className="font-medium text-emerald-600">{p.velocity} u/zi</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </Fragment>
    );
});

export default VelocityRow;
