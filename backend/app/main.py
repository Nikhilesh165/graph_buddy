import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.chat import router as chat_router
from app.api.routes.discovery import router as discovery_router
from app.api.routes.graph import router as graph_router
from app.api.routes.health import router as health_router
from app.api.routes.memory import router as memory_router
from app.api.routes.ontology import router as ontology_router
from app.api.routes.sources import router as sources_router
from app.core.config import get_settings
from app.core.db import create_db_and_tables, init_engine, session_scope
from app.core.graphiti_client import GraphitiState
from app.core.scheduler import PeriodicTask
from app.services import consolidation_service, memory_service, pipeline


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()

    # SQLite (sources, ontology) -- independent of Graphiti/Neo4j, which
    # Phase 1 doesn't touch at all (see docs/ROADMAP.md Phase 1 vs. Phase 2).
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    engine = init_engine(settings)
    create_db_and_tables(engine)
    with session_scope() as session:
        # Chat turns from before conversations existed -> one "Earlier
        # questions" conversation (see memory_service.adopt_orphan_turns).
        memory_service.adopt_orphan_turns(session)
        # Background passes that a restart cut short (see pipeline.py).
        pipeline.recover_interrupted_jobs(session)

    graphiti_state = GraphitiState(settings)
    await graphiti_state.startup()
    app.state.graphiti_state = graphiti_state

    # Periodic memory (docs/MEMORY_AND_DISCOVERY.md §2.4). One lock shared
    # by the schedule and POST /memory/consolidate so cycles never overlap.
    app.state.consolidation_lock = asyncio.Lock()

    async def scheduled_consolidation() -> None:
        if app.state.consolidation_lock.locked():
            return  # a manual run is in progress; this tick has nothing to add
        async with app.state.consolidation_lock:
            with session_scope() as session:
                await consolidation_service.run_cycle(
                    session, graphiti_state, get_settings(), trigger="schedule"
                )

    consolidation_task = PeriodicTask(
        "memory-consolidation",
        settings.consolidation_interval_minutes * 60,
        scheduled_consolidation,
    )
    consolidation_task.start()
    app.state.consolidation_task = consolidation_task

    yield

    await consolidation_task.stop()
    await graphiti_state.shutdown()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Graph Buddy API", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(sources_router)
    app.include_router(ontology_router)
    app.include_router(graph_router)
    app.include_router(chat_router)
    app.include_router(discovery_router)
    app.include_router(memory_router)

    return app


app = create_app()
