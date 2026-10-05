"""A minimal in-process periodic runner for the consolidation cycle (see
app/services/consolidation_service.py).

docs/ARCHITECTURE.md §5 suggested APScheduler for background jobs; for one
fixed-interval job in a single-process, single-tenant app an asyncio task
does the same with no new dependency. Revisit (APScheduler for cron-style
schedules, or a real worker queue for multi-process deployments) when there's
more than one job or more than one process.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)


class PeriodicTask:
    def __init__(
        self, name: str, interval_seconds: float, job: Callable[[], Awaitable[object]]
    ) -> None:
        self.name = name
        self.interval_seconds = interval_seconds
        self.job = job
        self._task: asyncio.Task[None] | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        """No-op for a non-positive interval -- that's how the schedule is
        disabled. The first run happens one interval after startup, not at
        boot, so restarting the server doesn't trigger a burst of LLM calls."""
        if self.interval_seconds <= 0 or self.running:
            return
        self._task = asyncio.create_task(self._loop(), name=self.name)

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self.interval_seconds)
            try:
                await self.job()
            except Exception:  # noqa: BLE001 - keep the schedule alive across failures
                logger.exception("Periodic task %s failed", self.name)

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
