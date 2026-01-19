import fitz  # type: ignore hiding import pymupdf
from typing import List, Dict, Any

def extract_text_with_layout(file_path: str) -> str:
    """
    Extracts text from a PDF file while preserving layout as much as possible.
    It returns a markdown-like string where tables are approximated.
    """
    try:
        doc = fitz.open(file_path)
        full_text = []

        for page_num, page in enumerate(doc):
            full_text.append(f"--- Page {page_num + 1} ---\n")
            
            # Get text blocks
            blocks = page.get_text("blocks")
            # Sort by vertical position (top to bottom), then horizontal (left to right)
            blocks.sort(key=lambda b: (b[1], b[0]))

            for b in blocks:
                # b is (x0, y0, x1, y1, text, block_no, block_type)
                text = b[4].strip()
                if text:
                    full_text.append(text)
            
            full_text.append("\n")

        return "\n".join(full_text)
    except Exception as e:
        return f"Error reading PDF: {str(e)}"

def extract_metadata(file_path: str) -> Dict[str, Any]:
    try:
        doc = fitz.open(file_path)
        return doc.metadata
    except Exception:
        return {}

def extract_text_from_bytes(file_content: bytes) -> str:
    """
    Extracts text from PDF bytes.
    """
    try:
        doc = fitz.open(stream=file_content, filetype="pdf")
        full_text = []

        for page_num, page in enumerate(doc):
            full_text.append(f"--- Page {page_num + 1} ---\n")
            
            blocks = page.get_text("blocks")
            blocks.sort(key=lambda b: (b[1], b[0]))

            for b in blocks:
                text = b[4].strip()
                if text:
                    full_text.append(text)
            
            full_text.append("\n")

        return "\n".join(full_text)
    except Exception as e:
        return f"Error reading PDF bytes: {str(e)}"
