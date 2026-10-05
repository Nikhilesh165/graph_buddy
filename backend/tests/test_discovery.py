from collections.abc import Callable
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.models.chat import ChatTurn
from app.models.discovery import Evidence, OntologyChange, OntologyChangeSet
from app.models.ontology import EntityType, PropertyDef, RelationType
from app.services.discovery_service import collect_gap_signals
from tests.conftest import FakeGraphiti


def _put_ontology(client: TestClient) -> None:
    response = client.put(
        "/ontology",
        json={
            "entity_types": [
                {"name": "Person", "description": "A person"},
                {"name": "Project", "description": "A project"},
            ],
            "relation_types": [
                {"name": "WORKS_ON", "source_types": ["Person"], "target_types": ["Project"]}
            ],
        },
    )
    assert response.status_code == 200


def _upload(
    client: TestClient, name: str = "note.txt", content: bytes = b"Alice knows Bob."
) -> dict:
    response = client.post("/sources", files={"file": (name, content, "text/plain")})
    assert response.status_code == 200
    return response.json()


def _evolution_change_set() -> OntologyChangeSet:
    return OntologyChangeSet(
        summary="The roster introduces customers and contract values.",
        changes=[
            OntologyChange(
                op="add_entity_type",
                target="Customer",
                entity_type=EntityType(name="Customer", description="A paying customer"),
            ),
            OntologyChange(
                op="add_relation_type",
                target="MANAGES_ACCOUNT",
                relation_type=RelationType(
                    name="MANAGES_ACCOUNT", source_types=["Person"], target_types=["Customer"]
                ),
            ),
            OntologyChange(
                op="add_entity_property",
                target="Project",
                property_def=PropertyDef(name="budget", type="number"),
            ),
            OntologyChange(op="remove_entity_type", target="Person"),
            # Already exists -- dropped by the dry run, never queued.
            OntologyChange(op="add_entity_type", target="project"),
        ],
        evidence=[Evidence(quote="GreenField Farms signed in March", origin="note.txt")],
    )


def test_first_upload_bootstraps_ontology_in_background(
    configure: Callable[..., None],
    client: TestClient,
    mock_propose_ontology: AsyncMock,
) -> None:
    configure(AUTO_DISCOVER_ON_UPLOAD="true")

    uploaded = _upload(client)

    # The upload response itself is returned before discovery runs...
    assert uploaded["discovery_status"] == "pending"
    # ...and TestClient runs background tasks before handing the response back.
    source = client.get(f"/sources/{uploaded['id']}").json()
    assert source["discovery_status"] == "completed"
    mock_propose_ontology.assert_awaited_once()

    ontology = client.get("/ontology").json()
    assert ontology["version_number"] == 1
    assert ontology["created_by"] == "discovery"
    assert ontology["source_id"] == uploaded["id"]
    assert "Initial ontology derived from note.txt" in ontology["note"]

    feed = client.get("/discovery/feed").json()
    assert [e["kind"] for e in feed] == ["ontology_bootstrapped"]
    applied = client.get("/discovery/proposals", params={"status": "applied"}).json()
    assert len(applied) == 1
    assert applied[0]["auto_applied"] is True
    assert applied[0]["trigger"] == "source"


def test_later_upload_evolves_ontology_and_queues_destructive_changes(
    configure: Callable[..., None],
    client: TestClient,
    mock_propose_ontology_changes: AsyncMock,
) -> None:
    _put_ontology(client)
    configure(AUTO_DISCOVER_ON_UPLOAD="true", ONTOLOGY_AUTONOMY="autonomous")
    mock_propose_ontology_changes.return_value = _evolution_change_set()

    uploaded = _upload(client, name="roster.txt")

    _, kwargs = mock_propose_ontology_changes.call_args
    assert kwargs["evidence_kind"] == "source"
    assert kwargs["label"] == "roster.txt"
    assert '"name": "WORKS_ON"' in kwargs["ontology"]

    ontology = client.get("/ontology").json()
    assert ontology["version_number"] == 2
    assert ontology["created_by"] == "discovery"
    assert [et["name"] for et in ontology["entity_types"]] == ["Person", "Project", "Customer"]
    assert "MANAGES_ACCOUNT" in [rt["name"] for rt in ontology["relation_types"]]
    project = next(et for et in ontology["entity_types"] if et["name"] == "Project")
    assert [p["name"] for p in project["properties"]] == ["budget"]

    pending = client.get("/discovery/proposals", params={"status": "pending"}).json()
    assert len(pending) == 1
    assert [c["op"] for c in pending[0]["changes"]] == ["remove_entity_type"]
    assert pending[0]["risk"] == "high"
    assert pending[0]["base_version_number"] == 2
    assert pending[0]["source_id"] == uploaded["id"]
    assert pending[0]["evidence"][0]["quote"] == "GreenField Farms signed in March"

    kinds = [e["kind"] for e in client.get("/discovery/feed").json()]
    assert sorted(kinds) == ["ontology_evolved", "proposal_pending"]


