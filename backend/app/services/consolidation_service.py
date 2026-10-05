"""Periodic memory: the consolidation cycle. See docs/MEMORY_AND_DISCOVERY.md
§2.4 and docs/ARCHITECTURE.md §3.4 ("Periodic memory (consolidation)").

Runs on a schedule (app/core/scheduler.py, settings.consolidation_interval_
minutes) or on demand (POST /memory/consolidate). Each cycle:

1. **Conversation summaries** -- folds turns that have scrolled out of a
   conversation's working-memory window into its rolling summary, so long
   conversations keep their earlier context without replaying every turn.
2. **Gap mining -> discovery** -- aggregates what query resolution recorded
   on each turn since the last cycle (terms with no ontology type,
   questions that retrieved nothing) and hands it to the discovery cycle
   (app/services/discovery_service.py), which may evolve the ontology.
3. **Community summaries** -- rebuilds Graphiti's community nodes
   (GraphRAG-style rollups) when new episodes arrived, so broad questions
   can be answered from summaries (chat_service's BROAD_INTENTS).
4. **Digest** -- a plain-language summary of the above, written to the
   Discovery Feed so consolidation is visible rather than silent batch work.

Steps are independent: one failing (say, the summarizer's LLM call) is
recorded in the run's stats and the digest, and the rest still run.
Confidence recomputation, contradiction flagging and retention (the rest of
ROADMAP Phase 6) are not in this cycle yet -- see docs/MEMORY_AND_DISCOVERY.md
§5.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func
from sqlmodel import Session, select

from app.core import llm
from app.core.config import Settings
from app.core.graphiti_client import GraphitiState
from app.models.chat import ChatTurn
from app.models.conversation import Conversation
from app.models.discovery import DiscoveryEvent
from app.models.episode import Episode
from app.models.memory import ConsolidationRun
from app.services import discovery_service, memory_service, ontology_service
from app.services.memory_service import MEMORY_ANSWER_CHARS

logger = logging.getLogger(__name__)

# How far back to look for the last run that completed a given step.
_STAT_LOOKBACK_RUNS = 50
_DIGEST_TOP_TERMS = 5


def _now() -> datetime:
    return datetime.now(UTC)


def _plural(n: int, word: str, plural: str | None = None) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {plural or word + 's'}"


def _last_stat(session: Session, key: str) -> Any:
    """The most recent value of `stats[key]` across completed runs -- each
    step records its own high-water mark only when it succeeds, so a failed
    step is retried over the same window next cycle instead of skipped."""
    runs = session.exec(
        select(ConsolidationRun)
        .where(ConsolidationRun.status == "completed")
        .order_by(ConsolidationRun.started_at.desc())
        .limit(_STAT_LOOKBACK_RUNS)
    ).all()
    return next(((run.stats or {})[key] for run in runs if key in (run.stats or {})), None)


async def summarize_conversations(session: Session, settings: Settings) -> int:
    """Fold turns older than the working-memory window into each
    conversation's rolling summary. Working memory shows the newest
    `memory_working_turns` verbatim, so those are deliberately left out --
    summary + working window together cover the whole conversation once."""
    summarized = 0
    for conversation in session.exec(select(Conversation)).all():
        turns = memory_service.conversation_turns(session, conversation.id)
        foldable = len(turns) - settings.memory_working_turns
        new_turns = turns[conversation.summarized_turn_count : max(foldable, 0)]
        if len(new_turns) < settings.consolidation_summary_min_new_turns:
            continue
        transcript = "\n".join(
            f"User: {t.question}\nAssistant: {t.answer[:MEMORY_ANSWER_CHARS]}" for t in new_turns
        )
        conversation.summary = await llm.summarize_conversation(
            previous_summary=conversation.summary,
            turns=transcript,
            api_key=settings.openai_api_key,
            model=settings.openai_model,
        )
        conversation.summarized_turn_count = foldable
        session.add(conversation)
        session.commit()
        summarized += 1
    return summarized


async def mine_gaps(session: Session, settings: Settings, *, window_end: datetime) -> dict:
    since_raw = _last_stat(session, "gap_mining_until")
    statement = select(ChatTurn).where(ChatTurn.created_at < window_end)
    if since_raw is not None:
        statement = statement.where(ChatTurn.created_at >= datetime.fromisoformat(since_raw))
    turns = list(session.exec(statement.order_by(ChatTurn.created_at.asc())).all())

    latest = ontology_service.get_latest_version(session)
    known = (
        {et.name for et in latest.entity_types_typed()}
        | {rt.name for rt in latest.relation_types_typed()}
        if latest
        else set()
    )
    signals = discovery_service.collect_gap_signals(turns, known)
    stats: dict[str, Any] = {
        "turns_reviewed": len(turns),
        "gap_terms": [{"term": t, "count": c} for t, c in signals.top_terms(_DIGEST_TOP_TERMS)],
        "unanswered_questions": len(signals.unanswered),
    }

    outcome = await discovery_service.discover_from_conversations(session, signals, settings)
    if outcome is not None:
        stats["ontology_changes_applied"] = len(outcome.applied.changes) if outcome.applied else 0
        stats["ontology_changes_pending"] = len(outcome.pending.changes) if outcome.pending else 0
        if outcome.version is not None:
            stats["ontology_version"] = outcome.version.version_number
    stats["gap_mining_until"] = window_end.isoformat()
    return stats


async def rebuild_communities(
    session: Session, graphiti_state: GraphitiState, settings: Settings
) -> dict:
    if not settings.consolidation_build_communities:
        return {}
    episode_count = session.exec(select(func.count()).select_from(Episode)).one()
    if episode_count == 0 or episode_count == _last_stat(session, "community_episode_count"):
        return {"communities_rebuilt": False}

    connected, error = await graphiti_state.check_connectivity()
    if not connected:
        raise RuntimeError(f"graph database not available: {error}")
    async with graphiti_state.write_lock:
        community_nodes, _ = await graphiti_state.graphiti.build_communities()
    return {
        "communities_rebuilt": True,
        "community_count": len(community_nodes),
        "community_episode_count": episode_count,
    }


def compose_digest(stats: dict) -> str:
    lines: list[str] = []
    if stats.get("conversations_summarized"):
        lines.append(
            f"Refreshed the running summary of "
            f"{_plural(stats['conversations_summarized'], 'conversation')}."
        )
    if stats.get("turns_reviewed"):
        lines.append(f"Reviewed {_plural(stats['turns_reviewed'], 'new question')}.")
    if stats.get("gap_terms"):
        terms = ", ".join(f"{g['term']} ({g['count']}×)" for g in stats["gap_terms"])
        lines.append(f"Asked about but missing from the ontology: {terms}.")
    if stats.get("unanswered_questions"):
        lines.append(
            f"{_plural(stats['unanswered_questions'], 'question')} found no facts in the graph."
        )
    if stats.get("ontology_changes_applied"):
        lines.append(
            f"Ontology updated to v{stats.get('ontology_version', '?')} with "
            f"{_plural(stats['ontology_changes_applied'], 'change')} learned from conversations."
        )
    if stats.get("ontology_changes_pending"):
        lines.append(
            f"{_plural(stats['ontology_changes_pending'], 'suggested ontology change')} "
            "await your review."
        )
    if stats.get("communities_rebuilt"):
        rebuilt = _plural(
            stats.get("community_count", 0), "community summary", "community summaries"
        )
        lines.append(f"Rebuilt {rebuilt} over the graph.")
    for error in stats.get("errors", []):
        lines.append(f"Skipped {error['step']}: {error['error']}")
    return "\n".join(lines) or "Nothing new since the last cycle."


def _is_noteworthy(stats: dict) -> bool:
    keys = (
        "conversations_summarized",
        "gap_terms",
        "unanswered_questions",
        "ontology_changes_applied",
        "ontology_changes_pending",
        "communities_rebuilt",
        "errors",
    )
    return any(stats.get(k) for k in keys)


async def run_cycle(
    session: Session, graphiti_state: GraphitiState, settings: Settings, *, trigger: str
) -> ConsolidationRun:
    run = ConsolidationRun(trigger=trigger)
    session.add(run)
    session.commit()
    session.refresh(run)

    stats: dict[str, Any] = {}
    errors: list[dict[str, str]] = []

    async def step(name: str, coro) -> None:
        try:
            result = await coro
        except Exception as exc:  # noqa: BLE001 - steps are independent; record and go on
            logger.warning("Consolidation step %s failed: %s", name, exc)
            session.rollback()
            errors.append({"step": name, "error": str(exc)})
        else:
            stats.update(result if isinstance(result, dict) else {name: result})

    await step("conversations_summarized", summarize_conversations(session, settings))
    await step("gap mining", mine_gaps(session, settings, window_end=run.started_at))
    await step("community summaries", rebuild_communities(session, graphiti_state, settings))
    if errors:
        stats["errors"] = errors

    run.stats = stats
    run.digest = compose_digest(stats)
    run.status = "completed"
    run.finished_at = _now()
    session.add(run)
    # A quiet cycle still gets a run row, but not a feed entry -- a digest
    # saying "nothing happened" every few hours is noise, not signal.
    if _is_noteworthy(stats):
        session.add(
            DiscoveryEvent(
                kind="consolidation_digest",
                title="Memory consolidated" + (" (with errors)" if errors else ""),
                body=run.digest,
                payload={"run_id": run.id, "trigger": trigger, "stats": stats},
            )
        )
    session.commit()
    session.refresh(run)
    return run
