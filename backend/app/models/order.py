"""Order model."""
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, Text, Boolean, DateTime, ForeignKey, JSON, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Order(Base):
    """Cached order from Frisbo API."""
    __tablename__ = "orders"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    uid: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    order_number: Mapped[str] = mapped_column(String(100), index=True)
    store_uid: Mapped[str] = mapped_column(String(100), ForeignKey("stores.uid"))
    
    # Order details
    customer_name: Mapped[str] = mapped_column(String(255))
    customer_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    shipping_address: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    # Items
    line_items: Mapped[dict] = mapped_column(JSON)  # Full line_items array
    item_count: Mapped[int] = mapped_column(Integer, default=1)  # Total quantity
    unique_sku_count: Mapped[int] = mapped_column(Integer, default=1)  # Unique SKUs
    
    # AWB/Shipment info
    tracking_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    courier_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    awb_pdf_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # From shipments[]
    shipment_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Status tracking
    fulfillment_status: Mapped[str] = mapped_column(String(50), default="unfulfilled")
    financial_status: Mapped[str] = mapped_column(String(50), default="pending")
    payment_gateway: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # e.g. "Plată ramburs" (COD), "Shopify Payments" (card)
    shipment_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)  # not_created, created_awb, etc.
    aggregated_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)  # not_fulfilled, waiting_for_courier, etc.
    is_printed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    
    # Multi-AWB support (max 10 per order)
    awb_count: Mapped[int] = mapped_column(Integer, default=1)  # Number of AWB labels (1-10)
    awb_count_manual: Mapped[bool] = mapped_column(Boolean, default=False)  # Set manually by user
    
    # Shipping details (from CSV import or historical matching)
    package_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # Nr colete
    package_weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Greutate kg
    transport_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Cost transport real
    shipping_data_source: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # csv_import | historical_match | manual
    shipping_data_manual: Mapped[bool] = mapped_column(Boolean, default=False)  # True = don't overwrite on import
    
    # Pricing (from Frisbo)
    total_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    subtotal_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_discounts: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(String(10), nullable=True, default="RON")
    
    # Timestamps
    frisbo_created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    fulfilled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)  # When order was fulfilled
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    printed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    waiting_for_courier_since: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)  # Set when mark_waiting_for_courier called
    
    # Relationships
    store: Mapped["Store"] = relationship(back_populates="orders")
    batch_items: Mapped[List["PrintBatchItem"]] = relationship(back_populates="order")
    awbs: Mapped[List["OrderAwb"]] = relationship(back_populates="order", cascade="all, delete-orphan")

