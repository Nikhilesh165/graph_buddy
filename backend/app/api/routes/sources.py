from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import Session, select

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.models.source import SUPPORTED_EXTENSIONS, Source, SourceRead
from app.services.parsing import parse_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sources", tags=["sources"])


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
