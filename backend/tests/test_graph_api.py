from fastapi.testclient import TestClient

from tests.conftest import (
    FakeAddEpisodeResult,
    FakeEntityEdge,
    FakeEntityNode,
    FakeEpisodicNode,
    FakeGraphiti,
)


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


def test_get_graph_down_is_503(client_with_graph_down: TestClient) -> None:
    response = client_with_graph_down.get("/graph")

    assert response.status_code == 503


def test_get_graph_happy_path(client_with_extraction: tuple[TestClient, FakeGraphiti]) -> None:
    client, fake_graphiti = client_with_extraction
    fake_graphiti.driver.execute_query.return_value = ([_edge_row()], None, None)

    response = client.get("/graph")

    assert response.status_code == 200
    body = response.json()
    assert body["truncated"] is False
    assert len(body["edges"]) == 1
    edge = body["edges"][0]
    assert edge["source"] == "n-alice"
    assert edge["target"] == "n-bob"
    assert edge["confidence"] == 0.9
    node_names = {n["name"] for n in body["nodes"]}
    assert node_names == {"Alice", "Bob"}
    assert all(n["type"] == "Person" for n in body["nodes"])


def test_get_graph_filters_forwarded_as_query_params(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, fake_graphiti = client_with_extraction
    fake_graphiti.driver.execute_query.return_value = ([], None, None)

    response = client.get(
        "/graph",
        params={
            "entity_types": ["Person"],
            "min_confidence": 0.5,
            "search": "alice",
            "limit": 10,
        },
    )

    assert response.status_code == 200
    _, kwargs = fake_graphiti.driver.execute_query.call_args
    assert kwargs["entity_types"] == ["Person"]
    assert kwargs["min_confidence"] == 0.5
    assert kwargs["search"] == "alice"
    assert kwargs["limit"] == 11  # limit+1, to detect truncation


def test_get_node_unknown_is_404(client_with_extraction: tuple[TestClient, FakeGraphiti]) -> None:
    client, fake_graphiti = client_with_extraction
    fake_graphiti.driver.execute_query.return_value = ([], None, None)

    response = client.get("/graph/nodes/does-not-exist")

    assert response.status_code == 404


def test_get_node_down_is_503(client_with_graph_down: TestClient) -> None:
    response = client_with_graph_down.get("/graph/nodes/whatever")

    assert response.status_code == 503


def test_get_node_resolves_provenance_to_source(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, fake_graphiti = client_with_extraction

    # Set up an ontology + a real extraction, so app/models/episode.py gets a
    # row mapping episode_uuid="ep-1" back to this uploaded source -- the
    # thing get /graph/nodes/{uuid} is meant to resolve.
    client.put(
        "/ontology",
        json={
            "entity_types": [{"name": "Person", "description": "A person"}],
            "relation_types": [
                {
                    "name": "KNOWS",
                    "source_types": ["Person"],
                    "target_types": ["Person"],
                }
            ],
        },
    )
    fake_graphiti.add_episode.return_value = FakeAddEpisodeResult(
        nodes=[FakeEntityNode(uuid="n-alice"), FakeEntityNode(uuid="n-bob")],
        edges=[
            FakeEntityEdge(uuid="edge-1", fact="Alice knows Bob", attributes={"confidence": 0.9})
        ],
        episode=FakeEpisodicNode(uuid="ep-1"),
    )
    source = client.post(
        "/sources", files={"file": ("note.txt", b"Alice knows Bob.", "text/plain")}
    ).json()
    extract_response = client.post(f"/sources/{source['id']}/extract")
    assert extract_response.status_code == 200

    node_row = {
        "uuid": "n-alice",
        "name": "Alice",
        "labels": ["Entity", "Person"],
        "summary": "",
        "attributes": {},
        "created_at": None,
    }
    provenance_row = {
        "episode_uuid": "ep-1",
        "source_description": "Uploaded file: note.txt",
        "valid_at": None,
    }
    fake_graphiti.driver.execute_query.side_effect = [
        ([node_row], None, None),
        ([], None, None),  # no neighbors for this test
        ([provenance_row], None, None),
    ]

    response = client.get("/graph/nodes/n-alice")

    assert response.status_code == 200
    body = response.json()
    assert body["node"]["name"] == "Alice"
    assert len(body["provenance"]) == 1
    item = body["provenance"][0]
    assert item["episode_uuid"] == "ep-1"
    assert item["source_id"] == source["id"]
    assert item["source_filename"] == "note.txt"
    assert item["chunk_preview"] == "Alice knows Bob."
