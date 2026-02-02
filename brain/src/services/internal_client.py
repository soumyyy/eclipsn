"""
Production-grade internal HTTP client for Gateway communication.
Provides reliable service-to-service communication with proper error handling.
"""
import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Union
from uuid import uuid4

import httpx
from ..config import get_settings

logger = logging.getLogger(__name__)


class InternalAPIError(Exception):
    """Internal API communication errors."""
    def __init__(self, message: str, status_code: int = 0, response_data: Dict = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_data = response_data or {}


class CircuitBreakerError(InternalAPIError):
    """Circuit breaker is open."""
    pass


class CircuitBreaker:
    """
    Production-grade circuit breaker for internal API calls.
    Implements fail-fast pattern to prevent cascading failures.
    """
    
    def __init__(self, failure_threshold: int = 5, recovery_timeout: int = 60):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.last_failure_time = 0
        self.state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
        self._lock = asyncio.Lock()
    
    async def call_with_breaker(self, func, *args, **kwargs):
        """Execute function with circuit breaker protection."""
        async with self._lock:
            if self.state == "OPEN":
                if self._should_attempt_reset():
                    self.state = "HALF_OPEN"
                    logger.info("[CircuitBreaker] Attempting recovery")
                else:
                    raise CircuitBreakerError("Circuit breaker is OPEN")
        
        try:
            result = await func(*args, **kwargs)
            await self._record_success()
            return result
        except Exception as e:
            await self._record_failure()
            raise e
    
    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to attempt recovery."""
        return (asyncio.get_event_loop().time() - self.last_failure_time) >= self.recovery_timeout
    
    async def _record_success(self):
        """Record successful call."""
        async with self._lock:
            self.failure_count = 0
            if self.state == "HALF_OPEN":
                self.state = "CLOSED"
                logger.info("[CircuitBreaker] Circuit breaker CLOSED - service recovered")
    
    async def _record_failure(self):
        """Record failed call."""
        async with self._lock:
            self.failure_count += 1
            self.last_failure_time = asyncio.get_event_loop().time()
            
            if self.failure_count >= self.failure_threshold and self.state != "OPEN":
                self.state = "OPEN"
                logger.error(f"[CircuitBreaker] Circuit breaker OPEN - {self.failure_count} failures")


class InternalGatewayClient:
    """
    Production-grade HTTP client for internal Gateway communication.
    Features: connection pooling, circuit breaker, comprehensive error handling.
    """
    
    def __init__(self):
        self.settings = get_settings()
        self._client: Optional[httpx.AsyncClient] = None
        self.circuit_breaker = CircuitBreaker()
        self._client_lock = asyncio.Lock()
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client with proper configuration."""
        if self._client is None or self._client.is_closed:
            async with self._client_lock:
                if self._client is None or self._client.is_closed:
                    self._client = httpx.AsyncClient(
                        base_url=self.settings.gateway_url,
                        timeout=httpx.Timeout(30.0, connect=5.0),
                        limits=httpx.Limits(
                            max_connections=20,
                            max_keepalive_connections=5,
                            keepalive_expiry=30.0
                        ),
                        headers=self._get_base_headers(),
                        follow_redirects=False
                    )
                    logger.info("[InternalClient] HTTP client initialized")
        
        return self._client
    
    def _get_base_headers(self) -> Dict[str, str]:
        """Generate base authentication headers."""
        return {
            "X-Internal-Service": "brain",
            "X-Internal-Secret": self.settings.gateway_internal_secret,
            "X-Request-ID": str(uuid4()),
            "X-Timestamp": str(int(time.time() * 1000)),
            "Content-Type": "application/json",
            "User-Agent": "brain-service/1.0"
        }
    
    def _get_request_headers(self, user_id: Optional[str] = None) -> Dict[str, str]:
        """Generate request headers with optional user context."""
        headers = self._get_base_headers()
        if user_id:
            headers["X-User-ID"] = user_id
        return headers
    
    async def _make_request(
        self, 
        method: str, 
        endpoint: str, 
        user_id: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Make authenticated request to Gateway internal API."""
        
        async def _request():
            client = await self._get_client()
            headers = self._get_request_headers(user_id)
            
            logger.debug(f"[InternalClient] {method} {endpoint}", extra={
                "user_id": user_id,
                "endpoint": endpoint,
                "has_data": bool(data)
            })
            
            response = await client.request(
                method=method,
                url=endpoint,
                headers=headers,
                json=data,
                params=params
            )
            
            return self._handle_response(response, endpoint)
        
        return await self.circuit_breaker.call_with_breaker(_request)
    
    def _handle_response(self, response: httpx.Response, endpoint: str) -> Dict[str, Any]:
        """Handle HTTP response with comprehensive error checking."""
        request_id = response.headers.get("x-request-id", "unknown")
        
        # Log response
        logger.debug(f"[InternalClient] Response {response.status_code} from {endpoint}", extra={
            "status_code": response.status_code,
            "request_id": request_id,
            "response_time": response.elapsed.total_seconds() if response.elapsed else 0
        })
        
        # Handle error responses
        if response.status_code >= 400:
            try:
                error_data = response.json()
            except Exception:
                error_data = {"error": response.text}
            
            error_message = error_data.get("error", f"HTTP {response.status_code}")
            
            logger.error(f"[InternalClient] API error {response.status_code}", extra={
                "endpoint": endpoint,
                "error": error_message,
                "request_id": request_id
            })
            
            raise InternalAPIError(
                message=f"Gateway API error: {error_message}",
                status_code=response.status_code,
                response_data=error_data
            )
        
        # Parse successful response
        try:
            return response.json()
        except Exception as e:
            logger.error(f"[InternalClient] Failed to parse response", extra={
                "endpoint": endpoint,
                "error": str(e),
                "content_type": response.headers.get("content-type")
            })
            raise InternalAPIError(f"Failed to parse Gateway response: {e}")
    
    # Profile Operations
    async def get_profile(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user profile from Gateway."""
        try:
            response = await self._make_request("GET", f"/internal/profile/{user_id}", user_id)
            
            if response.get("success") and response.get("data"):
                return response["data"]
            
            return None
            
        except InternalAPIError as e:
            if e.status_code == 404:
                return None
            raise e
    
    async def update_profile(
        self,
        user_id: str,
        field: Optional[str] = None,
        value: Optional[str] = None,
        note: Optional[str] = None,
        remove_note: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update user profile in Gateway."""
        
        # Validate input
        if not field and not note and not remove_note:
            raise ValueError("Provide field+value, note, or remove_note")
        
        if field and value is None:
            raise ValueError("Value must be provided when field is specified")
        
        request_data: Dict[str, Any] = {}
        if field:
            request_data["field"] = field
            request_data["value"] = value
        if note:
            request_data["note"] = note
        if remove_note:
            request_data["remove_note"] = remove_note
        
        response = await self._make_request(
            "POST", 
            f"/internal/profile/{user_id}", 
            user_id, 
            data=request_data
        )
        
        if not response.get("success"):
            error_msg = response.get("error", "Unknown error")
            raise InternalAPIError(f"Profile update failed: {error_msg}")
        
        return response.get("data", {})
    
    async def get_profile_status(self, user_id: str) -> Dict[str, Any]:
        """Get profile status/health information."""
        response = await self._make_request("GET", f"/internal/profile/{user_id}/status", user_id)
        
        if response.get("success"):
            return response.get("data", {})
        
        raise InternalAPIError("Failed to get profile status")

    async def get_gmail_thread_summaries(
        self, user_id: str, limit: int = 500
    ) -> list[Dict[str, Any]]:
        """List Gmail thread summaries for extraction. Returns list with threadId/subject/summary/sender/category/lastMessageAt."""
        response = await self._make_request(
            "GET",
            f"/internal/gmail/threads/{user_id}",
            user_id=user_id,
            params={"limit": limit},
        )
        if not response.get("success"):
            raise InternalAPIError("Failed to list Gmail threads")
        data = response.get("data") or {}
        return data.get("threads") or []

    async def get_service_account_thread_summaries(
        self, user_id: str, limit: int = 200, lookback_days: int = 365
    ) -> list[Dict[str, Any]]:
        """List service account thread summaries for extraction."""
        response = await self._make_request(
            "GET",
            f"/internal/service-accounts/threads/{user_id}",
            user_id=user_id,
            params={"limit": limit, "lookbackDays": lookback_days},
        )
        if not response.get("success"):
            raise InternalAPIError("Failed to list service account threads")
        data = response.get("data") or {}
        return data.get("threads") or []
    
    # Connection Management
    async def close(self):
        """Close HTTP client and cleanup resources."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            logger.info("[InternalClient] HTTP client closed")
    
    @asynccontextmanager
    async def session(self):
        """Context manager for client sessions."""
        try:
            yield self
        finally:
            await self.close()
    
    # Health Check
    async def health_check(self) -> bool:
        """Perform health check against Gateway."""
        try:
            client = await self._get_client()
            response = await client.get("/health", timeout=5.0)
            return response.status_code == 200
        except Exception as e:
            logger.warning(f"[InternalClient] Health check failed: {e}")
            return False


# Global client instance
_internal_client: Optional[InternalGatewayClient] = None
_client_lock = asyncio.Lock()


async def get_internal_client() -> InternalGatewayClient:
    """Get singleton internal client instance."""
    global _internal_client
    
    if _internal_client is None:
        async with _client_lock:
            if _internal_client is None:
                _internal_client = InternalGatewayClient()
    
    return _internal_client


async def close_internal_client():
    """Close global internal client."""
    global _internal_client
    
    if _internal_client:
        await _internal_client.close()
        _internal_client = None
