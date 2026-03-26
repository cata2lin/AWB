"""
Print Batch API endpoints.

Handles print preview, batch generation, and batch history.
"""
from typing import List, Optional
import logging
import os
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
    # Only include orders matching the printable status triple:
    # fulfillment = "ready_for_picking", shipment = "generated_awb", aggregated = "ready_for_picking"
    query = select(Order).where(
        (Order.is_printed == False)
        & (Order.fulfillment_status == "ready_for_picking")
        & (Order.shipment_status == "generated_awb")
        & (Order.aggregated_status == "ready_for_picking")
    )
    
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
        
        # Iterate all org tokens per order (orders may belong to different orgs)
        org_tokens = settings.get_org_tokens()
        if org_tokens:
            marked_count = 0
            failed_count = 0
            for order in orders:
                marked = False
                for token_cfg in org_tokens:
                    client = FrisboClient(token=token_cfg["token"], org_name=token_cfg.get("name", "default"))
                    try:
                        await client.mark_waiting_for_courier(order.uid)
                        marked = True
                        break
                    except Exception as e:
                        if "Order not found" in str(e):
                            continue
                        logger.warning(f"mark_waiting_for_courier [{token_cfg.get('name')}] failed for {order.uid}: {e}")
                if marked:
                    order.waiting_for_courier_since = datetime.utcnow()
                    marked_count += 1
                else:
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


def _extract_label_url(response: dict) -> str | None:
    """
    Extract the AWB label download URL from a Frisbo API response.
    
    Based on OpenAPI schema:
      - print_shipment returns: { order, shipment }
      - shipments returns: { shipments: [] }
      - Shipment.documents[].labels[].download_url  ← the PDF URL
    
    Tries multiple paths to handle variations in the response structure.
    """
    if not isinstance(response, dict):
        return None
    
    # The response might be wrapped in a "data" key by our client
    data = response.get("data", response)
    if not isinstance(data, dict):
        return None
    
    # Path 1: print_shipment response → { shipment: { documents: [{ labels: [{ download_url }] }] } }
    shipment = data.get("shipment")
    if isinstance(shipment, dict):
        for doc in shipment.get("documents", []):
            if isinstance(doc, dict):
                for label in doc.get("labels", []):
                    if isinstance(label, dict) and label.get("download_url"):
                        return label["download_url"]
    
    # Path 2: shipments array response → { shipments: [{ documents: ... }] }
    for s in data.get("shipments", []):
        if isinstance(s, dict):
            for doc in s.get("documents", []):
                if isinstance(doc, dict):
                    for label in doc.get("labels", []):
                        if isinstance(label, dict) and label.get("download_url"):
                            return label["download_url"]
    
    # Path 3: direct URL field (unlikely but safe)
    return data.get("download_url") or data.get("label_url") or None


