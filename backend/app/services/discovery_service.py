"""The AI-driven ontology discovery cycle. See docs/MEMORY_AND_DISCOVERY.md §3
and docs/ARCHITECTURE.md §3.5.

The ontology used to be a one-time, user-driven setup step: upload a file,
click "Propose ontology", hand-edit, extract. Now it's maintained by the
system as data and conversations arrive:

- **From data** (`discover_from_source`): every upload is compared against
  the current ontology. With no ontology yet, that's a bootstrap; otherwise
  the LLM proposes the smallest change set that lets extraction capture the
  new document.
- **From conversations** (`discover_from_conversations`, driven by the
  periodic consolidation cycle): terms the user asks about that the
  ontology has no type for, and questions that retrieved nothing, become
  evidence for change proposals.

Either way the result goes through `record_change_set`, which applies what
the configured autonomy policy allows (settings.ontology_autonomy, see
app/services/ontology_changes.py) as a new ontology version, and queues the
rest as a pending proposal in the Discovery Feed for the user to accept or
reject. The human's role shifts from author to reviewer.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlmodel import Session

from app.core import llm
from app.core.config import Settings
from app.models.chat import ChatTurn
from app.models.discovery import (
    DiscoveryEvent,
    OntologyChange,
    OntologyChangeProposal,
    OntologyChangeSet,
    ProposalTrigger,
)
from app.models.ontology import EntityType, OntologyVersion, RelationType
from app.models.source import Source
from app.services import ontology_service
from app.services.ontology_changes import (
    AutonomyLevel,
    SkippedChange,
    apply_changes,
    changes_from_bootstrap,
    describe_change,
    max_risk,
    partition_by_policy,
)

logger = logging.getLogger(__name__)

MAX_GAP_TERMS = 25
MAX_GAP_EXAMPLES_PER_TERM = 3
MAX_UNANSWERED_QUESTIONS = 15

CONVERSATIONS_LABEL = "your recent conversations"


def _now() -> datetime:
    return datetime.now(UTC)


class ProposalNotPendingError(Exception):
    def __init__(self, status: str) -> None:
        super().__init__(f"Proposal is already {status}")
        self.status = status


@dataclass
class DiscoveryOutcome:
    # The auto-applied part of the change set (status="applied"), if any.
    applied: OntologyChangeProposal | None = None
    # The part queued for review (status="pending"), if any.
    pending: OntologyChangeProposal | None = None
    # The ontology version the auto-applied part produced.
    version: OntologyVersion | None = None
    # Suggestions that didn't make sense against the current ontology.
    skipped: list[SkippedChange] = field(default_factory=list)


def _current(
    session: Session,
) -> tuple[OntologyVersion | None, list[EntityType], list[RelationType]]:
    latest = ontology_service.get_latest_version(session)
    if latest is None:
        return None, [], []
    return latest, latest.entity_types_typed(), latest.relation_types_typed()


def _bullets(changes: list[OntologyChange]) -> str:
    return "\n".join(f"• {describe_change(c)}" for c in changes)


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def record_change_set(
    session: Session,
    change_set: OntologyChangeSet,
    *,
    trigger: ProposalTrigger,
    autonomy: AutonomyLevel,
    label: str,
    source_id: str | None = None,
) -> DiscoveryOutcome:
    """Apply what policy allows, queue the rest, write the feed entries.

    Deliberately synchronous (no awaits): reading the latest ontology,
    applying, and saving the next version can't interleave with another
    coroutine doing the same, so two discovery passes finishing at once
    can't both claim the same version number. (That relies on the
    single-process, single-tenant MVP -- see docs/MEMORY_AND_DISCOVERY.md
    §6 for what changes beyond it.)
    """
    latest, entities, relations = _current(session)
    was_empty = not entities and not relations

    # Dry run of the whole set first: drops suggestions that are no-ops or
    # invalid against the ontology as it is *now*.
    dry_run = apply_changes(entities, relations, change_set.changes)
    auto, review = partition_by_policy(dry_run.applied, autonomy)

    # A low-risk change can depend on a higher-risk one in the same set
    # (a property on a new type that policy queued for review). Applied on
    # its own it would be skipped -- so it waits for review alongside the
    # change it depends on, rather than being lost.
    auto_result = apply_changes(entities, relations, auto)
    review_ids = {id(c) for c in review} | {id(s.change) for s in auto_result.skipped}
    review = [c for c in dry_run.applied if id(c) in review_ids]

    summary = change_set.summary.strip() or f"Ontology changes suggested by {label}"
    evidence = [e.model_dump() for e in change_set.evidence]
    base_version_number = latest.version_number if latest else 0
    outcome = DiscoveryOutcome(skipped=dry_run.skipped)

    if auto_result.applied:
        version = ontology_service.save_new_version(
            session,
            auto_result.entity_types,
            auto_result.relation_types,
            created_by="discovery",
            source_id=source_id,
            note=summary,
        )
        proposal = OntologyChangeProposal(
            status="applied",
            trigger=trigger,
            source_id=source_id,
            base_version_number=base_version_number,
            summary=summary,
            changes=[c.model_dump() for c in auto_result.applied],
            evidence=evidence,
            risk=max_risk(auto_result.applied),
            auto_applied=True,
            resulting_version_id=version.id,
            decided_at=_now(),
        )
        session.add(proposal)
        session.add(
            DiscoveryEvent(
                kind="ontology_bootstrapped" if was_empty else "ontology_evolved",
                title=(
                    f"Ontology bootstrapped from {label}"
                    if was_empty
                    else f"Ontology v{version.version_number}: "
                    f"{_plural(len(auto_result.applied), 'change')} from {label}"
                ),
                body=f"{summary}\n\n{_bullets(auto_result.applied)}",
                payload={
                    "proposal_id": proposal.id,
                    "version_number": version.version_number,
                    "source_id": source_id,
                    "trigger": trigger,
                },
            )
        )
        outcome.applied = proposal
        outcome.version = version
        base_version_number = version.version_number

    if review:
        proposal = OntologyChangeProposal(
            status="pending",
            trigger=trigger,
            source_id=source_id,
            base_version_number=base_version_number,
            summary=summary,
            changes=[c.model_dump() for c in review],
            evidence=evidence,
            risk=max_risk(review),
        )
        session.add(proposal)
        session.add(
            DiscoveryEvent(
                kind="proposal_pending",
                title=f"Review needed: {_plural(len(review), 'suggested change')} from {label}",
                body=f"{summary}\n\n{_bullets(review)}",
                payload={"proposal_id": proposal.id, "source_id": source_id, "trigger": trigger},
            )
        )
        outcome.pending = proposal

    if not auto_result.applied and not review and trigger == "source":
        session.add(
            DiscoveryEvent(
                kind="source_analyzed",
                title=f"{label}: already covered by the ontology",
                body=change_set.summary.strip() or "No ontology changes were needed.",
                payload={
                    "source_id": source_id,
                    "skipped": [describe_change(s.change) for s in dry_run.skipped],
                },
            )
        )

    session.commit()
    for proposal in (outcome.applied, outcome.pending):
        if proposal is not None:
            session.refresh(proposal)
    return outcome


async def discover_from_source(
    session: Session, source: Source, settings: Settings
) -> DiscoveryOutcome:
    sample = ontology_service.sample_for_bootstrap(source, settings.ontology_bootstrap_sample_chars)
    if not sample.strip():
        raise ValueError(f"{source.filename} has no text to analyze")

    _, entities, relations = _current(session)
    if not entities and not relations:
        bootstrap = await llm.propose_ontology(
            sample, api_key=settings.openai_api_key, model=settings.openai_ontology_model
        )
        change_set = OntologyChangeSet(
            summary=(
                f"Initial ontology derived from {source.filename}: "
                f"{_plural(len(bootstrap.entity_types), 'entity type')}, "
                f"{_plural(len(bootstrap.relation_types), 'relation type')}."
            ),
            changes=changes_from_bootstrap(bootstrap),
        )
    else:
        change_set = await llm.propose_ontology_changes(
            ontology=llm.ontology_json(entities, relations),
            evidence=sample,
            evidence_kind="source",
            label=source.filename,
            api_key=settings.openai_api_key,
            model=settings.openai_ontology_model,
        )

    return record_change_set(
        session,
        change_set,
        trigger="source",
        autonomy=settings.ontology_autonomy,
        label=source.filename,
        source_id=source.id,
    )


# --- Conversation-driven discovery ---


def normalize_term(term: str) -> str:
    return " ".join(term.lower().split())


@dataclass
class GapSignals:
    """What the user asked about that the ontology couldn't represent."""

    term_counts: Counter[str] = field(default_factory=Counter)
    term_examples: dict[str, list[str]] = field(default_factory=dict)
    unanswered: list[str] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not self.term_counts and not self.unanswered

    def top_terms(self, limit: int = MAX_GAP_TERMS) -> list[tuple[str, int]]:
        return self.term_counts.most_common(limit)

    def render(self) -> str:
        lines: list[str] = []
        if self.term_counts:
            lines.append("Terms with no ontology counterpart:")
            for term, count in self.top_terms():
                examples = "; ".join(f'"{q}"' for q in self.term_examples.get(term, []))
                lines.append(f'- "{term}" (asked {_plural(count, "time")}), e.g. {examples}')
        if self.unanswered:
            lines.append("Questions that retrieved no facts at all:")
            lines.extend(f'- "{q}"' for q in self.unanswered[:MAX_UNANSWERED_QUESTIONS])
        return "\n".join(lines)


