"""
Rate limiter for Frisbo API requests.
Token bucket algorithm with async support.
"""
import asyncio


class RateLimiter:
    """Simple rate limiter for API requests."""
    
    def __init__(self, rate: int = 20):
        """Initialize with requests per second."""
        self.rate = rate
        self.tokens = rate
        self.last_refill = asyncio.get_event_loop().time()
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        """Acquire a token, waiting if necessary."""
        async with self._lock:
            now = asyncio.get_event_loop().time()
            elapsed = now - self.last_refill
            
            # Refill tokens based on elapsed time
            self.tokens = min(self.rate, self.tokens + elapsed * self.rate)
            self.last_refill = now
            
            if self.tokens < 1:
                wait_time = (1 - self.tokens) / self.rate
                await asyncio.sleep(wait_time)
                self.tokens = 1
            
            self.tokens -= 1
