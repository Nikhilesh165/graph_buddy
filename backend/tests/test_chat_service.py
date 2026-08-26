from unittest.mock import AsyncMock

import pytest

from app.services import chat_service
from tests.conftest import FakeEntityEdge, FakeEntityNode, FakeGraphiti, FakeSearchResults


async def test_retrieve_maps_nodes_and_facts_with_scores() -> None:
    fake_graphiti = FakeGraphiti(should_connect=True)
    fake_graphiti.search_.return_value = FakeSearchResults(
        nodes=[FakeEntityNode(uuid="n1", name="Alice", labels=["Entity", "Person"])],
        node_reranker_scores=[0.8],
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
        edge_reranker_scores=[0.75],
    )

    trace = await chat_service.retrieve(fake_graphiti, "who does Alice know?")

    assert trace.query == "who does Alice know?"
    assert len(trace.seed_nodes) == 1
    assert trace.seed_nodes[0].name == "Alice"
    assert trace.seed_nodes[0].type == "Person"
    assert trace.seed_nodes[0].score == 0.8
    assert len(trace.facts) == 1
    fact = trace.facts[0]
    assert fact.fact == "Alice knows Bob"
    assert fact.confidence == 0.9
    assert fact.score == 0.75
    assert fact.source_node_uuid == "n1"
    assert fact.target_node_uuid == "n2"


async def test_retrieve_passes_limit_into_search_config() -> None:
    fake_graphiti = FakeGraphiti(should_connect=True)

    await chat_service.retrieve(fake_graphiti, "anything", limit=5)

    _, kwargs = fake_graphiti.search_.call_args
    assert kwargs["config"].limit == 5


async def test_ask_with_no_facts_skips_llm_call(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_graphiti = FakeGraphiti(should_connect=True)
    fake_llm = AsyncMock()
    monkeypatch.setattr("app.core.llm.generate_chat_answer", fake_llm)

    result = await chat_service.ask(fake_graphiti, "anything?", api_key="key", model="model")

    assert "don't have any facts" in result.answer
    assert result.citations == []
    fake_llm.assert_not_awaited()


async def test_ask_builds_citations_aligned_with_facts(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_graphiti = FakeGraphiti(should_connect=True)
    fake_graphiti.search_.return_value = FakeSearchResults(
        edges=[
            FakeEntityEdge(uuid="e1", fact="Alice knows Bob", attributes={"confidence": 0.9}),
            FakeEntityEdge(uuid="e2", fact="Bob works at Acme", attributes={}),
        ],
    )
    fake_llm = AsyncMock(return_value="Alice knows Bob [1], and Bob works at Acme [2].")
    monkeypatch.setattr("app.core.llm.generate_chat_answer", fake_llm)

    result = await chat_service.ask(
        fake_graphiti, "tell me about Alice", api_key="key", model="model"
    )

    assert result.answer == "Alice knows Bob [1], and Bob works at Acme [2]."
    assert [c.index for c in result.citations] == [1, 2]
    assert result.citations[0].fact == "Alice knows Bob"
    assert result.citations[0].confidence == 0.9
    assert result.citations[1].confidence is None

    fake_llm.assert_awaited_once()
    _, kwargs = fake_llm.call_args
    assert kwargs["facts"] == [("Alice knows Bob", 0.9), ("Bob works at Acme", None)]
