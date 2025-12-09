from datetime import datetime, timezone
from copy import deepcopy
from typing import Any, Dict, List, Optional

import httpx
from ..config import get_settings

KNOWN_FIELDS = {
    "full_name": "fullName",
    "preferred_name": "preferredName",
    "timezone": "timezone",
    "contact_email": "contactEmail",
    "phone": "phone",
    "company": "company",
    "role": "role",
    "preferences": "preferences",
    "biography": "biography",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_notes(raw_notes: Any) -> List[Dict[str, Any]]:
    notes: List[Dict[str, Any]] = []
    if isinstance(raw_notes, list):
        for entry in raw_notes:
            if isinstance(entry, dict) and entry.get("text"):
                notes.append({
                    "text": entry.get("text"),
                    "timestamp": entry.get("timestamp")
                })
            elif isinstance(entry, str) and entry.strip():
                notes.append({
                    "text": entry.strip(),
                    "timestamp": None
                })
    return notes


def _normalize_prev_entries(raw_entries: Any) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    if isinstance(raw_entries, list):
        entries = raw_entries
    elif raw_entries is None:
        entries = []
    else:
        entries = [raw_entries]

    for entry in entries:
        if isinstance(entry, dict) and "value" in entry:
            normalized.append({
                "value": entry.get("value"),
                "timestamp": entry.get("timestamp")
            })
        elif entry is not None:
            normalized.append({
                "value": entry,
                "timestamp": None
            })
    return normalized


async def _fetch_existing_profile(client: httpx.AsyncClient, base_url: str) -> Optional[Dict[str, Any]]:
    try:
        response = await client.get(f"{base_url}/api/profile")
    except httpx.HTTPError:
        return None
    if response.status_code >= 400:
        return None
    try:
        payload = response.json()
    except ValueError:
        return None
    profile = payload.get("profile")
    if not isinstance(profile, dict):
        return None
    return profile


async def profile_update_tool(field: str | None = None, value: str | None = None, note: str | None = None) -> str:
    settings = get_settings()
    payload: Dict[str, Any] = {}

    async with httpx.AsyncClient(timeout=10.0) as client:
        existing_profile = await _fetch_existing_profile(client, settings.gateway_url)
        existing_custom = {}
        if existing_profile:
            existing_custom = existing_profile.get("customData") or {}
        if not isinstance(existing_custom, dict):
            existing_custom = {}
        custom_data = deepcopy(existing_custom)
        custom_modified = False

        def mark_custom_modified():
            nonlocal custom_modified
            if not custom_modified:
                custom_modified = True

        def record_previous_value(field_key: str, previous_value: Any):
            if previous_value is None:
                return
            prev_values = custom_data.get("previousValues")
            if not isinstance(prev_values, dict):
                prev_values = {}
            entries = _normalize_prev_entries(prev_values.get(field_key))
            entries.append({
                "value": previous_value,
                "timestamp": _now_iso()
            })
            prev_values[field_key] = entries
            custom_data["previousValues"] = prev_values
            mark_custom_modified()

        if field and value is not None:
            matched_api_field = None
            for db_field, api_field in KNOWN_FIELDS.items():
                if field.lower() in {db_field, api_field.lower()}:
                    matched_api_field = api_field
                    break

            if matched_api_field:
                payload[matched_api_field] = value
                existing_value = existing_profile.get(matched_api_field) if existing_profile else None
                if existing_value != value:
                    record_previous_value(matched_api_field, existing_value)
            else:
                existing_value = custom_data.get(field)
                if existing_value != value:
                    custom_data[field] = value
                    mark_custom_modified()
                    record_previous_value(field, existing_value)

        if note:
            normalized_notes = _normalize_notes(custom_data.get("notes"))
            normalized_notes.append({
                "text": note,
                "timestamp": _now_iso()
            })
            custom_data["notes"] = normalized_notes
            mark_custom_modified()

        if custom_modified:
            payload["customData"] = custom_data

        if not payload:
            return "No profile changes supplied."

        response = await client.post(f"{settings.gateway_url}/api/profile", json=payload)
    if response.status_code >= 400:
        raise RuntimeError(f"Profile update failed: {response.text}")
    return "Profile updated."
