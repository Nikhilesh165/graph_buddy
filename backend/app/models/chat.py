"""Persisted chat turns. See docs/ARCHITECTURE.md §3.6 (Retrieval + retrieval
trace) and §4 (Chat), and app/services/chat_service.py for how a turn is
produced.

Phase 4 stored these as one flat append-only log. Each turn now also belongs
to a Conversation (app/models/conversation.py) and is an *episode* in the
chatbot's episodic memory (docs/MEMORY_AND_DISCOVERY.md §2.1-2.2): it
records how the question was resolved against the ontology (`query_plan`,
`standalone_query`), which graph entities it touched (`entity_uuids` -- the
episodic-to-semantic link used for recall by entity overlap), and an
embedding of the question for recall by similarity. `conversation_id` is
nullable because turns written before conversations existed have none.

`QueryPlan` below is both the LLM's structured-output shape for query
resolution (app/core/llm.py `resolve_query`) and what's persisted (as a
plain dict) in `ChatTurn.query_plan` / the retrieval trace -- the discovery
cycle later mines its `unmapped_terms` for ontology gaps.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel
from pydantic import Field as PydanticField
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

QueryIntent = Literal["lookup", "relationship", "aggregate", "overview", "temporal", "comparison"]

# Broad questions are better served by community summaries (periodic
# memory's GraphRAG-style rollups) than by a handful of individual edges.
BROAD_INTENTS: frozenset[str] = frozenset({"aggregate", "overview"})


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

    # --- Episodic memory (docs/MEMORY_AND_DISCOVERY.md §2.2) ---
    # (JSON columns below use none_as_null so "not set" is a real SQL NULL
    # -- plain JSON stores None as the string 'null', which `IS NOT NULL`
    # filters, like memory_service.recall's, would wrongly match.)
    conversation_id: str | None = Field(default=None, index=True)
    # The question rewritten to stand alone (pronouns/ellipsis resolved
    # against working memory) -- what retrieval actually searched for.
    standalone_query: str | None = None
    # QueryPlan.model_dump() -- see below.
    query_plan: dict | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))
    # Graph entity uuids this turn's retrieval surfaced -- links the episode
    # to the semantic graph, for recall by entity overlap.
    entity_uuids: list[str] | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))
    # Embedding of `standalone_query or question`, for recall by similarity.
    embedding: list[float] | None = Field(default=None, sa_column=Column(JSON(none_as_null=True)))


# --- Query resolution value types (LLM structured output) ---


class EntityMention(BaseModel):
    name: str
    entity_type: str | None = None


class TermMapping(BaseModel):
    """A word/phrase the user used, mapped onto an ontology type -- e.g.
    "accounts" -> Customer. Accumulated into learned vocabulary
    (app/models/memory.py OntologyAlias) so later questions resolve faster."""

    term: str
    kind: Literal["entity_type", "relation_type"]
    maps_to: str


class QueryPlan(BaseModel):
    standalone_query: str
    intent: QueryIntent = "lookup"
    entity_types: list[str] = PydanticField(default_factory=list)
    relation_types: list[str] = PydanticField(default_factory=list)
    entity_mentions: list[EntityMention] = PydanticField(default_factory=list)
    term_mappings: list[TermMapping] = PydanticField(default_factory=list)
    # Domain terms in the question with no ontology counterpart -- the
    # discovery cycle's main conversational signal for ontology gaps.
    unmapped_terms: list[str] = PydanticField(default_factory=list)
    uses_conversation_context: bool = False

    @classmethod
    def passthrough(cls, question: str) -> QueryPlan:
        """The plan used when resolution is disabled or fails: search for the
        question verbatim, no ontology constraints."""
        return cls(standalone_query=question)
