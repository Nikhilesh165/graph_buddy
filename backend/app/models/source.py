"""Uploaded source files. See docs/ARCHITECTURE.md §3.1 (Ingestion).

`status`/`parse_error`/etc. track Phase 1's parse step; `graphiti_status`/
`graphiti_error`/the *_count fields track Phase 2's separate extraction step
(a parsed source may never be extracted, extraction may be re-run, etc., so
this is deliberately not folded into `status`). `discovery_status`/
`discovery_error` track the AI ontology-discovery pass that now runs on
every upload (docs/MEMORY_AND_DISCOVERY.md §3) -- separate again, since it
runs in the background after the upload request has already returned.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Field, SQLModel

SourceStatus = Literal["uploaded", "parsed", "failed"]
GraphitiStatus = Literal["not_extracted", "extracting", "extracted", "failed"]
DiscoveryStatus = Literal["not_run", "pending", "running", "completed", "failed"]

SUPPORTED_EXTENSIONS: frozenset[str] = frozenset({".pdf", ".docx", ".csv", ".txt", ".md"})


def _now() -> datetime:
    return datetime.now(UTC)


class Source(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    filename: str
    content_type: str
    file_path: str
    size_bytes: int
    # Plain str at the table level -- SQLModel's column-type inference can't
    # map a `Literal[...]` alias to a SQL type. `SourceStatus` is still the
    # validated type on `SourceRead` and everywhere else.
    status: str = "uploaded"
    parse_error: str | None = None
    parsed_text: str | None = None
    char_count: int = 0
    row_count: int | None = None  # set for CSV sources
    created_at: datetime = Field(default_factory=_now)

    # Plain str at the table level, same reason as `status` above.
    graphiti_status: str = "not_extracted"
    graphiti_error: str | None = None
    episode_count: int = 0
    node_count: int = 0
    edge_count: int = 0
    extracted_at: datetime | None = None
    # Ontology version the last successful extraction ran against -- lets
    # the UI (and a future backfill job) tell which sources predate the
    # ontology changes discovery has applied since.
    extracted_ontology_version: int | None = None

    # Plain str at the table level, same reason as `status` above.
    discovery_status: str = "not_run"
    discovery_error: str | None = None

    def preview(self, chars: int = 500) -> str | None:
        return self.parsed_text[:chars] if self.parsed_text else None


_PREVIEW_CHARS = 500


class SourceRead(BaseModel):
    """API response shape -- omits `file_path` (a server-local disk path with
    no meaning to a client) and the full `parsed_text` in favor of a preview.
    """

    id: str
    filename: str
    content_type: str
    size_bytes: int
    status: SourceStatus
    parse_error: str | None
    char_count: int
    row_count: int | None
    text_preview: str | None
    created_at: datetime

    graphiti_status: GraphitiStatus
    graphiti_error: str | None
    episode_count: int
    node_count: int
    edge_count: int
    extracted_at: datetime | None
    extracted_ontology_version: int | None

    discovery_status: DiscoveryStatus
    discovery_error: str | None

    @classmethod
    def from_source(cls, source: Source) -> SourceRead:
        return cls(
            id=source.id,
            filename=source.filename,
            content_type=source.content_type,
            size_bytes=source.size_bytes,
            status=source.status,
            parse_error=source.parse_error,
            char_count=source.char_count,
            row_count=source.row_count,
            text_preview=source.preview(_PREVIEW_CHARS),
            created_at=source.created_at,
            graphiti_status=source.graphiti_status,
            graphiti_error=source.graphiti_error,
            episode_count=source.episode_count,
            node_count=source.node_count,
            edge_count=source.edge_count,
            extracted_at=source.extracted_at,
            extracted_ontology_version=source.extracted_ontology_version,
            discovery_status=source.discovery_status,
            discovery_error=source.discovery_error,
        )
