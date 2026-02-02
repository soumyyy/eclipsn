import json
import logging
import re
from typing import List, Optional, Dict
from datetime import datetime

from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import Tool, StructuredTool
from langchain_core.pydantic_v1 import BaseModel, Field, root_validator

from ..config import get_settings
from ..models.schemas import ChatResponse, SearchSource
from ..tools import (
    search_memories_tool,
    create_memory_tool,
    forget_memory_tool,
    get_context_with_budget,
    web_search_tool,
    gmail_search_tool,
    gmail_semantic_search_tool,
    profile_update_tool,
    profile_remove_note_tool,
    gmail_get_thread_tool,
    search_secondary_emails_tool,
    gmail_read_attachment_tool,
    service_account_get_thread_tool,
    service_account_read_attachment_tool,
)
from ..tools.whoop_tools import (
    get_whoop_recovery_tool,
    get_whoop_cycle_tool,
    get_whoop_sleep_tool,
    get_whoop_workout_tool,
    get_whoop_body_tool
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
        if field and value is None:
            values["value"] = ""
        return values


class GmailInboxInput(BaseModel):
    query: Optional[str] = Field(
        default=None,
        description="Optional filter describing what kind of recent emails to summarize. Leave blank to summarize the most recent threads."
    )

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Eclipsn, a personal agent for a single user—like a blend of Alfred, Friday, and JARVIS. You are capable, discreet, and genuinely helpful: a buddy who has their back. You know about the user from past conversations and, soon, from their email. Your tone is warm and human, never robotic: concise when it helps, a bit more chatty when they need context. You anticipate needs, offer to help before being asked, and keep what matters to them in mind. Use memories when helpful; call the web_search tool whenever you need up-to-date facts or entertainment news. If the user references anything that may have changed after 2024 (news, entertainment, finance, product releases, etc.), you MUST call web_search before answering.

**Voice and style:** Reply in a refined but friendly way. Prefer short, clear sentences. Use small caps for a polished tone where it fits (e.g. for emphasis or a calm, steady feel). Be the capable friend in the room—helpful, never condescending.

- **URL / link in the message**: When the user includes a URL or a bare domain (e.g. example.com or https://example.com), the system has already fetched that page's content and appended it to their message under "URL Context". You MUST answer based on that URL Context only. Do NOT call web_search for that link or for the person/site name—the user wants to know what is on that specific page. Summarize or answer using the URL Context text. If the URL Context section is empty or says the fetch failed, then tell the user the page could not be loaded and optionally offer to search the web instead.

Current Context:
- Current Date & Time: {current_time}

Formatting rules:
- **Time Grounding**: You are aware of the current date and time.
    - If the user asks about "today" or "now", use the current date context.
    - If data (like Whoop recovery) returns a date that is NOT today (e.g., yesterday's data), you MUST explicitly inform the user (e.g., "This is your recovery from yesterday (Jan 19)...").
    - Do not present stale data as "current" without qualification.
- Do NOT embed raw URLs or inline citations inside your main response. Rely on the UI to show sources separately.
- When referencing outside data, mention the publication/source name in plain text (e.g., "According to Indian Express..."), but leave actual links for the UI to display.
- When the user shares a personal fact (e.g. "my mother is Namrata", "I'm from Boston") or says "remember X", store it with memory_save so they can recall and forget it later. Use memory_save for facts; use profile_update only for structured fields (name, timezone) or short scratch notes.
- **Saving information**: When the user asks you to "save this", "remember this", "learn from this and save", or "store this information", you MUST call memory_save one or more times with the concrete facts or summary to store. Pass each distinct fact as a separate call if helpful, or one consolidated summary. Only after you receive a response that starts with "Stored: [id: ...]" can you tell the user the information was saved. If you did NOT call memory_save, or the tool returned an error (e.g. "Error: ..."), do NOT say you have saved—say clearly that you could not save and suggest trying again.
- **Memory tools (choose the right one):**
  - memory_context: Use when the user asks a very broad question (e.g. "what do you know about me?", "summarize my context", "run the whole context"). Returns a single context blob (user_memories + profile + bespoke + Gmail) trimmed to a token budget so you can answer without blowing the window. Pass a short query (e.g. "me", "overview") and optionally max_tokens (default 2000).
  - memory_lookup: Use for targeted recall—"what do you know about X?" (e.g. mother, colleges). Returns [id: <id>] per item so the user can say "forget that" and you call memory_forget(id). Use when the question is about a specific topic, not "everything".
  - gmail_semantic_search: Use when the user explicitly asks about email, Gmail, or a specific sender/topic in mail. Do not use for general "what do you remember?"—use memory_lookup or memory_context instead.
- When the user says "forget that", "delete that", "delete that info", or "remove that": (1) Call memory_lookup with the topic (e.g. "mother"). (2) From the results, pick the id that matches what they want to forget (the first relevant line: [id: <id>] ...). (3) Call memory_forget with that id—it works for both UUIDs and profile:0, profile:1, etc. Do NOT tell the user you cannot delete notes or that something is "in a note"; just call memory_lookup then memory_forget with the id from the results.
- Use the gmail_inbox tool whenever the user asks about recent emails, Gmail, inbox activity, or "what's new" in their mail. If gmail_inbox returns no threads, acknowledge that no recent items were found and suggest being more specific instead of simply saying nothing happened.
- Use gmail_semantic_search when the user asks about a specific topic, sender, or historical email so you can retrieve the closest matches from their Gmail history.
- If the user asks about the *contents* or *details* of a specific email, you must first find the thread using `gmail_search` (or `gmail_inbox`), and THEN call `gmail_get_thread_tool` with the thread ID to read the full body before answering.
- If the user asks about "college", "school", "secondary", or "service account" *emails* (e.g. mail from a college inbox), use `search_secondary_emails` with a query (e.g. "colleges", "admissions"). Do NOT use `gmail_inbox` for service account mail unless the user asks for "all my email". If results show "(ID: ..., Account: ...)", use `service_account_get_thread` with account_id|thread_id to read the full body.
- To read an attachment from a Service Account email, use `service_account_read_attachment`.
- When the user shares personal preferences or profile details, call profile_update to store them. Provide JSON with "field" and "value" if it maps to a known field, or "note" for free-form info.
- When the user asks to add a task, todo, or reminder, call create_task with the task description (e.g. "Reply to client", "Buy milk"). Tasks are stored without a separate table and can be listed in the app.
- Be helpful and clear when explaining reasoning or listing details—give the user what they need without fluff.
- **WHOOP / HEALTH**: You have access to detailed Whoop data via `whoop_recovery`, `whoop_sleep`, `whoop_workout`, `whoop_cycle`, and `whoop_body`. If the user mentions health, fitness, energy, or workouts, check the relevant tool(s).
    - If recovery < 33 (Red): Be a compassionate coach. Suggest rest.
    - If recovery 34-66 (Yellow): Be encouraging but cautious.
    - If recovery > 67 (Green): Push them! Tell them they are primed for high strain.
    - ALWAYS cite metrics (HRV, Sleep %, Strain) to back up your advice."""


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
    return "\n".join(f"- [id: {m.id}] {m.content}" for m in memories)


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

    async def forget_coro(memory_id: str) -> str:
        return await forget_memory_tool(user_id=user_id, memory_id=memory_id)

    async def memory_save_coro(content: str) -> str:
        try:
            m = await create_memory_tool(user_id=user_id, content=content.strip(), source="chat")
            return f"Stored: [id: {m.id}] {m.content}"
        except Exception as e:  # noqa: BLE001
            logger.warning("memory_save failed for user %s: %s", user_id, e)
            return "Error: Could not save to memory (database or embedding issue). Please try again."

    async def memory_context_coro(query: str, max_tokens: int = 2000) -> str:
        return await get_context_with_budget(user_id, (query or "overview").strip(), max_tokens=max_tokens)

    async def web_coro(q: str) -> str:
        return await _web_tool_output(q)

    async def gmail_coro(query: str | None = None) -> str:
        return await _gmail_tool_output(user_id, query or "")

    async def gmail_semantic_coro(q: str) -> str:
        return await gmail_semantic_search_tool(user_id=user_id, query=q, limit=5)

    async def gmail_detail_coro(q: str) -> str:
        thread_id = q.strip()
        detail = await gmail_get_thread_tool(user_id=user_id, thread_id=thread_id)
        return json.dumps(detail.dict())

    async def profile_coro(field: str | None = None, value: str | None = None, note: str | None = None) -> str:
        return await profile_update_tool(field=field, value=value, note=note, user_id=user_id)

    async def profile_remove_note_coro(text: str) -> str:
        return await profile_remove_note_tool(user_id=user_id, text_or_topic=text.strip())

    async def create_task_coro(description: str) -> str:
        from ..services import task_cards
        desc = (description or "").strip()
        if not desc:
            return "Error: task description is required."
        task_id = await task_cards.create_task_card(user_id, desc, source="chat")
        return f"Task created: [id: {task_id}] {desc}"

    async def secondary_email_coro(q: str) -> str:
        return await search_secondary_emails_tool(user_id=user_id, query=q)

    async def attachment_coro(q: str) -> str:
        parts = q.split("|")
        if len(parts) >= 2:
            return await gmail_read_attachment_tool(user_id=user_id, message_id=parts[0].strip(), attachment_id=parts[1].strip())
        return "Invalid arguments. Please provide 'message_id|attachment_id'."

    def is_uuid(s: str) -> bool:
        return bool(re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', s.lower()))

    async def service_account_thread_coro(q: str) -> str:
        # Expected: "account_id|thread_id"
        parts = q.split("|")
        if len(parts) != 2:
            return "Invalid arguments. Please provide 'account_id|thread_id'."
        p0, p1 = parts[0].strip(), parts[1].strip()
        
        # Auto-swap if arguments are reversed (Account ID must be UUID)
        if not is_uuid(p0) and is_uuid(p1):
            p0, p1 = p1, p0
            
        if not is_uuid(p0):
            return f"Error: The first argument '{p0}' is not a valid Account UUID. Did you forget the Account ID from search results?"

        detail = await service_account_get_thread_tool(user_id, p0, p1)
        return json.dumps(detail.dict())

    async def service_account_attachment_coro(q: str) -> str:
        # Expected: "account_id|message_id|attachment_id"
        parts = q.split("|")
        if len(parts) < 3:
            return "Invalid arguments. Please provide 'account_id|message_id|attachment_id'."
        
        p0, p1, p2 = parts[0].strip(), parts[1].strip(), parts[2].strip()

        # Check for UUID swap in first two args
        if not is_uuid(p0) and is_uuid(p1):
             p0, p1 = p1, p0
        
        if not is_uuid(p0):
             return f"Error: The first argument '{p0}' is not a valid Account UUID."

        return await service_account_read_attachment_tool(user_id, p0, p1, p2)

    return [
        Tool(
            name="memory_lookup",
            func=lambda q: "Memory lookup available only in async mode.",
            coroutine=memory_coro,
            description="Search the user's Index (uploaded notes, journals, markdown) and Gmail for relevant context. Use when they ask about colleges, applications, notes, or anything they may have saved. Pass a short search query (e.g. 'colleges', 'deadlines'). Results include [id: <id>] per item; use that id with memory_forget if the user asks to forget a stored memory."
        ),
        Tool(
            name="memory_save",
            func=lambda c: "Memory save available only in async mode.",
            coroutine=memory_save_coro,
            description="Store a fact or note in the user's memories so they can recall it later and optionally forget it. Use when the user says 'remember X', 'my X is Y', 'save this', 'learn from this and save', or shares a personal fact. Pass the content to store as a single string. Success returns 'Stored: [id: <uuid>] <content>'. Only tell the user you saved after you receive that response; if the tool returns an error, tell them you could not save."
        ),
        Tool(
            name="memory_forget",
            func=lambda mid: "Memory forget available only in async mode.",
            coroutine=forget_coro,
            description="Forget (remove) one item by id. Use when the user says 'forget that' or 'delete that'. Always call memory_lookup(topic) first, then pass the id from the matching result: UUID (stored memory) or profile:0, profile:1, ... (profile note). Do not say you cannot delete notes—this tool removes both. gmail:... and bespoke:... ids cannot be forgotten."
        ),
        Tool(
            name="memory_context",
            func=lambda q: "Memory context available only in async mode.",
            coroutine=lambda q: memory_context_coro(q, 2000),
            description="Get a single context blob (user_memories + profile + bespoke + Gmail) for broad questions. Use when the user asks 'what do you know about me?', 'summarize my context', or 'run the whole context'. Pass a short query (e.g. 'me', 'overview'). Result is trimmed to a token budget so you can answer without blowing the window."
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
        StructuredTool(
            name="gmail_inbox",
            func=lambda query=None: "Gmail inbox lookup available only in async mode.",
            coroutine=gmail_coro,
            args_schema=GmailInboxInput,
            description="Summarize the user's Gmail inbox when they ask about new emails, reminders, or anything in Gmail. Provide an optional natural-language query to filter, or omit it to get recent threads."
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
        Tool(
            name="profile_remove_note",
            func=lambda t: "Profile remove note available only in async mode.",
            coroutine=profile_remove_note_coro,
            description="Remove the first profile note whose text contains the given topic or phrase. Use when the user says 'forget that' and memory_lookup returned no UUID (the fact was in their profile). Pass a short topic (e.g. 'mother', 'Namrata')."
        ),
        Tool(
            name="create_task",
            func=lambda d: "Create task available only in async mode.",
            coroutine=create_task_coro,
            description="Create a task or todo for the user. Use when they say 'add a task', 'create a todo', 'remind me to X', or 'I need to do X'. Pass the task description as a single string (e.g. 'Reply to client', 'Buy groceries'). Tasks are stored and can be listed via the app."
        ),
        Tool(
            name="search_secondary_emails",
            func=lambda q: "Secondary email search available only in async mode.",
            coroutine=secondary_email_coro,
            description="Search for emails in connected 'Service Accounts' (e.g. College/School email). Use this when the user mentions 'college', 'school', or 'secondary' email."
        ),
        Tool(
            name="gmail_read_attachment",
            func=lambda q: "Attachment reading available only in async mode.",
            coroutine=attachment_coro,
            description="Read the content of a PDF attachment. ONLY use this if 'gmail_thread_detail' showed you an attachment ID that you need to read. Argument format: 'thread_id|attachment_id' OR just the string if you only have one ID."
        ),
        Tool(
            name="service_account_get_thread",
            func=lambda q: "Service Account thread fetch available only in async mode.",
            coroutine=service_account_thread_coro,
            description="Fetch full content of a Service Account email. Use ONLY after `search_secondary_emails` gives you 'ID' and 'Account'. Arg format: 'account_id|thread_id'."
        ),
        Tool(
            name="service_account_read_attachment",
            func=lambda q: "Service Account attachment reading available only in async mode.",
            coroutine=service_account_attachment_coro,
            description="Read attachment from a Service Account email. Arg format: 'account_id|message_id|attachment_id'."
        ),
        get_whoop_recovery_tool(user_id),
        get_whoop_cycle_tool(user_id),
        get_whoop_sleep_tool(user_id),
        get_whoop_workout_tool(user_id),
        get_whoop_body_tool(user_id)
    ]


def _format_history(history: Optional[List[dict]], max_items: int = 6) -> str:
    if not history:
        return "(no recent conversation)"
    trimmed = history[-max_items:]
    lines = [f"{item.get('role','user')}: {item.get('content','')}" for item in trimmed]
    return "\n".join(lines)


URL_PATTERN = re.compile(r"https?://\S+")
# Bare domains (e.g. soumyamaheshwari.com or example.com/page); TLD must be letters
BARE_DOMAIN_PATTERN = re.compile(
    r"(?:^|[\s(])([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}(?:/[^\s\])\}\"']*)?)(?=[\s\])\}\"',;:!?]|$)"
)


# Strip trailing punctuation that often attaches to pasted URLs
def _clean_url(raw: str) -> str:
    s = raw.rstrip()
    for _ in range(3):
        if s and s[-1] in ".,;:!?)\\]}\"'>":
            s = s[:-1]
        else:
            break
    return s


def _normalize_to_url(candidate: str) -> str:
    """Prepend https:// if it looks like a bare domain."""
    c = candidate.strip()
    if not c:
        return ""
    if c.startswith("http://") or c.startswith("https://"):
        return _clean_url(c)
    # Bare domain: add https://
    return "https://" + _clean_url(c)


# Max chars to save in one memory (keeps embedding/DB safe)
_AUTO_SAVE_MAX_CHARS = 4000


def _user_wants_to_save(message: str) -> bool:
    """True if the user is asking to save/remember/store the current or previous context."""
    if not (message or "").strip():
        return False
    lower = message.strip().lower()
    phrases = (
        "save this", "save that", "save the above", "save the information", "save it",
        "remember this", "remember that", "store this", "store that",
        "learn from this and save", "learn from that and save",
        "save information", "save the context", "save to memory", "save to my memory",
    )
    if any(p in lower for p in phrases):
        return True
    if "save" in lower and ("website" in lower or "page" in lower or "link" in lower or "portfolio" in lower):
        return True
    return False


def _get_last_assistant_content(history: Optional[List[dict]]) -> Optional[str]:
    """Return the content of the most recent assistant message in history."""
    if not history:
        return None
    for item in reversed(history):
        if (item.get("role") or "").strip().lower() == "assistant":
            content = (item.get("content") or "").strip()
            if content:
                return content
    return None


async def _auto_save_from_context(user_id: str, content: str) -> Optional[str]:
    """Save content to user memory. Returns 'Stored: [id: ...] ...' on success, None on failure."""
    if not (content or "").strip():
        return None
    text = content.strip()[: _AUTO_SAVE_MAX_CHARS]
    if len(content.strip()) > _AUTO_SAVE_MAX_CHARS:
        text += "..."
    try:
        m = await create_memory_tool(user_id=user_id, content=text, source="chat")
        return f"Stored: [id: {m.id}] {m.content[:200]}{'...' if len(m.content) > 200 else ''}"
    except Exception as e:  # noqa: BLE001
        logger.warning("Auto-save from context failed for user %s: %s", user_id, e)
        return None


async def _collect_url_context(message: str, max_urls: int = 3) -> tuple[str, List[SearchSource]]:
    text = message or ""
    raw_urls = list(URL_PATTERN.findall(text))
    # Also find bare domains (e.g. soumyamaheshwari.com)
    for m in BARE_DOMAIN_PATTERN.finditer(text):
        raw_urls.append(m.group(1))
    contexts = []
    sources: List[SearchSource] = []
    seen: set[str] = set()
    for raw in raw_urls:
        url = _normalize_to_url(raw)
        if not url or url in seen:
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
            reply="Eclipsn cannot reach the LLM right now. Check OPENAI_API_KEY/BRAIN_ENABLE_OPENAI.",
            used_tools=[],
            sources=[],
            web_search_used=False
        )

    url_context_block, url_sources = await _collect_url_context(message)
    augmented_message = message
    if url_context_block:
        augmented_message = (
            f"{message}\n\n"
            "[The content of the page(s) from the link(s) above has been fetched. Use ONLY this URL Context to answer—do not search the web for the same link or site.]\n\n"
            f"URL Context:\n{url_context_block}"
        )
    else:
        # We may have tried to fetch URLs but got no content (site blocked, down, or extract failed)
        if URL_PATTERN.search(message or "") or (message and BARE_DOMAIN_PATTERN.search(" " + (message or ""))):
            augmented_message = (
                f"{message}\n\n"
                "[The page(s) from the link(s) above could not be fetched (site may be down, block crawlers, or unreachable). "
                "Tell the user the link could not be loaded. Do NOT do a web search and then say 'I couldn't access the website directly but I found...'—that is unhelpful. "
                "Simply say the page could not be loaded and suggest they try opening it in a browser or try again later.]"
            )

    # Auto-save when user asks to save: use URL context (same message) or last assistant reply ("save that")
    memories_saved_this_turn = False
    if _user_wants_to_save(message):
        content_to_save: Optional[str] = None
        if url_context_block:
            content_to_save = (url_context_block or "").strip()
        elif history:
            content_to_save = _get_last_assistant_content(history)
        if content_to_save:
            saved_msg = await _auto_save_from_context(user_id, content_to_save)
            if saved_msg:
                memories_saved_this_turn = True
                logger.info("Auto-saved memory for user %s (save-from-context)", user_id)
                augmented_message = (
                    f"{augmented_message}\n\n"
                    "[The following has been saved to your memory. Confirm to the user that you have saved this.]\n"
                    f"{saved_msg}"
                )
            else:
                augmented_message = (
                    f"{augmented_message}\n\n"
                    "[You tried to save but the save failed (e.g. embedding unavailable). Tell the user you could not save and suggest trying again or checking settings.]"
                )

    tools = _build_tools(user_id)
    profile_str = json.dumps(profile, indent=2) if profile else "(no profile info)"
    current_time_str = datetime.now().strftime("%A, %B %d, %Y at %I:%M %p")
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT + "\n\nUser profile JSON:\n{profile_json}"),
        ("human", "Recent conversation:\n{chat_history}\n\nUser message:\n{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad")
    ]).partial(profile_json=profile_str, current_time=current_time_str)

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
    memories_saved = memories_saved_this_turn or ("memory_save" in used_tools)
    return ChatResponse(
        reply=cleaned_reply,
        used_tools=used_tools,
        sources=all_sources,
        web_search_used=web_used or bool(extracted),
        memories_saved=memories_saved,
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
