"""
Courier CSV HTTP endpoints — the FastAPI router for CSV import operations.
"""
import asyncio
import csv
import io
import os
import tempfile
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import CourierCsvImport
from app.services.shipping_estimator import estimate_missing_shipping
from app.api.courier_csv.parsers import (
    COURIER_PRESETS, COLUMN_MAPPINGS,
    find_column, find_column_by_name, detect_csv_params,
)
from app.api.courier_csv.background import process_csv_background

router = APIRouter()

# Max file size: 500 MB
MAX_FILE_SIZE = 500 * 1024 * 1024


@router.post("/import")
async def import_courier_csv(
    file: UploadFile = File(...),
    courier_name: str = Form(..., description="Courier name: DPD, Sameday, etc."),
    awb_column: Optional[str] = Form(None, description="Override AWB column name"),
    weight_column: Optional[str] = Form(None, description="Override weight column name"),
    cost_column: Optional[str] = Form(None, description="Override transport cost column name"),
    packages_column: Optional[str] = Form(None, description="Override packages column name"),
    delimiter_override: Optional[str] = Form(None, description="CSV delimiter (auto-detect if not provided)"),
    db: AsyncSession = Depends(get_db)
):
    """
    Import a courier CSV file to update shipping data on matching orders.

    Designed for large files (100k-200k+ rows):
    - Returns immediately with an import ID
    - Processing happens in background
    - Poll GET /courier-csv/import/{id}/status for progress

    Known courier presets (auto-configure columns, encoding, transforms):
    sameday, packeta, speedy, dpd
    """
    # ── Step 0: Apply courier preset if available ──
    preset_key = courier_name.strip().lower()
    preset = COURIER_PRESETS.get(preset_key)
    file_encoding = 'utf-8-sig'  # default
    awb_transform_fn = None
    cost_transform_fn = None
    order_ref_transform_fn = None
    awb_type_transform_fn = None

    if preset:
        file_encoding = preset.get('encoding', 'utf-8-sig')
        awb_transform_fn = preset.get('awb_transform')
        cost_transform_fn = preset.get('cost_transform')
        order_ref_transform_fn = preset.get('order_ref_transform')
        awb_type_transform_fn = preset.get('awb_type_transform')
        # Use preset delimiter unless explicitly overridden
        if not delimiter_override:
            delimiter_override = preset.get('delimiter')
        # Use preset column names as defaults (user overrides take priority)
        pcols = preset.get('columns', {})
        if not awb_column and pcols.get('awb'):
            awb_column = pcols['awb']
        if not cost_column and pcols.get('cost'):
            cost_column = pcols['cost']
        if not packages_column and pcols.get('packages'):
            packages_column = pcols['packages']
        if not weight_column and pcols.get('weight'):
            weight_column = pcols['weight']

    # ── Step 1: Save file to disk (streaming, bounded memory) ──
    temp_dir = os.path.join(tempfile.gettempdir(), "awb_csv_imports")
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, f"import_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{file.filename}")

    total_size = 0
    try:
        with open(temp_path, 'wb') as f:
            while True:
                chunk = await file.read(1024 * 1024)  # Read 1MB at a time
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > MAX_FILE_SIZE:
                    os.unlink(temp_path)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Max size is {MAX_FILE_SIZE // (1024*1024)}MB."
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save upload: {e}")

    # ── Step 2: Read first few lines to detect format ──
    try:
        with open(temp_path, 'r', encoding=file_encoding, errors='replace') as f:
            sample = ''.join(f.readline() for _ in range(10))
    except Exception as e:
        os.unlink(temp_path)
        raise HTTPException(status_code=400, detail=f"Cannot read CSV file: {e}")

    detected_delimiter, headers = detect_csv_params(sample)
    delimiter = delimiter_override or detected_delimiter

    if not headers:
        os.unlink(temp_path)
        raise HTTPException(status_code=400, detail="CSV file is empty or has no headers.")

    # Re-parse headers with correct delimiter (in case sample detection was different)
    if delimiter != detected_delimiter:
        reader = csv.reader(io.StringIO(sample.split('\n')[0]), delimiter=delimiter)
        try:
            headers = next(reader)
        except StopIteration:
            pass

    # ── Step 3: Find column indices ──
    # --- AWB (required) ---
    awb_idx = None
    if awb_column:
        awb_idx = find_column_by_name(headers, awb_column)
    if awb_idx is None and preset and 'awb_column_index' in preset:
        awb_idx = preset['awb_column_index']
    if awb_idx is None:
        awb_idx = find_column(headers, 'awb')
    if awb_idx is None:
        os.unlink(temp_path)
        raise HTTPException(
            status_code=400,
            detail=f"Cannot find AWB column. Headers: {headers}. "
                   f"Expected one of: {COLUMN_MAPPINGS['awb']}"
        )

    # --- Existing optional columns ---
    pkg_idx = find_column_by_name(headers, packages_column) if packages_column else None
    if pkg_idx is None:
        pkg_idx = find_column(headers, 'package_count')

    wgt_idx = find_column_by_name(headers, weight_column) if weight_column else None
    if wgt_idx is None:
        wgt_idx = find_column(headers, 'weight')

    cost_idx = find_column_by_name(headers, cost_column) if cost_column else None
    if cost_idx is None:
        cost_idx = find_column(headers, 'transport_cost')

    # --- NEW optional columns (from preset or auto-detect) ---
    pcols = preset.get('columns', {}) if preset else {}

    order_ref_idx = None
    if pcols.get('order_ref'):
        order_ref_idx = find_column_by_name(headers, pcols['order_ref'])
    if order_ref_idx is None:
        order_ref_idx = find_column(headers, 'order_ref')

    awb_type_idx = None
    if pcols.get('awb_type'):
        awb_type_idx = find_column_by_name(headers, pcols['awb_type'])
    if awb_type_idx is None:
        awb_type_idx = find_column(headers, 'awb_type')

    original_awb_idx = None
    if pcols.get('original_awb'):
        original_awb_idx = find_column_by_name(headers, pcols['original_awb'])
    if original_awb_idx is None:
        original_awb_idx = find_column(headers, 'original_awb')

    cost_fara_tva_idx = None
    if pcols.get('cost_fara_tva'):
        cost_fara_tva_idx = find_column_by_name(headers, pcols['cost_fara_tva'])
    if cost_fara_tva_idx is None:
        cost_fara_tva_idx = find_column(headers, 'cost_fara_tva')

    cost_tva_idx = None
    if pcols.get('cost_tva'):
        cost_tva_idx = find_column_by_name(headers, pcols['cost_tva'])
    if cost_tva_idx is None:
        cost_tva_idx = find_column(headers, 'cost_tva')

    cost_currency_idx = None
    if pcols.get('cost_currency'):
        cost_currency_idx = find_column_by_name(headers, pcols['cost_currency'])
    if cost_currency_idx is None:
        cost_currency_idx = find_column(headers, 'cost_currency')

    content_idx = None
    if pcols.get('content'):
        content_idx = find_column_by_name(headers, pcols['content'])
    if content_idx is None:
        content_idx = find_column(headers, 'content')

    # ── Step 4: Create import record ──
    import_log = CourierCsvImport(
        filename=file.filename or "unknown.csv",
        courier_name=courier_name,
        total_rows=0,
        matched_rows=0,
        unmatched_rows=0,
        status="processing",
    )
    db.add(import_log)
    await db.commit()
    await db.refresh(import_log)

    # ── Step 5: Launch background processing ──
    asyncio.create_task(
        process_csv_background(
            import_id=import_log.id,
            file_path=temp_path,
            delimiter=delimiter,
            awb_idx=awb_idx,
            pkg_idx=pkg_idx,
            wgt_idx=wgt_idx,
            cost_idx=cost_idx,
            encoding=file_encoding,
            awb_transform=awb_transform_fn,
            cost_transform=cost_transform_fn,
            # --- NEW ---
            order_ref_idx=order_ref_idx,
            awb_type_idx=awb_type_idx,
            original_awb_idx=original_awb_idx,
            cost_fara_tva_idx=cost_fara_tva_idx,
            cost_tva_idx=cost_tva_idx,
            cost_currency_idx=cost_currency_idx,
            content_idx=content_idx,
            order_ref_transform=order_ref_transform_fn,
            awb_type_transform=awb_type_transform_fn,
            courier_key=preset_key if preset else None,
        )
    )

    # Build detected columns info for response
    detected_cols = {
        "awb": headers[awb_idx] if awb_idx is not None and awb_idx < len(headers) else f"index:{awb_idx}",
        "package_count": headers[pkg_idx] if pkg_idx is not None else None,
        "weight": headers[wgt_idx] if wgt_idx is not None else None,
        "transport_cost": headers[cost_idx] if cost_idx is not None else None,
        "order_ref": headers[order_ref_idx] if order_ref_idx is not None and order_ref_idx < len(headers) else None,
        "awb_type": headers[awb_type_idx] if awb_type_idx is not None and awb_type_idx < len(headers) else None,
        "cost_fara_tva": headers[cost_fara_tva_idx] if cost_fara_tva_idx is not None and cost_fara_tva_idx < len(headers) else None,
        "cost_tva": headers[cost_tva_idx] if cost_tva_idx is not None and cost_tva_idx < len(headers) else None,
    }

    return {
        "status": "processing",
        "import_id": import_log.id,
        "courier_name": courier_name,
        "preset_used": preset_key if preset else None,
        "file_size_mb": round(total_size / (1024 * 1024), 2),
        "columns_detected": detected_cols,
        "message": "Import started in background. Poll /courier-csv/import/{id}/status for progress.",
    }


@router.get("/import/{import_id}/status")
async def get_import_status(import_id: int, db: AsyncSession = Depends(get_db)):
    """Get the current status and progress of a CSV import."""
    result = await db.execute(
        select(CourierCsvImport).where(CourierCsvImport.id == import_id)
    )
    imp = result.scalar_one_or_none()
    if not imp:
        raise HTTPException(status_code=404, detail="Import not found")

    return {
        "import_id": imp.id,
        "filename": imp.filename,
        "courier_name": imp.courier_name,
        "status": imp.status,
        "total_rows": imp.total_rows,
        "matched_rows": imp.matched_rows,
        "unmatched_rows": imp.unmatched_rows,
        "match_rate": round((imp.matched_rows / imp.total_rows * 100) if imp.total_rows > 0 else 0, 1),
        "error_message": imp.error_message,
        "imported_at": imp.imported_at.isoformat() if imp.imported_at else None,
    }


@router.get("/imports")
async def get_import_history(
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """Get history of CSV imports."""
    result = await db.execute(
        select(CourierCsvImport)
        .order_by(CourierCsvImport.imported_at.desc())
        .limit(limit)
    )
    imports = result.scalars().all()

    return {
        "imports": [
            {
                "id": imp.id,
                "filename": imp.filename,
                "courier_name": imp.courier_name,
                "total_rows": imp.total_rows,
                "matched_rows": imp.matched_rows,
                "unmatched_rows": imp.unmatched_rows,
                "match_rate": round((imp.matched_rows / imp.total_rows * 100) if imp.total_rows > 0 else 0, 1),
                "status": imp.status,
                "error_message": imp.error_message,
                "imported_at": imp.imported_at.isoformat() if imp.imported_at else None,
            }
            for imp in imports
        ]
    }


@router.post("/estimate-missing")
async def trigger_estimate_missing(db: AsyncSession = Depends(get_db)):
    """
    Trigger historical estimation for orders missing shipping data.
    Matches against previously imported CSV data from identical orders.
    """
    result = await estimate_missing_shipping(db)
    return {
        "status": "completed",
        "orders_updated": result["updated"],
        "orders_no_match": result["no_match"],
    }
