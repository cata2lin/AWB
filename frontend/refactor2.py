file_path = "c:\\Users\\Admin\\Desktop\\AWB Print\\awb-print-manager\\frontend\\src\\pages\\Analytics.jsx"

with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

# The map loop is between lines 2651 and 2779 (0-indexed 2650 to 2779)
start_line = 2650
end_line = 2779

new_block = """                                                            {sortedProducts.map((p, i) => {
                                                                const rowKey = `${p.sku}::${p.store_uid || ''}`
                                                                const isSelected = velocitySelectedSkus.has(rowKey)
                                                                const isExpanded = velocityExpanded === rowKey
                                                                
                                                                return (
                                                                    <VelocityRow 
                                                                        key={rowKey}
                                                                        p={p}
                                                                        i={i}
                                                                        rowKey={rowKey}
                                                                        isSelected={isSelected}
                                                                        isExpanded={isExpanded}
                                                                        velocityMetricsType={velocityMetricsType}
                                                                        velocityTargetCoverage={velocityTargetCoverage}
                                                                        isColVisible={isColVisible}
                                                                        onToggleSelect={handleToggleSelect}
                                                                        onToggleExpand={handleToggleExpand}
                                                                        COUNTRY_FLAGS={COUNTRY_FLAGS}
                                                                        Sparkline={Sparkline}
                                                                        setSelectedVariantOrders={setSelectedVariantOrders}
                                                                    />
                                                                )
                                                            })}
"""

lines = lines[:start_line] + [new_block] + lines[end_line:]

with open(file_path, "w", encoding="utf-8") as f:
    f.writelines(lines)
print("SUCCESS")
