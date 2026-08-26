"""Our own direct Anthropic calls for tasks outside Graphiti's own extraction
pipeline (ontology bootstrap, chat answers) -- distinct from
`graphiti_client.py`'s AnthropicClient, which is wired for Graphiti's
internal extraction prompts, not custom structured output or free-text
generation. Stateless per-call, no persistent connection to manage.
"""

from __future__ import annotations

from anthropic import AsyncAnthropic

from app.models.ontology import OntologyProposal

_TOOL_NAME = "propose_ontology"

_BOOTSTRAP_PROMPT = """You are bootstrapping a knowledge graph ontology from a sample \
of a user's uploaded document.

Propose a starter ontology: entity types and relation types that would \
meaningfully model this content. Keep it focused (roughly 3-8 entity types, \
2-6 relation types for a first pass). Every relation type's source_types and \
target_types must reference entity type names you also propose.

Naming: entity/relation type names should be short PascalCase-ish identifiers \
with no spaces or punctuation (e.g. "Person", "WORKS_AT") -- they become graph \
labels. Property `type` values must be one of: string, number, integer, boolean.

Document sample:
---
{sample}
---

Call the {tool_name} tool with your proposal."""


def _tool_schema() -> dict:
    return {
        "name": _TOOL_NAME,
        "description": (
            "Propose a starter ontology (entity types and relation types) for "
            "the given document sample."
        ),
        "input_schema": OntologyProposal.model_json_schema(),
    }


async def propose_ontology(
    sample_text: str, *, api_key: str | None, model: str
) -> OntologyProposal:
    client = AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=model,
        max_tokens=4096,
        tools=[_tool_schema()],
        tool_choice={"type": "tool", "name": _TOOL_NAME},
        messages=[
            {
                "role": "user",
                "content": _BOOTSTRAP_PROMPT.format(sample=sample_text, tool_name=_TOOL_NAME),
            }
        ],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == _TOOL_NAME:
            return OntologyProposal.model_validate(block.input)
    raise RuntimeError("Claude did not return a tool_use block for propose_ontology")


_CHAT_SYSTEM = """You are answering questions about a knowledge graph built from the \
user's own uploaded documents. Answer using ONLY the numbered facts below -- do not \
draw on outside knowledge. Cite the fact(s) supporting every claim with its bracketed \
number, e.g. [1] or [2][3]. If the facts don't contain enough information to answer \
the question, say so plainly instead of guessing."""


def format_facts(facts: list[tuple[str, float | None]]) -> str:
    """The exact numbered-facts block handed to the LLM as context -- public
    (not `_`-prefixed) because app/services/chat_service.py also calls this
    to capture the same string verbatim as the retrieval trace's
    `final_context` (docs/ARCHITECTURE.md §3.6), rather than reconstructing
    it separately and risking the two drifting apart.
    """
    lines = []
    for i, (fact, confidence) in enumerate(facts, start=1):
        conf_str = f"{confidence:.2f}" if confidence is not None else "unscored"
        lines.append(f"[{i}] (confidence {conf_str}) {fact}")
    return "\n".join(lines)


async def generate_chat_answer(
    *,
    question: str,
    facts_context: str,
    api_key: str | None,
    model: str,
) -> str:
    client = AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=model,
        max_tokens=1024,
        system=_CHAT_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": f"Facts:\n{facts_context}\n\nQuestion: {question}",
            }
        ],
    )
    for block in response.content:
        if block.type == "text":
            return block.text
    raise RuntimeError("Claude did not return a text block for the chat answer")
