"""
PDF Service for generating print batches.

Handles:
- Downloading AWB PDFs from Frisbo (concurrent, connection-pooled)
- Generating A6 separator pages
- Merging PDFs into a single batch
"""
import os
import asyncio
import logging
import time
from io import BytesIO
from typing import List, Dict, Any, Tuple

from pypdf import PdfWriter, PdfReader
from reportlab.lib.pagesizes import A6
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

from app.core.config import settings

logger = logging.getLogger(__name__)

# Concurrency limit for parallel AWB downloads
MAX_CONCURRENT_DOWNLOADS = 10


class PDFService:
    """Service for PDF generation and manipulation."""
    
    def __init__(self):
        self.storage_path = settings.pdf_storage_path
        os.makedirs(self.storage_path, exist_ok=True)
    
    async def _download_awb(
        self,
        client: "httpx.AsyncClient",
        order: Any,
        semaphore: asyncio.Semaphore,
        base_url: str,
        auth_headers: Dict[str, str],
    ) -> Tuple[Any, bytes]:
        """
        Download a single AWB PDF with concurrency control.
        
        Returns:
            Tuple of (order, pdf_bytes). pdf_bytes is None on failure.
        """
        async with semaphore:
            url = order.awb_pdf_url
            # Only add auth headers for Frisbo API URLs, not S3 pre-signed
            headers = auth_headers if base_url in url else {}
            try:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                return (order, resp.content)
            except Exception as e:
                logger.warning(f"[PDF] AWB download failed for {order.order_number}: {e}")
                return (order, None)
    
    async def generate_batch_pdf(
        self,
        groups: List[Dict[str, Any]],
        batch_number: str
    ) -> Tuple[str, int]:
        """
        Generate a merged batch PDF with concurrent AWB downloads.
        
        Downloads all AWBs in parallel (up to MAX_CONCURRENT_DOWNLOADS at once),
        then merges them in the correct group/order sequence.
        """
        import httpx
        from app.services.frisbo_client import frisbo_client
        
        t0 = time.time()
        
        # Flatten all orders while preserving group/position for merge order
        all_orders = []
        for group in groups:
            for order in group["orders"]:
                if order.awb_pdf_url:
                    all_orders.append(order)
        
        logger.info(f"[PDF] Starting concurrent download of {len(all_orders)} AWBs (max {MAX_CONCURRENT_DOWNLOADS} parallel)")
        
        # Download all AWBs concurrently with a shared client (connection pooling)
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
        base_url = frisbo_client.base_url
        auth_headers = frisbo_client._get_headers()
        
        async with httpx.AsyncClient(timeout=60.0, limits=httpx.Limits(max_connections=MAX_CONCURRENT_DOWNLOADS)) as client:
            tasks = [
                self._download_awb(client, order, semaphore, base_url, auth_headers)
                for order in all_orders
            ]
            results = await asyncio.gather(*tasks)
        
        # Build lookup: order uid → pdf bytes
        pdf_map = {order.uid: pdf_bytes for order, pdf_bytes in results}
        
        t_download = time.time()
        downloaded = sum(1 for _, b in results if b is not None)
        failed = sum(1 for _, b in results if b is None)
        logger.info(
            f"[PDF] Downloads complete: {downloaded} OK, {failed} failed "
            f"({t_download - t0:.1f}s)"
        )
        
        # Merge PDFs in the original group/order sequence
        writer = PdfWriter()
        for group in groups:
            for order in group["orders"]:
                pdf_bytes = pdf_map.get(order.uid)
                if pdf_bytes:
                    try:
                        writer.append(PdfReader(BytesIO(pdf_bytes)))
                    except Exception as e:
                        logger.warning(f"[PDF] Failed to parse PDF for {order.order_number}: {e}")
                        error_pdf = self._generate_error_page(
                            order_number=order.order_number,
                            error=f"PDF parse error: {str(e)[:80]}"
                        )
                        writer.append(PdfReader(BytesIO(error_pdf)))
                else:
                    # Download failed — insert error page
                    error_pdf = self._generate_error_page(
                        order_number=order.order_number,
                        error="AWB download failed"
                    )
                    writer.append(PdfReader(BytesIO(error_pdf)))
        
        # Write to file
        file_path = os.path.join(self.storage_path, f"{batch_number}.pdf")
        
        output = BytesIO()
        writer.write(output)
        pdf_bytes = output.getvalue()
        
        with open(file_path, "wb") as f:
            f.write(pdf_bytes)
        
        t_total = time.time()
        logger.info(
            f"[PDF] Batch {batch_number} complete: {len(all_orders)} AWBs, "
            f"{len(pdf_bytes)/1024:.0f} KB, "
            f"download={t_download - t0:.1f}s merge={t_total - t_download:.1f}s total={t_total - t0:.1f}s"
        )
        
        return file_path, len(pdf_bytes)
    
    def _generate_separator_page(
        self,
        group_name: str,
        group_color: str,
        order_count: int
    ) -> bytes:
        """
        Generate an A6 separator page for a group.
        
        The separator includes:
        - Group name in large text
        - Color indicator
        - Order count
        """
        buffer = BytesIO()
        
        # A6 size: 105mm x 148mm
        c = canvas.Canvas(buffer, pagesize=A6)
        width, height = A6
        
        # Background color band at top
        try:
            color = HexColor(group_color)
        except:
            color = HexColor("#6366f1")
        
        c.setFillColor(color)
        c.rect(0, height - 40*mm, width, 40*mm, fill=True, stroke=False)
        
        # White text on color band
        c.setFillColor(HexColor("#ffffff"))
        c.setFont("Helvetica-Bold", 18)
        
        # Truncate group name if too long
        display_name = group_name[:25] + "..." if len(group_name) > 25 else group_name
        c.drawCentredString(width / 2, height - 25*mm, display_name)
        
        # Order count
        c.setFont("Helvetica", 12)
        c.drawCentredString(width / 2, height - 35*mm, f"{order_count} orders")
        
        # Main content area
        c.setFillColor(HexColor("#000000"))
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(width / 2, height - 60*mm, "SEPARATOR PAGE")
        
        c.setFont("Helvetica", 10)
        c.drawCentredString(width / 2, height - 70*mm, "Remove this page before shipping")
        
        c.save()
        return buffer.getvalue()
    
    def _generate_error_page(self, order_number: str, error: str) -> bytes:
        """Generate an error page for failed AWB downloads."""
        buffer = BytesIO()
        c = canvas.Canvas(buffer, pagesize=A6)
        width, height = A6
        
        # Red warning band
        c.setFillColor(HexColor("#ef4444"))
        c.rect(0, height - 30*mm, width, 30*mm, fill=True, stroke=False)
        
        c.setFillColor(HexColor("#ffffff"))
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(width / 2, height - 18*mm, "AWB DOWNLOAD FAILED")
        
        # Details
        c.setFillColor(HexColor("#000000"))
        c.setFont("Helvetica-Bold", 12)
        c.drawCentredString(width / 2, height - 50*mm, f"Order: {order_number}")
        
        c.setFont("Helvetica", 9)
        c.drawCentredString(width / 2, height - 65*mm, "Error:")
        
        # Truncate error if too long
        error_display = error[:50] + "..." if len(error) > 50 else error
        c.drawCentredString(width / 2, height - 75*mm, error_display)
        
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(width / 2, height - 95*mm, "Please print this AWB manually")
        
        c.save()
        return buffer.getvalue()
