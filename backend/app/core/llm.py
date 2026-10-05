"""Our own direct OpenAI calls for tasks outside Graphiti's own extraction
pipeline (ontology bootstrap and evolution, query resolution, chat answers,
conversation summaries) -- distinct from
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

import json
from typing import Literal

from openai import AsyncOpenAI

from app.models.chat import QueryPlan
from app.models.discovery import OntologyChangeSet
from app.models.ontology import EntityType, OntologyProposal, RelationType

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


def ontology_json(entity_types: list[EntityType], relation_types: list[RelationType]) -> str:
    """The exact-spelling form of the ontology, for prompts that must propose
    changes against it (names have to round-trip precisely)."""
    return json.dumps(
        {
            "entity_types": [et.model_dump() for et in entity_types],
            "relation_types": [rt.model_dump() for rt in relation_types],
        },
        indent=1,
    )


def ontology_outline(entity_types: list[EntityType], relation_types: list[RelationType]) -> str:
    """A compact, readable form of the ontology for query resolution -- the
    resolver needs names, meanings and shape, not the full JSON."""
    if not entity_types and not relation_types:
        return "(no ontology defined yet)"
    lines = ["Entity types:"]
    for et in entity_types:
        props = ""
        if et.properties:
            props = f" [properties: {', '.join(p.name for p in et.properties)}]"
        lines.append(f"- {et.name}: {et.description or '(no description)'}{props}")
    lines.append("Relation types:")
    for rt in relation_types:
        shape = f"{'|'.join(rt.source_types) or '?'} -> {'|'.join(rt.target_types) or '?'}"
        lines.append(f"- {rt.name} ({shape}): {rt.description or '(no description)'}")
    return "\n".join(lines)


_CHANGES_FROM_SOURCE_PROMPT = """You maintain the ontology (schema) of a knowledge \
graph that is built automatically from a user's documents. A new document was just \
uploaded. Compare it with the current ontology and propose the SMALLEST set of changes \
needed for extraction from this document to capture its important entities, \
relationships and attributes.

Rules:
- Reuse before adding: if an existing type fits (even under a different name), refine \
it -- add a property, extend a relation's source/target types, sharpen a description -- \
instead of creating a near-duplicate.
- Only add types for things that recur or matter in the document, not one-off details.
- Never rename or remove a type just because this document doesn't mention it; other \
documents rely on it. Only propose rename/remove when a type is clearly wrong or duplicated.
- Names: PascalCase for entity types ("Customer"), SCREAMING_SNAKE_CASE for relation \
types ("WORKS_AT"), no spaces or punctuation. Property types: string, number, integer, boolean.
- Every relation's source/target types must be entity types that already exist or that \
this change set adds.
- Back the change set with a few short quotes from the document as evidence.
- If the ontology already covers the document well, return an empty changes list.

Current ontology (JSON):
{ontology}

Document "{label}" (sample):
---
{evidence}
---"""

_CHANGES_FROM_CONVERSATIONS_PROMPT = """You maintain the ontology (schema) of a \
knowledge graph built automatically from a user's documents. While chatting with the \
graph, the user asked about concepts the current ontology has no type for, and some \
questions retrieved nothing at all. Those signals are listed below.

Propose ontology changes (usually a new entity type, relation type, or property) that \
would let the graph represent what the user keeps asking about. Extraction will be \
re-run over the user's existing documents under the new ontology, so only propose \
concepts that plausibly appear in the kind of documents this ontology was built from.

Rules:
- Ignore conversational filler, and terms that are specific instances (a particular \
person's or company's name) rather than kinds of thing.
- Reuse before adding: map a term onto an existing type (via a property, extra relation \
endpoints, or a sharper description) when it fits.
- Never rename or remove types based on conversation signals alone.
- Names: PascalCase entity types, SCREAMING_SNAKE_CASE relation types, no spaces or \
punctuation. Property types: string, number, integer, boolean.
- Every relation's source/target types must exist already or be added in this change set.
- Use the user's own questions as evidence quotes.
- If nothing warrants a change, return an empty changes list.

Current ontology (JSON):
{ontology}

Signals from {label}:
---
{evidence}
---"""


async def propose_ontology_changes(
    *,
    ontology: str,
    evidence: str,
    evidence_kind: Literal["source", "conversation"],
    label: str,
    api_key: str | None,
    model: str,
) -> OntologyChangeSet:
    template = (
        _CHANGES_FROM_SOURCE_PROMPT
        if evidence_kind == "source"
        else _CHANGES_FROM_CONVERSATIONS_PROMPT
    )
    client = AsyncOpenAI(api_key=api_key)
    response = await client.responses.parse(
        model=model,
        input=[
            {
                "role": "user",
                "content": template.format(ontology=ontology, evidence=evidence, label=label),
            }
        ],
        max_output_tokens=4096,
        text_format=OntologyChangeSet,
    )
    if response.output_parsed is None:
        raise RuntimeError("OpenAI did not return a parsed ontology change set")
    return response.output_parsed


_RESOLVE_QUERY_PROMPT = """You resolve a user's question against the ontology of \
their knowledge graph, before retrieval runs. Produce:

