from typing import List, Optional
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    user_id: str = Field(..., description="User ID from gateway")
    conversation_id: str = Field(..., description="Conversation identifier")
    message: str = Field(..., description="Latest user utterance")


class ChatResponse(BaseModel):
    reply: str
    used_tools: List[str] = []


class Memory(BaseModel):
    id: str
    content: str
    source: str


class Task(BaseModel):
    id: str
    description: str
    status: str
    due_date: Optional[str]


class GmailThread(BaseModel):
    id: str
    subject: str
    summary: Optional[str]
