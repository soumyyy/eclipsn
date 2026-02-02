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
    type: str  # 'briefing', 'agenda', 'insight', 'stat', 'recovery', 'vitals'
    priority_score: float
    data: FeedCardData
    status: str = 'active'
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None

# Sleep target: 7h 55min (475 minutes) – standard for "enough sleep" comparison
SLEEP_TARGET_MINUTES = 7 * 60 + 55  # 475

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

        # Vitals / Readiness card: sleep vs 7h55m target, HRV/RHR vs monthly baselines, actionable summary
        await self._generate_vitals_card(user_id, whoop_data)

    def _format_time(self, iso_str: str) -> str:
        try:
            dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
            return dt.strftime('%I:%M %p')
        except:
            return iso_str

    async def _generate_vitals_card(self, user_id: str, recovery_data: dict | None) -> None:
        """
        Generate a vitals/readiness feed card:
        - Sleep vs 7h 55min target (enough / a bit short / well rested)
        - HRV vs monthly baseline (normal / above average / below)
        - RHR vs baseline (normal / elevated / lower)
        - Actionable summary: take it easy / steady / conquer your day
        """
        try:
            sleep_data = await gateway_client.fetch_whoop_sleep(user_id)
            baselines = await gateway_client.fetch_whoop_baselines(user_id, days=30)
        except Exception as e:
            logger.warning("Vitals card: could not fetch sleep/baselines: %s", e)
            sleep_data = None
            baselines = None

        if not recovery_data and not sleep_data:
            return

        score_obj = (recovery_data or {}).get("score") or {}
        hrv_ms = score_obj.get("hrv_rmssd_milli") or 0
        rhr = score_obj.get("resting_heart_rate")
        recovery_score = score_obj.get("recovery_score") or 0

        # Sleep duration from last sleep record (total in bed)
        sleep_minutes: float = 0.0
        if sleep_data and isinstance(sleep_data.get("score"), dict):
            stage = (sleep_data["score"] or {}).get("stage_summary") or {}
            total_ms = stage.get("total_in_bed_time_milli")
            if total_ms is not None:
                sleep_minutes = float(total_ms) / (60 * 1000)

        avg_hrv = (baselines or {}).get("avgHrvMs") or 0
        avg_rhr = (baselines or {}).get("avgRhr") or 0
        avg_sleep_min = (baselines or {}).get("avgSleepMinutes") or 0

        # Comparisons
        sleep_vs_target = "unknown"
        if sleep_minutes >= SLEEP_TARGET_MINUTES - 15:
            sleep_vs_target = "enough" if sleep_minutes >= SLEEP_TARGET_MINUTES else "close"
        elif sleep_minutes >= SLEEP_TARGET_MINUTES - 60:
            sleep_vs_target = "short"
        elif sleep_minutes > 0:
            sleep_vs_target = "low"

        hrv_vs_baseline = "unknown"
        if avg_hrv > 0 and hrv_ms > 0:
            ratio = hrv_ms / avg_hrv
            if ratio >= 1.15:
                hrv_vs_baseline = "above_average"
            elif ratio >= 0.85:
                hrv_vs_baseline = "normal"
            else:
                hrv_vs_baseline = "below_average"

        rhr_vs_baseline = "unknown"
        if avg_rhr > 0 and rhr is not None:
            diff = rhr - avg_rhr
            if diff <= -3:
                rhr_vs_baseline = "lower"
            elif diff <= 3:
                rhr_vs_baseline = "normal"
            else:
                rhr_vs_baseline = "elevated"

        # Narrative summary
        sleep_hours = sleep_minutes / 60
        sleep_str = f"{int(sleep_hours)}h {int(sleep_minutes % 60)}m" if sleep_minutes > 0 else "No data"
        target_str = "7h 55m"

        bullets = []
        if sleep_minutes > 0:
            if sleep_vs_target in ("enough", "close"):
                bullets.append(f"**Sleep:** {sleep_str} – on or near your {target_str} target.")
            elif sleep_vs_target == "short":
                bullets.append(f"**Sleep:** {sleep_str} – a bit under {target_str}. Consider taking it a little easier today.")
            else:
                bullets.append(f"**Sleep:** {sleep_str} – below target. Ease into the day.")
        if hrv_vs_baseline != "unknown":
            if hrv_vs_baseline == "above_average":
                bullets.append(f"**HRV:** Above your recent average – nervous system is primed.")
            elif hrv_vs_baseline == "normal":
                bullets.append(f"**HRV:** In line with your baseline.")
            else:
                bullets.append(f"**HRV:** Below your average – body may need more recovery.")
        if rhr_vs_baseline != "unknown":
            if rhr_vs_baseline == "normal":
                bullets.append(f"**RHR:** Normal for you.")
            elif rhr_vs_baseline == "elevated":
                bullets.append(f"**RHR:** Slightly elevated – consider light activity.")
            else:
                bullets.append(f"**RHR:** Lower than usual – good sign.")

        # One-line verdict
        if sleep_vs_target in ("low", "short") or hrv_vs_baseline == "below_average" or rhr_vs_baseline == "elevated":
            verdict = "Take it a little easy today and listen to your body."
        elif sleep_vs_target in ("enough", "close") and hrv_vs_baseline in ("above_average", "normal") and recovery_score >= 67:
            verdict = "You're in a great spot – go conquer your day."
        elif recovery_score >= 67:
            verdict = "Recovery looks good – steady effort today."
        else:
            verdict = "Steady pace today. You've got this."

        content = "\n\n".join(["\n".join(bullets), f"**Summary:** {verdict}"]) if bullets else f"**Summary:** {verdict}"

        await self._save_card(FeedCard(
            user_id=user_id,
            type="vitals",
            priority_score=0.95,
            data=FeedCardData(
                title="How You're Doing Today",
                content=content,
                metadata={
                    "sleep_minutes": round(sleep_minutes, 1),
                    "sleep_target_minutes": SLEEP_TARGET_MINUTES,
                    "sleep_vs_target": sleep_vs_target,
                    "hrv_ms": round(hrv_ms, 2),
                    "hrv_vs_baseline": hrv_vs_baseline,
                    "rhr": rhr,
                    "rhr_vs_baseline": rhr_vs_baseline,
                    "recovery_score": recovery_score,
                    "avg_hrv_ms": round(avg_hrv, 2),
                    "avg_rhr": avg_rhr,
                    "avg_sleep_minutes": round(avg_sleep_min, 1),
                    "verdict": verdict,
                    "sample_count": (baselines or {}).get("sampleCount", 0),
                },
            ),
        ))

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
