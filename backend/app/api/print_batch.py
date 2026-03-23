"""
Print Batch API endpoints.

Handles print preview, batch generation, and batch history.
"""
from typing import List, Optional
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.database import get_db
from app.models import Order, Rule, PrintBatch, PrintBatchItem
from app.schemas import (
    PrintPreviewRequest, PrintPreviewResponse, PrintGroupPreview,
    PrintBatchResponse, OrderResponse
)
from app.services.rules_engine import RulesEngine
from app.services.pdf_service import PDFService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/preview", response_model=PrintPreviewResponse)
async def get_print_preview(
    request: PrintPreviewRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a preview of how orders will be grouped for printing.
    
    Uses the rules engine to group unprinted orders.
    Shows all unprinted orders regardless of AWB status.
    """
    # Build query for unprinted orders (regardless of AWB status for preview)
    query = select(Order).where(Order.is_printed == False)
    
    if request.store_uids:
        query = query.where(Order.store_uid.in_(request.store_uids))
    
    if request.order_uids:
        query = query.where(Order.uid.in_(request.order_uids))
    
    result = await db.execute(query)
    orders = result.scalars().all()
    
    if not orders:
        return PrintPreviewResponse(
            groups=[],
            total_orders=0,
            total_groups=0
        )
    
    # Get active rules
    rules_result = await db.execute(
        select(Rule).where(Rule.is_active == True).order_by(Rule.priority)
    )
    rules = rules_result.scalars().all()
    
    # Apply rules engine
    engine = RulesEngine(rules)
    groups = engine.group_orders(orders)
    
    # Apply batch size limit — truncate in sorted order across groups
    if request.limit and request.limit > 0:
        remaining = request.limit
        truncated_groups = []
        for group in groups:
            if remaining <= 0:
                break
            if len(group["orders"]) <= remaining:
                truncated_groups.append(group)
                remaining -= len(group["orders"])
            else:
                # Partial group — take first N orders
                group["orders"] = group["orders"][:remaining]
                truncated_groups.append(group)
                remaining = 0
        groups = truncated_groups
    
    # Count total orders after truncation
    total_order_count = sum(len(g["orders"]) for g in groups)
    
    # Convert to response format
    response_groups = []
    for group in groups:
        order_responses = []
        for order in group["orders"]:
            order_responses.append(OrderResponse(
                id=order.id,
                uid=order.uid,
                order_number=order.order_number,
                store_uid=order.store_uid,
                customer_name=order.customer_name,
                customer_email=order.customer_email,
                shipping_address=order.shipping_address,
                line_items=order.line_items or [],
                item_count=order.item_count,
                unique_sku_count=order.unique_sku_count,
                tracking_number=order.tracking_number,
                courier_name=order.courier_name,
                awb_pdf_url=order.awb_pdf_url,
                fulfillment_status=order.fulfillment_status,
                is_printed=order.is_printed,
                frisbo_created_at=order.frisbo_created_at,
                synced_at=order.synced_at,
                printed_at=order.printed_at,
            ))
        
        response_groups.append(PrintGroupPreview(
            group_name=group["name"],
            group_color=group["color"],
            rule_id=group.get("rule_id"),
            orders=order_responses,
            order_count=len(order_responses)
        ))
    
    return PrintPreviewResponse(
        groups=response_groups,
        total_orders=total_order_count,
        total_groups=len(response_groups)
    )


@router.post("/generate")
async def generate_print_batch(
    order_uids: List[str],
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a print batch PDF.
    
    1. Fetch orders
    2. Apply rules engine for grouping
    3. Download AWB PDFs
    4. Generate separator pages
    5. Merge into single PDF
    6. Mark orders as printed
    7. Return batch info
    """
    # Fetch orders
    result = await db.execute(
        select(Order).where(Order.uid.in_(order_uids))
    )
    orders = result.scalars().all()
    
    if not orders:
        raise HTTPException(status_code=400, detail="No orders found")
    
    # Verify all orders have AWB URLs
    orders_without_awb = [o for o in orders if not o.awb_pdf_url]
    if orders_without_awb:
        raise HTTPException(
            status_code=400,
            detail=f"{len(orders_without_awb)} orders do not have AWB labels"
        )
    
    # Get active rules and group orders
    rules_result = await db.execute(
        select(Rule).where(Rule.is_active == True).order_by(Rule.priority)
    )
    rules = rules_result.scalars().all()
    
    engine = RulesEngine(rules)
    groups = engine.group_orders(orders)
    
    # Generate PDF
    pdf_service = PDFService()
    batch_number = f"batch_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    
    try:
        file_path, file_size = await pdf_service.generate_batch_pdf(
            groups=groups,
            batch_number=batch_number
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")
    
    # Create batch record
    batch = PrintBatch(
        batch_number=batch_number,
        file_path=file_path,
        file_size=file_size,
        order_count=len(orders),
        group_count=len(groups),
        status="completed"
    )
    db.add(batch)
    await db.flush()
    
    # Create batch items and mark orders as printed
    for group in groups:
        for idx, order in enumerate(group["orders"]):
            batch_item = PrintBatchItem(
                batch_id=batch.id,
                order_uid=order.uid,
                group_name=group["name"],
                group_position=idx
            )
            db.add(batch_item)
            
            order.is_printed = True
            order.printed_at = datetime.utcnow()
    
    await db.commit()
    
    # Mark orders as 'waiting for courier' in Frisbo
    # This tells Frisbo the package is ready for pickup
    try:
        from app.services.frisbo.client import FrisboClient
        from app.core.config import settings
        
        # Group orders by org token (each org has its own client)
        org_tokens = settings.get_org_tokens()
        if org_tokens:
            # Use first token as default (most orders belong to one org)
            client = FrisboClient(token=org_tokens[0]["token"], org_name=org_tokens[0].get("name", "default"))
            
            marked_count = 0
            failed_count = 0
            for order in orders:
                try:
                    await client.mark_waiting_for_courier(order.uid)
                    order.waiting_for_courier_since = datetime.utcnow()
                    marked_count += 1
                except Exception as e:
                    logger.warning(f"Failed to mark order {order.uid} as waiting_for_courier: {e}")
                    failed_count += 1
            
            await db.commit()
            logger.info(f"Marked {marked_count} orders as waiting_for_courier in Frisbo ({failed_count} failed)")
    except Exception as e:
        # Non-critical — local print marking still succeeded
        logger.warning(f"Frisbo mark_waiting_for_courier batch failed (non-critical): {e}")
    
    return {
        "batch_id": batch.id,
        "batch_number": batch_number,
        "file_path": file_path,
        "order_count": len(orders),
        "group_count": len(groups)
    }


@router.get("/download/{batch_id}")
async def download_batch_pdf(batch_id: int, db: AsyncSession = Depends(get_db)):
    """Download a previously generated batch PDF."""
    result = await db.execute(
        select(PrintBatch).where(PrintBatch.id == batch_id)
    )
    batch = result.scalar_one_or_none()
    
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    import os
    if not os.path.exists(batch.file_path):
        raise HTTPException(status_code=404, detail="PDF file not found")
    
    return FileResponse(
        batch.file_path,
        media_type="application/pdf",
        filename=f"{batch.batch_number}.pdf"
    )


@router.get("/history", response_model=List[PrintBatchResponse])
async def get_batch_history(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Get print batch history."""
    result = await db.execute(
        select(PrintBatch)
        .order_by(PrintBatch.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    batches = result.scalars().all()
    return batches


@router.get("/history/{batch_id}")
async def get_batch_details(batch_id: int, db: AsyncSession = Depends(get_db)):
    """Get details of a specific batch including orders."""
    result = await db.execute(
        select(PrintBatch).where(PrintBatch.id == batch_id)
    )
    batch = result.scalar_one_or_none()
    
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    # Get batch items with order details
    items_result = await db.execute(
        select(PrintBatchItem, Order)
        .join(Order, PrintBatchItem.order_uid == Order.uid)
        .where(PrintBatchItem.batch_id == batch_id)
        .order_by(PrintBatchItem.group_name, PrintBatchItem.group_position)
    )
    items = items_result.all()
    
    return {
        "batch": batch,
        "items": [
            {
                "group_name": item.PrintBatchItem.group_name,
                "position": item.PrintBatchItem.group_position,
                "order_uid": item.Order.uid,
                "order_number": item.Order.order_number,
                "customer_name": item.Order.customer_name,
                "tracking_number": item.Order.tracking_number
            }
            for item in items
        ]
    }
