import logging
import time
import uuid

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)


def _internal_headers(user_id: str | None = None):
    settings = get_settings()
    headers: dict[str, str] = {
        "x-internal-service": "brain",
        "x-request-id": str(uuid.uuid4()),
        "x-timestamp": str(int(time.time() * 1000)),
    }
    if settings.gateway_internal_secret:
        headers["x-internal-secret"] = settings.gateway_internal_secret
    if user_id:
        headers["x-user-id"] = user_id
    return headers


async def fetch_gmail_threads(user_id: str, limit: int = 5, importance_only: bool = True) -> dict:
    settings = get_settings()
    params = {
        "limit": limit,
        "importance_only": "true" if importance_only else "false",
        "user_id": user_id,
    }
    url = f"{settings.gateway_url}/api/gmail/threads"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params, headers=_internal_headers(user_id))
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.warning("Gateway Gmail fetch failed: %s", exc)
        return {"threads": [], "meta": {}}


async def semantic_gmail_search(user_id: str, query: str, limit: int = 5) -> list[dict]:
    settings = get_settings()
    url = f"{settings.gateway_url}/api/gmail/threads/search"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                url,
                params={"user_id": user_id},
                json={"query": query, "limit": limit},
                headers=_internal_headers(user_id)
            )
        response.raise_for_status()
        data = response.json()
        return data.get("threads", [])
    except httpx.HTTPError as exc:
        logger.warning("Semantic gmail search failed: %s", exc)
        return []


async def fetch_gmail_thread_detail(user_id: str, thread_id: str) -> dict | None:
    settings = get_settings()
    url = f"{settings.gateway_url}/api/gmail/threads/{thread_id}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                url,
                params={"user_id": user_id},
                headers=_internal_headers(user_id)
            )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.warning("Failed to load Gmail thread detail: %s", exc)
        return None


async def search_service_account_emails(user_id: str, query: str) -> list[dict]:
    """Search for emails across all connected service accounts."""
    settings = get_settings()
    url = f"{settings.gateway_url}/api/service-accounts/search"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                url,
                params={"q": query},
                headers=_internal_headers(user_id)
            )
        response.raise_for_status()
        data = response.json()
        return data.get("threads", [])
    except httpx.HTTPError as exc:
        logger.warning("Service account search failed: %s", exc)
        return []


async def fetch_calendar_events(user_id: str, time_min: str | None = None, time_max: str | None = None) -> list[dict]:
    """Fetch calendar events from all connected accounts."""
    settings = get_settings()
    url = f"{settings.gateway_url}/api/calendar/events"
    params = {"user_id": user_id}
    if time_min:
        params["start"] = time_min
    if time_max:
        params["end"] = time_max
        
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                url,
                params=params,
                headers=_internal_headers(user_id)
            )
        response.raise_for_status()
        data = response.json()
        return data.get("events", [])
    except httpx.HTTPError as exc:
        logger.warning("Calendar fetch failed: %s", exc)
        return []


async def fetch_attachment(user_id: str, message_id: str, attachment_id: str) -> bytes | None:
    """Download attachment content from Gateway."""
    settings = get_settings()
    url = f"{settings.gateway_url}/api/gmail/messages/{message_id}/attachments/{attachment_id}"
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                url,
                headers=_internal_headers(user_id)
            )
        response.raise_for_status()
        return response.content
    except httpx.HTTPError as exc:
        logger.warning("Attachment download failed: %s", exc)
        return None


async def fetch_whoop_recovery(user_id: str) -> dict | None:
    """Fetch user's latest Whoop recovery data."""
    settings = get_settings()
    url = f"{settings.gateway_url}/api/whoop/recovery"
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                url,
                headers=_internal_headers(user_id)
            )
        if response.status_code == 401:
            return None # Not connected
        response.raise_for_status()
        data = response.json()
        return data.get("recovery")
    except httpx.HTTPError as exc:
        logger.warning("Whoop fetch failed: %s", exc)
        return None


async def fetch_service_account_thread(user_id: str, account_id: str, thread_id: str) -> dict | None:
    settings = get_settings()
    url = f"{settings.gateway_url}/api/service-accounts/{account_id}/threads/{thread_id}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                url,
                headers=_internal_headers(user_id)
            )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.warning("Failed to load Service Account thread: %s", exc)
        return None


async def fetch_service_account_attachment(user_id: str, account_id: str, message_id: str, attachment_id: str) -> bytes | None:
    settings = get_settings()
    url = f"{settings.gateway_url}/api/service-accounts/{account_id}/messages/{message_id}/attachments/{attachment_id}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                url,
                headers=_internal_headers(user_id)
            )
        response.raise_for_status()
        return response.content
    except httpx.HTTPError as exc:
        logger.warning("Service Account Attachment download failed: %s", exc)
        return None

async def fetch_whoop_cycle(user_id: str) -> dict | None:
    settings = get_settings()
    url = f"{settings.gateway_url}/api/whoop/cycles"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=_internal_headers(user_id))
        if response.status_code == 401: return None
        response.raise_for_status()
        return response.json().get("cycle")
    except httpx.HTTPError as exc:
        logger.warning("Whoop cycle fetch failed: %s", exc)
        return None

async def fetch_whoop_sleep(user_id: str) -> dict | None:
    settings = get_settings()
    url = f"{settings.gateway_url}/api/whoop/sleep"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=_internal_headers(user_id))
        if response.status_code == 401: return None
        response.raise_for_status()
        return response.json().get("sleep")
    except httpx.HTTPError as exc:
        logger.warning("Whoop sleep fetch failed: %s", exc)
        return None

async def fetch_whoop_workout(user_id: str) -> dict | None:
    settings = get_settings()
    url = f"{settings.gateway_url}/api/whoop/workout"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=_internal_headers(user_id))
        if response.status_code == 401: return None
        response.raise_for_status()
        return response.json().get("workout")
    except httpx.HTTPError as exc:
        logger.warning("Whoop workout fetch failed: %s", exc)
        return None

async def fetch_whoop_profile(user_id: str) -> dict | None:
    settings = get_settings()
    url = f"{settings.gateway_url}/api/whoop/profile"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=_internal_headers(user_id))
        if response.status_code == 401: return None
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.warning("Whoop profile fetch failed: %s", exc)
        return None

async def fetch_whoop_measurements(user_id: str) -> dict | None:
    settings = get_settings()
    url = f"{settings.gateway_url}/api/whoop/measurements"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=_internal_headers(user_id))
        if response.status_code == 401: return None
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.warning("Whoop measurements fetch failed: %s", exc)
        return None


async def fetch_whoop_baselines(user_id: str, days: int = 30) -> dict | None:
    """Fetch monthly baselines (avg HRV, RHR, sleep) for vitals comparison."""
    settings = get_settings()
    url = f"{settings.gateway_url}/api/whoop/baselines"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                url,
                params={"days": days},
                headers=_internal_headers(user_id)
            )
        if response.status_code in (401, 503):
            return None
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.warning("Whoop baselines fetch failed: %s", exc)
        return None
