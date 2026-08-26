from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.models.ontology import OntologyProposal, OntologyVersion, OntologyVersionRead
from app.models.source import Source
from app.services import ontology_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ontology", tags=["ontology"])


class BootstrapRequest(BaseModel):
    source_id: str


@router.get("", response_model=OntologyVersionRead)
def get_current_ontology(session: Session = Depends(get_session)) -> OntologyVersionRead:
    latest = ontology_service.get_latest_version(session)
    return OntologyVersionRead.from_version(latest) if latest else OntologyVersionRead.empty()


@router.get("/versions", response_model=list[OntologyVersionRead])
def list_ontology_versions(session: Session = Depends(get_session)) -> list[OntologyVersionRead]:
    statement = select(OntologyVersion).order_by(OntologyVersion.version_number.desc())
    return [OntologyVersionRead.from_version(v) for v in session.exec(statement).all()]


@router.post("/bootstrap", response_model=OntologyVersionRead)
async def bootstrap_ontology(
    body: BootstrapRequest,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> OntologyVersionRead:
    source = session.get(Source, body.source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    if source.status != "parsed":
        raise HTTPException(
            status_code=400,
            detail=f"Source is not parsed (status={source.status!r}); cannot bootstrap from it",
        )

    sample = ontology_service.sample_for_bootstrap(source, settings.ontology_bootstrap_sample_chars)
    try:
        proposal = await ontology_service.bootstrap_ontology(
            sample, api_key=settings.openai_api_key, model=settings.openai_ontology_model
        )
    except Exception as exc:  # noqa: BLE001 - surface any LLM/config failure
        # (missing key, bad model, API error) as a clean error, not a 500.
        logger.warning("Ontology bootstrap failed for source %s: %s", body.source_id, exc)
        raise HTTPException(status_code=502, detail=f"Ontology bootstrap failed: {exc}") from exc

    version = ontology_service.save_new_version(
        session,
        proposal.entity_types,
        proposal.relation_types,
        created_by="bootstrap",
        source_id=body.source_id,
    )
    return OntologyVersionRead.from_version(version)


@router.put("", response_model=OntologyVersionRead)
def update_ontology(
    body: OntologyProposal, session: Session = Depends(get_session)
) -> OntologyVersionRead:
    version = ontology_service.save_new_version(
        session, body.entity_types, body.relation_types, created_by="user_edit"
    )
    return OntologyVersionRead.from_version(version)
