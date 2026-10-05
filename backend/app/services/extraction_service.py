"""Ontology-guided extraction of a parsed Source into Graphiti episodes. See
docs/ARCHITECTURE.md §3.3-3.4 and §3.7, and this repo's plan for how
`graphiti_core.Graphiti.add_episode`'s `entity_types`/`edge_types`/
`edge_type_map` parameters are the actual ontology-guidance mechanism
(confirmed by reading the installed graphiti-core==0.29.3 source directly --
none of this is documented anywhere else).

Confidence (§3.7 "set at extraction"): there is no built-in `confidence`
field on `EntityEdge` anywhere in graphiti-core, so every dynamically-built
edge Pydantic model gets one injected. That makes the LLM populate
`attributes["confidence"]` during extraction; we then re-weight it by
source-type reliability and persist the result via `EntityEdge.save()`.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from graphiti_core import Graphiti
from graphiti_core.edges import EntityEdge
from graphiti_core.nodes import EntityNode, EpisodeType
from pydantic import BaseModel, create_model
from pydantic import Field as PydanticField
from sqlmodel import Session, select

from app.core.config import Settings
from app.models.ontology import EntityType, OntologyVersion, RelationType
from app.models.source import Source
from app.services.ontology_service import is_valid_property_name

PROPERTY_TYPE_MAP: dict[str, type] = {
    "string": str,
    "text": str,
    "number": float,
    "float": float,
    "decimal": float,
    "integer": int,
    "int": int,
    "boolean": bool,
    "bool": bool,
}

CONFIDENCE_DESCRIPTION = (
    "Confidence (0.0-1.0) that this fact is accurate and explicitly supported "
    "by the source text. 1.0 = stated directly and unambiguously; lower for "
    "paraphrased, inferred, or uncertain claims."
)
DEFAULT_CONFIDENCE = 0.7

# Keyed by file extension. A structured table cell (CSV) is ground truth as
# typed by the user; free-text extraction carries more inference risk, and
# PDF text extraction adds its own layout/OCR noise on top of that.
SOURCE_RELIABILITY_WEIGHT: dict[str, float] = {
    ".csv": 1.0,
    ".txt": 0.85,
    ".md": 0.85,
    ".docx": 0.85,
    ".pdf": 0.8,
}
DEFAULT_RELIABILITY_WEIGHT = 0.8

# How much of a chunk's text to keep as a provenance excerpt (app/models/episode.py
# `chunk_preview`) -- enough for the Graph Explorer's node-detail panel to show
# a meaningful quote without persisting the full chunk a second time outside
# of Graphiti's own episode content.
EPISODE_PREVIEW_CHARS = 400


def reliability_weight(filename: str) -> float:
    return SOURCE_RELIABILITY_WEIGHT.get(Path(filename).suffix.lower(), DEFAULT_RELIABILITY_WEIGHT)


# Graphiti's own fields on the EntityNode/EntityEdge it builds from these
# models. A same-named ontology property (an LLM-bootstrapped `Person.name`
# is the classic case) duplicates a built-in -- and for entity types it's
# fatal: `add_episode` runs `validate_entity_types`, which raises
# EntityTypeValidationError and fails the whole extraction. For edges it's
# silently dropped at save time anyway (`EntityEdge.save` never lets an
# attribute overwrite a core field). So such properties are skipped here.
RESERVED_ENTITY_PROPERTIES: frozenset[str] = frozenset(EntityNode.model_fields)
RESERVED_EDGE_PROPERTIES: frozenset[str] = frozenset(EntityEdge.model_fields)


def _property_fields(properties: list, reserved: frozenset[str]) -> dict[str, Any]:
    # Names Pydantic can't take as a field (leading underscore, its own
    # `model_` namespace, ...) are skipped too, so an ontology stored before
    # PUT /ontology validated names can't crash `create_model`.
    return {
        prop.name: (
            PROPERTY_TYPE_MAP.get(prop.type.lower(), str) | None,
            PydanticField(default=None, description=prop.description),
        )
        for prop in properties
        if prop.name not in reserved and is_valid_property_name(prop.name)
    }


def build_entity_type_models(entity_types: list[EntityType]) -> dict[str, type[BaseModel]]:
    return {
        et.name: create_model(
            et.name,
            __doc__=et.description or None,
            **_property_fields(et.properties, RESERVED_ENTITY_PROPERTIES),
        )
        for et in entity_types
    }


def build_edge_type_models(relation_types: list[RelationType]) -> dict[str, type[BaseModel]]:
    models: dict[str, type[BaseModel]] = {}
    for rt in relation_types:
        fields = _property_fields(rt.properties, RESERVED_EDGE_PROPERTIES)
        # Always wins over a same-named ontology property -- confidence is a
        # system-level field, not something the ontology should be able to
        # accidentally shadow.
        fields["confidence"] = (
            float,
            PydanticField(
                default=DEFAULT_CONFIDENCE, ge=0.0, le=1.0, description=CONFIDENCE_DESCRIPTION
            ),
        )
        models[rt.name] = create_model(rt.name, __doc__=rt.description or None, **fields)
    return models


def build_edge_type_map(relation_types: list[RelationType]) -> dict[tuple[str, str], list[str]]:
    edge_map: dict[tuple[str, str], list[str]] = {}
    for rt in relation_types:
        for source_type in rt.source_types:
            for target_type in rt.target_types:
                edge_map.setdefault((source_type, target_type), []).append(rt.name)
    return edge_map


def _pack(pieces: list[str], max_chars: int, separator: str) -> list[str]:
    """Greedily pack consecutive pieces into chunks of at most `max_chars`
    (a single piece longer than that becomes its own oversized chunk)."""
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for piece in pieces:
        if current and current_len + len(piece) + len(separator) > max_chars:
            chunks.append(separator.join(current))
            current, current_len = [], 0
        current.append(piece)
        current_len += len(piece) + len(separator)
    if current:
        chunks.append(separator.join(current))
    return chunks


def chunk_prose(text: str, max_chars: int) -> list[str]:
    """Paragraph-packing: packs consecutive paragraphs up to `max_chars`.

    A paragraph longer than `max_chars` is broken at its line breaks and its
    lines packed the same way -- extracted PDF pages and DOCX tables arrive
    as one blank-line-free block, and passing those through whole produced
    unbounded episodes (one per page, or one for the whole document). Text
    is never hard-split mid-line: a single line longer than `max_chars` is
    still its own (oversized) chunk.
    """
    paragraphs = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paragraphs:
        return [text] if text.strip() else []

    units: list[str] = []
    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            lines = [line for line in paragraph.split("\n") if line.strip()]
            units.extend(_pack(lines, max_chars, "\n"))
        else:
            units.append(paragraph)
    return _pack(units, max_chars, "\n\n")


def chunk_csv(text: str, rows_per_chunk: int) -> list[str]:
    """Row-batching with the header repeated in every chunk, so each episode
    is schema-aware on its own (ARCHITECTURE.md §3.1: tables kept as tables).

    Rows are read with the csv module rather than split on newlines, so a
    quoted cell containing a line break stays inside its row instead of
    being cut in two at a chunk boundary.
    """
    rows = [row for row in csv.reader(io.StringIO(text)) if row]
    if not rows:
        return []
    header, body = rows[0], rows[1:]
    if not body:
        return [_write_csv_rows([header])]
    return [
        _write_csv_rows([header, *body[i : i + rows_per_chunk]])
        for i in range(0, len(body), rows_per_chunk)
    ]


def _write_csv_rows(rows: list[list[str]]) -> str:
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\n").writerows(rows)
    return buffer.getvalue().rstrip("\n")


def chunk_source(source: Source, settings: Settings) -> list[str]:
    text = source.parsed_text or ""
    if not text.strip():
        return []
    if Path(source.filename).suffix.lower() == ".csv":
        return chunk_csv(text, settings.extraction_chunk_rows)
    return chunk_prose(text, settings.extraction_chunk_chars)


@dataclass
class SampleFact:
    fact: str
    confidence: float | None


@dataclass
class EpisodeRecord:
    """One episode Graphiti actually created for this source -- the route
    persists these as app/models/episode.py rows after extraction succeeds,
    so the Graph Explorer can resolve provenance later (see that module's
    docstring). `chunk_index` matches this chunk's position from
    `chunk_source` above.
    """

    chunk_index: int
    episode_uuid: str
    chunk_preview: str


@dataclass
class ExtractionSummary:
    episodes_added: int = 0
    nodes_touched: int = 0
    edges_touched: int = 0
    sample_facts: list[SampleFact] = field(default_factory=list)
    episode_records: list[EpisodeRecord] = field(default_factory=list)


MAX_SAMPLE_FACTS = 20

INTERRUPTED_EXTRACTION_ERROR = "Extraction was interrupted (the server stopped mid-run)"


class ExtractionError(Exception):
    """Extraction failed partway through. Graphiti commits per-episode, so
    `summary` carries the episodes that were already written before the
    failure -- the route still persists their provenance rows, since those
    episodes really are in the graph (app/models/episode.py: one row per
    episode Graphiti actually created).
    """

    def __init__(self, cause: Exception, summary: ExtractionSummary) -> None:
        super().__init__(str(cause))
        self.summary = summary


def mark_interrupted_extractions(session: Session) -> int:
    """Flip any source left at graphiti_status="extracting" to "failed".

    Run at startup: nothing can be mid-extraction in a process that just
    started, so such a row was orphaned by a crash/restart. Left alone it
    would read as in-progress forever and block re-extraction (see the 409
    guard in app/api/routes/sources.py).
    """
    stale = session.exec(select(Source).where(Source.graphiti_status == "extracting")).all()
    for source in stale:
        source.graphiti_status = "failed"
        source.graphiti_error = INTERRUPTED_EXTRACTION_ERROR
        session.add(source)
    if stale:
        session.commit()
    return len(stale)


async def extract_source(
    graphiti: Graphiti, source: Source, ontology: OntologyVersion, settings: Settings
) -> ExtractionSummary:
    entity_types_typed = ontology.entity_types_typed()
    relation_types_typed = ontology.relation_types_typed()
    entity_type_models = build_entity_type_models(entity_types_typed)
    edge_type_models = build_edge_type_models(relation_types_typed)
    edge_type_map = build_edge_type_map(relation_types_typed)
    weight = reliability_weight(source.filename)

    chunks = chunk_source(source, settings)

    summary = ExtractionSummary()
    nodes_seen: set[str] = set()
    edges_seen: set[str] = set()
    sampled_edge_uuids: set[str] = set()

    try:
        for index, chunk in enumerate(chunks):
            result = await graphiti.add_episode(
                name=f"{source.filename} #{index + 1}",
                episode_body=chunk,
                source_description=f"Uploaded file: {source.filename}",
                reference_time=datetime.now(UTC),
                source=EpisodeType.text,
                entity_types=entity_type_models,
                edge_types=edge_type_models,
                edge_type_map=edge_type_map,
            )
            summary.episodes_added += 1
            summary.episode_records.append(
                EpisodeRecord(
                    chunk_index=index,
                    episode_uuid=result.episode.uuid,
                    chunk_preview=chunk[:EPISODE_PREVIEW_CHARS],
                )
            )
            nodes_seen.update(node.uuid for node in result.nodes)

            for edge in result.edges:
                edges_seen.add(edge.uuid)
                raw_confidence = edge.attributes.get("confidence")
                if isinstance(raw_confidence, int | float):
                    edge.attributes["confidence"] = max(
                        0.0, min(1.0, float(raw_confidence) * weight)
                    )
                    await edge.save(graphiti.driver)
                if (
                    edge.uuid not in sampled_edge_uuids
                    and len(summary.sample_facts) < MAX_SAMPLE_FACTS
                ):
                    sampled_edge_uuids.add(edge.uuid)
                    summary.sample_facts.append(
                        SampleFact(fact=edge.fact, confidence=edge.attributes.get("confidence"))
                    )
    except Exception as exc:
        raise ExtractionError(exc, summary) from exc

    summary.nodes_touched = len(nodes_seen)
    summary.edges_touched = len(edges_seen)
    return summary
