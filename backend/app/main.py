from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.core.config import get_settings
from app.core.graphiti_client import GraphitiState


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
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

    return app


app = create_app()
