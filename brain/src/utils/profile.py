from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_notes(raw_notes: Any) -> List[Dict[str, Any]]:
    notes: List[Dict[str, Any]] = []
    if isinstance(raw_notes, list):
        seen = set()
        for entry in raw_notes:
            if isinstance(entry, dict) and entry.get("text"):
                text = str(entry.get("text")).strip()
                if not text:
                    continue
                timestamp = entry.get("timestamp")
                if not isinstance(timestamp, str):
                    timestamp = None
                key = f"{text}-{timestamp or 'null'}"
                if key in seen:
                    continue
                seen.add(key)
                notes.append({
                    "text": text,
                    "timestamp": timestamp
                })
            elif isinstance(entry, str):
                trimmed = entry.strip()
                if not trimmed:
                    continue
                key = f"{trimmed}-null"
                if key in seen:
                    continue
                seen.add(key)
                notes.append({
                    "text": trimmed,
                    "timestamp": None
                })
    return notes


def normalize_prev_entries(raw_entries: Any) -> List[Dict[str, Any]]:
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
