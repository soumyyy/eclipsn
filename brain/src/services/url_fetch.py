"""Fetch URL content via Tavily Extract API (direct HTTP)."""

import logging
from typing import Optional, Tuple

import httpx

from ..config import get_settings

TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"
EXTRACT_TIMEOUT = 35.0  # allow 30s server-side + buffer

logger = logging.getLogger(__name__)


async def fetch_url_content(url: str) -> Tuple[str, Optional[str]]:
    """Fetch URL content via Tavily Extract API. Returns (content, title).

    Uses extract_depth=advanced and a 30s server timeout to improve success
    on JavaScript-rendered pages. Parses results[0].raw_content from the API.
    """
    settings = get_settings()
    if not settings.tavily_api_key or not url:
        return "", None

    payload = {
        "urls": [url],
        "extract_depth": "advanced",
        "timeout": 30.0,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.tavily_api_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=EXTRACT_TIMEOUT) as client:
            resp = await client.post(
                TAVILY_EXTRACT_URL,
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        logger.debug("Tavily extract failed for %s: %s", url, e)
        return "", None

    results = (data or {}).get("results") or []
    first = results[0] if results else {}
    content = (first.get("raw_content") or first.get("content") or "").strip()
    title = first.get("title") or url
    return content, title
