import httpx, json

r = httpx.get('http://localhost:8000/api/analytics/sku-risk', params={
    'days': 90,
    'min_units_sold': 5,
    'min_orders_with_sku': 3,
}, timeout=60)

d = r.json()

# 1) Analyze anomaly reasons distribution
anomalies = d.get('anomaly_orders', [])
reason_counts = {}
for a in anomalies:
    for reason in a.get('anomaly_reasons', []):
        # Extract rule type
        if 'Marj' in reason:
            key = 'NEGATIVE_MARGIN'
        elif 'Z-score' in reason:
            key = 'Z_SCORE'
        elif 'Cost' in reason or 'din total' in reason:
            key = 'COST_PCT_HIGH'
        else:
            key = reason
        reason_counts[key] = reason_counts.get(key, 0) + 1

print("=== ANOMALY REASON DISTRIBUTION ===")
for k, v in sorted(reason_counts.items(), key=lambda x: -x[1]):
    print(f"  {k}: {v} orders ({v*100/len(anomalies):.0f}% of anomalies)")

# 2) Analyze shipping cost % distribution across ALL anomalies
cost_pcts = [a['shipping_cost_pct'] for a in anomalies if a.get('shipping_cost_pct') is not None]
margins = [a['shipping_margin'] for a in anomalies if a.get('shipping_margin') is not None]
print(f"\n=== SHIPPING COST % (anomaly orders only) ===")
print(f"  Count: {len(cost_pcts)}")
if cost_pcts:
    print(f"  Min: {min(cost_pcts):.1f}%")
    print(f"  Median: {sorted(cost_pcts)[len(cost_pcts)//2]:.1f}%")
    print(f"  Max: {max(cost_pcts):.1f}%")
    above25 = sum(1 for p in cost_pcts if p > 25)
    print(f"  Above 25%: {above25} ({above25*100/len(cost_pcts):.0f}%)")

print(f"\n=== SHIPPING MARGIN (anomaly orders) ===")
if margins:
    negative = sum(1 for m in margins if m < 0)
    print(f"  Negative margins: {negative} ({negative*100/len(margins):.0f}%)")
    print(f"  Min margin: {min(margins):.2f}")
    print(f"  Median: {sorted(margins)[len(margins)//2]:.2f}")

# 3) Sample some anomaly orders to understand the pattern
print(f"\n=== SAMPLE ANOMALY ORDERS ===")
for a in anomalies[:10]:
    print(f"  total={a['order_total']}, charged={a.get('shipping_charged')}, "
          f"real={a['real_shipping_cost']}, margin={a['shipping_margin']:.2f}, "
          f"cost%={a['shipping_cost_pct']}%, outcome={a['final_outcome']}")

# 4) SKU anomaly rate distribution
skus = d.get('worst_skus', [])
anom_rates = [s['shipping_anomaly_rate'] for s in skus if s['shipping_anomaly_rate'] > 0]
print(f"\n=== SKU SHIPPING ANOMALY RATE DISTRIBUTION ===")
print(f"  SKUs with anomaly_rate > 0: {len(anom_rates)} / {len(skus)}")
if anom_rates:
    print(f"  Min: {min(anom_rates):.1f}%")
    print(f"  Avg: {sum(anom_rates)/len(anom_rates):.1f}%")
    print(f"  Max: {max(anom_rates):.1f}%")
    buckets = {'0-10%': 0, '10-20%': 0, '20-30%': 0, '30-50%': 0, '50%+': 0}
    for r_val in anom_rates:
        if r_val < 10: buckets['0-10%'] += 1
        elif r_val < 20: buckets['10-20%'] += 1
        elif r_val < 30: buckets['20-30%'] += 1
        elif r_val < 50: buckets['30-50%'] += 1
        else: buckets['50%+'] += 1
    print("  Buckets:")
    for b, c in buckets.items():
        print(f"    {b}: {c} SKUs")
