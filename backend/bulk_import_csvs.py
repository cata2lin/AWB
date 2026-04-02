"""
Bulk CSV Import Script — processes all CSV files from a folder.

Auto-detects courier type from column headers and imports each file.
Skips non-courier CSVs (like product/SKU exports).

Usage:
  python bulk_import_csvs.py <csv_folder_path>

Example:
  python bulk_import_csvs.py "C:\\Users\\Admin\\Desktop\\AWB Print\\CSV"
"""
import asyncio
import csv
import io
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(__file__))

from app.core.database import async_session
from app.models import CourierCsvImport
from app.core.config import settings
from app.api.courier_csv.parsers import (
    COURIER_PRESETS,
    find_column, find_column_by_name, detect_csv_params,
    detect_courier_from_headers,
)
from app.api.courier_csv.background import process_csv_background


async def import_single_csv(file_path: str, filename: str):
    """Import a single CSV file with auto-detection."""
    
    # --- Try to detect encoding and courier ---
    detected_key = None
    headers = []
    file_encoding = 'utf-8-sig'
    detected_delimiter = ','
    sample = ''
    
    # Try UTF-8 first
    for enc in ['utf-8-sig', 'utf-16', 'latin-1']:
        try:
            with open(file_path, 'r', encoding=enc, errors='replace') as f:
                sample = ''.join(f.readline() for _ in range(10))
            if not sample.strip():
                continue
            detected_delimiter, headers = detect_csv_params(sample)
            detected_key = detect_courier_from_headers(headers, delimiter=detected_delimiter, encoding=enc)
            if detected_key:
                file_encoding = enc
                break
            # Even if not detected, if we got headers, keep trying
            if headers:
                file_encoding = enc
        except Exception:
            continue
    
    if not detected_key:
        print(f"  ⏭  SKIP — Cannot identify courier from headers: {[h.strip() for h in headers[:8]]}")
        return None
    
    preset = COURIER_PRESETS[detected_key]
    file_encoding = preset.get('encoding', file_encoding)
    
    # Re-read with correct encoding if needed
    if file_encoding != 'utf-8-sig':
        try:
            with open(file_path, 'r', encoding=file_encoding, errors='replace') as f:
                sample = ''.join(f.readline() for _ in range(10))
            detected_delimiter, headers = detect_csv_params(sample)
        except Exception as e:
            print(f"  ❌ FAIL — Cannot re-read with {file_encoding}: {e}")
            return None
    
    # Apply preset
    delimiter = preset.get('delimiter', detected_delimiter) or detected_delimiter
    awb_transform_fn = preset.get('awb_transform')
    cost_transform_fn = preset.get('cost_transform')
    order_ref_transform_fn = preset.get('order_ref_transform')
    awb_type_transform_fn = preset.get('awb_type_transform')
    pcols = preset.get('columns', {})
    
    # Re-parse headers with correct delimiter
    if delimiter != detected_delimiter:
        reader = csv.reader(io.StringIO(sample.split('\n')[0]), delimiter=delimiter)
        try:
            headers = next(reader)
        except StopIteration:
            pass
    
    # Find column indices
    awb_column = pcols.get('awb')
    awb_idx = find_column_by_name(headers, awb_column) if awb_column else None
    if awb_idx is None and 'awb_column_index' in preset:
        awb_idx = preset['awb_column_index']
    if awb_idx is None:
        awb_idx = find_column(headers, 'awb')
    if awb_idx is None:
        print(f"  ❌ FAIL — Cannot find AWB column in headers")
        return None
    
    pkg_idx = find_column_by_name(headers, pcols['packages']) if pcols.get('packages') else None
    if pkg_idx is None:
        pkg_idx = find_column(headers, 'package_count')
    
    wgt_idx = find_column_by_name(headers, pcols['weight']) if pcols.get('weight') else None
    if wgt_idx is None:
        wgt_idx = find_column(headers, 'weight')
    
    cost_idx = find_column_by_name(headers, pcols['cost']) if pcols.get('cost') else None
    if cost_idx is None:
        cost_idx = find_column(headers, 'transport_cost')
    
    order_ref_idx = find_column_by_name(headers, pcols['order_ref']) if pcols.get('order_ref') else None
    if order_ref_idx is None:
        order_ref_idx = find_column(headers, 'order_ref')
    
    awb_type_idx = find_column_by_name(headers, pcols['awb_type']) if pcols.get('awb_type') else None
    if awb_type_idx is None:
        awb_type_idx = find_column(headers, 'awb_type')
    
    original_awb_idx = find_column_by_name(headers, pcols['original_awb']) if pcols.get('original_awb') else None
    if original_awb_idx is None:
        original_awb_idx = find_column(headers, 'original_awb')
    
    cost_fara_tva_idx = find_column_by_name(headers, pcols['cost_fara_tva']) if pcols.get('cost_fara_tva') else None
    if cost_fara_tva_idx is None:
        cost_fara_tva_idx = find_column(headers, 'cost_fara_tva')
    
    cost_tva_idx = find_column_by_name(headers, pcols['cost_tva']) if pcols.get('cost_tva') else None
    if cost_tva_idx is None:
        cost_tva_idx = find_column(headers, 'cost_tva')
    
    cost_currency_idx = find_column_by_name(headers, pcols['cost_currency']) if pcols.get('cost_currency') else None
    if cost_currency_idx is None:
        cost_currency_idx = find_column(headers, 'cost_currency')
    
    content_idx = find_column_by_name(headers, pcols['content']) if pcols.get('content') else None
    if content_idx is None:
        content_idx = find_column(headers, 'content')
    
    status_idx = find_column_by_name(headers, pcols['status']) if pcols.get('status') else None
    if status_idx is None:
        status_idx = find_column(headers, 'status')
    
    # Create import log
    async with async_session() as db:
        import_log = CourierCsvImport(
            filename=filename,
            courier_name=detected_key.upper(),
            total_rows=0,
            matched_rows=0,
            unmatched_rows=0,
            status="processing",
        )
        db.add(import_log)
        await db.commit()
        await db.refresh(import_log)
        import_id = import_log.id
        
        # Archive the CSV
        csv_archive_dir = os.path.join(settings.pdf_storage_path, "csv_imports")
        os.makedirs(csv_archive_dir, exist_ok=True)
        archive_filename = f"import_{import_id}_{filename}"
        archive_path = os.path.join(csv_archive_dir, archive_filename)
        try:
            shutil.copy2(file_path, archive_path)
            import_log.saved_file_path = archive_path
            await db.commit()
        except Exception as e:
            print(f"  ⚠  Archive failed: {e}")
    
    # Run import synchronously (not in background — we want sequential processing)
    print(f"  📊 Processing (import_id={import_id})...")
    await process_csv_background(
        import_id=import_id,
        file_path=file_path,
        delimiter=delimiter,
        awb_idx=awb_idx,
        pkg_idx=pkg_idx,
        wgt_idx=wgt_idx,
        cost_idx=cost_idx,
        encoding=file_encoding,
        awb_transform=awb_transform_fn,
        cost_transform=cost_transform_fn,
        order_ref_idx=order_ref_idx,
        awb_type_idx=awb_type_idx,
        original_awb_idx=original_awb_idx,
        cost_fara_tva_idx=cost_fara_tva_idx,
        cost_tva_idx=cost_tva_idx,
        cost_currency_idx=cost_currency_idx,
        content_idx=content_idx,
        status_idx=status_idx,
        order_ref_transform=order_ref_transform_fn,
        awb_type_transform=awb_type_transform_fn,
        courier_key=detected_key,
        delete_file_after=False,  # keep original file
    )
    
    # Print results
    async with async_session() as db:
        from sqlalchemy import select
        result = await db.execute(select(CourierCsvImport).where(CourierCsvImport.id == import_id))
        log = result.scalar_one()
        print(f"  ✅ {log.status.upper()} — {log.total_rows} rows, {log.matched_rows} matched ({round(log.matched_rows/max(log.total_rows,1)*100,1)}%)")
        if log.error_message:
            print(f"  ⚠  {log.error_message[:200]}")
    
    return import_id


