from fastapi import APIRouter, HTTPException, Depends
from typing import List, Dict, Any
from pydantic import BaseModel

from src.services.feed_engine import feed_engine

router = APIRouter(tags=["feed"])

class FeedResponse(BaseModel):
    feed: List[Dict[str, Any]]

@router.get("/feed", response_model=FeedResponse)
async def get_feed(user_id: str):
    """
    Get the user's current feed.
    """
    try:
        cards = await feed_engine.get_feed(user_id)
        return FeedResponse(feed=cards)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/feed/generate/briefing")
async def generate_briefing(user_id: str):
    """
    Trigger generation of a daily briefing card.
    """
    try:
        await feed_engine.generate_daily_briefing(user_id)
        return {"status": "success", "message": "Briefing generated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
