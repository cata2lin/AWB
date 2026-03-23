"""Product model — synced inventory items from Frisbo API."""
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, Float, Boolean, DateTime, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Product(Base):
    """
    Inventory item synced from Frisbo API.
    
    Each product can be listed on multiple stores (via store_uids JSON array).
    Stock levels are aggregated from all inventory owners (Frisbo + merchant).
    Images are stored as JSON array of {src, position} objects.
    """
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    uid: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    organization_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    external_identifier: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # Product info
    title_1: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # Product name
    title_2: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # Variant name
    sku: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    barcode: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    hs_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # Harmonized system code
    state: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, default="active")  # active/draft/archived/deleted/replaced
    
    # Dimensions
    weight: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # grams
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # mm
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)   # mm
    length: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # mm
    
    # Flags
    requires_shipping: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=True)
    quantity_tracked: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=True)
    managed_by: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # frisbo / others
    selling_policy: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # deny / continue
    
    # Rich data (JSON)
    images: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)      # [{src, position}]
    store_uids: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)  # [store_uid_1, store_uid_2, ...]
    
    # Stock levels (aggregated from all inventory owners)
    stock_available: Mapped[int] = mapped_column(Integer, default=0)       # All owners combined
    stock_committed: Mapped[int] = mapped_column(Integer, default=0)       # Reserved/committed
    stock_incoming: Mapped[int] = mapped_column(Integer, default=0)        # Incoming shipments
    stock_frisbo_available: Mapped[int] = mapped_column(Integer, default=0)  # Frisbo-managed
    stock_other_available: Mapped[int] = mapped_column(Integer, default=0)   # Merchant-managed
    
    # Exclusion flag (mystery boxes, bundles that shouldn't count in stock totals)
    exclude_from_stock: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # Primary listing preference — stored on all products in a barcode/SKU group.
    # Points to the UID of the listing whose stock/image should be used as the group's source of truth.
    primary_listing_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Timestamps
    frisbo_created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    frisbo_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
