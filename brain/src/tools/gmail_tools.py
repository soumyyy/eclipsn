from typing import List
from ..models.schemas import Task, GmailThread
from ..services.gateway_client import fetch_gmail_threads, semantic_gmail_search, fetch_gmail_thread_detail


async def gmail_search_tool(user_id: str, query: str, limit: int = 20) -> List[GmailThread]:
    _ = (user_id, query)
    payload = await fetch_gmail_threads(limit=limit, importance_only=True)
    raw_threads = payload.get("threads", [])
    threads: List[GmailThread] = []
    for entry in raw_threads:
        summary = entry.get("snippet") or entry.get("summary")
        threads.append(
            GmailThread(
                id=entry.get("threadId", ""),
                subject=entry.get("subject", "(no subject)"),
                summary=summary,
                link=entry.get("link"),
                last_message_at=entry.get("lastMessageAt"),
                category=entry.get("category")
            )
        )
    return threads


async def gmail_get_thread_tool(user_id: str, thread_id: str) -> GmailThread:
    detail = await fetch_gmail_thread_detail(thread_id)
    if not detail:
        return GmailThread(id=thread_id, subject="Thread", summary="Thread not found")
    return GmailThread(
        id=thread_id,
        subject=detail.get('subject', 'Thread'),
        summary=detail.get('body', detail.get('summary')),
        link=detail.get('link'),
        sender=detail.get('sender'),
        last_message_at=detail.get('lastMessageAt')
    )


async def gmail_summarize_thread_tool(user_id: str, thread_id: str) -> str:
    _ = (user_id, thread_id)
    return "Summary placeholder for Gmail thread"


async def gmail_extract_tasks_tool(user_id: str, thread_id: str) -> List[Task]:
    _ = (user_id, thread_id)
    return [Task(id="task-1", description="Reply to client", status="open", due_date=None)]


async def gmail_semantic_search_tool(user_id: str, query: str, limit: int = 5) -> str:
    _ = user_id
    matches = await semantic_gmail_search(query, limit)
    if not matches:
        return "No relevant Gmail threads found."

    lines: List[str] = ["Top Gmail matches:"]
    for entry in matches:
        subject = entry.get("subject", "(no subject)")
        sender = entry.get("sender", "unknown sender")
        date = entry.get("last_message_at", "")
        link = entry.get("link", "")
        lines.append(f"- {subject} — {sender} ({date}) {link}")

    return "\n".join(lines)
