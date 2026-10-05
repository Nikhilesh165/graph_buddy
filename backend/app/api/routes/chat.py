"""Chat with hybrid retrieval + inline citations (Phase 4), organized into
conversations with episodic memory and ontology-aware query resolution
(docs/MEMORY_AND_DISCOVERY.md §2). See app/services/chat_service.py for how a
turn is produced; this module persists it -- the turn itself (an episode),
its retrieval trace, and the vocabulary it taught.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Session, select

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.models.chat import ChatTurn, QueryPlan
from app.models.conversation import Conversation
from app.models.retrieval_trace import RetrievalTraceRecord
from app.services import chat_service, memory_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

DEFAULT_HISTORY_LIMIT = 50
CONVERSATION_TITLE_CHARS = 80


class ChatRequest(BaseModel):
    question: str
    # Omit to start a new conversation; the response carries its id.
    conversation_id: str | None = None


class ConversationCreate(BaseModel):
    title: str = ""


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
    conversation_id: str | None
    # How the question was resolved against the ontology (None for turns
    # asked before resolution existed).
    query_plan: QueryPlan | None

    @classmethod
    def from_turn(cls, turn: ChatTurn) -> ChatTurnRead:
        return cls(
            id=turn.id,
            question=turn.question,
            answer=turn.answer,
            citations=[CitationRead.model_validate(c) for c in turn.citations],
            retrieved_count=turn.retrieved_count,
            created_at=turn.created_at.isoformat(),
            conversation_id=turn.conversation_id,
            query_plan=QueryPlan.model_validate(turn.query_plan) if turn.query_plan else None,
        )


class ConversationRead(BaseModel):
    id: str
    title: str
    summary: str
    turn_count: int
    created_at: str
    updated_at: str

    @classmethod
    def from_conversation(cls, conversation: Conversation, turn_count: int) -> ConversationRead:
        return cls(
            id=conversation.id,
            title=conversation.title,
            summary=conversation.summary,
            turn_count=turn_count,
            created_at=conversation.created_at.isoformat(),
            updated_at=conversation.updated_at.isoformat(),
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
    ontology_match: bool = False


class TracedCommunityRead(BaseModel):
    uuid: str
    name: str
    summary: str
    score: float


class RetrievalTraceRead(BaseModel):
    turn_id: str
    query: str
    seed_nodes: list[SeedNodeRead]
    facts: list[TracedFactRead]
    final_context: str
    created_at: str
    # See app/models/retrieval_trace.py for these three's shapes; None/empty
    # for traces recorded before query resolution and memory existed.
    resolution: dict[str, Any] | None
    memory: dict[str, Any] | None
    communities: list[TracedCommunityRead]

    @classmethod
    def from_record(cls, record: RetrievalTraceRecord) -> RetrievalTraceRead:
        return cls(
            turn_id=record.turn_id,
            query=record.query,
            seed_nodes=[SeedNodeRead.model_validate(n) for n in record.seed_nodes],
            facts=[TracedFactRead.model_validate(f) for f in record.facts],
            final_context=record.final_context,
            created_at=record.created_at.isoformat(),
            resolution=record.resolution,
            memory=record.memory,
            communities=[TracedCommunityRead.model_validate(c) for c in record.communities or []],
        )


def _turn_counts(session: Session, conversation_ids: list[str]) -> dict[str, int]:
    if not conversation_ids:
        return {}
    rows = session.exec(
        select(ChatTurn.conversation_id, func.count())
        .where(ChatTurn.conversation_id.in_(conversation_ids))  # type: ignore[union-attr]
        .group_by(ChatTurn.conversation_id)
    ).all()
    return {conversation_id: count for conversation_id, count in rows}


@router.get("/conversations", response_model=list[ConversationRead])
def list_conversations(session: Session = Depends(get_session)) -> list[ConversationRead]:
    conversations = session.exec(
        select(Conversation).order_by(Conversation.updated_at.desc())
    ).all()
    counts = _turn_counts(session, [c.id for c in conversations])
    return [ConversationRead.from_conversation(c, counts.get(c.id, 0)) for c in conversations]


@router.post("/conversations", response_model=ConversationRead)
def create_conversation(
    body: ConversationCreate, session: Session = Depends(get_session)
) -> ConversationRead:
    conversation = Conversation(title=body.title.strip())
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    return ConversationRead.from_conversation(conversation, 0)


@router.get("/history", response_model=list[ChatTurnRead])
def get_history(
    session: Session = Depends(get_session),
    limit: int = DEFAULT_HISTORY_LIMIT,
    conversation_id: str | None = Query(default=None),
) -> list[ChatTurnRead]:
    statement = select(ChatTurn).order_by(ChatTurn.created_at.asc()).limit(limit)
    if conversation_id is not None:
        statement = statement.where(ChatTurn.conversation_id == conversation_id)
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

    if body.conversation_id is not None:
        conversation = session.get(Conversation, body.conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conversation = Conversation()

    graphiti_state = request.app.state.graphiti_state
    connected, error = await graphiti_state.check_connectivity()
    if not connected:
        raise HTTPException(status_code=503, detail=f"Graph database not available: {error}")

    try:
        result = await chat_service.run_turn(
            session,
            graphiti_state.graphiti,
            conversation=conversation,
            question=question,
            settings=settings,
        )
    except Exception as exc:  # noqa: BLE001 - any LLM/retrieval/config failure
        # (missing key, bad model, API error) surfaces as a clean error, not a 500.
        logger.warning("Chat failed for question %r: %s", question, exc)
        raise HTTPException(status_code=502, detail=f"Chat failed: {exc}") from exc

    chat, resolved, trace = result.chat, result.resolved, result.chat.trace

    if not conversation.title:
        conversation.title = question[:CONVERSATION_TITLE_CHARS]
    conversation.updated_at = datetime.now(UTC)
    session.add(conversation)

    turn = ChatTurn(
        question=question,
        answer=chat.answer,
        citations=[
            {"index": c.index, "edge_uuid": c.edge_uuid, "fact": c.fact, "confidence": c.confidence}
            for c in chat.citations
        ],
        retrieved_count=len(trace.facts),
        conversation_id=conversation.id,
        standalone_query=resolved.plan.standalone_query,
        query_plan=resolved.plan.model_dump(),
        entity_uuids=[n.uuid for n in trace.seed_nodes],
        embedding=result.embedding,
    )
    session.add(turn)
    memory_service.record_vocabulary(session, resolved.plan.term_mappings)
    session.commit()
    session.refresh(turn)

    # Persist the trace regardless of whether any facts came back -- even a
    # "nothing relevant" answer is worth being able to inspect (empty
    # seed_nodes/facts, per chat_service's module docstring).
    session.add(
        RetrievalTraceRecord(
            turn_id=turn.id,
            query=trace.query,
            seed_nodes=[
                {
                    "uuid": n.uuid,
                    "name": n.name,
                    "type": n.type,
                    "score": n.score,
                    "is_seed": n.is_seed,
                }
                for n in trace.seed_nodes
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
                    "ontology_match": f.ontology_match,
                }
                for f in trace.facts
            ],
            final_context=trace.final_context,
            resolution=resolved.to_trace(),
            memory=result.memory.to_trace(),
            # Only the summaries the answer actually used -- the trace
            # records what went into the answer, not everything search saw.
            communities=[
                {"uuid": c.uuid, "name": c.name, "summary": c.summary, "score": c.score}
                for c in chat.background
            ],
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
