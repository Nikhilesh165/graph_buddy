"""Conversation threads -- the unit of short-term (working) memory. See
docs/MEMORY_AND_DISCOVERY.md §2.1.

Phase 4 stored chat as one flat append-only log with no notion of "the
conversation this question belongs to", so every question was answered as
if it were the first (a follow-up like "and who manages her?" had nothing to
resolve "her" against). A Conversation groups turns so the chat pipeline can
hand the last few of them -- plus `summary`, the periodic-consolidation
rollup of everything older -- to query resolution as working memory.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(UTC)


class Conversation(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    title: str = ""
    # Rolling summary of this conversation's older turns, written by the
    # periodic consolidation cycle (app/services/consolidation_service.py),
    # not on every turn -- `summarized_turn_count` records how many turns it
    # already folds in, so the next cycle only summarizes what's new.
    summary: str = ""
    summarized_turn_count: int = 0
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
