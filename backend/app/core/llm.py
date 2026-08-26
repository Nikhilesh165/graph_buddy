"""Our own direct Anthropic calls for structured tasks (currently: ontology
bootstrap) -- distinct from `graphiti_client.py`'s AnthropicClient, which is
wired for Graphiti's internal extraction prompts, not custom structured
output. Stateless per-call, no persistent connection to manage.
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
