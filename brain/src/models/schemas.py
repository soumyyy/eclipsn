from typing import List, Optional
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    user_id: str = Field(..., description="User ID from gateway")
    conversation_id: str = Field(..., description="Conversation identifier")
    message: str = Field(..., description="Latest user utterance")


class SearchSource(BaseModel):
    title: str
    url: str
    snippet: str


class ChatResponse(BaseModel):
    reply: str
    used_tools: List[str] = Field(default_factory=list)
    sources: List[SearchSource] = Field(default_factory=list)
    web_search_used: bool = False


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
    link: Optional[str] = None
    last_message_at: Optional[str] = None
    category: Optional[str] = None
    sender: Optional[str] = None
