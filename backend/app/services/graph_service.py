"""Phase 3: read-only graph queries for the Graph Explorer UI. See
docs/ARCHITECTURE.md §4 (Graph Explorer) and §3.7 (confidence).

Graphiti's Python API (`Graphiti.search`, `EntityNode.get_by_group_ids`, ...)
is built for retrieval (semantic/BM25/traversal ranked by relevance), not for
"give me the subgraph matching these UI filters" -- there's no built-in way to
filter by node/relation type *and* confidence *and* a valid_at window in one
call. So this talks to Neo4j directly via `graphiti.driver.execute_query`,
the same low-level entry point graphiti_core's own node/edge classes use
internally (see e.g. `EntityEdge.get_by_group_ids` in graphiti_core/edges.py).
This ties the queries below to the Neo4j backend specifically, which matches
this repo's backend decision (ARCHITECTURE.md §3.4) -- there's no
provider-abstraction layer to preserve here.

Confidence is stored as a top-level relationship property (flattened out of
`EntityEdge.attributes` by `EntityEdge.save()` for the Neo4j driver -- see
extraction_service.py's module docstring), so `e.confidence` is directly
queryable/filterable in Cypher without reading back through `attributes`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from graphiti_core import Graphiti
from graphiti_core.helpers import parse_db_date

# Graphiti's own base label on every entity node, alongside whichever
# ontology entity type name(s) apply (see EntityNode.save in graphiti_core/
# nodes.py: `labels = self.labels + ['Entity']`). Not itself a useful "type"
# to show in the UI.
BASE_ENTITY_LABEL = "Entity"

DEFAULT_LIMIT = 300
MAX_LIMIT = 1000


def _primary_type(labels: list[str] | None) -> str:
    for label in labels or []:
        if label != BASE_ENTITY_LABEL:
            return label
    return BASE_ENTITY_LABEL


@dataclass
class GraphNode:
    uuid: str
    name: str
    type: str
    labels: list[str]
    summary: str
    attributes: dict[str, Any]
    created_at: datetime | None = None


@dataclass
class GraphEdge:
    uuid: str
    source_uuid: str
    target_uuid: str
    name: str
    fact: str
    confidence: float | None
    valid_at: datetime | None
    invalid_at: datetime | None
    created_at: datetime | None
    episodes: list[str] = field(default_factory=list)


@dataclass
class GraphFilters:
    entity_types: list[str] | None = None
    relation_types: list[str] | None = None
    min_confidence: float = 0.0
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    search: str | None = None
    limit: int = DEFAULT_LIMIT


@dataclass
class GraphQueryResult:
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    truncated: bool


@dataclass
class ProvenanceItem:
    episode_uuid: str
    source_description: str
    valid_at: datetime | None


@dataclass
class NodeNeighbor:
    edge: GraphEdge
    direction: str  # "outgoing" | "incoming", relative to the queried node
    node: GraphNode


@dataclass
class NodeDetail:
    node: GraphNode
    neighbors: list[NodeNeighbor]
    provenance: list[ProvenanceItem]


def _node_from_prefixed_row(row: dict[str, Any], prefix: str) -> GraphNode:
    labels = row.get(f"{prefix}_labels") or []
    return GraphNode(
        uuid=row[f"{prefix}_uuid"],
        name=row[f"{prefix}_name"],
        type=_primary_type(labels),
        labels=labels,
        summary=row.get(f"{prefix}_summary") or "",
        attributes=row.get(f"{prefix}_attributes") or {},
    )


def _edge_from_row(row: dict[str, Any], *, source_uuid: str, target_uuid: str) -> GraphEdge:
    return GraphEdge(
        uuid=row["uuid"],
        source_uuid=source_uuid,
        target_uuid=target_uuid,
        name=row["name"],
        fact=row["fact"],
        confidence=row.get("confidence"),
        valid_at=parse_db_date(row.get("valid_at")),
        invalid_at=parse_db_date(row.get("invalid_at")),
        created_at=parse_db_date(row.get("created_at")),
        episodes=row.get("episodes") or [],
    )


async def query_graph(graphiti: Graphiti, filters: GraphFilters) -> GraphQueryResult:
    """One query, driven entirely by the edge: nodes are whatever a matching
    edge touches. An orphan entity (mentioned but never related to anything)
    won't show up -- a reasonable v0 trade-off for the Explorer, which is
    fundamentally about relationships, and it keeps this to a single
    round-trip instead of a separate node scan unioned in.
    """
    limit = max(1, min(filters.limit, MAX_LIMIT))

    # Unscored edges (no ontology-guided relation type matched, so the LLM
    # never populated `confidence` -- see extraction_service.py) are treated
    # as confidence 0.0 rather than exempted from the filter: confidence is
    # meant to be surfaced/filterable everywhere (ARCHITECTURE.md §3.7), and
    # a fact nobody scored shouldn't silently bypass a "show me >= 0.8" query.
    where_clauses = ["coalesce(e.confidence, 0.0) >= $min_confidence"]
    params: dict[str, Any] = {"min_confidence": filters.min_confidence, "limit": limit + 1}

    if filters.relation_types:
        where_clauses.append("e.name IN $relation_types")
        params["relation_types"] = filters.relation_types

    if filters.entity_types:
        where_clauses.append(
            "(any(l IN labels(n) WHERE l IN $entity_types) "
            "OR any(l IN labels(m) WHERE l IN $entity_types))"
        )
        params["entity_types"] = filters.entity_types

    if filters.valid_from is not None:
        where_clauses.append("(e.valid_at IS NULL OR e.valid_at >= $valid_from)")
        params["valid_from"] = filters.valid_from

    if filters.valid_to is not None:
        where_clauses.append("(e.valid_at IS NULL OR e.valid_at <= $valid_to)")
        params["valid_to"] = filters.valid_to

    if filters.search:
        where_clauses.append(
            "(toLower(e.fact) CONTAINS $search "
            "OR toLower(n.name) CONTAINS $search OR toLower(m.name) CONTAINS $search)"
        )
        params["search"] = filters.search.lower()

    query = f"""
        MATCH (n:Entity)-[e:RELATES_TO]->(m:Entity)
        WHERE {" AND ".join(where_clauses)}
        RETURN
            e.uuid AS uuid, e.name AS name, e.fact AS fact, e.confidence AS confidence,
            e.valid_at AS valid_at, e.invalid_at AS invalid_at, e.created_at AS created_at,
            e.episodes AS episodes,
            n.uuid AS source_uuid, n.name AS source_name, labels(n) AS source_labels,
            n.summary AS source_summary, n.attributes AS source_attributes,
            m.uuid AS target_uuid, m.name AS target_name, labels(m) AS target_labels,
            m.summary AS target_summary, m.attributes AS target_attributes
        ORDER BY e.created_at DESC
        LIMIT $limit
    """

    records, _, _ = await graphiti.driver.execute_query(query, routing_="r", **params)
    rows = [dict(record) for record in records]

    truncated = len(rows) > limit
    rows = rows[:limit]

    nodes: dict[str, GraphNode] = {}
    edges: list[GraphEdge] = []
    for row in rows:
        for prefix in ("source", "target"):
            node = _node_from_prefixed_row(row, prefix)
            nodes.setdefault(node.uuid, node)
        edges.append(
            _edge_from_row(row, source_uuid=row["source_uuid"], target_uuid=row["target_uuid"])
        )

    return GraphQueryResult(nodes=list(nodes.values()), edges=edges, truncated=truncated)


async def get_node_detail(graphiti: Graphiti, node_uuid: str) -> NodeDetail | None:
    node_query = """
        MATCH (n:Entity {uuid: $uuid})
        RETURN n.uuid AS uuid, n.name AS name, labels(n) AS labels, n.summary AS summary,
               n.attributes AS attributes, n.created_at AS created_at
    """
    node_records, _, _ = await graphiti.driver.execute_query(
        node_query, uuid=node_uuid, routing_="r"
    )
    if not node_records:
        return None

    node_row = dict(node_records[0])
    node = GraphNode(
        uuid=node_row["uuid"],
        name=node_row["name"],
        type=_primary_type(node_row.get("labels")),
        labels=node_row.get("labels") or [],
        summary=node_row.get("summary") or "",
        attributes=node_row.get("attributes") or {},
        created_at=parse_db_date(node_row.get("created_at")),
    )

    # Undirected match + `startNode(e)` to recover direction -- `n` in the
    # pattern below is *not* necessarily the relationship's start node.
    neighbor_query = """
        MATCH (n:Entity {uuid: $uuid})-[e:RELATES_TO]-(m:Entity)
        RETURN e.uuid AS uuid, e.name AS name, e.fact AS fact, e.confidence AS confidence,
               e.valid_at AS valid_at, e.invalid_at AS invalid_at, e.created_at AS created_at,
               e.episodes AS episodes,
               startNode(e).uuid AS start_uuid,
               m.uuid AS other_uuid, m.name AS other_name, labels(m) AS other_labels,
               m.summary AS other_summary, m.attributes AS other_attributes
    """
    neighbor_records, _, _ = await graphiti.driver.execute_query(
        neighbor_query, uuid=node_uuid, routing_="r"
    )

    neighbors: list[NodeNeighbor] = []
    for record in neighbor_records:
        row = dict(record)
        neighbor_node = _node_from_prefixed_row(row, "other")
        outgoing = row["start_uuid"] == node_uuid
        edge = _edge_from_row(
            row,
            source_uuid=node_uuid if outgoing else neighbor_node.uuid,
            target_uuid=neighbor_node.uuid if outgoing else node_uuid,
        )
        neighbors.append(
            NodeNeighbor(
                edge=edge,
                direction="outgoing" if outgoing else "incoming",
                node=neighbor_node,
            )
        )

    provenance_query = """
        MATCH (ep:Episodic)-[:MENTIONS]->(n:Entity {uuid: $uuid})
        RETURN ep.uuid AS episode_uuid, ep.source_description AS source_description,
               ep.valid_at AS valid_at
        ORDER BY ep.valid_at DESC
    """
    provenance_records, _, _ = await graphiti.driver.execute_query(
        provenance_query, uuid=node_uuid, routing_="r"
    )
    provenance = [
        ProvenanceItem(
            episode_uuid=row["episode_uuid"],
            source_description=row.get("source_description") or "",
            valid_at=parse_db_date(row.get("valid_at")),
        )
        for row in (dict(r) for r in provenance_records)
    ]

    return NodeDetail(node=node, neighbors=neighbors, provenance=provenance)
