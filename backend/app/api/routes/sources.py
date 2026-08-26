from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.models.episode import Episode
from app.models.source import SUPPORTED_EXTENSIONS, Source, SourceRead
from app.services import extraction_service, ontology_service
from app.services.parsing import parse_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sources", tags=["sources"])


class SampleFactRead(BaseModel):
    fact: str
    confidence: float | None


class ExtractionResult(BaseModel):
    source_id: str
    episodes_added: int
    nodes_touched: int
    edges_touched: int
    sample_facts: list[SampleFactRead]


@router.post("", response_model=SourceRead)
async def upload_source(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> SourceRead:
    extension = Path(file.filename or "").suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type {extension!r}; "
                f"supported: {sorted(SUPPORTED_EXTENSIONS)}"
            ),
        )

    contents = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds max upload size of {settings.max_upload_mb}MB",
        )

    source_id = str(uuid.uuid4())
    dest_dir = settings.uploads_dir / source_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / (file.filename or f"upload{extension}")
    dest_path.write_bytes(contents)

    source = Source(
        id=source_id,
        filename=file.filename or dest_path.name,
        content_type=file.content_type or "application/octet-stream",
        file_path=str(dest_path),
        size_bytes=len(contents),
    )

    try:
        parsed = parse_file(dest_path, source.content_type)
    except Exception as exc:  # noqa: BLE001 - a parse failure is a recorded
        # source status, not a 500 (the extension check above already rules
        # out UnsupportedFileType in practice, but a malformed file of an
        # otherwise-supported type should still degrade cleanly here).
        source.status = "failed"
        source.parse_error = str(exc)
        logger.warning("Failed to parse source %s (%s): %s", source_id, file.filename, exc)
    else:
        source.status = "parsed"
        source.parsed_text = parsed.text
        source.char_count = parsed.char_count
        source.row_count = parsed.row_count

    session.add(source)
    session.commit()
    session.refresh(source)
    return SourceRead.from_source(source)


@router.get("", response_model=list[SourceRead])
def list_sources(session: Session = Depends(get_session)) -> list[SourceRead]:
    statement = select(Source).order_by(Source.created_at.desc())
    return [SourceRead.from_source(s) for s in session.exec(statement).all()]


@router.get("/{source_id}", response_model=SourceRead)
def get_source(source_id: str, session: Session = Depends(get_session)) -> SourceRead:
    source = session.get(Source, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return SourceRead.from_source(source)


@router.post("/{source_id}/extract", response_model=ExtractionResult)
async def extract_source(
    source_id: str,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ExtractionResult:
    source = session.get(Source, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    if source.status != "parsed":
        raise HTTPException(
            status_code=400,
            detail=f"Source is not parsed (status={source.status!r}); cannot extract from it",
        )

    ontology = ontology_service.get_latest_version(session)
    if ontology is None:
        raise HTTPException(
            status_code=400,
            detail="No ontology exists yet; bootstrap or define one before extracting",
        )

    graphiti_state = request.app.state.graphiti_state
    connected, error = await graphiti_state.check_connectivity()
    if not connected:
        raise HTTPException(status_code=503, detail=f"Graph database not available: {error}")

    source.graphiti_status = "extracting"
    session.add(source)
    session.commit()

    try:
        summary = await extraction_service.extract_source(
            graphiti_state.graphiti, source, ontology, settings
        )
    except Exception as exc:  # noqa: BLE001 - record the failure on the source
        # row and surface it cleanly instead of a 500; whatever episodes
        # already committed before the failure stay in the graph (Graphiti
        # commits per-episode).
        source.graphiti_status = "failed"
        source.graphiti_error = str(exc)
        session.add(source)
        session.commit()
        logger.warning("Extraction failed for source %s: %s", source_id, exc)
        raise HTTPException(status_code=502, detail=f"Extraction failed: {exc}") from exc

    source.graphiti_status = "extracted"
    source.graphiti_error = None
    source.episode_count += summary.episodes_added
    source.node_count = summary.nodes_touched
    source.edge_count = summary.edges_touched
    source.extracted_at = datetime.now(UTC)
    session.add(source)
    for record in summary.episode_records:
        session.add(
            Episode(
                episode_uuid=record.episode_uuid,
                source_id=source.id,
                chunk_index=record.chunk_index,
                chunk_preview=record.chunk_preview,
            )
        )
    session.commit()

    return ExtractionResult(
        source_id=source.id,
        episodes_added=summary.episodes_added,
        nodes_touched=summary.nodes_touched,
        edges_touched=summary.edges_touched,
        sample_facts=[
            SampleFactRead(fact=f.fact, confidence=f.confidence) for f in summary.sample_facts
        ],
    )