async def main(csv_folder: str):
    """Process all CSV files in the folder."""
    if not os.path.isdir(csv_folder):
        print(f"❌ Folder not found: {csv_folder}")
        sys.exit(1)
    
    csv_files = sorted([
        f for f in os.listdir(csv_folder)
        if f.lower().endswith('.csv')
    ])
    
    print(f"\n{'='*60}")
    print(f"  Bulk CSV Import — {len(csv_files)} files found")
    print(f"  Folder: {csv_folder}")
    print(f"{'='*60}\n")
    
    results = {"imported": 0, "skipped": 0, "failed": 0}
    
    for i, fname in enumerate(csv_files, 1):
        fpath = os.path.join(csv_folder, fname)
        fsize = os.path.getsize(fpath) / (1024 * 1024)
        print(f"\n[{i}/{len(csv_files)}] {fname} ({fsize:.1f} MB)")
        
        try:
            result = await import_single_csv(fpath, fname)
            if result:
                results["imported"] += 1
            else:
                results["skipped"] += 1
        except Exception as e:
            print(f"  ❌ ERROR: {e}")
            results["failed"] += 1
    
    print(f"\n{'='*60}")
    print(f"  SUMMARY")
    print(f"  Imported: {results['imported']}")
    print(f"  Skipped:  {results['skipped']} (non-courier CSVs)")
    print(f"  Failed:   {results['failed']}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\Admin\Desktop\AWB Print\CSV"
    asyncio.run(main(folder))
