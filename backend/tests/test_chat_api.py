from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from tests.conftest import FakeEntityEdge, FakeGraphiti, FakeSearchResults


def test_chat_down_is_503(client_with_graph_down: TestClient) -> None:
    response = client_with_graph_down.post("/chat", json={"question": "anything?"})

    assert response.status_code == 503


def test_chat_empty_question_is_400(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, _ = client_with_extraction

    response = client.post("/chat", json={"question": "   "})

    assert response.status_code == 400


def test_chat_happy_path_persists_and_returns_turn(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    fake_graphiti.search_.return_value = FakeSearchResults(
        edges=[FakeEntityEdge(uuid="e1", fact="Alice knows Bob", attributes={"confidence": 0.9})],
    )
    mock_generate_chat_answer.return_value = "Alice knows Bob [1]."

    response = client.post("/chat", json={"question": "Who does Alice know?"})

    assert response.status_code == 200
    body = response.json()
    assert body["question"] == "Who does Alice know?"
    assert body["answer"] == "Alice knows Bob [1]."
    assert body["retrieved_count"] == 1
    assert len(body["citations"]) == 1
    assert body["citations"][0] == {
        "index": 1,
        "edge_uuid": "e1",
        "fact": "Alice knows Bob",
        "confidence": 0.9,
    }

    history = client.get("/chat/history").json()
    assert len(history) == 1
    assert history[0]["id"] == body["id"]


def test_chat_llm_failure_is_502(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    fake_graphiti.search_.return_value = FakeSearchResults(
        edges=[FakeEntityEdge(uuid="e1", fact="Alice knows Bob", attributes={"confidence": 0.9})],
    )
    mock_generate_chat_answer.side_effect = RuntimeError("LLM call failed")

    response = client.post("/chat", json={"question": "Who does Alice know?"})

    assert response.status_code == 502
    assert "LLM call failed" in response.json()["detail"]
    assert client.get("/chat/history").json() == []


def test_chat_history_empty_by_default(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, _ = client_with_extraction

    assert client.get("/chat/history").json() == []


def test_chat_trace_persisted_and_readable_after_a_turn(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    fake_graphiti.search_.return_value = FakeSearchResults(
        edges=[
            FakeEntityEdge(
                uuid="e1",
                fact="Alice knows Bob",
                attributes={"confidence": 0.9},
                name="KNOWS",
                source_node_uuid="n1",
                target_node_uuid="n2",
            )
        ],
    )
    mock_generate_chat_answer.return_value = "Alice knows Bob [1]."

    turn = client.post("/chat", json={"question": "Who does Alice know?"}).json()

    response = client.get(f"/chat/{turn['id']}/trace")

    assert response.status_code == 200
    body = response.json()
    assert body["turn_id"] == turn["id"]
    assert body["query"] == "Who does Alice know?"
    assert len(body["facts"]) == 1
    fact = body["facts"][0]
    assert fact["edge_uuid"] == "e1"
    assert fact["confidence"] == 0.9
    assert fact["source_node_uuid"] == "n1"
    assert fact["target_node_uuid"] == "n2"
    assert "Alice knows Bob" in body["final_context"]


def test_chat_trace_persisted_even_with_no_facts(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, fake_graphiti = client_with_extraction
    fake_graphiti.search_.return_value = FakeSearchResults()  # no facts

    turn = client.post("/chat", json={"question": "anything?"}).json()

    response = client.get(f"/chat/{turn['id']}/trace")

    assert response.status_code == 200
    body = response.json()
    assert body["facts"] == []
    assert body["seed_nodes"] == []


def test_chat_trace_unknown_turn_is_404(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, _ = client_with_extraction

    response = client.get("/chat/does-not-exist/trace")

    assert response.status_code == 404
