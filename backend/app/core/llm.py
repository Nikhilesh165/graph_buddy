"""Our own direct OpenAI calls for tasks outside Graphiti's own extraction
pipeline (ontology bootstrap, chat answers) -- distinct from
`graphiti_client.py`'s OpenAIClient, which is wired for Graphiti's internal
extraction prompts, not custom structured output or free-text generation.
Stateless per-call, no persistent connection to manage.

Structured output (ontology bootstrap) uses the Responses API's native
`text_format=<pydantic model>` (`client.responses.parse`, confirmed against
the installed `openai` SDK by reading `graphiti_core`'s own
`openai_client.py`, which uses the same call) -- the model's response is
validated straight into `OntologyProposal`, no manual JSON-schema tool
definition or response-block scanning required.
"""

from __future__ import annotations

from openai import AsyncOpenAI

from app.models.ontology import OntologyProposal

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
---"""


async def propose_ontology(
    sample_text: str, *, api_key: str | None, model: str
) -> OntologyProposal:
    client = AsyncOpenAI(api_key=api_key)
    response = await client.responses.parse(
        model=model,
        input=[{"role": "user", "content": _BOOTSTRAP_PROMPT.format(sample=sample_text)}],
        max_output_tokens=4096,
        text_format=OntologyProposal,
    )
    if response.output_parsed is None:
        raise RuntimeError("OpenAI did not return a parsed ontology proposal")
    return response.output_parsed


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
    client = AsyncOpenAI(api_key=api_key)
    response = await client.responses.create(
        model=model,
        instructions=_CHAT_SYSTEM,
        input=f"Facts:\n{facts_context}\n\nQuestion: {question}",
        max_output_tokens=1024,
    )
    if not response.output_text:
        raise RuntimeError("OpenAI did not return a text answer for the chat question")
    return response.output_text
