"""Per-type file parsing. See docs/ARCHITECTURE.md §3.1 and §5 for the chosen
libraries (pdfplumber/python-docx/pandas) and the "tables kept as tables, not
flattened prose" requirement for CSV.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import pdfplumber
from docx import Document

from app.models.source import SUPPORTED_EXTENSIONS


class UnsupportedFileType(ValueError):
    def __init__(self, extension: str) -> None:
        self.extension = extension
        super().__init__(
            f"Unsupported file type {extension!r}; supported: "
            f"{sorted(SUPPORTED_EXTENSIONS)}"
        )


@dataclass
class ParsedContent:
    text: str
    char_count: int
    row_count: int | None = None  # set for CSV


def parse_file(path: Path, content_type: str) -> ParsedContent:
    extension = path.suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise UnsupportedFileType(extension)

    if extension == ".pdf":
        return _parse_pdf(path)
    if extension == ".docx":
        return _parse_docx(path)
    if extension == ".csv":
        return _parse_csv(path)
    # .txt / .md
    return _parse_text(path)


def _parse_text(path: Path) -> ParsedContent:
    text = path.read_text(encoding="utf-8", errors="replace")
    return ParsedContent(text=text, char_count=len(text))


def _parse_pdf(path: Path) -> ParsedContent:
    pages: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            pages.append(page_text)
    text = "\n\n".join(pages)
    return ParsedContent(text=text, char_count=len(text))


def _parse_docx(path: Path) -> ParsedContent:
    document = Document(path)
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    return ParsedContent(text=text, char_count=len(text))


def _parse_csv(path: Path) -> ParsedContent:
    df = pd.read_csv(path)
    text = df.to_csv(index=False)
    return ParsedContent(text=text, char_count=len(text), row_count=len(df))
