from unittest.mock import AsyncMock

from fastapi.testclient import TestClient


def test_get_ontology_when_none_exists(client: TestClient) -> None:
    response = client.get("/ontology")

    assert response.status_code == 200
    body = response.json()
    assert body["version_number"] == 0
    assert body["entity_types"] == []
    assert body["relation_types"] == []


def test_bootstrap_creates_first_version(
    client: TestClient, mock_propose_ontology: AsyncMock
) -> None:
    source = client.post(
        "/sources", files={"file": ("note.txt", b"Alice knows Bob.", "text/plain")}
    ).json()

    response = client.post("/ontology/bootstrap", json={"source_id": source["id"]})

    assert response.status_code == 200
    body = response.json()
    assert body["version_number"] == 1
    assert body["created_by"] == "bootstrap"
    assert body["source_id"] == source["id"]
    assert [et["name"] for et in body["entity_types"]] == ["Person"]
    assert body["diff"]["added_entity_types"] == ["Person"]
    mock_propose_ontology.assert_awaited_once()

    current = client.get("/ontology").json()
    assert current["version_number"] == 1


def test_bootstrap_unknown_source_is_404(
    client: TestClient, mock_propose_ontology: AsyncMock
) -> None:
    response = client.post("/ontology/bootstrap", json={"source_id": "does-not-exist"})
    assert response.status_code == 404


def test_bootstrap_unparsed_source_is_400(
    client: TestClient, mock_propose_ontology: AsyncMock
) -> None:
    failed = client.post(
        "/sources", files={"file": ("broken.docx", b"not real", "application/octet-stream")}
    ).json()
    assert failed["status"] == "failed"

    response = client.post("/ontology/bootstrap", json={"source_id": failed["id"]})
    assert response.status_code == 400


def test_bootstrap_llm_failure_is_502_not_500(
    client: TestClient, mock_propose_ontology: AsyncMock
) -> None:
    mock_propose_ontology.side_effect = RuntimeError("no ANTHROPIC_API_KEY configured")
    source = client.post(
        "/sources", files={"file": ("note.txt", b"some content", "text/plain")}
    ).json()

    response = client.post("/ontology/bootstrap", json={"source_id": source["id"]})

    assert response.status_code == 502


def test_update_ontology_creates_new_version_with_diff(client: TestClient) -> None:
    first = client.put(
        "/ontology",
        json={
            "entity_types": [{"name": "Person", "description": "A person"}],
            "relation_types": [],
        },
    ).json()
    assert first["version_number"] == 1
    assert first["created_by"] == "user_edit"

    second = client.put(
        "/ontology",
        json={
            "entity_types": [
                {"name": "Person", "description": "A person"},
                {"name": "Company", "description": "An organization"},
            ],
            "relation_types": [],
        },
    ).json()

    assert second["version_number"] == 2
    assert second["diff"]["added_entity_types"] == ["Company"]

    versions = client.get("/ontology/versions").json()
    assert [v["version_number"] for v in versions] == [2, 1]
