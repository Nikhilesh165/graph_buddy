"""The ontology registry. See docs/ARCHITECTURE.md §3.2.

`OntologyVersion` is an append-only history, not an in-place-edited singleton
-- every bootstrap or hand-edit creates a new row with a diff against the
previous version. docs/ROADMAP.md's sequencing notes call for this explicitly:
Phase 7 (discovery cycle) reuses this same diffing primitive for its ontology
proposals, so it isn't one-off code built just for Phase 1's Studio.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel
from pydantic import Field as PydanticField
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

OntologyVersionSource = Literal["bootstrap", "user_edit"]


def _now() -> datetime:
    return datetime.now(UTC)


# --- Value types (used both as the LLM's structured-output schema and as the
# shape stored -- as plain dicts -- in OntologyVersion's JSON columns) ---


class PropertyDef(BaseModel):
    name: str
    description: str = ""
    type: str = "string"


class EntityType(BaseModel):
    name: str
    description: str = ""
    properties: list[PropertyDef] = PydanticField(default_factory=list)
    examples: list[str] = PydanticField(default_factory=list)


class RelationType(BaseModel):
    name: str
    description: str = ""
    source_types: list[str] = PydanticField(default_factory=list)
    target_types: list[str] = PydanticField(default_factory=list)
    properties: list[PropertyDef] = PydanticField(default_factory=list)


class OntologyProposal(BaseModel):
    """Both the LLM bootstrap's structured-output shape and the body of a
    hand-edit (PUT /ontology)."""

    entity_types: list[EntityType] = PydanticField(default_factory=list)
    relation_types: list[RelationType] = PydanticField(default_factory=list)


class OntologyDiff(BaseModel):
    added_entity_types: list[str] = PydanticField(default_factory=list)
    removed_entity_types: list[str] = PydanticField(default_factory=list)
    modified_entity_types: list[str] = PydanticField(default_factory=list)
    added_relation_types: list[str] = PydanticField(default_factory=list)
    removed_relation_types: list[str] = PydanticField(default_factory=list)
    modified_relation_types: list[str] = PydanticField(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not any(
            [
                self.added_entity_types,
                self.removed_entity_types,
                self.modified_entity_types,
                self.added_relation_types,
                self.removed_relation_types,
                self.modified_relation_types,
            ]
        )


# --- Persisted table: entity_types/relation_types/diff are stored as plain
# JSON (list[dict] / dict), reconstructed into the typed models above via the
# `*_typed` helpers below -- SQLModel's JSON column type doesn't natively
# round-trip nested Pydantic models. ---


class OntologyVersion(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    version_number: int = Field(index=True)
    entity_types: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    relation_types: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    # Plain str at the table level -- SQLModel's column-type inference can't
    # map a `Literal[...]` alias to a SQL type. `OntologyVersionSource` is
    # still the validated type on `OntologyVersionRead` and everywhere else.
    created_by: str
    source_id: str | None = None
    diff: dict | None = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_now)

    def entity_types_typed(self) -> list[EntityType]:
        return [EntityType.model_validate(d) for d in self.entity_types]

    def relation_types_typed(self) -> list[RelationType]:
        return [RelationType.model_validate(d) for d in self.relation_types]

    def diff_typed(self) -> OntologyDiff | None:
        return OntologyDiff.model_validate(self.diff) if self.diff is not None else None


class OntologyVersionRead(BaseModel):
    """API response shape -- typed, unlike the raw-dict JSON columns above."""

    id: str
    version_number: int
    entity_types: list[EntityType]
    relation_types: list[RelationType]
    created_by: OntologyVersionSource
    source_id: str | None
    diff: OntologyDiff | None
    created_at: datetime

    @classmethod
    def from_version(cls, version: OntologyVersion) -> OntologyVersionRead:
        return cls(
            id=version.id,
            version_number=version.version_number,
            entity_types=version.entity_types_typed(),
            relation_types=version.relation_types_typed(),
            created_by=version.created_by,
            source_id=version.source_id,
            diff=version.diff_typed(),
            created_at=version.created_at,
        )

    @classmethod
    def empty(cls) -> OntologyVersionRead:
        """The "no ontology yet" shape GET /ontology returns instead of 404."""
        return cls(
            id="",
            version_number=0,
            entity_types=[],
            relation_types=[],
            created_by="bootstrap",
            source_id=None,
            diff=None,
            created_at=_now(),
        )
