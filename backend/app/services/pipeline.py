"""The data side of the discovery cycle: what happens after an upload. See
docs/MEMORY_AND_DISCOVERY.md §3.1.

    upload (parse) -> discover (bootstrap / evolve the ontology) -> extract

The upload request returns as soon as the file is parsed; this runs as a
FastAPI background task afterwards, tracking its progress on the source row
(`discovery_status`, then `graphiti_status` if auto-extract is on) so the UI
can poll it. Failures are recorded on the row and in the Discovery Feed,
never raised -- there's no request left to raise them to.
"""

from __future__ import annotations

import logging

from sqlmodel import Session

from app.core.config import Settings
from app.core.db import session_scope
from app.core.graphiti_client import GraphitiState
from app.models.discovery import DiscoveryEvent
from app.models.source import Source
from app.services import discovery_service, extraction_service, ontology_service

logger = logging.getLogger(__name__)


async def run_source_discovery_job(
    source_id: str, graphiti_state: GraphitiState, settings: Settings
) -> None:
    with session_scope() as session:
        source = session.get(Source, source_id)
        if source is None:
            return
        source.discovery_status = "running"
        source.discovery_error = None
        session.add(source)
        session.commit()

        try:
            await discovery_service.discover_from_source(session, source, settings)
        except Exception as exc:  # noqa: BLE001 - background job: record, don't raise
            logger.warning("Discovery failed for source %s: %s", source_id, exc)
            session.rollback()
            source = session.get(Source, source_id)
            assert source is not None
            source.discovery_status = "failed"
            source.discovery_error = str(exc)
            session.add(source)
            session.add(
                DiscoveryEvent(
                    kind="discovery_failed",
                    title=f"Couldn't analyze {source.filename}",
                    body=str(exc),
                    payload={"source_id": source_id},
                )
            )
            session.commit()
            return

        source.discovery_status = "completed"
        session.add(source)
        session.commit()

        if settings.auto_extract_on_upload:
            await _auto_extract(session, source, graphiti_state, settings)


async def _auto_extract(
    session: Session, source: Source, graphiti_state: GraphitiState, settings: Settings
) -> None:
    ontology = ontology_service.get_latest_version(session)
    if ontology is None or not ontology.entity_types:
        return
    connected, error = await graphiti_state.check_connectivity()
    if not connected:
        source.graphiti_error = f"Auto-extract skipped: graph database not available: {error}"
        session.add(source)
        session.commit()
        return
    async with graphiti_state.write_lock:
        try:
            await extraction_service.extract_and_record(
                session, graphiti_state.graphiti, source, ontology, settings
            )
        except Exception as exc:  # noqa: BLE001 - already recorded on the source row
            logger.warning("Auto-extract failed for source %s: %s", source.id, exc)
