import logging
import httpx
from ..config import get_settings

logger = logging.getLogger(__name__)


def _internal_headers():
    settings = get_settings()
    headers: dict[str, str] = {}
    if settings.gateway_internal_secret:
        headers["x-internal-secret"] = settings.gateway_internal_secret
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
            response = await client.get(url, params=params, headers=_internal_headers())
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
                headers=_internal_headers()
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
                headers=_internal_headers()
            )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.warning("Failed to load Gmail thread detail: %s", exc)
        return None
