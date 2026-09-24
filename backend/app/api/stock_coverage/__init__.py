"""
Stoc & Viteză — per-store stock coverage report package.
"""

from app.api.stock_coverage.endpoint import keep_warm, router

__all__ = ["keep_warm", "router"]
