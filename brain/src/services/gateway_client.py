import logging
import httpx
from ..config import get_settings

logger = logging.getLogger(__name__)


async def fetch_gmail_threads(limit: int = 5, importance_only: bool = True) -> dict:
    settings = get_settings()
    url = f"{settings.gateway_url}/api/gmail/threads?limit={limit}&importance_only={'true' if importance_only else 'false'}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.warning("Gateway Gmail fetch failed: %s", exc)
        return { "threads": [], "meta": {} }


async def semantic_gmail_search(query: str, limit: int = 5) -> list[dict]:
  settings = get_settings()
  url = f"{settings.gateway_url}/api/gmail/threads/search"
  try:
    async with httpx.AsyncClient(timeout=10.0) as client:
      response = await client.post(url, json={ "query": query, "limit": limit })
    response.raise_for_status()
    data = response.json()
    return data.get("threads", [])
  except httpx.HTTPError as exc:
    logger.warning("Semantic gmail search failed: %s", exc)
    return []


async def fetch_gmail_thread_detail(thread_id: str) -> dict | None:
    settings = get_settings()
    url = f"{settings.gateway_url}/api/gmail/threads/{thread_id}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.warning("Failed to load Gmail thread detail: %s", exc)
        return None