def collect_gap_signals(turns: list[ChatTurn], known_type_names: set[str]) -> GapSignals:
    """Aggregate per-turn resolver output (`ChatTurn.query_plan`) into
    ontology-gap evidence. A term that has since become an ontology type
    (e.g. discovery already added it) no longer counts as a gap."""
    known = {normalize_term(n) for n in known_type_names}
    signals = GapSignals()
    for turn in turns:
        plan = turn.query_plan or {}
        for raw in plan.get("unmapped_terms") or []:
            term = normalize_term(str(raw))
            if not term or term in known or term.replace(" ", "_") in known:
                continue
            signals.term_counts[term] += 1
            examples = signals.term_examples.setdefault(term, [])
            if turn.question not in examples and len(examples) < MAX_GAP_EXAMPLES_PER_TERM:
                examples.append(turn.question)
        if turn.retrieved_count == 0 and turn.question not in signals.unanswered:
            signals.unanswered.append(turn.question)
    return signals


async def discover_from_conversations(
    session: Session, signals: GapSignals, settings: Settings
) -> DiscoveryOutcome | None:
    """None when there's nothing to act on: no signals, or no ontology yet
    (uploads drive the bootstrap; conversations only evolve)."""
    if signals.empty:
        return None
    _, entities, relations = _current(session)
    if not entities and not relations:
        return None

    change_set = await llm.propose_ontology_changes(
        ontology=llm.ontology_json(entities, relations),
        evidence=signals.render(),
        evidence_kind="conversation",
        label=CONVERSATIONS_LABEL,
        api_key=settings.openai_api_key,
        model=settings.openai_ontology_model,
    )
    return record_change_set(
        session,
        change_set,
        trigger="conversation",
        autonomy=settings.ontology_autonomy,
        label=CONVERSATIONS_LABEL,
    )


