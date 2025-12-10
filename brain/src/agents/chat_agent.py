import json
import logging
import re
from typing import List, Optional, Dict

from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import Tool, StructuredTool
from langchain_core.pydantic_v1 import BaseModel, Field, root_validator

from ..config import get_settings
from ..models.schemas import ChatResponse, SearchSource
from ..tools import (
    search_memories_tool,
    web_search_tool,
    gmail_search_tool,
    gmail_semantic_search_tool,
    profile_update_tool,
    gmail_get_thread_tool,
)
from ..services.url_fetch import fetch_url_content


class ProfileUpdateInput(BaseModel):
    field: Optional[str] = Field(
        default=None,
        description="Profile field to update. Allowed keys include preferred_name, full_name, timezone, etc."
    )
    value: Optional[str] = Field(default=None, description="Value to store for the provided field.")
    note: Optional[str] = Field(default=None, description="Free-form note about the user.")

    @root_validator
    def validate_payload(cls, values: Dict) -> Dict:
        field = values.get("field")
        value = values.get("value")
        note = values.get("note")
        if not field and not note:
            raise ValueError("Provide either a (field, value) pair or a note.")
        if field and not value:
            raise ValueError("Value is required when field is provided.")
        return values

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Pluto, a personal agent for a single user. You know about the user from past conversations and, soon, from their email. Your job is to help summarize information, extract tasks, and keep track of what matters to them. Use memories when helpful, call the web_search tool whenever you need up-to-date facts or entertainment news. If the user references anything that may have changed after 2024 (news, entertainment, finance, product releases, etc.), you MUST call web_search before answering.

