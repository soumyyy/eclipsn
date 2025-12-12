import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models.schemas import ChatRequest, ChatResponse
from .agents import run_chat_agent
from .config import get_settings
from .services.memory_indexer import process_pending_chunks, rebuild_indices_for_users

app = FastAPI(title="Eclipsn Brain")
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
