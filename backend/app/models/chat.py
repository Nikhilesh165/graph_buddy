"""Persisted chat turns. See docs/ARCHITECTURE.md §3.6 (Retrieval + retrieval
trace) and §4 (Chat), and app/services/chat_service.py for how a turn is
produced.

This is an append-only log, not a threaded "conversation" model -- Phase 4's
scope is a single running Q&A transcript (single-tenant MVP, per
docs/ARCHITECTURE.md §6), not multi-conversation management. It exists as a
persisted table (not just returned to the caller) because
docs/ROADMAP.md's sequencing notes call out that Phase 7 (discovery cycle)
needs real conversations to read once it exists: "Phase 7 ... depends on
Phase 4 (there need to be conversations to learn from)." Storing turns now
means Phase 7 has a transcript to mine without Phase 4 needing to be revisited.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(UTC)


class ChatTurn(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    question: str
    answer: str
    # list[{"index", "edge_uuid", "fact", "confidence"}] -- mirrors
    # chat_service.Citation, stored as plain JSON same as ontology's *_types
    # columns (app/models/ontology.py) rather than a normalized table, since
    # citations are only ever read back alongside their turn.
    citations: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    retrieved_count: int
    created_at: datetime = Field(default_factory=_now)
