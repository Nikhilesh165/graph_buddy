from fastapi.testclient import TestClient


def test_health_is_always_ok(client_with_graph_down: TestClient) -> None:
    """/health is pure liveness -- ok even when the graph DB is unreachable."""
    response = client_with_graph_down.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_graph_ok_when_connected(client_with_graph_connected: TestClient) -> None:
    response = client_with_graph_connected.get("/health/graph")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_graph_reports_error_when_down(client_with_graph_down: TestClient) -> None:
    """A down/unreachable DB is a clean reported error, never a 500."""
    response = client_with_graph_down.get("/health/graph")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "error"
    assert "detail" in body and body["detail"]
