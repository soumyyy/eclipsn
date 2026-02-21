from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass
from typing import List, Optional

import fitz  # PyMuPDF
from openai import AsyncOpenAI

from ..config import get_settings

logger = logging.getLogger(__name__)

MAX_ATTACHMENT_CONTEXT_CHARS = 6000
MAX_PDF_PAGES = 15


@dataclass
class AttachmentResult:
    filename: str
    mime_type: str
    text: str
    summary: str
    description: str
    user_facts: List[str]
    source_hash: str


def _data_url(mime_type: str, data: bytes) -> str:
    encoded = base64.b64encode(data).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def _normalize_text(text: str) -> str:
    return " ".join((text or "").split()).strip()


def _hash_bytes(data: bytes) -> str:
    import hashlib
    return hashlib.sha1(data).hexdigest()


async def _vision_analyze_image(client: AsyncOpenAI, image_bytes: bytes, mime_type: str) -> tuple[str, str, List[str]]:
    prompt = (
        "Analyze this image. If it contains patterns, diagrams, charts, or visual structure, interpret them. "
        "Extract any readable text only if it is important. "
        "Return ONLY JSON: {\"description\": \"...\", \"summary\": \"...\", \"extracted_text\": \"...\", \"user_facts\": [\"...\"]}. "
        "Keep description < 400 chars, summary < 400 chars. If no user facts, return []."
    )
    data_url = _data_url(mime_type, image_bytes)
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a multimodal analyst that interprets images."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
        max_tokens=800,
        temperature=0.1,
    )
    raw = (response.choices[0].message.content or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:].strip()
    try:
        payload = json.loads(raw)
    except Exception:
        return "", "", []
    description = _normalize_text(payload.get("description", ""))
    summary = _normalize_text(payload.get("summary", ""))
    extracted_text = _normalize_text(payload.get("extracted_text", ""))
    facts = payload.get("user_facts") or []
    if not isinstance(facts, list):
        facts = []
    facts = [_normalize_text(str(item)) for item in facts if _normalize_text(str(item))]
    return description, f"{summary}\n{extracted_text}".strip(), facts


async def _summarize_and_extract_facts(client: AsyncOpenAI, text: str) -> tuple[str, List[str]]:
    prompt = (
        "Summarize the following content in 2-4 sentences. "
        "Then extract any facts about the user (name, preferences, background, relationships, personal details). "
        "Return ONLY JSON: {\"summary\": \"...\", \"user_facts\": [\"...\"]}. "
        "If there are no user facts, return an empty list.\n\n"
        f"{text}"
    )
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You summarize and extract durable user facts."},
            {"role": "user", "content": prompt},
        ],
        max_tokens=500,
        temperature=0.1,
    )
    raw = (response.choices[0].message.content or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:].strip()
    try:
        payload = json.loads(raw)
    except Exception:
        return "", []
    summary = _normalize_text(payload.get("summary", ""))
    facts = payload.get("user_facts") or []
    if not isinstance(facts, list):
        facts = []
    facts = [_normalize_text(str(item)) for item in facts if _normalize_text(str(item))]
    return summary, facts


def _extract_pdf_text(pdf_bytes: bytes) -> List[str]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = min(doc.page_count, MAX_PDF_PAGES)
    out: List[str] = []
    for idx in range(pages):
        page = doc.load_page(idx)
        text = page.get_text().strip()
        out.append(text)
    doc.close()
    return out


def _render_pdf_page_image(pdf_bytes: bytes, page_index: int) -> bytes:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc.load_page(page_index)
    pix = page.get_pixmap(dpi=200)
    image_bytes = pix.tobytes("png")
    doc.close()
    return image_bytes


async def extract_attachment(attachment: dict) -> Optional[AttachmentResult]:
    settings = get_settings()
    if not settings.enable_openai or not settings.openai_api_key:
        logger.warning("OpenAI not configured; skipping attachment extraction.")
        return None

    filename = attachment.get("filename", "attachment")
    mime_type = attachment.get("mime_type", "application/octet-stream")
    data_b64 = attachment.get("data_base64")
    if not data_b64:
        return None
    try:
        raw_bytes = base64.b64decode(data_b64)
    except Exception:
        return None

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    source_hash = _hash_bytes(raw_bytes)

    if mime_type.startswith("image/"):
        description, combined, facts = await _vision_analyze_image(client, raw_bytes, mime_type)
        summary = _normalize_text(combined)
        return AttachmentResult(
            filename=filename,
            mime_type=mime_type,
            text=combined,
            summary=summary,
            description=description,
            user_facts=facts,
            source_hash=source_hash,
        )

    if mime_type == "application/pdf":
        extracted_pages = _extract_pdf_text(raw_bytes)
        text_chunks: List[str] = []
        for idx, page_text in enumerate(extracted_pages):
            if page_text and len(page_text) > 200:
                text_chunks.append(page_text)
            else:
                try:
                    image_bytes = _render_pdf_page_image(raw_bytes, idx)
                    ocr_text = await _vision_ocr_image(client, image_bytes, "image/png")
                    if ocr_text:
                        text_chunks.append(ocr_text)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("PDF OCR failed for page %d: %s", idx, exc)
        combined = "\n\n".join(text_chunks).strip()
        summary, facts = await _summarize_and_extract_facts(client, combined)
        return AttachmentResult(
            filename=filename,
            mime_type=mime_type,
            text=combined,
            summary=summary,
            description="",
            user_facts=facts,
            source_hash=source_hash,
        )

    return None


def build_attachment_context(results: List[AttachmentResult]) -> str:
    blocks: List[str] = []
    for item in results:
        parts: List[str] = []
        if item.description:
            parts.append(f"Description: {item.description}")
        if item.summary:
            parts.append(f"Summary: {item.summary}")
        if item.text and item.text not in item.summary:
            text = item.text.strip()
            if len(text) > MAX_ATTACHMENT_CONTEXT_CHARS:
                text = text[:MAX_ATTACHMENT_CONTEXT_CHARS] + "..."
            parts.append(f"Extracted text:\n{text}")
        if parts:
            blocks.append(f"Attachment: {item.filename}\n" + "\n".join(parts))
    return "\n\n".join(blocks)
