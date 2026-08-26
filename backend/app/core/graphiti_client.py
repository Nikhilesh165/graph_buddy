"""Graphiti wiring: one Graphiti instance, Claude for extraction/chat + OpenAI
for embeddings (per docs/ARCHITECTURE.md §5; embedding provider chosen for
this repo's Phase 0 since the docs don't pin one).

Startup must not raise even if Neo4j is unreachable -- see docs/ROADMAP.md
Phase 0 vs. this project's dev sandbox, which has no Docker daemon. Instead
we track readiness on `GraphitiState` and let `/health/graph` report it.
"""

from __future__ import annotations

import logging

from graphiti_core import Graphiti
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.llm_client.anthropic_client import AnthropicClient
from graphiti_core.llm_client.config import LLMConfig

from app.core.config import Settings

logger = logging.getLogger(__name__)


def build_graphiti(settings: Settings) -> Graphiti:
    """Construct a Graphiti instance. Does not connect to Neo4j yet."""
    llm_config = LLMConfig(
        api_key=settings.anthropic_api_key,
        model=settings.anthropic_model,
    )
    return Graphiti(
        uri=settings.neo4j_uri,
        user=settings.neo4j_user,
        password=settings.neo4j_password,
        llm_client=AnthropicClient(config=llm_config),
        embedder=OpenAIEmbedder(
            config=OpenAIEmbedderConfig(api_key=settings.openai_api_key)
        ),
        # cross_encoder left as graphiti-core's default (OpenAIRerankerClient) --
        # we're already depending on OPENAI_API_KEY for embeddings, so this adds
        # no new external dependency.
    )


class GraphitiState:
    """Holds the process-wide Graphiti instance and its connectivity status.

    `graphiti` is built lazily rather than in `__init__`: constructing the
    OpenAI embedder client raises immediately if no API key is configured
    (unlike the Anthropic client, which only fails on first real request), so
    even *building* Graphiti can fail before any network call is attempted.
    Treating that the same as a failed connection -- caught, reported via
    `error`, never raised out of startup -- is what keeps the app booting
    with missing config/keys or an unreachable Neo4j alike.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.graphiti: Graphiti | None = None
        self.ready = False
        self.error: str | None = None

    def _ensure_built(self) -> None:
        if self.graphiti is None:
            self.graphiti = build_graphiti(self.settings)

    async def startup(self) -> None:
        """Attempt to build the client, connect, and prepare indices. Never
        raises -- an unreachable Neo4j or missing API key is an expected state
        in some environments (e.g. this repo's Phase 0 dev sandbox has no
        Docker daemon), not a boot failure.
        """
        try:
            self._ensure_built()
            assert self.graphiti is not None
            await self.graphiti.build_indices_and_constraints()
        except Exception as exc:  # noqa: BLE001 - deliberately broad: any
            # construction/connectivity/auth/driver failure should degrade,
            # not crash boot.
            self.ready = False
            self.error = str(exc)
            logger.warning("Graphiti/Neo4j startup failed: %s", exc)
        else:
            self.ready = True
            self.error = None

    async def check_connectivity(self) -> tuple[bool, str | None]:
        """Live connectivity check for /health/graph -- doesn't rely solely on
        the cached startup result, since Neo4j may come up after this process
        did (or go down after it started).
        """
        try:
            self._ensure_built()
            assert self.graphiti is not None
            await self.graphiti.driver.client.verify_connectivity()  # type: ignore[attr-defined]
        except Exception as exc:  # noqa: BLE001 - report any failure, don't crash
            self.ready = False
            self.error = str(exc)
            return False, str(exc)
        self.ready = True
        self.error = None
        return True, None

    async def shutdown(self) -> None:
        if self.graphiti is not None:
            await self.graphiti.close()
