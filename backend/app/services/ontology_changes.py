"""Pure ontology change-set operations: apply, classify risk, split by
autonomy policy. See docs/MEMORY_AND_DISCOVERY.md §3.2 and
app/models/discovery.py for why changes are operations rather than snapshots.

Nothing here touches the database or an LLM -- discovery_service.py and the
accept endpoint both call `apply_changes` against whatever the latest
ontology is at that moment, and the result goes through the same
`ontology_service.save_new_version` (and so the same `compute_diff`) as a
bootstrap or a hand edit.

`apply_changes` is deliberately forgiving: an LLM-proposed change that no
longer makes sense against the current ontology (adds a type that already
exists, extends a relation that was since removed, names an endpoint type
nobody defined) is *skipped with a reason*, never raised -- a change set is
a batch of independent suggestions, and one bad suggestion shouldn't sink
the rest of the batch.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from graphiti_core.helpers import SAFE_CYPHER_IDENTIFIER_PATTERN

from app.models.discovery import OntologyChange, RiskLevel
from app.models.ontology import EntityType, OntologyProposal, PropertyDef, RelationType

AutonomyLevel = Literal["manual", "assisted", "autonomous"]

# Labels Graphiti itself puts on nodes -- an ontology type with one of these
# names would be indistinguishable from Graphiti's own bookkeeping.
RESERVED_TYPE_NAMES: frozenset[str] = frozenset({"Entity", "Episodic", "Community", "Saga"})

# Mirrors extraction_service.PROPERTY_TYPE_MAP's canonical keys.
SUPPORTED_PROPERTY_TYPES: frozenset[str] = frozenset({"string", "number", "integer", "boolean"})

# Injected on every relation by extraction_service.build_edge_type_models --
# an ontology property of the same name would be silently overridden.
SYSTEM_RELATION_PROPERTIES: frozenset[str] = frozenset({"confidence"})

OP_RISK: dict[str, RiskLevel] = {
    "add_entity_property": "low",
    "add_relation_property": "low",
    "extend_relation_endpoints": "low",
    "update_description": "low",
    "add_entity_type": "medium",
    "add_relation_type": "medium",
    "rename_entity_type": "high",
    "rename_relation_type": "high",
    "remove_entity_type": "high",
    "remove_relation_type": "high",
}

_RISK_ORDER: dict[RiskLevel, int] = {"low": 0, "medium": 1, "high": 2}

# What each autonomy level may apply without asking. "high" (renames and
# removals) is in none of them on purpose: those can orphan graph data
# that's already been extracted under the old name, so a human always
# decides.
AUTO_APPLY_RISKS: dict[AutonomyLevel, frozenset[RiskLevel]] = {
    "manual": frozenset(),
    "assisted": frozenset({"low"}),
    "autonomous": frozenset({"low", "medium"}),
}

# Apply order within one change set: new entity types first so a relation
# added in the same batch can reference them, destructive ops last.
_OP_PHASE: dict[str, int] = {
    "add_entity_type": 0,
    "add_relation_type": 1,
    "add_entity_property": 2,
    "add_relation_property": 2,
    "extend_relation_endpoints": 2,
    "update_description": 2,
    "rename_entity_type": 3,
    "rename_relation_type": 3,
    "remove_relation_type": 4,
    "remove_entity_type": 4,
}


def classify(change: OntologyChange) -> RiskLevel:
    return OP_RISK[change.op]


def max_risk(changes: list[OntologyChange]) -> RiskLevel:
    if not changes:
        return "low"
    return max((classify(c) for c in changes), key=_RISK_ORDER.__getitem__)


def partition_by_policy(
    changes: list[OntologyChange], autonomy: AutonomyLevel
) -> tuple[list[OntologyChange], list[OntologyChange]]:
    """(auto-apply now, queue for review)."""
    allowed = AUTO_APPLY_RISKS[autonomy]
    auto = [c for c in changes if classify(c) in allowed]
    review = [c for c in changes if classify(c) not in allowed]
    return auto, review


def changes_from_bootstrap(proposal: OntologyProposal) -> list[OntologyChange]:
    """Express a from-scratch bootstrap as an ordinary change set, so first
    contact with a dataset flows through the same policy/proposal/feed path
    as every later evolution instead of being a special case."""
    return [
        *(
            OntologyChange(op="add_entity_type", target=et.name, entity_type=et)
            for et in proposal.entity_types
        ),
        *(
            OntologyChange(op="add_relation_type", target=rt.name, relation_type=rt)
            for rt in proposal.relation_types
        ),
    ]


def describe_change(change: OntologyChange) -> str:
    """One plain-language line per change, for the Discovery Feed."""
    match change.op:
        case "add_entity_type":
            return f"Add entity type {change.target}"
        case "add_relation_type":
            rt = change.relation_type
            sources = ", ".join(rt.source_types if rt else change.source_types) or "?"
            targets = ", ".join(rt.target_types if rt else change.target_types) or "?"
            return f"Add relation {change.target} ({sources} → {targets})"
        case "add_entity_property" | "add_relation_property":
            name = change.property_def.name if change.property_def else "?"
            return f"Add property '{name}' to {change.target}"
        case "extend_relation_endpoints":
            sources = ", ".join(change.source_types) or "—"
            targets = ", ".join(change.target_types) or "—"
            return f"Extend {change.target} endpoints (sources: {sources}; targets: {targets})"
        case "update_description":
            return f"Update the description of {change.target}"
        case "rename_entity_type" | "rename_relation_type":
            return f"Rename {change.target} → {change.new_name}"
        case "remove_entity_type":
            return f"Remove entity type {change.target}"
        case "remove_relation_type":
            return f"Remove relation {change.target}"
    return f"{change.op} {change.target}"  # pragma: no cover - exhaustive above


@dataclass
class SkippedChange:
    change: OntologyChange
    reason: str


@dataclass
class ApplyResult:
    entity_types: list[EntityType]
    relation_types: list[RelationType]
    applied: list[OntologyChange] = field(default_factory=list)
    skipped: list[SkippedChange] = field(default_factory=list)


def is_valid_type_name(name: str) -> bool:
    return bool(SAFE_CYPHER_IDENTIFIER_PATTERN.match(name)) and name not in RESERVED_TYPE_NAMES


def _find(names: list[str], wanted: str) -> str | None:
    """Case-insensitive lookup returning the canonical spelling -- an LLM
    saying "customer" for an ontology's "Customer" is the same type."""
    lowered = wanted.strip().lower()
    return next((n for n in names if n.lower() == lowered), None)


