"""
Pydantic schemas for API request/response validation.
"""
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field


# ==================== Store Schemas ====================

class StoreBase(BaseModel):
    name: str
    color_code: str = "#6366f1"
    shopify_domain: Optional[str] = None
    is_active: bool = True


class StoreCreate(StoreBase):
    uid: str


class StoreUpdate(BaseModel):
    name: Optional[str] = None
    color_code: Optional[str] = None
    shopify_domain: Optional[str] = None
    is_active: Optional[bool] = None


class StoreResponse(StoreBase):
    id: int
    uid: str
    created_at: datetime
    order_count: int = 0
    unprinted_count: int = 0
    printable_count: int = 0  # Orders with AWB that can be printed
    
    class Config:
        from_attributes = True


# ==================== Order Schemas ====================

class LineItemSchema(BaseModel):
    sku: Optional[str] = None
    name: str
    quantity: int
    price: Optional[float] = None


class OrderBase(BaseModel):
    uid: str
    order_number: str
    store_uid: str
    customer_name: str
    item_count: int
    unique_sku_count: int


class OrderResponse(OrderBase):
    id: int
    customer_email: Optional[str] = None
    shipping_address: Optional[dict] = None
    line_items: List[dict]
    tracking_number: Optional[str] = None
    courier_name: Optional[str] = None
    awb_pdf_url: Optional[str] = None
    fulfillment_status: str
    shipment_status: Optional[str] = None
    aggregated_status: Optional[str] = None
    is_printed: bool
    frisbo_created_at: Optional[datetime] = None
    fulfilled_at: Optional[datetime] = None
    synced_at: datetime
    printed_at: Optional[datetime] = None
    store_name: Optional[str] = None
    store_color: Optional[str] = None
    # Multi-AWB
    awb_count: int = 1
    awb_count_manual: bool = False
    # Shipping data (from CSV import or historical)
    package_count: Optional[int] = None
    package_weight: Optional[float] = None
    transport_cost: Optional[float] = None
    shipping_data_source: Optional[str] = None
    shipping_data_manual: bool = False
    # Financial
    total_price: Optional[float] = None
    subtotal_price: Optional[float] = None
    currency: Optional[str] = None
    
    class Config:
        from_attributes = True


class OrderFilters(BaseModel):
    store_uids: Optional[List[str]] = None
    is_printed: Optional[bool] = None
    has_awb: Optional[bool] = None
    min_items: Optional[int] = None
    max_items: Optional[int] = None
    search: Optional[str] = None


# ==================== Rule Schemas ====================

class RuleConditions(BaseModel):
    store_uids: Optional[List[str]] = None
    min_items: Optional[int] = None
    max_items: Optional[int] = None
    sku_contains: Optional[str] = None
    courier_name: Optional[str] = None


class RuleGroupConfig(BaseModel):
    name: str
    color: str = "#6366f1"
    description: Optional[str] = None


class RuleBase(BaseModel):
    name: str
    priority: int = 0
    is_active: bool = True
    conditions: dict = Field(default_factory=dict)
    group_config: dict = Field(default_factory=dict)


class RuleCreate(RuleBase):
    pass


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None
    conditions: Optional[dict] = None
    group_config: Optional[dict] = None


class RuleResponse(RuleBase):
    id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class RulePriorityUpdate(BaseModel):
    rule_ids: List[int]  # Ordered list of rule IDs (first = highest priority)


# ==================== Print Batch Schemas ====================

class PrintGroupPreview(BaseModel):
    """Preview of a print group before generating."""
    group_name: str
    group_color: str
    rule_id: Optional[int] = None
    orders: List[OrderResponse]
    order_count: int


class PrintPreviewRequest(BaseModel):
    store_uids: Optional[List[str]] = None
    order_uids: Optional[List[str]] = None  # Specific orders to include
    limit: Optional[int] = None  # Max orders to include (batch size)


class PrintPreviewResponse(BaseModel):
    groups: List[PrintGroupPreview]
    total_orders: int
    total_groups: int


class PrintBatchCreate(BaseModel):
    order_uids: List[str]
    groups: List[PrintGroupPreview]


class PrintBatchResponse(BaseModel):
    id: int
    batch_number: str
    file_path: str
    order_count: int
    group_count: int
    status: str
    created_at: datetime
    
    class Config:
        from_attributes = True


# ==================== Sync Schemas ====================

class SyncStatusResponse(BaseModel):
    status: str
    last_sync: Optional[datetime] = None
    orders_fetched: int = 0
    orders_new: int = 0
    next_sync: Optional[datetime] = None


class SyncTriggerResponse(BaseModel):
    message: str
    sync_id: int


# ==================== Analytics Schemas ====================

class DashboardStats(BaseModel):
    total_orders: int
    unprinted_orders: int
    total_stores: int
    active_rules: int
    batches_today: int
    orders_printed_today: int


class StoreStats(BaseModel):
    uid: str
    name: str
    color_code: str
    total_orders: int
    unprinted_orders: int
    printed_orders: int


# ==================== Rule Preset Schemas ====================

class RulePresetCreate(BaseModel):
    """Create a new preset from current rules."""
    name: str
    description: Optional[str] = None


class RulePresetResponse(BaseModel):
    """Preset response with metadata."""
    id: int
    name: str
    description: Optional[str] = None
    rule_count: int = 0
    is_active: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class RulePresetDetailResponse(RulePresetResponse):
    """Preset response with full rules snapshot."""
    rules_snapshot: List[dict] = []
