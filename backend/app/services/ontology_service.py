"""Ontology bootstrap, diffing, and versioning. See docs/ARCHITECTURE.md §3.2
and this repo's plan for why `compute_diff` is a standalone, reusable
primitive (docs/ROADMAP.md sequencing notes: Phase 7's discovery cycle reuses
it for ontology-change proposals).
"""

from __future__ import annotations

import re

from sqlmodel import Session, select

from app.core import llm
from app.models.ontology import (
    EntityType,
    OntologyDiff,
    OntologyProposal,
    OntologyVersion,
    OntologyVersionSource,
    PropertyDef,
    RelationType,
)
from app.models.source import Source

# Entity type names become Neo4j node labels, which Graphiti validates
# against this same pattern (graphiti_core.helpers.SAFE_CYPHER_IDENTIFIER_PATTERN)
# when it builds each node -- an invalid one (a space, a hyphen, an empty
# name from a blank Studio card) fails extraction of every chunk.
TYPE_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Property names become Pydantic field names on the models handed to
# Graphiti (app/services/extraction_service.py), which reject a leading
# underscore and pydantic's own `model_` namespace.
PROPERTY_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


def is_valid_property_name(name: str) -> bool:
    return bool(PROPERTY_NAME_PATTERN.match(name)) and not name.startswith("model_")


def _property_problems(owner: str, properties: list[PropertyDef]) -> list[str]:
    problems: list[str] = []
    seen: set[str] = set()
    for prop in properties:
        if not prop.name:
            problems.append(f"{owner} has a property with no name")
        elif not is_valid_property_name(prop.name):
            problems.append(
                f"{owner} property {prop.name!r} must start with a letter and contain only "
                "letters, digits and underscores (and not start with 'model_')"
            )
        elif prop.name in seen:
            problems.append(f"{owner} has duplicate property {prop.name!r}")
        seen.add(prop.name)
    return problems


def validate_ontology(
    entity_types: list[EntityType], relation_types: list[RelationType]
) -> list[str]:
    """Human-readable problems that would make this ontology fail (or
    silently misbehave) at extraction time; empty if it's usable. Shared by
    the hand-edit route and the LLM bootstrap so both enforce one contract.
    """
    problems: list[str] = []

    entity_names: set[str] = set()
    for position, et in enumerate(entity_types, start=1):
        owner = f"Entity type {et.name!r}" if et.name else f"Entity type #{position}"
        if not et.name:
            problems.append(f"{owner} has no name")
        elif not TYPE_NAME_PATTERN.match(et.name):
            problems.append(
                f"{owner} name must contain only letters, digits and underscores, "
                "and not start with a digit (it becomes a graph label)"
            )
        elif et.name in entity_names:
            problems.append(f"Duplicate entity type {et.name!r}")
        entity_names.add(et.name)
        problems.extend(_property_problems(owner, et.properties))

    relation_names: set[str] = set()
    for position, rt in enumerate(relation_types, start=1):
        owner = f"Relation type {rt.name!r}" if rt.name else f"Relation type #{position}"
        if not rt.name:
            problems.append(f"{owner} has no name")
        elif rt.name in relation_names:
            problems.append(f"Duplicate relation type {rt.name!r}")
        relation_names.add(rt.name)
        undefined = sorted({*rt.source_types, *rt.target_types} - entity_names)
        if undefined:
            problems.append(f"{owner} references undefined entity type(s): {', '.join(undefined)}")
        problems.extend(_property_problems(owner, rt.properties))

    return problems


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
