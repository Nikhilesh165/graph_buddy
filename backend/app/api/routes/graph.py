"""Phase 3: Graph Explorer API. See docs/ARCHITECTURE.md §4 and
app/services/graph_service.py for the underlying Cypher.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.db import get_session
from app.models.episode import Episode
from app.models.source import Source
from app.services import graph_service

router = APIRouter(prefix="/graph", tags=["graph"])


class GraphNodeRead(BaseModel):
    uuid: str
    name: str
    type: str
    labels: list[str]
    summary: str
    attributes: dict[str, Any]


class GraphEdgeRead(BaseModel):
    uuid: str
    source: str
    target: str
    name: str
    fact: str
    confidence: float | None
    valid_at: datetime | None
    invalid_at: datetime | None
    created_at: datetime | None


class GraphQueryRead(BaseModel):
    nodes: list[GraphNodeRead]
    edges: list[GraphEdgeRead]
    truncated: bool


class ProvenanceRead(BaseModel):
    episode_uuid: str
    source_description: str
    valid_at: datetime | None
    source_id: str | None
    source_filename: str | None
    chunk_preview: str | None


class NodeNeighborRead(BaseModel):
    edge: GraphEdgeRead
    direction: str
    node: GraphNodeRead


class NodeDetailRead(BaseModel):
    node: GraphNodeRead
    neighbors: list[NodeNeighborRead]
    provenance: list[ProvenanceRead]


def _node_read(node: graph_service.GraphNode) -> GraphNodeRead:
    return GraphNodeRead(
        uuid=node.uuid,
        name=node.name,
        type=node.type,
        labels=node.labels,
        summary=node.summary,
        attributes=node.attributes,
    )


def _edge_read(edge: graph_service.GraphEdge) -> GraphEdgeRead:
    return GraphEdgeRead(
        uuid=edge.uuid,
        source=edge.source_uuid,
        target=edge.target_uuid,
        name=edge.name,
        fact=edge.fact,
        confidence=edge.confidence,
        valid_at=edge.valid_at,
        invalid_at=edge.invalid_at,
        created_at=edge.created_at,
    )


async def _require_connected_graphiti(request: Request):
    graphiti_state = request.app.state.graphiti_state
    connected, error = await graphiti_state.check_connectivity()
    if not connected:
        raise HTTPException(status_code=503, detail=f"Graph database not available: {error}")
    return graphiti_state.graphiti


@router.get("", response_model=GraphQueryRead)
async def get_graph(
    request: Request,
    entity_types: list[str] | None = Query(default=None),
    relation_types: list[str] | None = Query(default=None),
    min_confidence: float = Query(default=0.0, ge=0.0, le=1.0),
    valid_from: datetime | None = Query(default=None),
    valid_to: datetime | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=graph_service.DEFAULT_LIMIT, ge=1, le=graph_service.MAX_LIMIT),
) -> GraphQueryRead:
    graphiti = await _require_connected_graphiti(request)

    result = await graph_service.query_graph(
        graphiti,
        graph_service.GraphFilters(
            entity_types=entity_types or None,
            relation_types=relation_types or None,
            min_confidence=min_confidence,
            valid_from=valid_from,
            valid_to=valid_to,
            search=search,
            limit=limit,
        ),
    )
    return GraphQueryRead(
        nodes=[_node_read(n) for n in result.nodes],
        edges=[_edge_read(e) for e in result.edges],
        truncated=result.truncated,
    )


@router.get("/nodes/{node_uuid}", response_model=NodeDetailRead)
async def get_node(
    node_uuid: str,
    request: Request,
    session: Session = Depends(get_session),
) -> NodeDetailRead:
    graphiti = await _require_connected_graphiti(request)

    detail = await graph_service.get_node_detail(graphiti, node_uuid)
    if detail is None:
        raise HTTPException(status_code=404, detail="Node not found")

    # Resolve each provenance episode back to the uploaded Source it came
    # from via the SQL-side app/models/episode.py mapping (see that module's
    # docstring) -- an episode Graphiti has no record of on our side (e.g.
    # from data ingested some other way) just comes back with source_id=None.
    episode_uuids = [p.episode_uuid for p in detail.provenance]
    episodes_by_uuid: dict[str, Episode] = {}
    if episode_uuids:
        rows = session.exec(select(Episode).where(Episode.episode_uuid.in_(episode_uuids))).all()
        episodes_by_uuid = {e.episode_uuid: e for e in rows}

    source_ids = {e.source_id for e in episodes_by_uuid.values()}
    sources_by_id: dict[str, Source] = {}
    if source_ids:
        rows = session.exec(select(Source).where(Source.id.in_(source_ids))).all()
        sources_by_id = {s.id: s for s in rows}

    provenance_read = []
    for item in detail.provenance:
        episode_row = episodes_by_uuid.get(item.episode_uuid)
        source = sources_by_id.get(episode_row.source_id) if episode_row else None
        provenance_read.append(
            ProvenanceRead(
                episode_uuid=item.episode_uuid,
                source_description=item.source_description,
                valid_at=item.valid_at,
                source_id=source.id if source else None,
                source_filename=source.filename if source else None,
                chunk_preview=episode_row.chunk_preview if episode_row else None,
            )
        )

    return NodeDetailRead(
        node=_node_read(detail.node),
        neighbors=[
            NodeNeighborRead(
                edge=_edge_read(n.edge), direction=n.direction, node=_node_read(n.node)
            )
            for n in detail.neighbors
        ],
        provenance=provenance_read,
    )
