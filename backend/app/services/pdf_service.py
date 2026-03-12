"""
PDF Service for generating print batches.

Handles:
- Downloading AWB PDFs from Frisbo
- Generating A6 separator pages
- Merging PDFs into a single batch
"""
import os
from io import BytesIO
from typing import List, Dict, Any, Tuple

from pypdf import PdfWriter, PdfReader
from reportlab.lib.pagesizes import A6
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

from app.core.config import settings
from app.services.frisbo_client import frisbo_client


class PDFService:
    """Service for PDF generation and manipulation."""
    
    def __init__(self):
        self.storage_path = settings.pdf_storage_path
        os.makedirs(self.storage_path, exist_ok=True)
    
    async def generate_batch_pdf(
        self,
        groups: List[Dict[str, Any]],
        batch_number: str
    ) -> Tuple[str, int]:
        """
        Generate a merged batch PDF.
        
        Args:
            groups: List of groups with orders
            batch_number: Unique batch identifier
            
        Returns:
            Tuple of (file_path, file_size)
        """
        writer = PdfWriter()
        
        for group in groups:
            # Generate separator page for this group
            separator_pdf = self._generate_separator_page(
                group_name=group["name"],
                group_color=group["color"],
                order_count=len(group["orders"])
            )
            writer.append(PdfReader(BytesIO(separator_pdf)))
            
            # Download and append each order's AWB
            for order in group["orders"]:
                if order.awb_pdf_url:
                    try:
                        awb_pdf = await frisbo_client.download_awb_pdf(order.awb_pdf_url)
                        writer.append(PdfReader(BytesIO(awb_pdf)))
                    except Exception as e:
                        # If download fails, add an error page instead
                        error_pdf = self._generate_error_page(
                            order_number=order.order_number,
                            error=str(e)
                        )
                        writer.append(PdfReader(BytesIO(error_pdf)))
        
        # Write to file
        file_path = os.path.join(self.storage_path, f"{batch_number}.pdf")
        
        output = BytesIO()
        writer.write(output)
        pdf_bytes = output.getvalue()
        
        with open(file_path, "wb") as f:
            f.write(pdf_bytes)
        
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
