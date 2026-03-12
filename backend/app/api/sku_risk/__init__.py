"""
SKU Risk package — re-exports for backward compatibility.

- computations.py → Constants, outcome mapping, normalization helpers
- endpoint.py     → The FastAPI endpoint
"""
from app.api.sku_risk.endpoint import router

__all__ = ["router"]