def test_manual_autonomy_queues_everything_and_accept_applies_it(
    configure: Callable[..., None],
    client: TestClient,
    mock_propose_ontology_changes: AsyncMock,
) -> None:
    _put_ontology(client)
    configure(AUTO_DISCOVER_ON_UPLOAD="true", ONTOLOGY_AUTONOMY="manual")
    mock_propose_ontology_changes.return_value = _evolution_change_set()

    _upload(client)

    assert client.get("/ontology").json()["version_number"] == 1
    [proposal] = client.get("/discovery/proposals", params={"status": "pending"}).json()
    assert len(proposal["changes"]) == 4

    decision = client.post(f"/discovery/proposals/{proposal['id']}/accept").json()

    assert decision["proposal"]["status"] == "applied"
    assert decision["ontology"]["version_number"] == 2
    # Including the destructive change -- accepting is the human's call.
    assert [et["name"] for et in decision["ontology"]["entity_types"]] == ["Project", "Customer"]
    assert decision["ontology"]["note"].startswith("Accepted from the Discovery Feed")

    again = client.post(f"/discovery/proposals/{proposal['id']}/accept")
    assert again.status_code == 409


def test_reject_proposal(
    configure: Callable[..., None],
    client: TestClient,
    mock_propose_ontology_changes: AsyncMock,
) -> None:
    _put_ontology(client)
    configure(AUTO_DISCOVER_ON_UPLOAD="true", ONTOLOGY_AUTONOMY="manual")
    mock_propose_ontology_changes.return_value = _evolution_change_set()
    _upload(client)
    [proposal] = client.get("/discovery/proposals", params={"status": "pending"}).json()

    decision = client.post(f"/discovery/proposals/{proposal['id']}/reject").json()

    assert decision["proposal"]["status"] == "rejected"
    assert decision["ontology"]["version_number"] == 1
    assert client.get("/discovery/feed").json()[0]["kind"] == "proposal_rejected"
    assert client.post("/discovery/proposals/nope/reject").status_code == 404


def test_accepting_a_stale_proposal_marks_it_failed(
    configure: Callable[..., None],
    client: TestClient,
    mock_propose_ontology_changes: AsyncMock,
) -> None:
    _put_ontology(client)
    configure(AUTO_DISCOVER_ON_UPLOAD="true", ONTOLOGY_AUTONOMY="manual")
    mock_propose_ontology_changes.return_value = OntologyChangeSet(
        changes=[OntologyChange(op="add_entity_type", target="Customer")]
    )
    _upload(client)
    [proposal] = client.get("/discovery/proposals", params={"status": "pending"}).json()

    # The user adds Customer by hand in the meantime.
    client.put(
        "/ontology",
        json={"entity_types": [{"name": "Customer"}], "relation_types": []},
    )

    decision = client.post(f"/discovery/proposals/{proposal['id']}/accept").json()

    assert decision["proposal"]["status"] == "failed"
    assert "already exists" in decision["proposal"]["error"]
    assert decision["ontology"]["version_number"] == 2


def test_low_risk_change_depending_on_queued_type_waits_for_review(
    configure: Callable[..., None],
    client: TestClient,
    mock_propose_ontology_changes: AsyncMock,
) -> None:
    _put_ontology(client)
    configure(AUTO_DISCOVER_ON_UPLOAD="true", ONTOLOGY_AUTONOMY="assisted")
    mock_propose_ontology_changes.return_value = OntologyChangeSet(
        changes=[
            OntologyChange(op="add_entity_type", target="Customer"),
            OntologyChange(
                op="add_entity_property",
                target="Customer",
                property_def=PropertyDef(name="tier"),
            ),
        ]
    )

    _upload(client)

    assert client.get("/ontology").json()["version_number"] == 1
    [proposal] = client.get("/discovery/proposals", params={"status": "pending"}).json()
    assert [c["op"] for c in proposal["changes"]] == ["add_entity_type", "add_entity_property"]


def test_no_changes_needed_is_recorded_in_feed(
    configure: Callable[..., None],
    client: TestClient,
    mock_propose_ontology_changes: AsyncMock,
) -> None:
    _put_ontology(client)
    configure(AUTO_DISCOVER_ON_UPLOAD="true")

    _upload(client)

    assert client.get("/ontology").json()["version_number"] == 1
    [event] = client.get("/discovery/feed").json()
    assert event["kind"] == "source_analyzed"
    assert client.get("/discovery/proposals").json() == []


def test_background_discovery_failure_is_recorded_not_raised(
    configure: Callable[..., None],
    client: TestClient,
    mock_propose_ontology: AsyncMock,
) -> None:
    configure(AUTO_DISCOVER_ON_UPLOAD="true")
    mock_propose_ontology.side_effect = RuntimeError("no OPENAI_API_KEY configured")

    uploaded = _upload(client)

    source = client.get(f"/sources/{uploaded['id']}").json()
    assert source["discovery_status"] == "failed"
    assert "OPENAI_API_KEY" in source["discovery_error"]
    [event] = client.get("/discovery/feed").json()
    assert event["kind"] == "discovery_failed"


