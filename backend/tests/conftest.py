"""Shared test fixtures.

None of these tests talk to a real Neo4j, Anthropic, or OpenAI -- `build_graphiti`
is monkeypatched to return a lightweight fake with the same shape our code
relies on (`driver.client.verify_connectivity`, `build_indices_and_constraints`,
`close`), so the suite is deterministic and runs with no external services and
no API keys, per docs/ROADMAP.md Phase 0's "no live run needed to verify" plan.
"""

from collections.abc import Iterator
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

import app.core.graphiti_client as graphiti_client_module
from app.main import create_app


class FakeNeo4jClient:
    """Stands in for the raw neo4j driver exposed as `graphiti.driver.client`."""

    def __init__(self, should_connect: bool) -> None:
        self._should_connect = should_connect
        self.verify_connectivity = AsyncMock(side_effect=self._verify)

    async def _verify(self) -> None:
        if not self._should_connect:
            raise ConnectionError("could not connect to Neo4j (fake: DB down)")


class FakeDriver:
    def __init__(self, should_connect: bool) -> None:
        self.client = FakeNeo4jClient(should_connect)


class FakeGraphiti:
    """Stands in for graphiti_core.Graphiti."""

    def __init__(self, should_connect: bool) -> None:
        self.driver = FakeDriver(should_connect)
        self._should_connect = should_connect
        self.build_indices_and_constraints = AsyncMock(
            side_effect=self._build_indices
        )
        self.close = AsyncMock()

    async def _build_indices(self, delete_existing: bool = False) -> None:
        if not self._should_connect:
            raise ConnectionError("could not connect to Neo4j (fake: DB down)")


@pytest.fixture
def client_with_graph_connected(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(
        graphiti_client_module,
        "build_graphiti",
        lambda settings: FakeGraphiti(should_connect=True),
    )
    with TestClient(create_app()) as client:
        yield client


@pytest.fixture
def client_with_graph_down(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(
        graphiti_client_module,
        "build_graphiti",
        lambda settings: FakeGraphiti(should_connect=False),
    )
    with TestClient(create_app()) as client:
        yield client
