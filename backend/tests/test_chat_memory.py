from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core import db
from app.models.chat import ChatTurn, QueryPlan, TermMapping
from app.models.conversation import Conversation
from app.services import memory_service
from tests.conftest import FakeCommunityNode, FakeEntityEdge, FakeGraphiti, FakeSearchResults


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


def test_first_question_starts_a_conversation_and_follow_up_uses_working_memory(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
    mock_resolve_query: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    _with_facts(fake_graphiti)

    first = client.post("/chat", json={"question": "Who manages GreenField?"}).json()

    conversation_id = first["conversation_id"]
    assert conversation_id
    [conversation] = client.get("/chat/conversations").json()
    assert conversation["id"] == conversation_id
    assert conversation["title"] == "Who manages GreenField?"
    assert conversation["turn_count"] == 1

    mock_resolve_query.side_effect = None
    mock_resolve_query.return_value = QueryPlan(
        standalone_query="Where is Priya based?", uses_conversation_context=True
    )
    second = client.post(
        "/chat", json={"question": "Where is she based?", "conversation_id": conversation_id}
    ).json()

    _, kwargs = mock_resolve_query.call_args
    assert "User: Who manages GreenField?" in kwargs["memory"]
    assert "Assistant: Alice knows Bob [1]." in kwargs["memory"]
    assert second["conversation_id"] == conversation_id
    assert second["query_plan"]["standalone_query"] == "Where is Priya based?"

    # Retrieval searched for the resolved question, not the pronoun-laden one.
    search_query = fake_graphiti.search_.call_args.args[0]
    assert search_query == "Where is Priya based?"
    # And the answer saw both the original and its resolution, plus memory.
    _, answer_kwargs = mock_generate_chat_answer.call_args
    assert "Where is she based?" in answer_kwargs["question"]
    assert "Where is Priya based?" in answer_kwargs["question"]
    assert "Who manages GreenField?" in answer_kwargs["memory_context"]

    trace = client.get(f"/chat/{second['id']}/trace").json()
    assert trace["query"] == "Where is Priya based?"
    assert [t["question"] for t in trace["memory"]["working_turns"]] == ["Who manages GreenField?"]
    assert trace["resolution"]["plan"]["uses_conversation_context"] is True

    history = client.get("/chat/history", params={"conversation_id": conversation_id}).json()
    assert [t["id"] for t in history] == [first["id"], second["id"]]


def test_unknown_conversation_is_404(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, _ = client_with_extraction
    response = client.post("/chat", json={"question": "hi", "conversation_id": "nope"})
    assert response.status_code == 404


def test_create_conversation_endpoint(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    client, _ = client_with_extraction
    created = client.post("/chat/conversations", json={"title": "Q3 churn"}).json()
    assert created["title"] == "Q3 churn"
    assert created["turn_count"] == 0


def test_episodic_recall_across_conversations(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    _with_facts(fake_graphiti)

    earlier = client.post("/chat", json={"question": "Which projects does Priya lead?"}).json()
    client.post("/chat", json={"question": "What is the office address?"})

    # A brand-new conversation, but a question close to the first one.
    later = client.post("/chat", json={"question": "Which projects does Priya Nair lead?"}).json()

    trace = client.get(f"/chat/{later['id']}/trace").json()
    recalled = trace["memory"]["recalled"]
    assert recalled[0]["turn_id"] == earlier["id"]
    assert "similar question" in recalled[0]["reason"]
    assert all(r["question"] != "What is the office address?" for r in recalled)
    _, answer_kwargs = mock_generate_chat_answer.call_args
    assert "Related earlier exchanges" in answer_kwargs["memory_context"]


def test_resolved_vocabulary_is_learned_and_fed_back(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
    mock_resolve_query: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    _put_ontology(client)
    _with_facts(fake_graphiti)
    mock_resolve_query.side_effect = None
    mock_resolve_query.return_value = QueryPlan(
        standalone_query="Who manages our accounts?",
        entity_types=["Customer"],
        term_mappings=[
            TermMapping(term="Accounts", kind="entity_type", maps_to="customer"),
            TermMapping(term="widgets", kind="entity_type", maps_to="Product"),  # not in ontology
        ],
        unmapped_terms=["contracts"],
    )

    turn = client.post("/chat", json={"question": "Who manages our accounts?"}).json()
    client.post("/chat", json={"question": "And their contracts?"})

    _, kwargs = mock_resolve_query.call_args
    assert '"accounts" -> Customer (used 1x)' in kwargs["vocabulary"]
    assert "widgets" not in kwargs["vocabulary"]
    assert "MANAGES (Person -> Customer)" in kwargs["ontology"]

    # Grounded plan persisted on the turn -- the discovery cycle mines it later.
    assert turn["query_plan"]["entity_types"] == ["Customer"]
    assert turn["query_plan"]["unmapped_terms"] == ["contracts"]
    trace = client.get(f"/chat/{turn['id']}/trace").json()
    assert trace["resolution"]["edge_types"] == ["MANAGES"]
    assert trace["resolution"]["node_labels"] == ["Customer"]


def test_resolution_failure_falls_back_to_verbatim_search(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
    mock_resolve_query: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    _with_facts(fake_graphiti)
    mock_resolve_query.side_effect = RuntimeError("resolver down")

    response = client.post("/chat", json={"question": "Who manages GreenField?"})

    assert response.status_code == 200
    trace = client.get(f"/chat/{response.json()['id']}/trace").json()
    assert trace["query"] == "Who manages GreenField?"
    assert trace["resolution"]["error"] == "resolver down"


def test_query_resolution_can_be_disabled(
    configure,
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
    mock_resolve_query: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    configure(QUERY_RESOLUTION_ENABLED="false")
    _with_facts(fake_graphiti)

    client.post("/chat", json={"question": "anything?"})

    mock_resolve_query.assert_not_awaited()


def test_broad_questions_get_community_summaries_as_background(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
    mock_resolve_query: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    fake_graphiti.search_.return_value = FakeSearchResults(
        edges=[FakeEntityEdge(uuid="e1", fact="Priya manages GreenField", attributes={})],
        communities=[FakeCommunityNode("c1", "Customer accounts", "Who manages which customer.")],
    )
    mock_resolve_query.side_effect = None
    mock_resolve_query.return_value = QueryPlan(
        standalone_query="Give me an overview of our customers", intent="overview"
    )

    turn = client.post("/chat", json={"question": "Give me an overview of our customers"}).json()

    _, kwargs = mock_generate_chat_answer.call_args
    assert "Customer accounts: Who manages which customer." in kwargs["background_context"]
    trace = client.get(f"/chat/{turn['id']}/trace").json()
    assert [c["uuid"] for c in trace["communities"]] == ["c1"]


def test_lookup_questions_skip_community_background(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
    mock_generate_chat_answer: AsyncMock,
) -> None:
    client, fake_graphiti = client_with_extraction
    fake_graphiti.search_.return_value = FakeSearchResults(
        edges=[FakeEntityEdge(uuid="e1", fact="Priya manages GreenField", attributes={})],
        communities=[FakeCommunityNode("c1", "Customer accounts", "Who manages which customer.")],
    )

    turn = client.post("/chat", json={"question": "Who manages GreenField?"}).json()

    _, kwargs = mock_generate_chat_answer.call_args
    assert kwargs["background_context"] == ""
    assert client.get(f"/chat/{turn['id']}/trace").json()["communities"] == []


def test_orphan_turns_are_adopted_into_one_conversation(
    client_with_extraction: tuple[TestClient, FakeGraphiti],
) -> None:
    # Started the app (so the engine exists), then simulate pre-upgrade rows.
    with Session(db._engine) as session:
        session.add(ChatTurn(question="old one", answer="a", retrieved_count=0))
        session.add(ChatTurn(question="old two", answer="b", retrieved_count=0))
        session.commit()

        assert memory_service.adopt_orphan_turns(session) == 2
        assert memory_service.adopt_orphan_turns(session) == 0

        [conversation] = session.exec(select(Conversation)).all()
        assert conversation.title == "Earlier questions"
        turns = memory_service.conversation_turns(session, conversation.id)
        assert [t.question for t in turns] == ["old one", "old two"]
