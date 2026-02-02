import logging
import json
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional, Any
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langchain.schema import SystemMessage, HumanMessage

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
        logger.info(f"Starting daily briefing generation for user {user_id}")
        
        # 1. Fetch Context
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(hours=24)
        
        try:
            logger.info("Fetching calendar events...")
            events = await gateway_client.fetch_calendar_events(
                user_id, 
                time_min=today_start.isoformat(), 
                time_max=today_end.isoformat()
            )
            logger.info(f"Fetched {len(events)} events")
        except Exception as e:
            logger.error(f"Failed to fetch calendar: {e}")
            events = []
        
        try:
            logger.info("Fetching gmail threads...")
            threads = await gateway_client.fetch_gmail_threads(user_id, limit=3, importance_only=True)
            logger.info(f"Fetched {len(threads.get('threads', []))} threads")
        except Exception as e:
            logger.error(f"Failed to fetch gmail: {e}")
            threads = {'threads': []}

        try:
            logger.info("Fetching Whoop recovery...")
            whoop_data = await gateway_client.fetch_whoop_recovery(user_id)
            logger.info(f"Fetched Whoop data: {whoop_data is not None}")
        except Exception as e:
            logger.error(f"Failed to fetch whoop: {e}")
            whoop_data = None
        
        # 2. Synthesize with LLM
        try:
            logger.info("Initializing LLM...")
            llm = ChatOpenAI(model="gpt-4o", temperature=0)

            # Format Events
            event_lines = []
            for e in events[:5]:
                start = self._format_time(e.get('start'))
                event_lines.append(f"- {start}: {e.get('summary')}")
            event_text = "\n".join(event_lines) if event_lines else "No scheduled events."

            # Format Emails
            email_lines = []
            raw_threads = threads.get('threads', [])
            for t in raw_threads:
                sender = t.get('sender', 'Unknown')
                subj = t.get('subject', '(No Subject)')
                snip = t.get('snippet', '')
                email_lines.append(f"From: {sender} | Subj: {subj} | Body: {snip}")
            
            email_text = "\n".join(email_lines) if email_lines else "No recent emails."

            # Whoop Context
            recovery_text = "No recovery data."
            if whoop_data:
                score = whoop_data.get('score', {}).get('recovery_score', 0)
                recovery_text = f"Recovery Score: {score}%"

            prompt = f"""
            You are a Chief of Staff for a busy executive.
            Generate a 'Morning Briefing' markdown summary based on the following context.
            
            # Calendar (Today)
            {event_text}

            # Recent Emails
            {email_text}

            # Health (Whoop)
            {recovery_text}

            # Guidelines
            1. **Tone**: Professional, concise, actionable. No fluff.
            2. **Structure**:
            - **Agenda**: 1-2 key meetings (or "Clear schedule" if none).
            - **Inbox**: Identify ONLY "Critical" or "Actionable" emails. Ignore newsletters, promotions, and spam.
                - If a package is arriving, mention it briefly.
                - If no important emails, say "Inbox is quiet."
            - **Health**: Brief comment on recovery state.
            3. **Format**: Use Markdown. Bold key terms. Use bullet points.
            """

            logger.info("Invoking LLM for briefing...")
            response = await llm.ainvoke([SystemMessage(content="You are a helpful executive assistant."), HumanMessage(content=prompt)])
            briefing_content = response.content
            logger.info("LLM generation successful")

        except Exception as e:
            logger.error(f"LLM generation failed: {e}")
            briefing_content = "Failed to generate AI briefing. Please try again."

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
                    "event_count": len(events),
                    "email_count": len(raw_threads)
                }
            )
        ))

        # Whoop Recovery Card (kept separate for visual pop)
        if whoop_data:
            recovery_score = whoop_data.get('score', {}).get('recovery_score', 0)
            sleep_score = whoop_data.get('score', {}).get('sleep_performance_percentage', 0)
            hrv = whoop_data.get('score', {}).get('hrv_rmssd_milli', 0)
            
            # Simple advice based on score
            advice = "Rest day." if recovery_score < 33 else "Ready to train." if recovery_score > 66 else "Steady effort."

            await self._save_card(FeedCard(
                user_id=user_id,
                type='recovery',
                priority_score=0.9,
                data=FeedCardData(
                    title="Recovery",
                    content=f"**{advice}** HRV is {int(hrv)}ms.",
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
