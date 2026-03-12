"""
Courier CSV Import package — splits into focused modules.

- parsers.py     → Column mappings, courier presets, transform functions
- background.py  → Background CSV processing, batch DB matching
- endpoints.py   → FastAPI HTTP endpoints
"""
from app.api.courier_csv.endpoints import router

__all__ = ["router"]
