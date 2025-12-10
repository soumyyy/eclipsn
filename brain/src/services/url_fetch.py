import asyncio
from typing import Optional, Tuple

from tavily import TavilyClient

from ..config import get_settings


async def fetch_url_content(url: str) -> Tuple[str, Optional[str]]:
    """Fetch URL content via Tavily extract API. Returns (content, title)."""
    settings = get_settings()
    if not settings.tavily_api_key or not url:
        return "", None

    client = TavilyClient(api_key=settings.tavily_api_key)

    def _extract():
        return client.extract(url=url)

    try:
        data = await asyncio.to_thread(_extract)
    except Exception:  # pragma: no cover - Tavily/network failures
        return "", None

    content = (data or {}).get("content") or ""
    title = (data or {}).get("title") or url
    return content.strip(), title