Formatting rules:
- Do NOT embed raw URLs or inline citations inside your main response. Rely on the UI to show sources separately.
- When referencing outside data, mention the publication/source name in plain text (e.g., "According to Indian Express..."), but leave actual links for the UI to display.
- Use the gmail_inbox tool whenever the user asks about recent emails, Gmail, inbox activity, or "what's new" in their mail.
- Use gmail_semantic_search when the user asks about a specific topic, sender, or historical email so you can retrieve the closest matches from their Gmail history.
- When the user shares personal preferences or profile details, call profile_update to store them. Provide JSON with "field" and "value" if it maps to a known field, or "note" for free-form info.
- Be verbose when explaining reasoning or listing numeric details so the user gets a useful summary."""


async def _load_llm():
    from langchain_openai import ChatOpenAI

    settings = get_settings()
    if not (settings.enable_openai and settings.openai_api_key):
        return None

    return ChatOpenAI(
        api_key=settings.openai_api_key,
        temperature=0.35,
        model_name="gpt-4o-mini",
        max_tokens=800
    )


async def _memory_tool_output(user_id: str, query: str) -> str:
    memories = await search_memories_tool(user_id=user_id, query=query)
    if not memories:
        return "No stored memories matched."
    return "\n".join(f"- {m.content}" for m in memories)


async def _web_tool_output(query: str) -> str:
    summary, sources = await web_search_tool(query)
    payload = {
        "summary": summary,
        "sources": [source.dict() for source in sources],
    }
    return json.dumps(payload)


async def _gmail_tool_output(user_id: str, query: str) -> str:
    threads = await gmail_search_tool(user_id=user_id, query=query, limit=5)
    payload = [thread.dict() for thread in threads]
    return json.dumps(payload)


def _build_tools(user_id: str) -> List[Tool]:
    async def memory_coro(q: str) -> str:
        return await _memory_tool_output(user_id, q)

    async def web_coro(q: str) -> str:
        return await _web_tool_output(q)

    async def gmail_coro(q: str) -> str:
        return await _gmail_tool_output(user_id, q)

    async def gmail_semantic_coro(q: str) -> str:
        return await gmail_semantic_search_tool(user_id=user_id, query=q, limit=5)

    async def gmail_detail_coro(q: str) -> str:
        thread_id = q.strip()
        detail = await gmail_get_thread_tool(user_id=user_id, thread_id=thread_id)
        return json.dumps(detail.dict())

    async def profile_coro(field: str | None = None, value: str | None = None, note: str | None = None) -> str:
        return await profile_update_tool(field=field, value=value, note=note)

    return [
        Tool(
            name="memory_lookup",
            func=lambda q: "Memory lookup available only in async mode.",
            coroutine=memory_coro,
            description="Retrieve relevant long-term memories about the user."
        ),
        Tool(
            name="gmail_thread_detail",
            func=lambda q: "Gmail detail available only in async mode.",
            coroutine=gmail_detail_coro,
            description="Fetch the full content of a Gmail thread. Pass the thread ID shown in gmail_semantic_search results."
        ),
        Tool(
            name="web_search",
            func=lambda q: "Web search available only in async mode.",
            coroutine=web_coro,
            description="Fetch recent information from the internet when the user asks about current events, entertainment news, or unknown facts."
        ),
        Tool(
            name="gmail_inbox",
            func=lambda q: "Gmail inbox lookup available only in async mode.",
            coroutine=gmail_coro,
            description="Summarize the user's Gmail inbox when they ask about new emails, reminders, or anything in Gmail."
        ),
        Tool(
            name="gmail_semantic_search",
            func=lambda q: "Semantic Gmail search available only in async mode.",
            coroutine=gmail_semantic_coro,
            description="Use semantic search over Gmail history when the user asks about a specific topic, person, or past email."
        ),
        StructuredTool(
            name="profile_update",
            func=lambda field=None, value=None, note=None: "Profile update available only in async mode.",
            coroutine=profile_coro,
            args_schema=ProfileUpdateInput,
            description="Update the user's profile with a structured argument object containing either field/value or a free-form note."
        ),
    ]


def _format_history(history: Optional[List[dict]], max_items: int = 6) -> str:
    if not history:
        return "(no recent conversation)"
    trimmed = history[-max_items:]
    lines = [f"{item.get('role','user')}: {item.get('content','')}" for item in trimmed]
    return "\n".join(lines)

URL_PATTERN = re.compile(r"https?://\S+")


async def _collect_url_context(message: str, max_urls: int = 2) -> tuple[str, List[SearchSource]]:
    urls = URL_PATTERN.findall(message or "")
    contexts = []
    sources: List[SearchSource] = []
    seen = set()
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        if len(seen) > max_urls:
            break
        content, title = await fetch_url_content(url)
        if not content:
            continue
        display_title = title or url
        snippet = content[:200].strip().replace("\n", " ")
        contexts.append(f"URL: {url}\nTitle: {display_title}\nContent:\n{content[:1000]}")
        sources.append(SearchSource(title=display_title, url=url, snippet=snippet))
    if not contexts:
        return "", []
    block = "\n\n".join(contexts)
    return block, sources


async def run_chat_agent(
    user_id: str,
    conversation_id: str,
    message: str,
    history: Optional[List[dict]] = None,
    profile: Optional[Dict] = None,
) -> ChatResponse:
    _ = conversation_id  # TODO: fetch conversation history for better context.
    llm = await _load_llm()
    if not llm:
        return ChatResponse(
            reply="Pluto cannot reach the LLM right now. Check OPENAI_API_KEY/BRAIN_ENABLE_OPENAI.",
            used_tools=[],
            sources=[],
            web_search_used=False
        )

    url_context_block, url_sources = await _collect_url_context(message)
    augmented_message = message
    if url_context_block:
        augmented_message = f"{message}\n\nURL Context:\n{url_context_block}"

    tools = _build_tools(user_id)
    profile_str = json.dumps(profile, indent=2) if profile else "(no profile info)"
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT + "\n\nUser profile JSON:\n{profile_json}"),
        ("human", "Recent conversation:\n{chat_history}\n\nUser message:\n{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad")
    ]).partial(profile_json=profile_str)

    agent = create_openai_functions_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=agent, tools=tools, verbose=False)

    history_str = _format_history(history)
    result = await executor.ainvoke({"input": augmented_message, "chat_history": history_str})
    raw_reply = result.get("output", "")

    tool_calls = result.get("intermediate_steps", [])
    used_tools: List[str] = []
    sources: List[SearchSource] = []
    web_used = False

    for action, action_result in tool_calls:
        tool_name = getattr(action, "tool", None) or getattr(action, "tool_name", "")
        if tool_name:
            used_tools.append(tool_name)

        if tool_name == "web_search" and isinstance(action_result, str):
            web_used = True
            try:
                payload = json.loads(action_result)
            except json.JSONDecodeError:
                # thoughts.append(action_result[:200])
                continue

            raw_sources = payload.get("sources", [])
            for entry in raw_sources:
                try:
                    src = SearchSource(**entry)
                except Exception:  # pragma: no cover - malformed entry
                    continue
                if not any(existing.url == src.url for existing in sources):
                    sources.append(src)

        if tool_name == "gmail_inbox" and isinstance(action_result, str):
            try:
                payload = json.loads(action_result)
            except json.JSONDecodeError:
                continue

            for entry in payload:
                try:
                    src = SearchSource(
                        title=entry.get("subject", "Gmail thread"),
                        url=entry.get("link", ""),
                        snippet=entry.get("summary") or entry.get("snippet", "")
                    )
                except Exception:
                    continue
                if src.url and not any(existing.url == src.url for existing in sources):
                    sources.append(src)

    cleaned_reply, extracted = _strip_markdown_links(raw_reply)
    for src in extracted:
        if not any(existing.url == src.url for existing in sources):
            sources.append(src)

    force_web = _should_force_web(message)
    if force_web and not web_used:
        summary, manual_sources = await web_search_tool(message)
        if manual_sources:
            web_used = True
            for entry in manual_sources:
                if not any(existing.url == entry.url for existing in sources):
                    sources.append(entry)

    all_sources = sources + url_sources
    return ChatResponse(
        reply=cleaned_reply,
        used_tools=used_tools,
        sources=all_sources,
        web_search_used=web_used or bool(extracted)
    )


def _strip_markdown_links(text: str) -> tuple[str, List[SearchSource]]:
    pattern = re.compile(r"\[([^\]]+)\]\((https?://[^)]+)\)")
    matches = pattern.findall(text)
    cleaned = pattern.sub(r"\1", text)
    extracted = [SearchSource(title=title, url=url, snippet="") for title, url in matches]
    return cleaned, extracted


def _should_force_web(message: str) -> bool:
    lowered = message.lower()
    force_terms = (
        "news", "latest", "current", "today", "movie", "film", "show", "release",
        "box office", "actor", "actress", "music", "song", "stock", "price",
        "review", "update", "report", "happening", "trend", "earnings"
    )
    if "?" in message or len(message.split()) > 15:
        return True
    return any(term in lowered for term in force_terms)
