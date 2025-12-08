from typing import List
from ..models.schemas import Task, GmailThread


async def gmail_search_tool(user_id: str, query: str) -> List[GmailThread]:
    # TODO: Call Gmail API via gateway to execute search queries.
    _ = (user_id, query)
    return [
        GmailThread(id="thread-1", subject="Demo thread", summary="Follow up about Pluto alpha")
    ]


async def gmail_get_thread_tool(user_id: str, thread_id: str) -> GmailThread:
    _ = (user_id, thread_id)
    return GmailThread(id=thread_id, subject="Demo thread", summary="Detailed thread body")


async def gmail_summarize_thread_tool(user_id: str, thread_id: str) -> str:
    _ = (user_id, thread_id)
    return "Summary placeholder for Gmail thread"


async def gmail_extract_tasks_tool(user_id: str, thread_id: str) -> List[Task]:
    _ = (user_id, thread_id)
    return [Task(id="task-1", description="Reply to client", status="open", due_date=None)]
