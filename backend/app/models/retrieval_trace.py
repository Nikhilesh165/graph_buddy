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
    #       "source_node_uuid","target_node_uuid","ontology_match"}] --
    # mirrors chat_service.RetrievedFact.
    facts: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    final_context: str
    created_at: datetime = Field(default_factory=_now)

    # --- Query resolution + memory (docs/MEMORY_AND_DISCOVERY.md §2.3) ---
    # Nullable: traces written before this existed have none of these.
    # QueryPlan.model_dump() plus the ontology filters actually applied
    # ({"plan": {...}, "edge_types": [...], "node_labels": [...],
    #   "anchors": [{"uuid","name","type"}]}).
    resolution: dict | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))
    # Which memory fed this answer: {"conversation_summary": str,
    # "working_turns": [{"turn_id","question"}],
    # "recalled": [{"turn_id","question","score","reason"}],
    # "vocabulary": [{"term","maps_to"}]}.
    memory: dict | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))
    # list[{"uuid","name","summary","score"}] -- community summaries
    # (periodic memory) included as background for broad questions.
    communities: list[dict] | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))
