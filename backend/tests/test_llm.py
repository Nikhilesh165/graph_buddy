"""app/core/llm.py's request shaping, against a fake AsyncOpenAI client (no
network) -- the rest of the suite mocks these functions out entirely."""

from types import SimpleNamespace

import pytest

import app.core.llm as llm
from app.models.ontology import OntologyProposal


class _FakeResponses:
    def __init__(self, response: SimpleNamespace) -> None:
        self.response = response
        self.calls: list[dict] = []

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        return self.response

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def _install_fake(monkeypatch: pytest.MonkeyPatch, response: SimpleNamespace) -> _FakeResponses:
    responses = _FakeResponses(response)
    monkeypatch.setattr(
        llm, "AsyncOpenAI", lambda api_key=None: SimpleNamespace(responses=responses)
    )
    return responses


async def test_chat_answer_sets_graphiti_matching_reasoning_effort(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses = _install_fake(monkeypatch, SimpleNamespace(status="completed", output_text="ok"))

    await llm.generate_chat_answer(question="q", facts_context="f", api_key="k", model="gpt-5.5")
    await llm.generate_chat_answer(question="q", facts_context="f", api_key="k", model="gpt-4.1")

    assert responses.calls[0]["reasoning"] == {"effort": "none"}
    assert "reasoning" not in responses.calls[1]  # not a reasoning model


async def test_ontology_proposal_sets_reasoning_effort(monkeypatch: pytest.MonkeyPatch) -> None:
    responses = _install_fake(
        monkeypatch, SimpleNamespace(status="completed", output_parsed=OntologyProposal())
    )

    await llm.propose_ontology("sample", api_key="k", model="gpt-5-mini")

    assert responses.calls[0]["reasoning"] == {"effort": "minimal"}


async def test_incomplete_response_raises_with_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake(
        monkeypatch,
        SimpleNamespace(
            status="incomplete",
            incomplete_details=SimpleNamespace(reason="max_output_tokens"),
            output_text="partial",
        ),
    )

    with pytest.raises(RuntimeError, match="max_output_tokens"):
        await llm.generate_chat_answer(
            question="q", facts_context="f", api_key="k", model="gpt-5.5"
        )
