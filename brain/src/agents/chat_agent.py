from typing import List, Optional, TYPE_CHECKING, Any
import logging

from ..config import get_settings
from ..models.schemas import ChatResponse
from ..tools import search_memories_tool

if TYPE_CHECKING:  # pragma: no cover - type hints only
    from langchain.schema import BaseMessage
    from langchain_openai import ChatOpenAI
else:
    BaseMessage = Any
    ChatOpenAI = Any

SYSTEM_PROMPT = """You are Pluto, a personal agent for a single user. You know about the user from past conversations and, soon, from their email. Your job is to help summarize information, extract tasks, and keep track of what matters to them. Use memories when helpful, and be concise and clear."""
logger = logging.getLogger(__name__)


async def _build_context(user_id: str, message: str) -> tuple[str, List[str]]:
    used_tools: List[str] = []
    memories = await search_memories_tool(user_id=user_id, query=message)
    memory_text = "".join(f"- {m.content}\n" for m in memories)
    if memory_text:
        used_tools.append("search_memories")
    return memory_text, used_tools


async def _load_llm(settings) -> Optional["ChatOpenAI"]:
    if not (settings.enable_openai and settings.openai_api_key):
        return None
    try:
        from langchain_openai import ChatOpenAI  # type: ignore
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.warning("Failed to import langchain_openai; falling back to stubbed replies: %s", exc)
        return None

    return ChatOpenAI(
        api_key=settings.openai_api_key,
        temperature=0.2,
        model_name="gpt-3.5-turbo"
    )


def _fallback_reply(user_message: str, memory_context: str) -> str:
    base = "Pluto stubbed reply: "
    if memory_context:
        return f"{base}I noted these memories -> {memory_context.strip()} | You said: {user_message}"
    return f"{base}You said: {user_message}"


async def run_chat_agent(user_id: str, conversation_id: str, message: str) -> ChatResponse:
    _ = conversation_id  # TODO: fetch conversation history for better context.
    settings = get_settings()
    context, used_tools = await _build_context(user_id=user_id, message=message)

    llm = await _load_llm(settings)
    if not llm:
        return ChatResponse(reply=_fallback_reply(message, context), used_tools=used_tools)

    reply_text = await _generate_with_llm(llm, context, message)
    return ChatResponse(reply=reply_text, used_tools=used_tools)


async def _generate_with_llm(llm: "ChatOpenAI", context: str, message: str) -> str:
    try:
        from langchain.prompts import ChatPromptTemplate  # type: ignore
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.warning("LangChain prompt import failed, using fallback: %s", exc)
        return _fallback_reply(message, context)

    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        (
            "human",
            "Context from memories:\n{memory_context}\n\nUser message:\n{user_message}"
        )
    ])

    formatted_messages: List[BaseMessage] = prompt.format_messages(
        memory_context=context or "(no memories yet)",
        user_message=message
    )

    response = await llm.ainvoke(formatted_messages)
    return response.content
