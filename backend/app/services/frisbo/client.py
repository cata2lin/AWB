"""
Frisbo API Client — handles HTTP communication with the Frisbo Store-View API.

Edit THIS file for API endpoint changes, request/response handling, and authentication.
For data mapping changes, edit parser.py instead.
"""
import logging
from typing import List, Optional, Dict, Any

import httpx

from app.core.config import settings
from app.services.frisbo.rate_limiter import RateLimiter
from app.services.frisbo.parser import parse_order

# Configure logger
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.DEBUG)


class FrisboClient:
    """Client for Frisbo Store-View API."""
    
    def __init__(self, token: str = None, org_name: str = None):
        self.base_url = settings.frisbo_api_url
        self.token = token or settings.frisbo_api_token
        self.org_name = org_name or "default"
        self.rate_limiter = RateLimiter(settings.frisbo_rate_limit)
        
        # Log configuration on init
        logger.info("=" * 60)
        logger.info(f"FRISBO CLIENT INITIALIZED (org: {self.org_name})")
        logger.info(f"  Base URL: {self.base_url}")
        logger.info(f"  Token: {self.token[:20]}...{self.token[-10:] if len(self.token) > 30 else self.token}")
        logger.info(f"  Rate Limit: {settings.frisbo_rate_limit} req/sec")
        logger.info("=" * 60)
    
    def _get_headers(self) -> Dict[str, str]:
        """Get authorization headers."""
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
    
    async def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict] = None,
        json: Optional[Dict] = None
    ) -> Dict:
        """Make a rate-limited API request with detailed logging."""
        await self.rate_limiter.acquire()
        
        url = f"{self.base_url}{endpoint}"
        headers = self._get_headers()
        
        # Log request details
        logger.info("-" * 60)
        logger.info(f"🚀 FRISBO API REQUEST")
        logger.info(f"  Method: {method}")
        logger.info(f"  URL: {url}")
        logger.info(f"  Params: {params}")
        logger.info(f"  Headers: Authorization: Bearer {self.token[:15]}...")
        if json:
            logger.info(f"  Body: {json}")
        
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:  # Increased timeout for slow Frisbo API
                response = await client.request(
                    method,
                    url,
                    headers=headers,
                    params=params,
                    json=json
                )
                
                # Log response details
                logger.info(f"📥 FRISBO API RESPONSE")
                logger.info(f"  Status Code: {response.status_code}")
                logger.info(f"  Response Headers: {dict(response.headers)}")
                
                # Try to get response body regardless of status
                try:
                    response_body = response.json()
                    logger.info(f"  Response Body (preview): {str(response_body)[:500]}...")
                except Exception:
                    response_body = response.text
                    logger.info(f"  Response Text: {response_body[:500]}...")
                
                # Check for errors
                if response.status_code >= 400:
                    logger.error(f"❌ API ERROR: {response.status_code}")
                    logger.error(f"  Full Response: {response_body}")
                    response.raise_for_status()
                
                logger.info(f"✅ Request successful")
                logger.info("-" * 60)
                
                return response_body if isinstance(response_body, dict) else {"data": response_body}
                
        except httpx.HTTPStatusError as e:
            logger.error(f"❌ HTTP STATUS ERROR: {e}")
            logger.error(f"  Request URL: {e.request.url}")
            logger.error(f"  Response Status: {e.response.status_code}")
            try:
                error_body = e.response.json()
                logger.error(f"  Error Body: {error_body}")
            except Exception:
                logger.error(f"  Error Text: {e.response.text}")
            raise
        except httpx.RequestError as e:
            logger.error(f"❌ REQUEST ERROR: {e}")
            logger.error(f"  Request URL: {e.request.url if e.request else 'N/A'}")
            raise
        except Exception as e:
            logger.error(f"❌ UNEXPECTED ERROR: {type(e).__name__}: {e}")
            raise
    
    async def search_orders(
        self,
        skip: int = 0,
        limit: int = 100,
        store_uids: Optional[List[str]] = None,
        aggregated_status_keys: Optional[List[str]] = None,
        created_at_start: Optional[str] = None,
        created_at_end: Optional[str] = None,
        updated_at_start: Optional[str] = None,
        updated_at_end: Optional[str] = None
    ) -> Dict:
        """
        Search orders with filters.
        
        Args:
            aggregated_status_keys: Filter by status (e.g., 'not_generated', 'shipped')
            created_at_start: Filter orders created after this datetime (ISO format)
            created_at_end: Filter orders created before this datetime (ISO format)
            updated_at_start: Filter orders updated after this datetime (ISO format)
            updated_at_end: Filter orders updated before this datetime (ISO format)
        
        Returns:
            {"data": [...orders...], "total": int, "skip": int, "limit": int}
        """
        params = {
            "skip": skip,
            "limit": min(limit, 100)  # API max is 100
        }
        
        if store_uids:
            params["store_uids[]"] = store_uids
        
        if aggregated_status_keys:
            params["aggregated_status_keys[]"] = aggregated_status_keys
        
        # Date range filters (new Frisbo API feature)
        if created_at_start:
            params["created_at_start"] = created_at_start
        if created_at_end:
            params["created_at_end"] = created_at_end
        if updated_at_start:
            params["updated_at_start"] = updated_at_start
        if updated_at_end:
            params["updated_at_end"] = updated_at_end
        
        return await self._request("GET", "/orders/search", params=params)
    
    async def get_order(self, order_uid: str) -> Dict:
        """Get a single order by UID."""
        return await self._request("GET", f"/orders/{order_uid}")
    
    async def fetch_orders(
        self,
        updated_at_start: Optional[str] = None,
        updated_at_end: Optional[str] = None,
        created_at_start: Optional[str] = None,
        created_at_end: Optional[str] = None
    ) -> List[Dict]:
        """
        Fetch all orders with pagination, optionally filtered by date range.
        
        For incremental syncs, use updated_at_start to get only orders
        that have been modified since the last sync.
        
        Frisbo API returns: {"success": true, "data": {"orders": [...]}}
        
        Returns:
            List of all matching orders
        """
        all_orders = []
        skip = 0
        limit = 100
        
        filter_desc = []
        if updated_at_start:
            filter_desc.append(f"updated_at_start={updated_at_start}")
        if created_at_start:
            filter_desc.append(f"created_at_start={created_at_start}")
        
        logger.info(f"📦 Fetching orders with filters: {', '.join(filter_desc) if filter_desc else 'none'}")
        
        while True:
            result = await self.search_orders(
                skip=skip,
                limit=limit,
                updated_at_start=updated_at_start,
                updated_at_end=updated_at_end,
                created_at_start=created_at_start,
                created_at_end=created_at_end
            )
            
            # Frisbo structure: {"success": true/false, "data": {"orders": [...]}}
            orders = []
            if isinstance(result, dict):
                # Check success flag
                if result.get("success") is False:
                    logger.error(f"Frisbo API returned success=false: {result}")
                    break
                
                # Get data object
                data = result.get("data", {})
                if isinstance(data, dict):
                    # Orders are in data.orders
                    orders = data.get("orders", [])
                elif isinstance(data, list):
                    # Fallback if data is directly a list
                    orders = data
            
            if not isinstance(orders, list):
                logger.warning(f"Orders is not a list: {type(orders)}")
                orders = []
            
            logger.info(f"Fetched {len(orders)} orders (skip={skip})")
            all_orders.extend(orders)
            
            # Check if we got all orders (no more to fetch)
            if len(orders) < limit:
                break
            
            skip += limit
        
        logger.info(f"Total orders fetched: {len(all_orders)}")
        return all_orders
    
    # Keep backward compatibility
    async def fetch_all_unfulfilled_orders(self) -> List[Dict]:
        """Backward compatibility wrapper - fetches all orders."""
        return await self.fetch_orders()
    
    async def download_awb_pdf(self, url: str) -> bytes:
        """
        Download AWB PDF from a shipment URL.
        
        Args:
            url: Direct URL to the AWB PDF
            
        Returns:
            PDF file bytes
        """
        await self.rate_limiter.acquire()
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(url, headers=self._get_headers())
            response.raise_for_status()
            return response.content
    
    async def update_order_fulfillment(
        self,
        order_reference: str,
        tracking_number: Optional[str] = None,
        courier_name: Optional[str] = None,
        fulfillment_status: str = "fulfilled",
        shipment_status: str = "created_awb",
        aggregated_status: str = "waiting_for_courier",
    ) -> Dict:
        """
        Update an order's statuses in Frisbo after AWB printing.
        
        Uses POST /orders/order endpoint (create or update).
        Pushes three status fields:
          - fulfillment_status: "fulfilled"
          - shipment_status: "created_awb" (Shipment: created awb)
          - aggregated_status: "waiting_for_courier" (Workflow: waiting for courier)
        """
        payload = {
            "order": {
                "external_identifier": order_reference,
                "reference": order_reference,
                "fulfillment_status": fulfillment_status,
                "shipment_status": shipment_status,
                "aggregated_status": aggregated_status,
            }
        }
        
        # Add tracking/fulfillment data if available
        if tracking_number:
            fulfillment = {
                "tracking_numbers": [tracking_number],
            }
            if courier_name:
                fulfillment["tracking_company"] = courier_name
            payload["order"]["fulfillments"] = [fulfillment]
        
        return await self._request(
            "POST",
            "/orders/order",
            json=payload
        )

    async def update_orders_printed_batch(self, orders_data: List[Dict]) -> Dict:
        """
        Update multiple orders' fulfillment status after AWB printing.
        
        Args:
            orders_data: List of dicts with keys:
                - reference: order reference/number
                - tracking_number: AWB tracking number (optional)
                - courier_name: courier key (optional)
        
        Returns:
            Dict with success/failure counts.
        """
        success = 0
        failed = 0
        errors = []
        
        for order_data in orders_data:
            try:
                await self.update_order_fulfillment(
                    order_reference=order_data["reference"],
                    tracking_number=order_data.get("tracking_number"),
                    courier_name=order_data.get("courier_name"),
                )
                success += 1
            except Exception as e:
                failed += 1
                errors.append(f"{order_data['reference']}: {str(e)[:100]}")
                logger.warning(
                    f"Failed to update Frisbo status for order {order_data['reference']}: {e}"
                )
        
        logger.info(
            f"Frisbo status update batch: {success} success, {failed} failed"
        )
        return {"success": success, "failed": failed, "errors": errors[:10]}
    
    # Delegate parsing to the parser module
    def parse_order(self, raw_order: Dict) -> Dict:
        """Parse raw Frisbo order into our internal format. Delegates to parser module."""
        return parse_order(raw_order)


# Singleton instance
frisbo_client = FrisboClient()