- standalone_query: the question rewritten to be fully self-contained. Replace pronouns \
and elliptical references ("her", "that project", "what about Q3?") using the \
conversation so far. Keep it a natural-language question; if it already stands alone, \
repeat it unchanged.
- intent: lookup (facts about one specific thing), relationship (how things connect), \
aggregate (counts or lists across many things), overview (broad summary or themes), \
temporal (change over time), comparison.
- entity_types / relation_types: the ontology types the question is about. Use ONLY \
names that appear in the ontology below, spelled exactly. Leave empty if none apply.
- entity_mentions: specific named things in the standalone query (a person, a company, \
a project...), each with its ontology entity type if one fits.
- term_mappings: words the user used for an ontology type under a different name \
(e.g. "clients" -> Customer). Only include real synonyms, not exact type names.
- unmapped_terms: kinds of thing in the question that NO ontology type covers (category \
nouns like "contracts" or "invoices", never specific names). Empty if everything maps.
- uses_conversation_context: true only if you needed the conversation to resolve the \
question.

Ontology:
{ontology}

Learned vocabulary (how this user has referred to ontology types before):
{vocabulary}

{memory}

Question: {question}"""


async def resolve_query(
    *,
    question: str,
    ontology: str,
    vocabulary: str,
    memory: str,
    api_key: str | None,
    model: str,
) -> QueryPlan:
    client = AsyncOpenAI(api_key=api_key)
    response = await client.responses.parse(
        model=model,
        input=[
            {
                "role": "user",
                "content": _RESOLVE_QUERY_PROMPT.format(
                    ontology=ontology,
                    vocabulary=vocabulary or "(none yet)",
                    memory=memory or "Conversation so far: (this is the first question)",
                    question=question,
                ),
            }
        ],
        max_output_tokens=1024,
        text_format=QueryPlan,
    )
    if response.output_parsed is None:
        raise RuntimeError("OpenAI did not return a parsed query plan")
    return response.output_parsed


_SUMMARIZE_CONVERSATION_PROMPT = """Maintain a running summary of a user's \
conversation with an assistant that answers questions from their knowledge graph. \
Fold the new exchanges into the existing summary. Keep what a future turn would need: \
the entities and topics discussed, what the user is trying to find out, conclusions \
reached, and open questions the graph could not answer. At most 150 words, plain prose.

Existing summary:
{previous}

New exchanges:
{turns}"""


async def summarize_conversation(
    *, previous_summary: str, turns: str, api_key: str | None, model: str
) -> str:
    client = AsyncOpenAI(api_key=api_key)
    response = await client.responses.create(
        model=model,
        input=_SUMMARIZE_CONVERSATION_PROMPT.format(
            previous=previous_summary or "(none yet)", turns=turns
        ),
        max_output_tokens=512,
    )
    if not response.output_text:
        raise RuntimeError("OpenAI did not return a conversation summary")
    return response.output_text.strip()


_CHAT_SYSTEM = """You are answering questions about a knowledge graph built from the \
user's own uploaded documents. Answer using ONLY the numbered facts below -- do not \
draw on outside knowledge. Cite the fact(s) supporting every claim with its bracketed \
number, e.g. [1] or [2][3]. If the facts don't contain enough information to answer \
the question, say so plainly instead of guessing.

You may also be given conversation memory (earlier exchanges with this user) and \
background summaries of parts of the graph. Use them to understand what the question \
refers to and to frame the answer, but every factual claim must still be supported by, \
and cite, the numbered facts."""


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
    memory_context: str = "",
    background_context: str = "",
) -> str:
    sections = []
    if memory_context:
        sections.append(f"Conversation memory:\n{memory_context}")
    if background_context:
        sections.append(f"Background summaries:\n{background_context}")
    sections.append(f"Facts:\n{facts_context}")
    sections.append(f"Question: {question}")
    client = AsyncOpenAI(api_key=api_key)
    response = await client.responses.create(
        model=model,
        instructions=_CHAT_SYSTEM,
        input="\n\n".join(sections),
        max_output_tokens=1024,
    )
    if not response.output_text:
        raise RuntimeError("OpenAI did not return a text answer for the chat question")
    return response.output_text
