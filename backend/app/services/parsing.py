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
from docx.table import Table

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
    # utf-8-sig: drop the BOM Windows editors prepend, rather than leaking a
    # U+FEFF into the first chunk/episode.
    text = path.read_text(encoding="utf-8-sig", errors="replace")
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
    # Body paragraphs *and* tables, in document order -- `document.paragraphs`
    # alone silently drops every table. Blocks are blank-line separated
    # because each one really is a paragraph: joined with single newlines, the
    # paragraph-packing chunker (extraction_service.chunk_prose) saw the
    # whole document as one paragraph and never split it.
    document = Document(path)
    blocks: list[str] = []
    for block in document.iter_inner_content():
        block_text = _docx_table_text(block) if isinstance(block, Table) else block.text
        if block_text.strip():
            blocks.append(block_text)
    text = "\n\n".join(blocks)
    return ParsedContent(text=text, char_count=len(text))


def _docx_table_text(table: Table) -> str:
    """One line per row, cells separated by " | " -- kept as rows rather
    than flattened into prose (ARCHITECTURE.md §3.1)."""
    rows = (" | ".join(cell.text.strip() for cell in row.cells) for row in table.rows)
    return "\n".join(row for row in rows if row.strip(" |"))


def _parse_csv(path: Path) -> ParsedContent:
    # Every cell kept as the literal text the user typed: by default pandas
    # infers types, so "02134" became "2134", an integer column with a blank
    # became floats ("42" -> "42.0"), and "NA"/"N/A"/"null" became empty --
    # for the source type extraction trusts most (reliability weight 1.0).
    df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding_errors="replace")
    text = df.to_csv(index=False)
    return ParsedContent(text=text, char_count=len(text), row_count=len(df))
