import asyncio
from collections.abc import Callable
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

import app.core.llm as llm_module
from app.core.scheduler import PeriodicTask
from app.models.chat import QueryPlan, TermMapping
from app.models.discovery import OntologyChange, OntologyChangeSet
from tests.conftest import FakeEntityEdge, FakeGraphiti, FakeSearchResults


@pytest.fixture
def mock_summarize(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    mock = AsyncMock(return_value="They discussed GreenField's account manager.")
    monkeypatch.setattr(llm_module, "summarize_conversation", mock)
    return mock


def _put_ontology(client: TestClient) -> None:
    client.put(
        "/ontology",
        json={
            "entity_types": [{"name": "Person"}, {"name": "Customer"}],
            "relation_types": [
                {"name": "MANAGES", "source_types": ["Person"], "target_types": ["Customer"]}
            ],
        },
    )


def _with_facts(fake_graphiti: FakeGraphiti) -> None:
    fake_graphiti.search_.return_value = FakeSearchResults(
        edges=[FakeEntityEdge(uuid="e1", fact="Priya manages GreenField", attributes={})]
    )


def test_quiet_cycle_records_a_run_but_no_feed_entry(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, _ = client_with_extraction

    run = client.post("/memory/consolidate").json()

    assert run["status"] == "completed"
    assert run["trigger"] == "manual"
    assert run["digest"] == "Nothing new since the last cycle."
    assert client.get("/discovery/feed").json() == []
    assert [r["id"] for r in client.get("/memory/runs").json()] == [run["id"]]


def test_conversation_summary_folds_turns_older_than_working_memory(
    configure: Callable[..., None],
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
    mock_resolve_query: AsyncMock,
    mock_summarize: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    configure(MEMORY_WORKING_TURNS="1", CONSOLIDATION_SUMMARY_MIN_NEW_TURNS="2")
    _with_facts(fake_graphiti)
    first = client.post("/chat", json={"question": "Who manages GreenField?"}).json()
    conversation_id = first["conversation_id"]
    for question in ("Since when?", "Where is she based?"):
        client.post("/chat", json={"question": question, "conversation_id": conversation_id})

    run = client.post("/memory/consolidate").json()

    assert run["stats"]["conversations_summarized"] == 1
    _, kwargs = mock_summarize.call_args
    # Turns 1-2 are folded; turn 3 stays in the verbatim working window.
    assert "Who manages GreenField?" in kwargs["turns"]
    assert "Since when?" in kwargs["turns"]
    assert "Where is she based?" not in kwargs["turns"]
    [conversation] = client.get("/chat/conversations").json()
    assert conversation["summary"] == "They discussed GreenField's account manager."

    # The next turn's resolver sees the summary as working memory.
    client.post("/chat", json={"question": "Anything else?", "conversation_id": conversation_id})
    _, resolver_kwargs = mock_resolve_query.call_args
    assert "Summary of earlier conversation: They discussed" in resolver_kwargs["memory"]

    # Nothing new to fold yet -> not re-summarized.
    mock_summarize.reset_mock()
    client.post("/memory/consolidate")
    mock_summarize.assert_not_awaited()


def test_gap_mining_feeds_conversation_driven_discovery(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
    mock_resolve_query: AsyncMock,
    mock_propose_ontology_changes: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    _put_ontology(client)
    _with_facts(fake_graphiti)
    mock_resolve_query.side_effect = lambda *, question, **_: QueryPlan(
        standalone_query=question,
        unmapped_terms=["contracts"],
        term_mappings=[TermMapping(term="accounts", kind="entity_type", maps_to="Customer")],
    )
    client.post("/chat", json={"question": "Which contracts renew in May?"})
    client.post("/chat", json={"question": "Who signed the GreenField contracts?"})
    mock_propose_ontology_changes.return_value = OntologyChangeSet(
        summary="Users keep asking about contracts.",
        changes=[OntologyChange(op="add_entity_type", target="Contract")],
    )

    run = client.post("/memory/consolidate").json()

    _, kwargs = mock_propose_ontology_changes.call_args
    assert kwargs["evidence_kind"] == "conversation"
    assert '"contracts" (asked 2 times)' in kwargs["evidence"]
    assert "Which contracts renew in May?" in kwargs["evidence"]
    assert run["stats"]["turns_reviewed"] == 2
    assert run["stats"]["gap_terms"] == [{"term": "contracts", "count": 2}]
    assert run["stats"]["ontology_changes_applied"] == 1
    assert "missing from the ontology: contracts (2×)" in run["digest"]
    assert "Ontology updated to v2" in run["digest"]

    ontology = client.get("/ontology").json()
    assert "Contract" in [et["name"] for et in ontology["entity_types"]]
    kinds = [e["kind"] for e in client.get("/discovery/feed").json()]
    assert sorted(kinds) == ["consolidation_digest", "ontology_evolved"]
    [applied] = client.get("/discovery/proposals", params={"status": "applied"}).json()
    assert applied["trigger"] == "conversation"

    # The window advances: the same turns aren't mined twice.
    mock_propose_ontology_changes.reset_mock()
    second = client.post("/memory/consolidate").json()
    assert second["stats"]["turns_reviewed"] == 0
    mock_propose_ontology_changes.assert_not_awaited()

    vocabulary = client.get("/memory/vocabulary").json()
    assert vocabulary[0]["term"] == "accounts"
    assert vocabulary[0]["hits"] == 2


def test_failed_gap_mining_is_retried_over_the_same_window(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
    mock_resolve_query: AsyncMock,
    mock_propose_ontology_changes: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    _put_ontology(client)
    _with_facts(fake_graphiti)
    mock_resolve_query.side_effect = lambda *, question, **_: QueryPlan(
        standalone_query=question, unmapped_terms=["invoices"]
    )
    client.post("/chat", json={"question": "Which invoices are overdue?"})
    mock_propose_ontology_changes.side_effect = RuntimeError("LLM down")

    failed = client.post("/memory/consolidate").json()

    assert failed["status"] == "completed"
    # A failed step records no partial results (and no high-water mark).
    assert "turns_reviewed" not in failed["stats"]
    assert failed["stats"]["errors"] == [{"step": "gap mining", "error": "LLM down"}]
    assert "Skipped gap mining: LLM down" in failed["digest"]
    assert client.get("/discovery/feed").json()[0]["title"] == "Memory consolidated (with errors)"

    mock_propose_ontology_changes.side_effect = None
    retried = client.post("/memory/consolidate").json()
    assert retried["stats"]["turns_reviewed"] == 1


def test_communities_rebuilt_only_when_new_episodes_arrived(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, fake_graphiti = client_with_extraction
    _put_ontology(client)
    source = client.post(
        "/sources", files={"file": ("note.txt", b"Priya manages GreenField.", "text/plain")}
    ).json()
    client.post(f"/sources/{source['id']}/extract")

    first = client.post("/memory/consolidate").json()
    second = client.post("/memory/consolidate").json()

    assert first["stats"]["communities_rebuilt"] is True
    assert "Rebuilt 0 community summaries" in first["digest"]
    assert second["stats"]["communities_rebuilt"] is False
    fake_graphiti.build_communities.assert_awaited_once()


def test_community_rebuild_with_graph_down_is_a_recorded_step_error(
    client_with_graph_down: TestClient,
) -> None:
    client = client_with_graph_down
    # An Episode row exists from an earlier extraction (graph since went down).
    from sqlmodel import Session

    from app.core import db
    from app.models.episode import Episode
    from app.models.source import Source

    with Session(db._engine) as session:
        session.add(
            Source(id="s1", filename="a.txt", content_type="t", file_path="/x", size_bytes=1)
        )
        session.add(Episode(episode_uuid="ep1", source_id="s1", chunk_index=0, chunk_preview=""))
        session.commit()

    run = client.post("/memory/consolidate").json()

    [error] = run["stats"]["errors"]
    assert error["step"] == "community summaries"
    assert "not available" in error["error"]


def test_overview_endpoint(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    _with_facts(fake_graphiti)
    client.post("/chat", json={"question": "Who manages GreenField?"})
    client.post("/memory/consolidate")

    overview = client.get("/memory/overview").json()

    assert overview["conversations"] == 1
    assert overview["episodes"] == 1
    assert overview["pending_proposals"] == 0
    assert overview["last_run"]["status"] == "completed"


async def test_periodic_task_runs_on_interval_and_stops() -> None:
    calls = 0

    async def job() -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("first run fails -- the schedule must survive it")

    task = PeriodicTask("test", 0.01, job)
    task.start()
    await asyncio.sleep(0.08)
    await task.stop()

    assert calls >= 2
    assert not task.running


async def test_periodic_task_with_zero_interval_never_starts() -> None:
    task = PeriodicTask("disabled", 0, AsyncMock())
    task.start()
    assert not task.running
    await task.stop()


def test_digest_wording() -> None:
    from app.services.consolidation_service import compose_digest

    assert "1 suggested ontology change awaits your review." in compose_digest(
        {"ontology_changes_pending": 1}
    )
    assert "2 suggested ontology changes await your review." in compose_digest(
        {"ontology_changes_pending": 2}
    )
    assert "Rebuilt 1 community summary over the graph." in compose_digest(
        {"communities_rebuilt": True, "community_count": 1}
    )
