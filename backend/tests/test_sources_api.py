from fastapi.testclient import TestClient


def test_upload_txt_source(client: TestClient) -> None:
    response = client.post(
        "/sources", files={"file": ("note.txt", b"hello world", "text/plain")}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "parsed"
    assert body["filename"] == "note.txt"
    assert body["char_count"] == len("hello world")
    assert body["text_preview"] == "hello world"
    assert "file_path" not in body


def test_upload_rejects_unsupported_extension(client: TestClient) -> None:
    response = client.post(
        "/sources", files={"file": ("data.xlsx", b"whatever", "application/octet-stream")}
    )

    assert response.status_code == 400


def test_upload_records_parse_failure_without_500(client: TestClient) -> None:
    # A .docx extension but not a real docx file -- python-docx will raise.
    response = client.post(
        "/sources", files={"file": ("broken.docx", b"not a real docx", "application/octet-stream")}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "failed"
    assert body["parse_error"]


def test_list_and_get_source(client: TestClient) -> None:
    upload = client.post(
        "/sources", files={"file": ("note.txt", b"content", "text/plain")}
    ).json()

    listed = client.get("/sources").json()
    assert any(s["id"] == upload["id"] for s in listed)

    fetched = client.get(f"/sources/{upload['id']}").json()
    assert fetched["id"] == upload["id"]


def test_get_unknown_source_is_404(client: TestClient) -> None:
    response = client.get("/sources/does-not-exist")
    assert response.status_code == 404
