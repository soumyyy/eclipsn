from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models.schemas import ChatRequest, ChatResponse
from .agents import run_chat_agent
from .config import get_settings

app = FastAPI(title="Pluto Brain")

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