def _normalize_property(prop: PropertyDef) -> PropertyDef:
    prop_type = prop.type.strip().lower()
    return PropertyDef(
        name=prop.name.strip(),
        description=prop.description,
        type=prop_type if prop_type in SUPPORTED_PROPERTY_TYPES else "string",
    )


class _Skip(Exception):  # noqa: N818 - internal control flow, not an error type
    pass


def apply_changes(
    entity_types: list[EntityType],
    relation_types: list[RelationType],
    changes: list[OntologyChange],
) -> ApplyResult:
    entities = [et.model_copy(deep=True) for et in entity_types]
    relations = [rt.model_copy(deep=True) for rt in relation_types]
    result = ApplyResult(entity_types=entities, relation_types=relations)

    def entity_names() -> list[str]:
        return [et.name for et in entities]

    def relation_names() -> list[str]:
        return [rt.name for rt in relations]

    def get_entity(name: str) -> EntityType:
        canonical = _find(entity_names(), name)
        if canonical is None:
            raise _Skip(f"entity type {name!r} doesn't exist")
        return next(et for et in entities if et.name == canonical)

    def get_relation(name: str) -> RelationType:
        canonical = _find(relation_names(), name)
        if canonical is None:
            raise _Skip(f"relation type {name!r} doesn't exist")
        return next(rt for rt in relations if rt.name == canonical)

    def resolve_endpoints(names: list[str]) -> list[str]:
        resolved = [_find(entity_names(), n) for n in names]
        return list(dict.fromkeys(n for n in resolved if n is not None))

    def check_new_name(name: str, existing: list[str], kind: str) -> None:
        if not is_valid_type_name(name):
            raise _Skip(f"{name!r} isn't a valid {kind} name")
        clash = _find(existing, name)
        if clash is not None:
            raise _Skip(f"{kind} {clash!r} already exists")

    def add_property(properties: list[PropertyDef], change: OntologyChange, owner: str) -> None:
        if change.property_def is None or not change.property_def.name.strip():
            raise _Skip("no property definition given")
        prop = _normalize_property(change.property_def)
        if _find([p.name for p in properties], prop.name) is not None:
            raise _Skip(f"{owner} already has a property {prop.name!r}")
        properties.append(prop)

    def apply_one(change: OntologyChange) -> None:
        match change.op:
            case "add_entity_type":
                new = change.entity_type or EntityType(name=change.target)
                name = (new.name or change.target).strip()
                check_new_name(name, entity_names(), "entity type")
                properties: list[PropertyDef] = []
                for prop in new.properties:
                    if prop.name.strip() and _find([p.name for p in properties], prop.name) is None:
                        properties.append(_normalize_property(prop))
                entities.append(new.model_copy(update={"name": name, "properties": properties}))

            case "add_relation_type":
                new = change.relation_type or RelationType(
                    name=change.target,
                    source_types=change.source_types,
                    target_types=change.target_types,
                )
                name = (new.name or change.target).strip()
                check_new_name(name, relation_names(), "relation type")
                sources = resolve_endpoints(new.source_types)
                targets = resolve_endpoints(new.target_types)
                if not sources or not targets:
                    raise _Skip(f"relation {name!r} has no known source or target entity types")
                properties = [
                    _normalize_property(p)
                    for p in new.properties
                    if p.name.strip() and p.name.strip() not in SYSTEM_RELATION_PROPERTIES
                ]
                relations.append(
                    new.model_copy(
                        update={
                            "name": name,
                            "source_types": sources,
                            "target_types": targets,
                            "properties": properties,
                        }
                    )
                )

            case "add_entity_property":
                entity = get_entity(change.target)
                add_property(entity.properties, change, entity.name)

            case "add_relation_property":
                relation = get_relation(change.target)
                if change.property_def and change.property_def.name.strip() in (
                    SYSTEM_RELATION_PROPERTIES
                ):
                    raise _Skip(f"{change.property_def.name!r} is a system-managed property")
                add_property(relation.properties, change, relation.name)

            case "extend_relation_endpoints":
                relation = get_relation(change.target)
                new_sources = [
                    n
                    for n in resolve_endpoints(change.source_types)
                    if n not in relation.source_types
                ]
                new_targets = [
                    n
                    for n in resolve_endpoints(change.target_types)
                    if n not in relation.target_types
                ]
                if not new_sources and not new_targets:
                    raise _Skip("no new known endpoint types to add")
                relation.source_types.extend(new_sources)
                relation.target_types.extend(new_targets)

            case "update_description":
                if not (change.description or "").strip():
                    raise _Skip("no new description given")
                canonical_entity = _find(entity_names(), change.target)
                if canonical_entity is not None:
                    get_entity(canonical_entity).description = change.description.strip()
                else:
                    get_relation(change.target).description = change.description.strip()

            case "rename_entity_type":
                entity = get_entity(change.target)
                new_name = (change.new_name or "").strip()
                check_new_name(
                    new_name, [n for n in entity_names() if n != entity.name], "entity type"
                )
                old_name = entity.name
                entity.name = new_name
                for rt in relations:
                    rt.source_types = [new_name if n == old_name else n for n in rt.source_types]
                    rt.target_types = [new_name if n == old_name else n for n in rt.target_types]

            case "rename_relation_type":
                relation = get_relation(change.target)
                new_name = (change.new_name or "").strip()
                check_new_name(
                    new_name, [n for n in relation_names() if n != relation.name], "relation type"
                )
                relation.name = new_name

            case "remove_entity_type":
                entity = get_entity(change.target)
                entities.remove(entity)
                for rt in list(relations):
                    rt.source_types = [n for n in rt.source_types if n != entity.name]
                    rt.target_types = [n for n in rt.target_types if n != entity.name]
                    # A relation left with no source or no target can never
                    # match anything during extraction -- drop it with its type.
                    if not rt.source_types or not rt.target_types:
                        relations.remove(rt)

            case "remove_relation_type":
                relations.remove(get_relation(change.target))

    for change in sorted(changes, key=lambda c: _OP_PHASE[c.op]):
        try:
            apply_one(change)
        except _Skip as skip:
            result.skipped.append(SkippedChange(change=change, reason=str(skip)))
        else:
            result.applied.append(change)

    return result
