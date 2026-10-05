"""The chatbot's memory, outside the knowledge graph itself. See
docs/MEMORY_AND_DISCOVERY.md §2.

Three tiers, each feeding query resolution and answering differently:

- **Working memory** -- the current conversation's last few turns verbatim,
  plus its rolling summary (written by periodic consolidation). This is what
  lets "and who manages her?" resolve "her".
- **Episodic memory** -- every past turn is an episode carrying an
  embedding of its resolved question and the graph entities it touched.
  `recall` brings back older episodes (from any conversation) that are
  semantically similar to the new question *or* about the same entities --
  "you asked about Priya's projects last week, and the graph had nothing on
  budgets".
- **Learned vocabulary** -- how this user names ontology types
  ("accounts" -> Customer), reinforced on every resolved question.

Why chat turns aren't written into Graphiti as episodes (as the original
docs/ARCHITECTURE.md §3.4 sketch had it): the graph is the record of what
the *sources* say. Re-ingesting assistant answers -- which are themselves
built from graph facts -- would mint "new" facts that corroborate the very
facts they were derived from, inflating confidence (§3.7) in a loop, and
would cost an extraction LLM pass per turn. Conversations still shape the
graph, through the discovery cycle's reviewed ontology proposals rather
than by writing facts directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

import numpy as np
from sqlmodel import Session, select

from app.models.chat import ChatTurn, TermMapping
from app.models.conversation import Conversation
from app.models.memory import OntologyAlias
from app.services.ontology_changes import refers_to_type

# Embeddings are scanned in-process (single-tenant MVP): cap how many past
# episodes a recall compares against. docs/MEMORY_AND_DISCOVERY.md §6 covers
# moving this to a vector index once it matters.
MAX_RECALL_CANDIDATES = 500
# Added to cosine similarity, scaled by the fraction of the question's
# anchor entities a past turn also touched.
ENTITY_OVERLAP_BONUS = 0.25
# Answers can be long; working/recalled memory only needs the gist.
MEMORY_ANSWER_CHARS = 400


def _now() -> datetime:
    return datetime.now(UTC)


def normalize_term(term: str) -> str:
    return " ".join(term.lower().split())


@dataclass
class MemoryTurn:
    turn_id: str
    question: str
    answer: str


@dataclass
class RecalledTurn(MemoryTurn):
    score: float = 0.0
    reason: str = ""


@dataclass
class VocabularyEntry:
    term: str
    kind: str
    maps_to: str
    hits: int


@dataclass
class MemoryContext:
    conversation_summary: str = ""
    working: list[MemoryTurn] = field(default_factory=list)
    recalled: list[RecalledTurn] = field(default_factory=list)
    vocabulary: list[VocabularyEntry] = field(default_factory=list)

    def resolver_block(self) -> str:
        """Conversation context for query resolution: just enough to
        resolve references, newest last."""
        lines: list[str] = []
        if self.conversation_summary:
            lines.append(f"Summary of earlier conversation: {self.conversation_summary}")
        if self.working:
            lines.append("Conversation so far:")
            for turn in self.working:
                lines.append(f"User: {turn.question}")
                lines.append(f"Assistant: {_clip(turn.answer)}")
        return "\n".join(lines)

    def vocabulary_block(self) -> str:
        return "\n".join(f'- "{v.term}" -> {v.maps_to} (used {v.hits}x)' for v in self.vocabulary)

    def answer_block(self) -> str:
        """Memory handed to the answer prompt -- working memory plus any
        recalled episodes from other conversations or further back."""
        lines = [self.resolver_block()] if (self.working or self.conversation_summary) else []
        if self.recalled:
            lines.append("Related earlier exchanges:")
            for turn in self.recalled:
                lines.append(f"- Q: {turn.question}\n  A: {_clip(turn.answer)}")
        return "\n".join(line for line in lines if line)

    def to_trace(self) -> dict:
        return {
            "conversation_summary": self.conversation_summary,
            "working_turns": [{"turn_id": t.turn_id, "question": t.question} for t in self.working],
            "recalled": [
                {
                    "turn_id": t.turn_id,
                    "question": t.question,
                    "score": round(t.score, 4),
                    "reason": t.reason,
                }
                for t in self.recalled
            ],
            "vocabulary": [{"term": v.term, "maps_to": v.maps_to} for v in self.vocabulary],
        }


def _clip(text: str, limit: int = MEMORY_ANSWER_CHARS) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def conversation_turns(session: Session, conversation_id: str) -> list[ChatTurn]:
    statement = (
        select(ChatTurn)
        .where(ChatTurn.conversation_id == conversation_id)
        .order_by(ChatTurn.created_at.asc())
    )
    return list(session.exec(statement).all())


def working_memory(session: Session, conversation: Conversation, limit: int) -> MemoryContext:
    statement = (
        select(ChatTurn)
        .where(ChatTurn.conversation_id == conversation.id)
        .order_by(ChatTurn.created_at.desc())
        .limit(limit)
    )
    recent = list(reversed(session.exec(statement).all()))
    return MemoryContext(
        conversation_summary=conversation.summary,
        working=[MemoryTurn(turn_id=t.id, question=t.question, answer=t.answer) for t in recent],
    )


def vocabulary(session: Session, limit: int) -> list[VocabularyEntry]:
    statement = (
        select(OntologyAlias)
        .order_by(OntologyAlias.hits.desc(), OntologyAlias.last_seen_at.desc())
        .limit(limit)
    )
    return [
        VocabularyEntry(term=a.term, kind=a.kind, maps_to=a.maps_to, hits=a.hits)
        for a in session.exec(statement).all()
    ]


def record_vocabulary(session: Session, mappings: list[TermMapping]) -> None:
    """Reinforce learned vocabulary. Caller commits. `mappings` must already
    be grounded against the ontology (chat_service.ground_plan) so only real
    type names get learned."""
    for mapping in mappings:
        term = normalize_term(mapping.term)
        # "customers" -> Customer isn't vocabulary worth learning, just the name.
        if not term or refers_to_type(term, [mapping.maps_to]):
            continue
        existing = session.exec(
            select(OntologyAlias).where(
                OntologyAlias.term == term,
                OntologyAlias.kind == mapping.kind,
                OntologyAlias.maps_to == mapping.maps_to,
            )
        ).first()
        if existing is None:
            session.add(OntologyAlias(term=term, kind=mapping.kind, maps_to=mapping.maps_to))
        else:
            existing.hits += 1
            existing.last_seen_at = _now()
            session.add(existing)


def recall(
    session: Session,
    *,
    query_embedding: list[float] | None,
    anchor_uuids: list[str],
    exclude_turn_ids: set[str],
    k: int,
    min_score: float,
) -> list[RecalledTurn]:
    """Past episodes relevant to the new question: cosine similarity of the
    resolved questions, boosted by overlap between the new question's anchor
    entities and the entities each past turn's retrieval touched."""
    if k <= 0 or (query_embedding is None and not anchor_uuids):
        return []

    statement = (
        select(ChatTurn)
        .where(ChatTurn.embedding.is_not(None))  # type: ignore[union-attr]
        .order_by(ChatTurn.created_at.desc())
        .limit(MAX_RECALL_CANDIDATES)
    )
    candidates = [t for t in session.exec(statement).all() if t.id not in exclude_turn_ids]
    if not candidates:
        return []

    similarities = [0.0] * len(candidates)
    if query_embedding is not None:
        query = np.asarray(query_embedding, dtype=float)
        query_norm = np.linalg.norm(query)
        for i, turn in enumerate(candidates):
            vector = np.asarray(turn.embedding, dtype=float)
            if vector.shape != query.shape:
                continue  # embedding model changed since -- not comparable
            denom = query_norm * np.linalg.norm(vector)
            similarities[i] = float(query @ vector / denom) if denom else 0.0

    anchors = set(anchor_uuids)
    scored: list[RecalledTurn] = []
    for turn, similarity in zip(candidates, similarities, strict=True):
        overlap = len(anchors & set(turn.entity_uuids or [])) / len(anchors) if anchors else 0.0
        score = similarity + ENTITY_OVERLAP_BONUS * overlap
        if score < min_score:
            continue
        reasons = []
        if similarity >= min_score:
            reasons.append("similar question")
        if overlap > 0:
            reasons.append("same entities")
        scored.append(
            RecalledTurn(
                turn_id=turn.id,
                question=turn.question,
                answer=turn.answer,
                score=score,
                reason=" + ".join(reasons) or "related",
            )
        )
    scored.sort(key=lambda t: t.score, reverse=True)
    return scored[:k]


def adopt_orphan_turns(session: Session) -> int:
    """Turns asked before conversations existed have no conversation_id --
    gather them into one "Earlier questions" conversation so they stay
    visible (and usable as working memory) in the threaded chat UI."""
    orphans = session.exec(
        select(ChatTurn)
        .where(ChatTurn.conversation_id.is_(None))  # type: ignore[union-attr]
        .order_by(ChatTurn.created_at.asc())
    ).all()
    if not orphans:
        return 0
    conversation = Conversation(
        title="Earlier questions",
        created_at=orphans[0].created_at,
        updated_at=orphans[-1].created_at,
    )
    session.add(conversation)
    for turn in orphans:
        turn.conversation_id = conversation.id
        session.add(turn)
    session.commit()
    return len(orphans)
