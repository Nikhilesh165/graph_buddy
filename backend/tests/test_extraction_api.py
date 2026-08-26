from fastapi.testclient import TestClient

from tests.conftest import FakeAddEpisodeResult, FakeEntityEdge, FakeEntityNode, FakeGraphiti


def _put_ontology(client: TestClient) -> None:
    response = client.put(
        "/ontology",
        json={
            "entity_types": [{"name": "Person", "description": "A person"}],
            "relation_types": [
                {
                    "name": "KNOWS",
                    "description": "knows",
                    "source_types": ["Person"],
                    "target_types": ["Person"],
                }
            ],
        },
    )
    assert response.status_code == 200


def _upload_txt(client: TestClient, content: bytes = b"Alice knows Bob.") -> dict:
    response = client.post("/sources", files={"file": ("note.txt", content, "text/plain")})
    assert response.status_code == 200
    return response.json()


def test_extract_happy_path(client_with_extraction: tuple[TestClient, FakeGraphiti]) -> None:
    client, fake_graphiti = client_with_extraction
    _put_ontology(client)
    source = _upload_txt(client)

    response = client.post(f"/sources/{source['id']}/extract")

    assert response.status_code == 200
    body = response.json()
    assert body["episodes_added"] == 1
    assert body["nodes_touched"] == 2
    assert body["edges_touched"] == 1
    assert len(body["sample_facts"]) == 1
    assert body["sample_facts"][0]["fact"] == "Alice knows Bob"
    # .txt reliability weight is 0.85; the fake edge's raw LLM confidence is 0.9.
    assert body["sample_facts"][0]["confidence"] == 0.9 * 0.85

    fake_graphiti.add_episode.assert_awaited_once()
    saved_edge = fake_graphiti.add_episode.return_value.edges[0]
    saved_edge.save.assert_awaited_once()

    fetched = client.get(f"/sources/{source['id']}").json()
    assert fetched["graphiti_status"] == "extracted"
    assert fetched["episode_count"] == 1
    assert fetched["node_count"] == 2
    assert fetched["edge_count"] == 1
    assert fetched["extracted_at"] is not None


def test_extract_without_ontology_is_400(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, _ = client_with_extraction
    source = _upload_txt(client)

    response = client.post(f"/sources/{source['id']}/extract")

    assert response.status_code == 400


def test_extract_unparsed_source_is_400(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, _ = client_with_extraction
    _put_ontology(client)
    failed = client.post(
        "/sources", files={"file": ("broken.docx", b"not real", "application/octet-stream")}
    ).json()
    assert failed["status"] == "failed"

    response = client.post(f"/sources/{failed['id']}/extract")

    assert response.status_code == 400


def test_extract_unknown_source_is_404(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, _ = client_with_extraction
    _put_ontology(client)

    response = client.post("/sources/does-not-exist/extract")

    assert response.status_code == 404


def test_extract_graph_down_is_503(client_with_graph_down: TestClient) -> None:
    _put_ontology(client_with_graph_down)
    source = _upload_txt(client_with_graph_down)

    response = client_with_graph_down.post(f"/sources/{source['id']}/extract")

    assert response.status_code == 503


def test_extract_mid_failure_records_status_on_source(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, fake_graphiti = client_with_extraction
    _put_ontology(client)
    # Two long paragraphs (with a default 3000-char chunk budget) so this
    # produces two chunks/two add_episode calls -- the second one fails.
    long_text = ("A" * 2000) + "\n\n" + ("B" * 2000)
    source = _upload_txt(client, content=long_text.encode())

    fake_graphiti.add_episode.side_effect = [
        FakeAddEpisodeResult(nodes=[FakeEntityNode(uuid="n1")], edges=[]),
        RuntimeError("LLM call failed"),
    ]

    response = client.post(f"/sources/{source['id']}/extract")

    assert response.status_code == 502
    assert "LLM call failed" in response.json()["detail"]

    fetched = client.get(f"/sources/{source['id']}").json()
    assert fetched["graphiti_status"] == "failed"
    assert "LLM call failed" in fetched["graphiti_error"]
    # episode_count reflects only the extraction call, which never completed
    # (it's only incremented on success), not the one chunk that succeeded
    # before the failure.
    assert fetched["episode_count"] == 0


def test_extract_confidence_clamped_and_missing_confidence_skipped(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, fake_graphiti = client_with_extraction
    _put_ontology(client)
    source = _upload_txt(client)

    fake_graphiti.add_episode.return_value = FakeAddEpisodeResult(
        nodes=[FakeEntityNode(uuid="n1")],
        edges=[
            FakeEntityEdge(uuid="e1", fact="over-confident fact", attributes={"confidence": 5.0}),
            FakeEntityEdge(uuid="e2", fact="no confidence reported", attributes={}),
        ],
    )

    response = client.post(f"/sources/{source['id']}/extract")

    assert response.status_code == 200
    facts = {f["fact"]: f["confidence"] for f in response.json()["sample_facts"]}
    assert facts["over-confident fact"] == 1.0  # clamped, not 5.0 * 0.85
    assert facts["no confidence reported"] is None
