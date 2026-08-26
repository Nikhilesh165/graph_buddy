"""Phase 4: chat with hybrid retrieval + inline citations. See
docs/ARCHITECTURE.md §3.6 and §4, and app/services/chat_service.py.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.models.chat import ChatTurn
from app.models.retrieval_trace import RetrievalTraceRecord
from app.services import chat_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

DEFAULT_HISTORY_LIMIT = 50


class ChatRequest(BaseModel):
    question: str


class CitationRead(BaseModel):
    index: int
    edge_uuid: str
    fact: str
    confidence: float | None


class ChatTurnRead(BaseModel):
    id: str
    question: str
    answer: str
    citations: list[CitationRead]
    retrieved_count: int
    created_at: str

    @classmethod
    def from_turn(cls, turn: ChatTurn) -> ChatTurnRead:
        return cls(
            id=turn.id,
            question=turn.question,
            answer=turn.answer,
            citations=[CitationRead.model_validate(c) for c in turn.citations],
            retrieved_count=turn.retrieved_count,
            created_at=turn.created_at.isoformat(),
        )


class SeedNodeRead(BaseModel):
    uuid: str
    name: str
    type: str
    score: float
    is_seed: bool


class TracedFactRead(BaseModel):
    edge_uuid: str
    name: str
    fact: str
    confidence: float | None
    score: float
    source_node_uuid: str
    target_node_uuid: str


class RetrievalTraceRead(BaseModel):
    turn_id: str
    query: str
    seed_nodes: list[SeedNodeRead]
    facts: list[TracedFactRead]
    final_context: str
    created_at: str

    @classmethod
    def from_record(cls, record: RetrievalTraceRecord) -> RetrievalTraceRead:
        return cls(
            turn_id=record.turn_id,
            query=record.query,
            seed_nodes=[SeedNodeRead.model_validate(n) for n in record.seed_nodes],
            facts=[TracedFactRead.model_validate(f) for f in record.facts],
            final_context=record.final_context,
            created_at=record.created_at.isoformat(),
        )


@router.get("/history", response_model=list[ChatTurnRead])
def get_history(
    session: Session = Depends(get_session), limit: int = DEFAULT_HISTORY_LIMIT
) -> list[ChatTurnRead]:
    statement = select(ChatTurn).order_by(ChatTurn.created_at.asc()).limit(limit)
    return [ChatTurnRead.from_turn(t) for t in session.exec(statement).all()]


@router.post("", response_model=ChatTurnRead)
async def ask(
    body: ChatRequest,
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ChatTurnRead:
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question must not be empty")

    graphiti_state = request.app.state.graphiti_state
    connected, error = await graphiti_state.check_connectivity()
    if not connected:
        raise HTTPException(status_code=503, detail=f"Graph database not available: {error}")

    try:
        result = await chat_service.ask(
            graphiti_state.graphiti,
            question,
            api_key=settings.anthropic_api_key,
            model=settings.anthropic_model or "claude-sonnet-5",
        )
    except Exception as exc:  # noqa: BLE001 - any LLM/retrieval/config failure
        # (missing key, bad model, API error) surfaces as a clean error, not a 500.
        logger.warning("Chat failed for question %r: %s", question, exc)
        raise HTTPException(status_code=502, detail=f"Chat failed: {exc}") from exc

    turn = ChatTurn(
        question=question,
        answer=result.answer,
        citations=[
            {"index": c.index, "edge_uuid": c.edge_uuid, "fact": c.fact, "confidence": c.confidence}
            for c in result.citations
        ],
        retrieved_count=len(result.trace.facts),
    )
    session.add(turn)
    session.commit()
    session.refresh(turn)

    # Persist the trace regardless of whether any facts came back -- even a
    # "nothing relevant" answer is worth being able to inspect (empty
    # seed_nodes/facts, per this module's docstring).
    session.add(
        RetrievalTraceRecord(
            turn_id=turn.id,
            query=question,
            seed_nodes=[
                {
                    "uuid": n.uuid,
                    "name": n.name,
                    "type": n.type,
                    "score": n.score,
                    "is_seed": n.is_seed,
                }
                for n in result.trace.seed_nodes
            ],
            facts=[
                {
                    "edge_uuid": f.edge_uuid,
                    "name": f.name,
                    "fact": f.fact,
                    "confidence": f.confidence,
                    "score": f.score,
                    "source_node_uuid": f.source_node_uuid,
                    "target_node_uuid": f.target_node_uuid,
                }
                for f in result.trace.facts
            ],
            final_context=result.trace.final_context,
        )
    )
    session.commit()

    return ChatTurnRead.from_turn(turn)


@router.get("/{turn_id}/trace", response_model=RetrievalTraceRead)
def get_trace(turn_id: str, session: Session = Depends(get_session)) -> RetrievalTraceRead:
    statement = select(RetrievalTraceRecord).where(RetrievalTraceRecord.turn_id == turn_id)
    record = session.exec(statement).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Retrieval trace not found")
    return RetrievalTraceRead.from_record(record)
