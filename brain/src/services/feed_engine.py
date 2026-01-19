from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional, Any
from pydantic import BaseModel
import json
import logging

from src.services.database import get_pool
from src.services import gateway_client

logger = logging.getLogger(__name__)

class FeedCardData(BaseModel):
    title: str
    content: str
    action_url: Optional[str] = None
    metadata: Dict[str, Any] = {}

class FeedCard(BaseModel):
    id: Optional[str] = None
    user_id: str
    type: str  # 'briefing', 'agenda', 'insight', 'stat'
    priority_score: float
    data: FeedCardData
    status: str = 'active'
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None

class FeedEngine:
    async def get_feed(self, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Fetch active feed cards for the user."""
        try:
            pool = await get_pool()
            query = """
                SELECT id, type, priority_score, data, status, created_at
                FROM feed_cards
                WHERE user_id = $1 AND status = 'active'
                AND (expires_at IS NULL OR expires_at > NOW())
                ORDER BY priority_score DESC, created_at DESC
                LIMIT $2
            """
            async with pool.acquire() as conn:
                rows = await conn.fetch(query, user_id, limit)
                # Parse JSON data strings back to objects if needed, but asyncpg returns jsonb as dict?
                # asyncpg decodes jsonb automatically to python objects (dict/list).
                # But our FeedCard model expects 'data' to be parsed. 
                # Let's inspect rows. They are Record objects.
                result = []
                for row in rows:
                    r = dict(row)
                    if isinstance(r.get('data'), str):
                        try:
                            r['data'] = json.loads(r['data'])
                        except:
                            pass
                    result.append(r)
                return result
        except Exception as e:
            logger.error(f"Error fetching feed: {e}")
            return []

    async def generate_daily_briefing(self, user_id: str):
        """Generates a daily briefing card using real context."""
        
        # 1. Fetch Context
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(hours=24)
        
        events = await gateway_client.fetch_calendar_events(
            user_id, 
            time_min=today_start.isoformat(), 
            time_max=today_end.isoformat()
        )
        
        threads = await gateway_client.fetch_gmail_threads(user_id, limit=3, importance_only=True)
        # TODO: Fetch Whoop data once client is ready
        
        
        whoop_data = await gateway_client.fetch_whoop_recovery(user_id)
        
        # 2. Synthesize Content (Mock LLM for now, but using real data counts)
        event_count = len(events)
        email_count = len(threads.get('threads', []))
        
        event_summary = "No meetings today."
        if event_count > 0:
            first_event = events[0]
            event_summary = f"You have {event_count} meetings today, starting with '{first_event.get('summary')}' at {self._format_time(first_event.get('start'))}."

        email_summary = "No urgent emails."
        if email_count > 0:
            top_email = threads['threads'][0]
            email_summary = f"You have {email_count} important emails. Check '{top_email.get('subject')}' from {top_email.get('sender')}."

        briefing_content = (
            f"**Good Morning!**\n\n"
            f"{event_summary}\n"
            f"{email_summary}\n"
            f"- **Focus**: Review your tasks for the week."
        )

        # Briefing Card
        await self._save_card(FeedCard(
            user_id=user_id,
            type='briefing',
            priority_score=1.0, 
            data=FeedCardData(
                title="Daily Briefing",
                content=briefing_content,
                metadata={
                    "date": datetime.now(timezone.utc).isoformat(),
                    "event_count": event_count,
                    "email_count": email_count
                }
            )
        ))

        # Whoop Recovery Card (if data exists)
        if whoop_data:
            recovery_score = whoop_data.get('score', {}).get('recovery_score', 0)
            sleep_score = whoop_data.get('score', {}).get('sleep_performance_percentage', 0)
            hrv = whoop_data.get('score', {}).get('hrv_rmssd_milli', 0)
            
            content = f"Recovery is at **{recovery_score}%**. HRV: {hrv}ms."
            if recovery_score < 33:
                content += " Take it easy today."
            elif recovery_score > 66:
                content += " Prime to perform!"
                
            await self._save_card(FeedCard(
                user_id=user_id,
                type='recovery',
                priority_score=0.9,
                data=FeedCardData(
                    title="Recovery",
                    content=content,
                    metadata={
                        "score": recovery_score,
                        "sleep": sleep_score,
                        "hrv": hrv,
                        "state": whoop_data.get('score', {}).get('recovery_score_state_id')
                    }
                )
            ))

    def _format_time(self, iso_str: str) -> str:
        try:
            dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
            return dt.strftime('%I:%M %p')
        except:
            return iso_str

    async def _save_card(self, card: FeedCard):
        """Persist a card to the database."""
        try:
            pool = await get_pool()
            query = """
                INSERT INTO feed_cards (user_id, type, priority_score, data, status, created_at, expires_at)
                VALUES ($1, $2, $3, $4, $5, NOW(), $6)
            """
            # data is a Pydantic model in FeedCard, need to dump it.
            # card.data.dict() -> json.dumps -> str
            # asyncpg will take json-compatible dict if column is jsonb? 
            # Usually strict: pass string for jsonb or use json codec. 
            # In database.py config, asyncpg might not have set_type_codec for jsonb automatically unless configured.
            # Best to safe bet: pass valid JSON string for jsonb column.
            
            async with pool.acquire() as conn:
                await conn.execute(
                    query,
                    card.user_id,
                    card.type,
                    card.priority_score,
                    json.dumps(card.data.dict()),
                    card.status,
                    card.expires_at
                )
        except Exception as e:
            logger.error(f"Error saving feed card: {e}")

feed_engine = FeedEngine()
