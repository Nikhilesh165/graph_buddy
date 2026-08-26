"""Ontology bootstrap, diffing, and versioning. See docs/ARCHITECTURE.md §3.2
and this repo's plan for why `compute_diff` is a standalone, reusable
primitive (docs/ROADMAP.md sequencing notes: Phase 7's discovery cycle reuses
it for ontology-change proposals).
"""

from __future__ import annotations

from sqlmodel import Session, select

from app.core import llm
from app.models.ontology import (
    EntityType,
    OntologyDiff,
    OntologyProposal,
    OntologyVersion,
    OntologyVersionSource,
    RelationType,
)
from app.models.source import Source


def sample_for_bootstrap(source: Source, max_chars: int) -> str:
    """First `max_chars` of parsed text, cut at the last full line so a CSV
    row (or a prose sentence) isn't truncated mid-way.
    """
    text = source.parsed_text or ""
    if len(text) <= max_chars:
        return text
    truncated = text[:max_chars]
    last_newline = truncated.rfind("\n")
    return truncated[:last_newline] if last_newline > 0 else truncated


async def bootstrap_ontology(sample: str, *, api_key: str | None, model: str) -> OntologyProposal:
    return await llm.propose_ontology(sample, api_key=api_key, model=model)


def compute_diff(
    old: OntologyVersion | None,
    new_entity_types: list[EntityType],
    new_relation_types: list[RelationType],
) -> OntologyDiff:
    old_entities = {et.name: et for et in old.entity_types_typed()} if old else {}
    old_relations = {rt.name: rt for rt in old.relation_types_typed()} if old else {}
    new_entities = {et.name: et for et in new_entity_types}
    new_relations = {rt.name: rt for rt in new_relation_types}

    return OntologyDiff(
        added_entity_types=sorted(new_entities.keys() - old_entities.keys()),
        removed_entity_types=sorted(old_entities.keys() - new_entities.keys()),
        modified_entity_types=sorted(
            name
            for name in new_entities.keys() & old_entities.keys()
            if new_entities[name] != old_entities[name]
        ),
        added_relation_types=sorted(new_relations.keys() - old_relations.keys()),
        removed_relation_types=sorted(old_relations.keys() - new_relations.keys()),
        modified_relation_types=sorted(
            name
            for name in new_relations.keys() & old_relations.keys()
            if new_relations[name] != old_relations[name]
        ),
    )


def get_latest_version(session: Session) -> OntologyVersion | None:
    statement = select(OntologyVersion).order_by(OntologyVersion.version_number.desc())
    return session.exec(statement).first()


def save_new_version(
    session: Session,
    entity_types: list[EntityType],
    relation_types: list[RelationType],
    created_by: OntologyVersionSource,
    source_id: str | None = None,
) -> OntologyVersion:
    latest = get_latest_version(session)
    diff = compute_diff(latest, entity_types, relation_types)
    version = OntologyVersion(
        version_number=(latest.version_number + 1) if latest else 1,
        entity_types=[et.model_dump() for et in entity_types],
        relation_types=[rt.model_dump() for rt in relation_types],
        created_by=created_by,
        source_id=source_id,
        diff=diff.model_dump(),
    )
    session.add(version)
    session.commit()
    session.refresh(version)
    return version
