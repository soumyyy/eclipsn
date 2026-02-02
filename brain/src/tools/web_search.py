import asyncio
from typing import List, Tuple

from tavily import TavilyClient

from ..config import get_settings
from ..models.schemas import SearchSource


async def web_search_tool(query: str, max_results: int = 4) -> Tuple[str, List[SearchSource]]:
    """Execute a Tavily web search. Returns summary text and structured sources."""
    settings = get_settings()
    if not settings.tavily_api_key:
        return "", []

    client = TavilyClient(api_key=settings.tavily_api_key)

    def _search():
        return client.search(query=query, max_results=max_results)

    try:
        data = await asyncio.to_thread(_search)
    except Exception as exc:  # pragma: no cover - network failures
        return f"(Web search failed: {exc})", []

    results = data.get("results", [])
    sources: List[SearchSource] = []
    summary_lines: List[str] = []
    for item in results:
        title = item.get("title", "Untitled")
        url = item.get("url", "")
        snippet = item.get("content", "").strip()
        
        # Filter out self-referential Tavily sources
        if "tavily ai" in title.lower() and "ai search" in title.lower():
            continue
            
        source = SearchSource(title=title, url=url, snippet=snippet)
        sources.append(source)
        summary_lines.append(f"{title} — {snippet}")

    summary_text = "\n".join(summary_lines)
    return summary_text, sources