# --- Review queue decisions ---


def accept_proposal(session: Session, proposal: OntologyChangeProposal) -> OntologyVersion | None:
    """Replay the proposal's changes onto the *current* ontology (not the
    version it was proposed against -- see app/models/discovery.py). Returns
    the new version, or None if nothing in it still applies (the proposal is
    then marked "failed" with the reasons)."""
    if proposal.status != "pending":
        raise ProposalNotPendingError(proposal.status)

    _, entities, relations = _current(session)
    result = apply_changes(entities, relations, proposal.changes_typed())
    reasons = "; ".join(f"{describe_change(s.change)}: {s.reason}" for s in result.skipped)
    proposal.decided_at = _now()

    if not result.applied:
        proposal.status = "failed"
        proposal.error = f"Nothing could be applied to the current ontology -- {reasons}"
        session.add(proposal)
        session.commit()
        session.refresh(proposal)
        return None

    version = ontology_service.save_new_version(
        session,
        result.entity_types,
        result.relation_types,
        created_by="discovery",
        source_id=proposal.source_id,
        note=f"Accepted from the Discovery Feed: {proposal.summary}",
    )
    proposal.status = "applied"
    proposal.resulting_version_id = version.id
    proposal.error = f"Skipped: {reasons}" if reasons else None
    session.add(proposal)
    session.add(
        DiscoveryEvent(
            kind="proposal_accepted",
            title=(
                f"Ontology v{version.version_number}: accepted "
                f"{_plural(len(result.applied), 'suggested change')}"
            ),
            body=f"{proposal.summary}\n\n{_bullets(result.applied)}",
            payload={"proposal_id": proposal.id, "version_number": version.version_number},
        )
    )
    session.commit()
    session.refresh(proposal)
    return version


def reject_proposal(session: Session, proposal: OntologyChangeProposal) -> None:
    if proposal.status != "pending":
        raise ProposalNotPendingError(proposal.status)
    proposal.status = "rejected"
    proposal.decided_at = _now()
    session.add(proposal)
    session.add(
        DiscoveryEvent(
            kind="proposal_rejected",
            title=f"Dismissed {_plural(len(proposal.changes), 'suggested change')}",
            body=proposal.summary,
            payload={"proposal_id": proposal.id},
        )
    )
    session.commit()
    session.refresh(proposal)
