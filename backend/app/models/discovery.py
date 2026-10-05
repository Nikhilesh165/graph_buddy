"""The AI-driven ontology discovery cycle's data. See
docs/MEMORY_AND_DISCOVERY.md §3 and app/services/discovery_service.py.

Ontology changes are expressed as a list of *operations* (`OntologyChange`)
rather than as a full proposed ontology snapshot. That matters because a
proposal can sit in the review queue while the ontology moves on underneath
it (another upload's discovery pass auto-applies something, the user edits
the Studio): replaying "add property `budget` to Project" onto whatever the
ontology is at accept time is still meaningful, whereas swapping in a stale
snapshot would silently revert everything that happened in between.

`OntologyChangeSet` is the LLM's structured-output shape;
`OntologyChangeProposal` is its persisted, reviewable form; `DiscoveryEvent`
is the Discovery Feed (docs/ARCHITECTURE.md §4) -- one timeline for
ontology changes and the periodic-consolidation digests alike.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel
from pydantic import Field as PydanticField
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

from app.models.ontology import EntityType, PropertyDef, RelationType

ChangeOpName = Literal[
    "add_entity_type",
    "add_relation_type",
    "add_entity_property",
    "add_relation_property",
    "extend_relation_endpoints",
    "update_description",
    "rename_entity_type",
    "rename_relation_type",
    "remove_entity_type",
    "remove_relation_type",
]

# low = refines an existing type; medium = adds new structure; high =
# destructive (renames/removals can orphan already-extracted graph data).
RiskLevel = Literal["low", "medium", "high"]

ProposalStatus = Literal["pending", "applied", "rejected", "failed"]
ProposalTrigger = Literal["source", "conversation", "manual"]

DiscoveryEventKind = Literal[
    "ontology_bootstrapped",
    "ontology_evolved",
    "proposal_pending",
    "proposal_accepted",
    "proposal_rejected",
    "source_analyzed",
    "discovery_failed",
    "consolidation_digest",
]


def _now() -> datetime:
    return datetime.now(UTC)


# --- Value types (LLM structured output) ---


class OntologyChange(BaseModel):
    op: ChangeOpName
    target: str = PydanticField(
        description=(
            "Name of the type this change acts on. For add_entity_type/"
            "add_relation_type, the new type's name; for add_*_property, "
            "extend_relation_endpoints, update_description, rename_* and "
            "remove_*, the existing type's name."
        )
    )
    entity_type: EntityType | None = PydanticField(
        default=None, description="Full definition, for add_entity_type only."
    )
    relation_type: RelationType | None = PydanticField(
        default=None, description="Full definition, for add_relation_type only."
    )
    property_def: PropertyDef | None = PydanticField(
        default=None, description="The new property, for add_entity_property/add_relation_property."
    )
    source_types: list[str] = PydanticField(
        default_factory=list,
        description="Extra source entity types, for extend_relation_endpoints.",
    )
    target_types: list[str] = PydanticField(
        default_factory=list,
        description="Extra target entity types, for extend_relation_endpoints.",
    )
    new_name: str | None = PydanticField(default=None, description="For rename_* only.")
    description: str | None = PydanticField(
        default=None, description="New description, for update_description only."
    )
    rationale: str = PydanticField(default="", description="Why this change is warranted.")


class Evidence(BaseModel):
    quote: str
    origin: str = ""


class OntologyChangeSet(BaseModel):
    summary: str = PydanticField(
        default="", description="One or two plain-language sentences on what changes and why."
    )
    changes: list[OntologyChange] = PydanticField(default_factory=list)
    evidence: list[Evidence] = PydanticField(default_factory=list)


# --- Persisted tables ---


class OntologyChangeProposal(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    # Plain str at the table level -- SQLModel can't map Literal aliases to a
    # SQL type (same convention as app/models/source.py's status columns).
    status: str = "pending"
    trigger: str
    source_id: str | None = None
    base_version_number: int = 0
    summary: str = ""
    changes: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    evidence: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    risk: str = "low"
    auto_applied: bool = False
    resulting_version_id: str | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=_now)
    decided_at: datetime | None = None

    def changes_typed(self) -> list[OntologyChange]:
        return [OntologyChange.model_validate(c) for c in self.changes]


class DiscoveryEvent(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    kind: str = Field(index=True)
    title: str
    body: str = ""
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_now, index=True)


# --- API read shapes ---


class OntologyChangeProposalRead(BaseModel):
    id: str
    status: ProposalStatus
    trigger: ProposalTrigger
    source_id: str | None
    base_version_number: int
    summary: str
    changes: list[OntologyChange]
    evidence: list[Evidence]
    risk: RiskLevel
    auto_applied: bool
    resulting_version_id: str | None
    error: str | None
    created_at: datetime
    decided_at: datetime | None

    @classmethod
    def from_proposal(cls, proposal: OntologyChangeProposal) -> OntologyChangeProposalRead:
        return cls(
            id=proposal.id,
            status=proposal.status,
            trigger=proposal.trigger,
            source_id=proposal.source_id,
            base_version_number=proposal.base_version_number,
            summary=proposal.summary,
            changes=proposal.changes_typed(),
            evidence=[Evidence.model_validate(e) for e in proposal.evidence],
            risk=proposal.risk,
            auto_applied=proposal.auto_applied,
            resulting_version_id=proposal.resulting_version_id,
            error=proposal.error,
            created_at=proposal.created_at,
            decided_at=proposal.decided_at,
        )


class DiscoveryEventRead(BaseModel):
    id: str
    kind: DiscoveryEventKind
    title: str
    body: str
    payload: dict[str, Any]
    created_at: datetime

    @classmethod
    def from_event(cls, event: DiscoveryEvent) -> DiscoveryEventRead:
        return cls(
            id=event.id,
            kind=event.kind,
            title=event.title,
            body=event.body,
            payload=event.payload or {},
            created_at=event.created_at,
        )
