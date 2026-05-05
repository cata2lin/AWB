"""Verify that store_uid timestamp matches org_uid timestamp for direct token lookup."""
from app.core.config import settings

org_map = settings.get_org_token_map()

# Build org timestamp -> org config map
org_by_ts = {}
for org_uid, cfg in org_map.items():
    parts = org_uid.split("-")
    if len(parts) >= 6:
        ts = parts[5]
        org_by_ts[ts] = (org_uid, cfg)

stores = [
    "03c31499-a28d-4cc7-b760-b2c5172f948f-1749064023-8IDHEEFLIT",
    "75801bb8-54c7-461a-9e82-665c58405876-1749063850-WIUC7717L6",
    "5a67aeb6-35fb-4fc7-b0b8-dccae38b31bf-1765442373-6TKLACMPIK",
    "95c51908-c5ee-41cb-8fa9-438957069ed9-1749064270-6G08N0D9UJ",
    "a3e207dc-70a3-489f-bccd-2d060f6d634d-1749063872-WVUSVFT4PJ",
    "dd18bcb8-b76b-455b-8378-237f283a88b8-1765442265-K3QTMXZLF0",
]

for s in stores:
    parts = s.split("-")
    ts = parts[5] if len(parts) >= 6 else "?"
    if ts in org_by_ts:
        org_uid, cfg = org_by_ts[ts]
        print(f"MATCH: store_ts={ts} -> {cfg.get('name','?')}")
    else:
        print(f"NO MATCH: store_ts={ts}")