@router.post("/single/{order_uid}")
async def print_single_order(order_uid: str, db: AsyncSession = Depends(get_db)):
    """
    Print a single order's AWB.
    
    Uses Frisbo's print_shipment endpoint to retrieve the label.
    Falls back to stored awb_pdf_url or order re-fetch if needed.
    Marks the order as printed and notifies Frisbo.
    """
    # Fetch order from DB
    result = await db.execute(select(Order).where(Order.uid == order_uid))
    order = result.scalar_one_or_none()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Get a Frisbo client for API calls
    from app.services.frisbo.client import FrisboClient
    from app.services.frisbo.parser import parse_order as parse_frisbo_order
    from app.core.config import settings
    
    org_tokens = settings.get_org_tokens()
    if not org_tokens:
        raise HTTPException(status_code=500, detail="No Frisbo org tokens configured")
    
    # Strategy: try each org token's print_shipment until we find the label
    awb_pdf = None
    download_url = None
    working_client = None
    
    for token_cfg in org_tokens:
        client = FrisboClient(token=token_cfg["token"], org_name=token_cfg.get("name", "default"))
        
        # Try print_shipment with this token
        try:
            label_response = await client.print_shipment(order.uid)
            logger.info(f"print_shipment [{token_cfg.get('name')}] raw: {str(label_response)[:500]}")
            download_url = _extract_label_url(label_response)
            if download_url:
                logger.info(f"✅ Found label via print_shipment [{token_cfg.get('name')}]: {download_url[:120]}")
                working_client = client
                break
        except Exception as e:
            err_str = str(e)
            # "Order not found" = wrong org token → skip to next token entirely
            if "Order not found" in err_str:
                logger.debug(f"print_shipment [{token_cfg.get('name')}] — wrong org, skipping")
                continue
            # Any other failure (e.g. "not ready for picking") → try get_shipments below
            logger.debug(f"print_shipment [{token_cfg.get('name')}] failed: {err_str[:200]}")
        
        # Try get_shipments as fallback with this token
        try:
            shipments_response = await client.get_shipments(order.uid)
            logger.info(f"get_shipments [{token_cfg.get('name')}] raw: {str(shipments_response)[:500]}")
            download_url = _extract_label_url(shipments_response)
            if download_url:
                logger.info(f"✅ Found label via get_shipments [{token_cfg.get('name')}]: {download_url[:120]}")
                working_client = client
                break
        except Exception as e:
            if "Order not found" in str(e):
                continue
            logger.warning(f"get_shipments [{token_cfg.get('name')}] failed: {e}")
    
    # Use the first token as fallback if none matched
    if not working_client:
        working_client = FrisboClient(token=org_tokens[0]["token"], org_name=org_tokens[0].get("name", "default"))
    
    # Download the PDF if we have a URL
    if download_url:
        try:
            awb_pdf = await working_client.download_awb_pdf(download_url)
            order.awb_pdf_url = download_url
        except Exception as e:
            logger.warning(f"PDF download failed for {download_url}: {e}")
    
    # Attempt 2: Use stored awb_pdf_url or fetch from order data
    if not awb_pdf:
        awb_url = order.awb_pdf_url
        if not awb_url:
            try:
                raw = await working_client.get_order(order.uid)
                logger.info(f"get_order raw response: {str(raw)[:1000]}")
                raw_order = raw.get("data", raw) if isinstance(raw, dict) else raw
                # For the Order endpoint, the order object is inside data.order
                if isinstance(raw_order, dict) and "order" in raw_order:
                    raw_order = raw_order["order"]
                parsed = parse_frisbo_order(raw_order)
                awb_url = parsed.get("awb_pdf_url")
                if awb_url:
                    order.awb_pdf_url = awb_url
                    logger.info(f"Got AWB URL from get_order fallback for {order.uid}")
            except Exception as e:
                logger.warning(f"get_order fallback failed for {order.uid}: {e}")
        
        if not awb_url:
            raise HTTPException(status_code=400, detail="Could not find AWB label — not available in Frisbo")
        
        try:
            awb_pdf = await working_client.download_awb_pdf(awb_url)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"AWB download failed: {str(e)}")
    
    # Save to file
    batch_number = f"single_{order_uid}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    pdf_service = PDFService()
    file_path = os.path.join(pdf_service.storage_path, f"{batch_number}.pdf")
    
    with open(file_path, "wb") as f:
        f.write(awb_pdf)
    
    file_size = len(awb_pdf)
    
    # Create batch record
    batch = PrintBatch(
        batch_number=batch_number,
        file_path=file_path,
        file_size=file_size,
        order_count=1,
        group_count=1,
        status="completed"
    )
    db.add(batch)
    await db.flush()
    
    # Create batch item + mark printed
    batch_item = PrintBatchItem(
        batch_id=batch.id,
        order_uid=order.uid,
        group_name="Single Print",
        group_position=0
    )
    db.add(batch_item)
    
    order.is_printed = True
    order.printed_at = datetime.utcnow()
    
    await db.commit()
    
    # Notify Frisbo — mark as waiting for courier (non-critical)
    try:
        await working_client.mark_waiting_for_courier(order.uid)
        order.waiting_for_courier_since = datetime.utcnow()
        await db.commit()
        logger.info(f"Marked order {order.uid} as waiting_for_courier in Frisbo")
    except Exception as e:
        logger.warning(f"Frisbo mark_waiting_for_courier failed for {order.uid} (non-critical): {e}")
    
    return {
        "batch_id": batch.id,
        "batch_number": batch_number,
        "order_uid": order.uid,
        "order_number": order.order_number,
    }


