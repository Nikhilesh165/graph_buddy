"""Unit tests for graph_service.py's query building/row-mapping, exercised
directly against a fake `graphiti.driver.execute_query` rather than through
the API -- see test_graph_api.py for the route-level behavior (404s, 503s,
provenance resolution against the SQL Episode table).
"""

from types import SimpleNamespace

from app.services import graph_service
from tests.conftest import FakeDriver


def _fake_graphiti(records: list[dict]) -> SimpleNamespace:
    driver = FakeDriver(should_connect=True)
    driver.execute_query.return_value = (records, None, None)
    return SimpleNamespace(driver=driver)


def _edge_row(**overrides) -> dict:
    row = {
        "uuid": "edge-1",
        "name": "KNOWS",
        "fact": "Alice knows Bob",
        "confidence": 0.9,
        "valid_at": None,
        "invalid_at": None,
        "created_at": None,
        "episodes": ["ep-1"],
        "source_uuid": "n-alice",
        "source_name": "Alice",
        "source_labels": ["Entity", "Person"],
        "source_summary": "",
        "source_attributes": {},
        "target_uuid": "n-bob",
        "target_name": "Bob",
        "target_labels": ["Entity", "Person"],
        "target_summary": "",
        "target_attributes": {},
    }
    row.update(overrides)
    return row


async def test_query_graph_dedupes_nodes_across_edges() -> None:
    graphiti = _fake_graphiti(
        [
            _edge_row(uuid="e1"),
            _edge_row(uuid="e2", name="LIKES", fact="Alice likes Bob"),
        ]
    )

    result = await graph_service.query_graph(graphiti, graph_service.GraphFilters())

    assert {n.uuid for n in result.nodes} == {"n-alice", "n-bob"}
    assert {n.type for n in result.nodes} == {"Person"}
    assert len(result.edges) == 2
    assert result.truncated is False


async def test_query_graph_maps_edge_fields_and_direction() -> None:
    graphiti = _fake_graphiti([_edge_row()])

    result = await graph_service.query_graph(graphiti, graph_service.GraphFilters())

    edge = result.edges[0]
    assert edge.source_uuid == "n-alice"
    assert edge.target_uuid == "n-bob"
    assert edge.confidence == 0.9
    assert edge.episodes == ["ep-1"]


async def test_query_graph_truncated_when_more_rows_than_limit() -> None:
    graphiti = _fake_graphiti([_edge_row(uuid="e1"), _edge_row(uuid="e2")])

    result = await graph_service.query_graph(graphiti, graph_service.GraphFilters(limit=1))

    assert len(result.edges) == 1
    assert result.truncated is True
    # The +1-row-over-limit trick must not leak the extra row's params into
    # the actual Cypher LIMIT sent to the driver.
    call_kwargs = graphiti.driver.execute_query.call_args.kwargs
    assert call_kwargs["limit"] == 2


async def test_query_graph_passes_filters_as_query_params() -> None:
    graphiti = _fake_graphiti([])

    await graph_service.query_graph(
        graphiti,
        graph_service.GraphFilters(
            entity_types=["Person"],
            relation_types=["KNOWS"],
            min_confidence=0.5,
            search="Alice",
        ),
    )

    query, kwargs = graphiti.driver.execute_query.call_args
    cypher = query[0]
    assert "e.name IN $relation_types" in cypher
    assert "labels(n) WHERE l IN $entity_types" in cypher
    assert kwargs["entity_types"] == ["Person"]
    assert kwargs["relation_types"] == ["KNOWS"]
    assert kwargs["min_confidence"] == 0.5
    assert kwargs["search"] == "alice"  # lower-cased for the CONTAINS match


async def test_get_node_detail_returns_none_when_node_missing() -> None:
    graphiti = _fake_graphiti([])  # first call (node lookup) returns no records

    detail = await graph_service.get_node_detail(graphiti, "missing")

    assert detail is None


async def test_get_node_detail_assembles_neighbors_and_provenance() -> None:
    driver = FakeDriver(should_connect=True)
    node_row = {
        "uuid": "n-alice",
        "name": "Alice",
        "labels": ["Entity", "Person"],
        "summary": "A person",
        "attributes": {},
        "created_at": None,
    }
    neighbor_row = {
        "uuid": "edge-1",
        "name": "KNOWS",
        "fact": "Alice knows Bob",
        "confidence": 0.9,
        "valid_at": None,
        "invalid_at": None,
        "created_at": None,
        "episodes": ["ep-1"],
        "start_uuid": "n-alice",  # Alice is the RELATES_TO start node -> outgoing
        "other_uuid": "n-bob",
        "other_name": "Bob",
        "other_labels": ["Entity", "Person"],
        "other_summary": "",
        "other_attributes": {},
    }
    provenance_row = {
        "episode_uuid": "ep-1",
        "source_description": "Uploaded file: note.txt",
        "valid_at": None,
    }
    driver.execute_query.side_effect = [
        ([node_row], None, None),
        ([neighbor_row], None, None),
        ([provenance_row], None, None),
    ]
    graphiti = SimpleNamespace(driver=driver)

    detail = await graph_service.get_node_detail(graphiti, "n-alice")

    assert detail is not None
    assert detail.node.name == "Alice"
    assert detail.node.type == "Person"
    assert len(detail.neighbors) == 1
    neighbor = detail.neighbors[0]
    assert neighbor.direction == "outgoing"
    assert neighbor.node.uuid == "n-bob"
    assert neighbor.edge.source_uuid == "n-alice"
    assert neighbor.edge.target_uuid == "n-bob"
    assert len(detail.provenance) == 1
    assert detail.provenance[0].episode_uuid == "ep-1"
