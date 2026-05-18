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
        self.tokens = float(rate)
        # Lazy-initialized: set on first acquire() inside a running event loop
        # to avoid asyncio.get_event_loop() deprecation warning in Python 3.10+
        self.last_refill: float | None = None
        self._lock = asyncio.Lock()

    async def acquire(self):
        """Acquire a token, waiting if necessary."""
        async with self._lock:
            now = asyncio.get_event_loop().time()

            # Initialize on first call (guaranteed to be inside a running loop here)
            if self.last_refill is None:
                self.last_refill = now

            elapsed = now - self.last_refill

            # Refill tokens proportional to elapsed time (token bucket)
            self.tokens = min(float(self.rate), self.tokens + elapsed * self.rate)
            self.last_refill = now

            if self.tokens < 1.0:
                wait_time = (1.0 - self.tokens) / self.rate
                await asyncio.sleep(wait_time)
                self.tokens = 0.0

            self.tokens -= 1.0
