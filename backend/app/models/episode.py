"""SQL-side reverse index from a Graphiti episode UUID back to the uploaded
Source (+ the chunk text) that produced it.

Graphiti/Neo4j is the source of truth for the graph itself (nodes, edges,
episodes); this table exists purely so the API can answer "which uploaded
file, and what excerpt of it, produced this fact" for the Graph Explorer's
node-detail provenance panel (docs/ARCHITECTURE.md §4) without parsing
Neo4j's free-text `EpisodicNode.source_description`. One row per episode
Graphiti actually created -- written by the /sources/{id}/extract route
right after a successful `extraction_service.extract_source` call.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(UTC)


class Episode(SQLModel, table=True):
    # The Graphiti episode's own uuid (graphiti_core.nodes.EpisodicNode.uuid)
    # -- reused as our primary key rather than minting a second id, since it's
    # already globally unique and it's the only thing edges point back to
    # (EntityEdge.episodes is a list of these).
    episode_uuid: str = Field(primary_key=True)
    source_id: str = Field(foreign_key="source.id", index=True)
    chunk_index: int
    chunk_preview: str
    created_at: datetime = Field(default_factory=_now)
