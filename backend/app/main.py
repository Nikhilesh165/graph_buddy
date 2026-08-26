from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.ontology import router as ontology_router
from app.api.routes.sources import router as sources_router
from app.core.config import get_settings
from app.core.db import create_db_and_tables, init_engine
from app.core.graphiti_client import GraphitiState


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()

    # SQLite (sources, ontology) -- independent of Graphiti/Neo4j, which
    # Phase 1 doesn't touch at all (see docs/ROADMAP.md Phase 1 vs. Phase 2).
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    engine = init_engine(settings)
    create_db_and_tables(engine)

    graphiti_state = GraphitiState(settings)
    await graphiti_state.startup()
    app.state.graphiti_state = graphiti_state

    yield

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

    return app


app = create_app()
