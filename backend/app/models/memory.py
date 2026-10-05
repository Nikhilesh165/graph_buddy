"""Consolidated (semantic/periodic) memory that isn't part of the knowledge
graph itself. See docs/MEMORY_AND_DISCOVERY.md §2.

- `OntologyAlias` is *learned vocabulary*: every time query resolution maps
  a user's word onto an ontology type ("accounts" -> Customer), the mapping
  is reinforced here. The resolver reads the strongest mappings back on the
  next question, so the chatbot's grasp of how *this* user talks about
  *this* ontology sharpens with use rather than being re-derived each time.
- `ConsolidationRun` records each periodic-consolidation cycle
  (app/services/consolidation_service.py): what it did, and the
  plain-language digest it wrote to the Discovery Feed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel

ConsolidationStatus = Literal["running", "completed", "failed"]
ConsolidationTrigger = Literal["schedule", "manual"]


def _now() -> datetime:
    return datetime.now(UTC)


class OntologyAlias(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("term", "kind", "maps_to"),)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    term: str = Field(index=True)  # normalized: lowercased, whitespace-collapsed
    kind: str  # "entity_type" | "relation_type"
    maps_to: str
    hits: int = 1
    first_seen_at: datetime = Field(default_factory=_now)
    last_seen_at: datetime = Field(default_factory=_now)


class ConsolidationRun(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    trigger: str
    status: str = "running"
    started_at: datetime = Field(default_factory=_now, index=True)
    finished_at: datetime | None = None
    stats: dict = Field(default_factory=dict, sa_column=Column(JSON))
    digest: str = ""
    error: str | None = None


class OntologyAliasRead(BaseModel):
    term: str
    kind: Literal["entity_type", "relation_type"]
    maps_to: str
    hits: int
    last_seen_at: datetime

    @classmethod
    def from_alias(cls, alias: OntologyAlias) -> OntologyAliasRead:
        return cls(
            term=alias.term,
            kind=alias.kind,
            maps_to=alias.maps_to,
            hits=alias.hits,
            last_seen_at=alias.last_seen_at,
        )


class ConsolidationRunRead(BaseModel):
    id: str
    trigger: ConsolidationTrigger
    status: ConsolidationStatus
    started_at: datetime
    finished_at: datetime | None
    stats: dict[str, Any]
    digest: str
    error: str | None

    @classmethod
    def from_run(cls, run: ConsolidationRun) -> ConsolidationRunRead:
        return cls(
            id=run.id,
            trigger=run.trigger,
            status=run.status,
            started_at=run.started_at,
            finished_at=run.finished_at,
            stats=run.stats or {},
            digest=run.digest,
            error=run.error,
        )
