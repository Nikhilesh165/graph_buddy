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


def test_upload_strips_directory_components_from_filename(client: TestClient) -> None:
    # The multipart filename is client-controlled -- a traversal attempt must
    # land inside the per-source upload dir under its bare basename.
    from app.core.config import get_settings

    uploads_dir = get_settings().uploads_dir.resolve()
    for raw, expected in [
        ("../../escaped.txt", "escaped.txt"),
        ("/etc/abs.md", "abs.md"),
        ("C:\\Users\\me\\win.txt", "win.txt"),
    ]:
        response = client.post("/sources", files={"file": (raw, b"hello", "text/plain")})

        assert response.status_code == 200
        body = response.json()
        assert body["filename"] == expected
        written = [p for p in uploads_dir.rglob(expected) if p.is_file()]
        assert len(written) == 1
        assert written[0].parent.parent == uploads_dir

    assert not (uploads_dir.parent / "escaped.txt").exists()
    assert not (uploads_dir.parent.parent / "escaped.txt").exists()


def test_upload_rejects_oversized_file(client: TestClient, monkeypatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    response = client.post(
        "/sources", files={"file": ("big.txt", b"x" * (1024 * 1024 + 1), "text/plain")}
    )

    assert response.status_code == 400
    assert "max upload size" in response.json()["detail"]


def test_source_timestamps_are_utc_aware(client: TestClient) -> None:
    # SQLite drops tzinfo; without app.models.utc_datetime these came back
    # with no offset and JS parsed them as the viewer's local time.
    client.post("/sources", files={"file": ("note.txt", b"content", "text/plain")})

    created_at = client.get("/sources").json()[0]["created_at"]

    assert created_at.endswith("Z") or created_at.endswith("+00:00")
