"""
AWB Print Manager - FastAPI Backend
Main application entry point
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import orders, rules, stores, print_batch, sync, analytics, sku_costs, presets, profitability_config, exchange_rates, courier_csv, business_costs, sku_risk, sales_velocity, sku_profitability, sku_marketing_costs
from app.core.config import settings
from app.core.database import engine, Base
from app.services.scheduler import scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events."""
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Sync BNR exchange rates on startup
    try:
        from app.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            await exchange_rates.sync_bnr_rates(db)
            await db.commit()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"BNR rate sync on startup failed: {e}")
    
    # Start background scheduler
    scheduler.start()
    
    yield
    
    # Shutdown
    scheduler.shutdown()


app = FastAPI(
    title="AWB Print Manager",
    description="API for managing AWB printing with Frisbo integration",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Configuration — configurable via ALLOWED_ORIGINS env var
import os
cors_origins = os.getenv("ALLOWED_ORIGINS", "").split(",") if os.getenv("ALLOWED_ORIGINS") else [
    "http://localhost:3000", "http://localhost:5173", "http://localhost:5174",
    "http://localhost:5143",
    "https://awb.arona.ro", "http://awb.arona.ro",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(orders.router, prefix="/api/orders", tags=["orders"])
app.include_router(rules.router, prefix="/api/rules", tags=["rules"])
app.include_router(stores.router, prefix="/api/stores", tags=["stores"])
app.include_router(print_batch.router, prefix="/api/print", tags=["print"])
app.include_router(sync.router, prefix="/api/sync", tags=["sync"])
app.include_router(analytics.router, prefix="/api", tags=["analytics"])
app.include_router(sku_costs.router, prefix="/api", tags=["sku-costs"])
app.include_router(presets.router, prefix="/api/presets", tags=["presets"])
app.include_router(profitability_config.router, prefix="/api", tags=["profitability-config"])
app.include_router(exchange_rates.router, prefix="/api", tags=["exchange-rates"])
app.include_router(courier_csv.router, prefix="/api/courier-csv", tags=["courier-csv"])
app.include_router(business_costs.router, prefix="/api/business-costs", tags=["business-costs"])
app.include_router(sku_risk.router, prefix="/api", tags=["sku-risk"])
app.include_router(sales_velocity.router, prefix="/api", tags=["sales-velocity"])
app.include_router(sku_profitability.router, prefix="/api", tags=["sku-profitability"])
app.include_router(sku_marketing_costs.router, prefix="/api", tags=["sku-marketing-costs"])


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "version": "1.0.0"}
