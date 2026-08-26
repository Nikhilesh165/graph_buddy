"""Persisted retrieval trace, one per chat turn. See docs/ARCHITECTURE.md
§3.6 ("Every retrieval produces a trace object, stored (not just logged)")
and docs/ROADMAP.md Phase 5.

app.services.chat_service.RetrievalTrace is the in-memory shape a chat turn
produces (Phase 4); this table is that object's durable form, written by
app/api/routes/chat.py right after a turn succeeds and read back by
`GET /chat/{turn_id}/trace` for the Retrieval Inspector.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(UTC)


class RetrievalTraceRecord(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    turn_id: str = Field(foreign_key="chatturn.id", index=True, unique=True)
    query: str
    # list[{"uuid","name","type","score","is_seed"}] --
    # mirrors chat_service.RetrievedNode.
    seed_nodes: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    # list[{"edge_uuid","name","fact","confidence","score",
    #       "source_node_uuid","target_node_uuid"}] --
    # mirrors chat_service.RetrievedFact.
    facts: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    final_context: str
    created_at: datetime = Field(default_factory=_now)
