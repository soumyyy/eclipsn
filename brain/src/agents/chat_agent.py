import json
import logging
import re
from typing import List, Optional

from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import Tool

from ..config import get_settings
from ..models.schemas import ChatResponse, SearchSource
from ..tools import (
    search_memories_tool,
    web_search_tool,
    gmail_search_tool,
    gmail_semantic_search_tool,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Pluto, a personal agent for a single user. You know about the user from past conversations and, soon, from their email. Your job is to help summarize information, extract tasks, and keep track of what matters to them. Use memories when helpful, call the web_search tool whenever you need up-to-date facts or entertainment news. If the user references anything that may have changed after 2024 (news, entertainment, finance, product releases, etc.), you MUST call web_search before answering.

Formatting rules:
- Do NOT embed raw URLs or inline citations inside your main response. Rely on the UI to show sources separately.
- When referencing outside data, mention the publication/source name in plain text (e.g., "According to Indian Express..."), but leave actual links for the UI to display.
- Use the gmail_inbox tool whenever the user asks about recent emails, Gmail, inbox activity, or "what's new" in their mail.
- Use gmail_semantic_search when the user asks about a specific topic, sender, or historical email so you can retrieve the closest matches from their Gmail history.
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

    return [
        Tool(
            name="memory_lookup",
            func=lambda q: "Memory lookup available only in async mode.",
            coroutine=memory_coro,
            description="Retrieve relevant long-term memories about the user."
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
    ]


def _format_history(history: Optional[List[dict]], max_items: int = 6) -> str:
    if not history:
        return "(no recent conversation)"
    trimmed = history[-max_items:]
    lines = [f"{item.get('role','user')}: {item.get('content','')}" for item in trimmed]
    return "\n".join(lines)


async def run_chat_agent(
    user_id: str,
    conversation_id: str,
    message: str,
    history: Optional[List[dict]] = None,
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

    tools = _build_tools(user_id)
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", "Recent conversation:\n{chat_history}\n\nUser message:\n{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad")
    ])

    agent = create_openai_functions_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=agent, tools=tools, verbose=False)

    history_str = _format_history(history)
    result = await executor.ainvoke({"input": message, "chat_history": history_str})
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

    return ChatResponse(
        reply=cleaned_reply,
        used_tools=used_tools,
        sources=sources,
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
