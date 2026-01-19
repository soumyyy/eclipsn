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
            profile=request.profile
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
