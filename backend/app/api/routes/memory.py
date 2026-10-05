"""Periodic memory (consolidation) and learned-vocabulary endpoints. See
docs/MEMORY_AND_DISCOVERY.md §2 and app/services/consolidation_service.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Session, select

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.models.chat import ChatTurn
from app.models.conversation import Conversation
from app.models.discovery import OntologyChangeProposal
from app.models.memory import (
    ConsolidationRun,
    ConsolidationRunRead,
    OntologyAlias,
    OntologyAliasRead,
)
from app.services import consolidation_service

router = APIRouter(prefix="/memory", tags=["memory"])


class MemoryOverviewRead(BaseModel):
    conversations: int
    episodes: int  # chat turns -- each one is an episode in episodic memory
    vocabulary_terms: int
    pending_proposals: int
    consolidation_interval_minutes: int
    last_run: ConsolidationRunRead | None


def _count(session: Session, model, *where) -> int:
    statement = select(func.count()).select_from(model)
    for clause in where:
        statement = statement.where(clause)
    return session.exec(statement).one()


@router.get("/overview", response_model=MemoryOverviewRead)
def get_overview(
    session: Session = Depends(get_session), settings: Settings = Depends(get_settings)
) -> MemoryOverviewRead:
    last_run = session.exec(
        select(ConsolidationRun).order_by(ConsolidationRun.started_at.desc())
    ).first()
    return MemoryOverviewRead(
        conversations=_count(session, Conversation),
        episodes=_count(session, ChatTurn),
        vocabulary_terms=_count(session, OntologyAlias),
        pending_proposals=_count(
            session, OntologyChangeProposal, OntologyChangeProposal.status == "pending"
        ),
        consolidation_interval_minutes=settings.consolidation_interval_minutes,
        last_run=ConsolidationRunRead.from_run(last_run) if last_run else None,
    )


@router.get("/vocabulary", response_model=list[OntologyAliasRead])
def get_vocabulary(
    session: Session = Depends(get_session), limit: int = Query(default=100, ge=1, le=1000)
) -> list[OntologyAliasRead]:
    aliases = session.exec(
        select(OntologyAlias)
        .order_by(OntologyAlias.hits.desc(), OntologyAlias.last_seen_at.desc())
        .limit(limit)
    ).all()
    return [OntologyAliasRead.from_alias(a) for a in aliases]


@router.get("/runs", response_model=list[ConsolidationRunRead])
def list_runs(
    session: Session = Depends(get_session), limit: int = Query(default=20, ge=1, le=200)
) -> list[ConsolidationRunRead]:
    runs = session.exec(
        select(ConsolidationRun).order_by(ConsolidationRun.started_at.desc()).limit(limit)
    ).all()
    return [ConsolidationRunRead.from_run(r) for r in runs]


@router.post("/consolidate", response_model=ConsolidationRunRead)
async def consolidate(
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ConsolidationRunRead:
    """Run a consolidation cycle now, synchronously. Individual step
    failures (an LLM call, an unreachable graph) are reported inside the
    returned run, not as an HTTP error -- see consolidation_service."""
    lock = request.app.state.consolidation_lock
    if lock.locked():
        raise HTTPException(status_code=409, detail="A consolidation cycle is already running")
    async with lock:
        run = await consolidation_service.run_cycle(
            session, request.app.state.graphiti_state, settings, trigger="manual"
        )
    return ConsolidationRunRead.from_run(run)
