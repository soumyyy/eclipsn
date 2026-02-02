import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .models.schemas import ChatRequest, ChatResponse
from .agents import run_chat_agent
from .config import get_settings
from .services.memory_indexer import process_pending_chunks, rebuild_indices_for_users
from .routes.feed import router as feed_router

app = FastAPI(title="Eclipsn Brain")
app.include_router(feed_router, prefix="/api")
logger = logging.getLogger(__name__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get('/health')
def health_check():
    settings = get_settings()
    return {"status": "ok", "has_openai_key": bool(settings.openai_api_key)}


@app.post('/chat', response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    try:
        result = await run_chat_agent(
            user_id=request.user_id,
            conversation_id=request.conversation_id,
            message=request.message,
            history=request.history,
            profile=request.profile,
            attachments=[a.model_dump() for a in (request.attachments or [])]
        )
        return result
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post('/memory/index')
async def trigger_memory_index(user_id: str | None = None):
    try:
        processed = await process_pending_chunks()
        if user_id and processed == 0:
            await rebuild_indices_for_users([user_id])
        return {"processed": processed}
    except Exception as exc:  # pragma: no cover
        logger.exception("Memory indexing job failed")
        message = str(exc) or repr(exc)
        raise HTTPException(status_code=500, detail=message) from exc


class MemoryExtractRequest(BaseModel):
    user_id: str


@app.post('/memory/extract')
async def trigger_memory_extract(request: MemoryExtractRequest):
    """Phase 4: Run extraction (Gmail + bespoke → user_memories) for one user. On-demand or cron."""
    try:
        from .services.memory_extraction import run_extraction_for_user
        from .services.extraction_runs import record_extraction_run
        result = await run_extraction_for_user(request.user_id)
        await record_extraction_run()
        return result
    except Exception as exc:  # pragma: no cover
        logger.exception("Memory extraction failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get('/memory/extract-last-run')
async def get_extract_last_run():
    """Return last memory extraction run time (for gateway 24h check + nightly cron)."""
    try:
        from .services.extraction_runs import get_last_extraction_run
        last = await get_last_extraction_run()
        return {"last_run_at": last.isoformat() if last else None}
    except Exception as exc:  # pragma: no cover
        logger.exception("Get extract last run failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# Phase 5: User memories list/search and delete for Memory UI (gateway proxies with user_id)
@app.get('/memory/user-memories')
async def list_or_search_user_memories(
    user_id: str,
    limit: int = 20,
    offset: int = 0,
    q: str | None = None,
):
    """List user_memories (paginated) or semantic search when q is provided. Used by gateway GET /api/memories.
    Gmail-sourced memories are excluded from the list (not shown in Settings UI); fetch and delete still work."""
    from .services import user_memory_store
    exclude_gmail = ["gmail"]
    try:
        if q and q.strip():
            rows = await user_memory_store.search_user_memories_by_query(
                user_id, q.strip(), limit=limit, exclude_source_types=exclude_gmail
            )
            return {"memories": rows, "total": len(rows)}
        rows = await user_memory_store.list_user_memories(
            user_id, limit=limit, offset=offset, exclude_source_types=exclude_gmail
        )
        return {"memories": rows}
    except Exception as exc:  # pragma: no cover
        logger.exception("List/search user memories failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.delete('/memory/user-memories/{memory_id}')
async def delete_user_memory_endpoint(memory_id: str, user_id: str):
    """Soft-delete one user_memory. Used by gateway DELETE /api/memories/:id."""
    from .services import user_memory_store
    try:
        ok = await user_memory_store.delete_user_memory(memory_id, user_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Memory not found or already deleted")
        return {"status": "deleted"}
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        logger.exception("Delete user memory failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class ScheduleIngestRequest(BaseModel):
    user_id: str
    file_data: str # base64
    filename: str

@app.post('/schedule/ingest')
async def ingest_schedule_endpoint(request: ScheduleIngestRequest):
    try:
        import base64
        import tempfile
        import os
        from .agents.schedule_ingestion import ingest_schedule_pdf

        # Decode base64
        file_bytes = base64.b64decode(request.file_data)
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        
        try:
            result = await ingest_schedule_pdf(request.user_id, tmp_path)
            return {"status": "success", "message": result}
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            
    except Exception as exc:
        logger.exception("Schedule ingestion failed")
        raise HTTPException(status_code=500, detail=str(exc))
