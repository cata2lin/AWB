"""Generate a synthetic 100k-row courier CSV for testing."""
import csv
import random
import os

ROWS = 100_000
FILENAME = "test_100k.csv"

with open(FILENAME, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f, delimiter=';')
    w.writerow(['AWB', 'Greutate', 'Cost_Transport', 'Nr_Colete'])
    for i in range(ROWS):
        w.writerow([
            f'AWB{i:07d}',
            round(random.uniform(0.5, 30.0), 2),
            round(random.uniform(5.0, 80.0), 2),
            random.randint(1, 5),
        ])

size_mb = os.path.getsize(FILENAME) / 1024 / 1024
print(f"Generated {FILENAME}: {size_mb:.2f} MB, {ROWS} rows")
