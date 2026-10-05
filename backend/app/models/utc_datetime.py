"""Timezone-aware datetime column for SQLite.

SQLite has no timezone-aware datetime type: SQLAlchemy stores the wall-clock
digits and drops `tzinfo`, so a `datetime.now(UTC)` written by a model's
default factory came back *naive*. The API then serialized it with no offset
(`2026-01-01T12:00:00`), which JavaScript's `Date` parses as the viewer's
*local* time -- every timestamp silently shifted by the viewer's UTC offset.

This column normalizes to UTC on write and re-attaches UTC on read, so values
round-trip as aware datetimes and serialize with `+00:00`. Rows written
before this type existed were already naive UTC, so they read back correctly
with no migration.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(UTC).replace(tzinfo=None)
        return value

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value
