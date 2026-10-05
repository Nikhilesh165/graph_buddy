"""The Discovery Feed and ontology review queue. See
docs/MEMORY_AND_DISCOVERY.md §3 and app/services/discovery_service.py.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.models.discovery import (
    DiscoveryEvent,
    DiscoveryEventRead,
    OntologyChangeProposal,
    OntologyChangeProposalRead,
    ProposalStatus,
)
from app.models.ontology import OntologyVersionRead
from app.models.source import Source, SourceRead
from app.services import discovery_service, ontology_service
from app.services.ontology_changes import describe_change

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/discovery", tags=["discovery"])

DEFAULT_FEED_LIMIT = 50


class DiscoverySettingsRead(BaseModel):
    ontology_autonomy: str
    auto_discover_on_upload: bool
    auto_extract_on_upload: bool
    consolidation_interval_minutes: int


class ProposalDecisionRead(BaseModel):
    proposal: OntologyChangeProposalRead
    # The ontology after the decision -- the client swaps this in directly
    # rather than re-fetching (same pattern as PUT /ontology's response).
    ontology: OntologyVersionRead


class SourceDiscoveryRead(BaseModel):
    source: SourceRead
    ontology: OntologyVersionRead
    applied: OntologyChangeProposalRead | None
    pending: OntologyChangeProposalRead | None
    skipped: list[str]


def _current_ontology(session: Session) -> OntologyVersionRead:
    latest = ontology_service.get_latest_version(session)
    return OntologyVersionRead.from_version(latest) if latest else OntologyVersionRead.empty()


def _get_proposal(session: Session, proposal_id: str) -> OntologyChangeProposal:
    proposal = session.get(OntologyChangeProposal, proposal_id)
    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return proposal


@router.get("/settings", response_model=DiscoverySettingsRead)
def get_discovery_settings(settings: Settings = Depends(get_settings)) -> DiscoverySettingsRead:
    return DiscoverySettingsRead(
        ontology_autonomy=settings.ontology_autonomy,
        auto_discover_on_upload=settings.auto_discover_on_upload,
        auto_extract_on_upload=settings.auto_extract_on_upload,
        consolidation_interval_minutes=settings.consolidation_interval_minutes,
    )


@router.get("/feed", response_model=list[DiscoveryEventRead])
def get_feed(
    session: Session = Depends(get_session),
    limit: int = Query(default=DEFAULT_FEED_LIMIT, ge=1, le=500),
) -> list[DiscoveryEventRead]:
    statement = select(DiscoveryEvent).order_by(DiscoveryEvent.created_at.desc()).limit(limit)
    return [DiscoveryEventRead.from_event(e) for e in session.exec(statement).all()]


@router.get("/proposals", response_model=list[OntologyChangeProposalRead])
def list_proposals(
    session: Session = Depends(get_session),
    status: ProposalStatus | None = Query(default=None),
) -> list[OntologyChangeProposalRead]:
    statement = select(OntologyChangeProposal).order_by(OntologyChangeProposal.created_at.desc())
    if status is not None:
        statement = statement.where(OntologyChangeProposal.status == status)
    return [OntologyChangeProposalRead.from_proposal(p) for p in session.exec(statement).all()]


@router.post("/proposals/{proposal_id}/accept", response_model=ProposalDecisionRead)
def accept_proposal(
    proposal_id: str, session: Session = Depends(get_session)
) -> ProposalDecisionRead:
    proposal = _get_proposal(session, proposal_id)
    try:
        discovery_service.accept_proposal(session, proposal)
    except discovery_service.ProposalNotPendingError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    # A proposal whose changes no longer apply comes back status="failed"
    # with the reasons in `error` -- a recorded outcome, not an HTTP error.
    return ProposalDecisionRead(
        proposal=OntologyChangeProposalRead.from_proposal(proposal),
        ontology=_current_ontology(session),
    )


@router.post("/proposals/{proposal_id}/reject", response_model=ProposalDecisionRead)
def reject_proposal(
    proposal_id: str, session: Session = Depends(get_session)
) -> ProposalDecisionRead:
    proposal = _get_proposal(session, proposal_id)
    try:
        discovery_service.reject_proposal(session, proposal)
    except discovery_service.ProposalNotPendingError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return ProposalDecisionRead(
        proposal=OntologyChangeProposalRead.from_proposal(proposal),
        ontology=_current_ontology(session),
    )


@router.post("/sources/{source_id}", response_model=SourceDiscoveryRead)
async def discover_source(
    source_id: str,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> SourceDiscoveryRead:
    """Run (or re-run) the discovery pass for one source, synchronously --
    the user-initiated counterpart of the background pass every upload
    triggers. Replaces the old one-shot "Propose ontology" button: with an
    ontology already in place it evolves it rather than starting over."""
    source = session.get(Source, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    if source.status != "parsed":
        raise HTTPException(
            status_code=400,
            detail=f"Source is not parsed (status={source.status!r}); cannot analyze it",
        )

    source.discovery_status = "running"
    source.discovery_error = None
    session.add(source)
    session.commit()
    try:
        outcome = await discovery_service.discover_from_source(session, source, settings)
    except Exception as exc:  # noqa: BLE001 - surface any LLM/config failure
        # (missing key, bad model, API error) as a clean error, not a 500.
        session.rollback()
        source.discovery_status = "failed"
        source.discovery_error = str(exc)
        session.add(source)
        session.commit()
        logger.warning("Discovery failed for source %s: %s", source_id, exc)
        raise HTTPException(status_code=502, detail=f"Discovery failed: {exc}") from exc

    source.discovery_status = "completed"
    session.add(source)
    session.commit()
    session.refresh(source)

    return SourceDiscoveryRead(
        source=SourceRead.from_source(source),
        ontology=_current_ontology(session),
        applied=(
            OntologyChangeProposalRead.from_proposal(outcome.applied) if outcome.applied else None
        ),
        pending=(
            OntologyChangeProposalRead.from_proposal(outcome.pending) if outcome.pending else None
        ),
        skipped=[f"{describe_change(s.change)}: {s.reason}" for s in outcome.skipped],
    )