def test_auto_extract_after_discovery_when_enabled(
    configure: Callable[..., None],
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_propose_ontology: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    configure(AUTO_DISCOVER_ON_UPLOAD="true", AUTO_EXTRACT_ON_UPLOAD="true")

    uploaded = _upload(client)

    fake_graphiti.add_episode.assert_awaited_once()
    source = client.get(f"/sources/{uploaded['id']}").json()
    assert source["graphiti_status"] == "extracted"
    assert source["extracted_ontology_version"] == 1


def test_manual_discovery_endpoint(
    client: TestClient,
    mock_propose_ontology: AsyncMock,
) -> None:
    uploaded = _upload(client)
    assert uploaded["discovery_status"] == "not_run"

    response = client.post(f"/discovery/sources/{uploaded['id']}")

    assert response.status_code == 200
    body = response.json()
    assert body["source"]["discovery_status"] == "completed"
    assert body["ontology"]["version_number"] == 1
    assert body["applied"]["status"] == "applied"
    assert body["pending"] is None

    assert client.post("/discovery/sources/missing").status_code == 404


def test_manual_discovery_llm_failure_is_502(
    client: TestClient,
    mock_propose_ontology: AsyncMock,
) -> None:
    mock_propose_ontology.side_effect = RuntimeError("API error")
    uploaded = _upload(client)

    response = client.post(f"/discovery/sources/{uploaded['id']}")

    assert response.status_code == 502
    source = client.get(f"/sources/{uploaded['id']}").json()
    assert source["discovery_status"] == "failed"


def test_discovery_settings_endpoint(configure: Callable[..., None], client: TestClient) -> None:
    configure(ONTOLOGY_AUTONOMY="assisted")
    body = client.get("/discovery/settings").json()
    assert body["ontology_autonomy"] == "assisted"


def test_collect_gap_signals_aggregates_and_skips_known_types() -> None:
    turns = [
        ChatTurn(
            question="Which contracts expire soon?",
            answer="",
            retrieved_count=0,
            query_plan={"unmapped_terms": ["Contracts", "customer"]},
        ),
        ChatTurn(
            question="Who signed the contracts?",
            answer="",
            retrieved_count=2,
            query_plan={"unmapped_terms": ["contracts"]},
        ),
        ChatTurn(question="Old turn with no plan", answer="", retrieved_count=1),
    ]

    signals = collect_gap_signals(turns, known_type_names={"Customer", "Person"})
    # Once discovery has added the type, its plural stops counting as a gap.
    assert collect_gap_signals(turns, known_type_names={"Contract"}).top_terms() == [
        ("customer", 1)
    ]

    assert signals.top_terms() == [("contracts", 2)]
    assert signals.term_examples["contracts"] == [
        "Which contracts expire soon?",
        "Who signed the contracts?",
    ]
    assert signals.unanswered == ["Which contracts expire soon?"]
    rendered = signals.render()
    assert '"contracts" (asked 2 times)' in rendered
    assert "retrieved no facts" in rendered


def test_suggestions_already_awaiting_review_are_not_queued_twice(
    configure: Callable[..., None],
    client: TestClient,
    mock_propose_ontology_changes: AsyncMock,
) -> None:
    _put_ontology(client)
    configure(AUTO_DISCOVER_ON_UPLOAD="true", ONTOLOGY_AUTONOMY="autonomous")
    mock_propose_ontology_changes.return_value = OntologyChangeSet(
        changes=[OntologyChange(op="rename_entity_type", target="Person", new_name="Employee")]
    )

    _upload(client, name="a.txt")
    # A second upload re-suggests the same rename (worded differently).
    mock_propose_ontology_changes.return_value = OntologyChangeSet(
        changes=[
            OntologyChange(
                op="rename_entity_type", target="person", new_name="Employee", rationale="again"
            ),
            OntologyChange(op="add_entity_type", target="Team"),
        ]
    )
    _upload(client, name="b.txt")

    pending = client.get("/discovery/proposals", params={"status": "pending"}).json()
    assert len(pending) == 1
    assert "Team" in [et["name"] for et in client.get("/ontology").json()["entity_types"]]

    # A third upload with only the duplicate says so, rather than "covered".
    mock_propose_ontology_changes.return_value = OntologyChangeSet(
        changes=[OntologyChange(op="rename_entity_type", target="Person", new_name="Employee")]
    )
    _upload(client, name="c.txt")
    assert len(client.get("/discovery/proposals", params={"status": "pending"}).json()) == 1
    latest = client.get("/discovery/feed").json()[0]
    assert latest["kind"] == "source_analyzed"
    assert "awaiting review" in latest["title"]
