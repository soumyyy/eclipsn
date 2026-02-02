from typing import List, Optional, Any
from pydantic import BaseModel, Field


class AttachmentInput(BaseModel):
    filename: str
    mime_type: str
    data_base64: str


class ChatRequest(BaseModel):
    user_id: str = Field(..., description="User ID from gateway")
    conversation_id: str = Field(..., description="Conversation identifier")
    message: str = Field(..., description="Latest user utterance")
    history: List[dict] = Field(default_factory=list)
    profile: Optional[dict] = Field(default=None)
    attachments: Optional[List[AttachmentInput]] = Field(default=None)


class SearchSource(BaseModel):
    title: str
    url: str
    snippet: str


class ChatResponse(BaseModel):
    reply: str
    used_tools: List[str] = Field(default_factory=list)
    sources: List[SearchSource] = Field(default_factory=list)
    web_search_used: bool = False
    memories_saved: bool = Field(default=False, description="True when a memory was saved this turn (auto-save or memory_save tool).")


class Memory(BaseModel):
    id: str
    content: str
    source: str


class Task(BaseModel):
    id: str
    description: str
    status: str
    due_date: Optional[str]


class GmailAttachment(BaseModel):
    id: str
    messageId: str
    filename: str
    mimeType: str
    size: int


class GmailThread(BaseModel):
    id: str
    subject: str
    summary: Optional[str]
    link: Optional[str] = None
    last_message_at: Optional[str] = None
    category: Optional[str] = None
    sender: Optional[str] = None
    attachments: List[GmailAttachment] = Field(default_factory=list)