@router.post("/regenerate/{order_uid}")
async def regenerate_order_awb(order_uid: str, db: AsyncSession = Depends(get_db)):
    """
    Regenerate an order's AWB — creates a brand new label with the courier.
    
    Uses Frisbo's regenerate_shipment endpoint to create a new label,
    then retrieves the new label via print_shipment.
    Does not change the order's printed status.
    """
    # Fetch order from DB
    result = await db.execute(select(Order).where(Order.uid == order_uid))
    order = result.scalar_one_or_none()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Get Frisbo client
    from app.services.frisbo.client import FrisboClient
    from app.services.frisbo.parser import parse_order as parse_frisbo_order
    from app.core.config import settings
    
    org_tokens = settings.get_org_tokens()
    if not org_tokens:
        raise HTTPException(status_code=500, detail="No Frisbo org tokens configured")
    
    # Find the correct org token by trying regenerate_shipment on each
    client = None
    regen_response = None
    for token_cfg in org_tokens:
        try_client = FrisboClient(token=token_cfg["token"], org_name=token_cfg.get("name", "default"))
        try:
            regen_response = await try_client.regenerate_shipment(order.uid, parcel_count=order.package_count or 1)
            logger.info(f"regenerate_shipment [{token_cfg.get('name')}] response: {str(regen_response)[:300]}")
            client = try_client
            break
        except Exception as e:
            if "Order not found" in str(e) or "500" in str(e) or "404" in str(e):
                continue
            logger.warning(f"regenerate_shipment [{token_cfg.get('name')}] failed: {e}")
            raise HTTPException(status_code=500, detail=f"Frisbo AWB regeneration failed: {str(e)}")
    
    if not client:
        raise HTTPException(status_code=500, detail="Could not find correct Frisbo org for this order")
    
    # Step 2: Retrieve the new label via print_shipment
    awb_pdf = None
    
    try:
        label_response = await client.print_shipment(order.uid)
        download_url = _extract_label_url(label_response)
        
        if download_url:
            awb_pdf = await client.download_awb_pdf(download_url)
            order.awb_pdf_url = download_url
            await db.commit()
    except Exception as e:
        logger.warning(f"print_shipment after regenerate failed for {order.uid}: {e}")
    
    # Fallback: re-fetch order to get the new URL from order data
    if not awb_pdf:
        try:
            raw = await client.get_order(order.uid)
            raw_order = raw.get("data", raw) if isinstance(raw, dict) else raw
            if isinstance(raw_order, dict) and "order" in raw_order:
                raw_order = raw_order["order"]
            parsed = parse_frisbo_order(raw_order)
            awb_url = parsed.get("awb_pdf_url")
            if awb_url:
                awb_pdf = await client.download_awb_pdf(awb_url)
                order.awb_pdf_url = awb_url
                await db.commit()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to retrieve regenerated label: {str(e)}")
    
    if not awb_pdf:
        raise HTTPException(status_code=500, detail="Regeneration succeeded but could not retrieve the new label")
    
    # Save to file
    batch_number = f"regen_{order_uid}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    pdf_service = PDFService()
    file_path = os.path.join(pdf_service.storage_path, f"{batch_number}.pdf")
    
    with open(file_path, "wb") as f:
        f.write(awb_pdf)
    
    # Create batch record
    batch = PrintBatch(
        batch_number=batch_number,
        file_path=file_path,
        file_size=len(awb_pdf),
        order_count=1,
        group_count=1,
        status="regenerated"
    )
    db.add(batch)
    await db.commit()
    
    return {
        "batch_id": batch.id,
        "batch_number": batch_number,
        "order_uid": order.uid,
        "order_number": order.order_number,
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
