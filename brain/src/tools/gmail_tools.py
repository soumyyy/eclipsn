from typing import List
from ..models.schemas import Task, GmailThread
from ..services.gateway_client import fetch_gmail_threads, semantic_gmail_search, fetch_gmail_thread_detail


async def gmail_search_tool(user_id: str, query: str, limit: int = 20) -> List[GmailThread]:
    _ = query
    payload = await fetch_gmail_threads(user_id=user_id, limit=limit, importance_only=True)
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
    """
    Fetch the FULL content of a specific email thread. 
    Use this when the user asks for "details", "contents", or "what does it say" about a specific email found in search results.
    Do NOT rely on search snippets for answering detailed questions.
    """
    detail = await fetch_gmail_thread_detail(user_id, thread_id)
    if not detail:
        return GmailThread(id=thread_id, subject="Thread", summary="Thread not found")
    return GmailThread(
        id=thread_id,
        subject=detail.get('subject', 'Thread'),
        summary=detail.get('body', detail.get('summary')),
        link=detail.get('link'),
        sender=detail.get('sender'),
        last_message_at=detail.get('lastMessageAt'),
        attachments=detail.get('attachments', [])
    )


async def gmail_summarize_thread_tool(user_id: str, thread_id: str) -> str:
    _ = (user_id, thread_id)
    return "Summary placeholder for Gmail thread"


async def gmail_extract_tasks_tool(user_id: str, thread_id: str) -> List[Task]:
    _ = (user_id, thread_id)
    return [Task(id="task-1", description="Reply to client", status="open", due_date=None)]


async def gmail_semantic_search_tool(user_id: str, query: str, limit: int = 5) -> str:
    matches = await semantic_gmail_search(user_id, query, limit)
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


async def search_secondary_emails_tool(user_id: str, query: str) -> str:
    """
    Search connected Service Accounts (e.g. College Email) for threads.
    Use this when the user asks about school/college emails or specific secondary accounts.
    """
    from ..services.gateway_client import search_service_account_emails
    
    threads = await search_service_account_emails(user_id, query)
    if not threads:
        return "No emails found in secondary accounts."
        
    lines = [f"Found {len(threads)} emails in service accounts:"]
    for t in threads:
        lines.append(f"- [{t['accountEmail']}] {t['snippet']} (Link: {t['link']})")
        
    return "\n".join(lines)


async def gmail_read_attachment_tool(user_id: str, message_id: str, attachment_id: str) -> str:
    """
    Read the content of a PDF attachment from a Gmail message.
    Use this when an email has an attachment (listed in details) that needs to be read.
    """
    from ..services.gateway_client import fetch_attachment
    from .pdf_tools import extract_text_from_bytes
    
    content = await fetch_attachment(user_id, message_id, attachment_id)
    if not content:
        return "Failed to download attachment."
        
    # Assume PDF for now as that's the primary request
    text = extract_text_from_bytes(content)
    if not text:
        return "Could not extract text from the attachment (it might be an image or empty)."
        
    return f"--- Attachment Content ---\n{text}"
