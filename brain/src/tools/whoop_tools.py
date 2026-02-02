from typing import Optional
from langchain_core.tools import StructuredTool
from langchain_core.pydantic_v1 import BaseModel, Field
from ..services.gateway_client import (
    fetch_whoop_recovery, 
    fetch_whoop_cycle, 
    fetch_whoop_sleep, 
    fetch_whoop_workout,
    fetch_whoop_profile,
    fetch_whoop_measurements
)

class WhoopInput(BaseModel):
    query: Optional[str] = Field(default="", description="Ignored, can be empty.")

# --- Recovery ---
async def _whoop_recovery_coro(user_id: str, query: str = "") -> str:
    data = await fetch_whoop_recovery(user_id)
    if not data: return "No Whoop recovery data found (or not connected)."
    
    score = data.get("score", {})
    return (
        f"Whoop Recovery (Latest):\n"
        f"Score: {score.get('recovery_score', '?')}%\n"
        f"HRV: {score.get('hrv_rmssd_milli', '?')} ms\n"
        f"RHR: {score.get('resting_heart_rate', '?')} bpm\n"
        f"Full Data: {data}"
    )

def get_whoop_recovery_tool(user_id: str) -> StructuredTool:
    return StructuredTool.from_function(
        name="whoop_recovery",
        func=lambda query="": "Async only",
        coroutine=lambda query="": _whoop_recovery_coro(user_id, query),
        args_schema=WhoopInput,
        description="Fetch latest Whoop recovery stats (Score, HRV, RHR)."
    )

# --- Cycle ---
async def _whoop_cycle_coro(user_id: str, query: str = "") -> str:
    data = await fetch_whoop_cycle(user_id)
    if not data: return "No Whoop cycle data found."
    score = data.get("score", {})
    return (
        f"Whoop Cycle (Latest):\n"
        f"strain: {score.get('strain', '?')}\n"
        f"calories: {score.get('kilojoule', 0) / 4.184:.0f} kcal\n"
        f"Full Data: {data}"
    )

def get_whoop_cycle_tool(user_id: str) -> StructuredTool:
    return StructuredTool.from_function(
        name="whoop_cycle",
        func=lambda query="": "Async only",
        coroutine=lambda query="": _whoop_cycle_coro(user_id, query),
        args_schema=WhoopInput,
        description="Fetch latest physiological cycle (strain, calories)."
    )

# --- Sleep ---
async def _whoop_sleep_coro(user_id: str, query: str = "") -> str:
    data = await fetch_whoop_sleep(user_id)
    if not data: return "No Whoop sleep data found."
    score = data.get("score", {})
    return (
        f"Whoop Sleep (Latest):\n"
        f"Performance: {score.get('sleep_performance_percentage', '?')}%\n"
        f"Efficiency: {score.get('sleep_efficiency_percentage', '?')}%\n"
        f"Consistency: {score.get('sleep_consistency_percentage', '?')}%\n"
        f"Full Data: {data}"
    )

def get_whoop_sleep_tool(user_id: str) -> StructuredTool:
    return StructuredTool.from_function(
        name="whoop_sleep",
        func=lambda query="": "Async only",
        coroutine=lambda query="": _whoop_sleep_coro(user_id, query),
        args_schema=WhoopInput,
        description="Fetch latest sleep data (performance, efficiency, stages)."
    )

# --- Workout ---
async def _whoop_workout_coro(user_id: str, query: str = "") -> str:
    data = await fetch_whoop_workout(user_id)
    if not data: return "No recent workout found."
    score = data.get("score", {})
    return (
        f"Whoop Workout (Latest):\n"
        f"Strain: {score.get('strain', '?')}\n"
        f"Max HR: {score.get('max_heart_rate', '?')}\n"
        f"Distance: {score.get('distance_meter', 0)} m\n"
        f"Full Data: {data}"
    )

def get_whoop_workout_tool(user_id: str) -> StructuredTool:
    return StructuredTool.from_function(
        name="whoop_workout",
        func=lambda query="": "Async only",
        coroutine=lambda query="": _whoop_workout_coro(user_id, query),
        args_schema=WhoopInput,
        description="Fetch latest workout details (strain, HR zones, distance)."
    )

# --- Profile/Body ---
async def _whoop_body_coro(user_id: str, query: str = "") -> str:
    profile = await fetch_whoop_profile(user_id)
    body = await fetch_whoop_measurements(user_id)
    if not profile and not body: return "No Whoop profile data found."
    return f"Whoop Profile: {profile}\nBody Measurements: {body}"

def get_whoop_body_tool(user_id: str) -> StructuredTool:
    return StructuredTool.from_function(
        name="whoop_body",
        func=lambda query="": "Async only",
        coroutine=lambda query="": _whoop_body_coro(user_id, query),
        args_schema=WhoopInput,
        description="Fetch user's Whoop profile and body measurements (height, weight, max HR)."
    )
