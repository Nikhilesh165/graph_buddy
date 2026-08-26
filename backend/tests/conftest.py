"""Shared test fixtures.

None of these tests talk to a real Neo4j, Anthropic, or OpenAI -- `build_graphiti`
is monkeypatched to return a lightweight fake with the same shape our code
relies on (`driver.client.verify_connectivity`, `build_indices_and_constraints`,
`close`), and `app.core.llm.propose_ontology` is mocked for anything that
touches ontology bootstrap. Every test also gets its own SQLite DB + uploads
dir (never the real `backend/data/` used by `uv run uvicorn ...` locally), so
the suite is deterministic and side-effect-free with no external services and
no API keys, per docs/ROADMAP.md Phase 0/1's "no live run needed to verify"
plan.
"""

from collections.abc import Iterator
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

import app.core.graphiti_client as graphiti_client_module
import app.core.llm as llm_module
from app.core.config import get_settings
from app.main import create_app
from app.models.ontology import EntityType, OntologyProposal, RelationType


@pytest.fixture(autouse=True)
def _isolated_app_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path / "uploads"))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


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
        # graph_service.py talks to Neo4j via `graphiti.driver.execute_query`
        # directly (see that module's docstring) rather than through
        # graphiti_core's node/edge classes -- tests for it configure
        # `execute_query.side_effect`/`return_value` to hand back
        # `(records, summary, keys)` tuples, same shape as the real neo4j
        # driver's `EagerResult`. Plain dicts stand in for `neo4j.Record`
        # (`dict(record)` works on either).
        self.execute_query = AsyncMock(return_value=([], None, None))


class FakeEntityNode:
    def __init__(self, uuid: str) -> None:
        self.uuid = uuid


class FakeEpisodicNode:
    """Stands in for graphiti_core.nodes.EpisodicNode -- extraction_service
    only reads `.uuid` off of it (see AddEpisodeResults.episode)."""

    def __init__(self, uuid: str = "fake-episode") -> None:
        self.uuid = uuid


class FakeEntityEdge:
    """Stands in for graphiti_core.edges.EntityEdge -- just enough surface
    for extraction_service.extract_source: a mutable `attributes` dict and an
    awaitable `save`.
    """

    def __init__(self, uuid: str, fact: str, attributes: dict | None = None) -> None:
        self.uuid = uuid
        self.fact = fact
        self.attributes = attributes or {}
        self.save = AsyncMock()


class FakeAddEpisodeResult:
    def __init__(
        self,
        nodes: list[FakeEntityNode],
        edges: list[FakeEntityEdge],
        episode: FakeEpisodicNode | None = None,
    ) -> None:
        self.nodes = nodes
        self.edges = edges
        self.episode = episode or FakeEpisodicNode()


def default_add_episode_result() -> FakeAddEpisodeResult:
    edge = FakeEntityEdge(uuid="edge-1", fact="Alice knows Bob", attributes={"confidence": 0.9})
    return FakeAddEpisodeResult(
        nodes=[FakeEntityNode(uuid="node-alice"), FakeEntityNode(uuid="node-bob")],
        edges=[edge],
    )


class FakeGraphiti:
    """Stands in for graphiti_core.Graphiti."""

    def __init__(self, should_connect: bool) -> None:
        self.driver = FakeDriver(should_connect)
        self._should_connect = should_connect
        self.build_indices_and_constraints = AsyncMock(
            side_effect=self._build_indices
        )
        self.close = AsyncMock()
        self.add_episode = AsyncMock(return_value=default_add_episode_result())

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


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """Plain client for sources/ontology endpoints, which don't care about
    Graphiti's connectivity state -- mocked as connected just so it doesn't
    log warnings during the test.
    """
    monkeypatch.setattr(
        graphiti_client_module,
        "build_graphiti",
        lambda settings: FakeGraphiti(should_connect=True),
    )
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def client_with_extraction(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[TestClient, FakeGraphiti]]:
    """Like `client`, but also hands back the FakeGraphiti instance so a test
    can configure/inspect `add_episode` (return_value, side_effect, call args)
    for extraction endpoint tests.
    """
    fake_graphiti = FakeGraphiti(should_connect=True)
    monkeypatch.setattr(graphiti_client_module, "build_graphiti", lambda settings: fake_graphiti)
    with TestClient(create_app()) as c:
        yield c, fake_graphiti


@pytest.fixture
def mock_propose_ontology(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """Patches app.core.llm.propose_ontology so ontology bootstrap never calls
    the real Anthropic API. Returns the mock so a test can override
    return_value/side_effect for its own scenario.
    """
    default_proposal = OntologyProposal(
        entity_types=[EntityType(name="Person", description="A person mentioned in the text")],
        relation_types=[
            RelationType(name="KNOWS", source_types=["Person"], target_types=["Person"])
        ],
    )
    mock = AsyncMock(return_value=default_proposal)
    monkeypatch.setattr(llm_module, "propose_ontology", mock)
    return mock
