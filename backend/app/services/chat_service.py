"""Phase 4: hybrid retrieval + chat with inline citations. See
docs/ARCHITECTURE.md §3.6 (Retrieval + retrieval trace) and §4 (Chat).

Retrieval goes through Graphiti's advanced `search_` with the
`COMBINED_HYBRID_SEARCH_CROSS_ENCODER` recipe -- bm25 + cosine similarity +
breadth-first graph traversal for both edges and nodes, reranked by a cross
encoder (graphiti_client.py already configures graphiti-core's default
OpenAIRerankerClient for this, so it needs no new external dependency beyond
the OPENAI_API_KEY already used for embeddings). That's "hybrid retrieval
(vector + graph traversal)" from docs/ROADMAP.md's Phase 4 in one call,
rather than hand-rolling seed-search-then-hop-expansion ourselves.

`RetrievalTrace` is deliberately a structured object (seed nodes + scored
facts), not just a flat citation list. docs/ROADMAP.md's sequencing notes
call this out explicitly: "Phase 5 (retrieval inspector) depends on Phase
4's trace object existing; don't start the inspector UI before the trace
schema is settled, or it'll get rebuilt." Persisting it and building the
Inspector UI on top are both explicitly Phase 5's -- this just makes sure
Phase 5 extends this shape instead of reworking retrieval to produce it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from graphiti_core import Graphiti
from graphiti_core.search.search_config_recipes import COMBINED_HYBRID_SEARCH_CROSS_ENCODER

from app.core import llm

DEFAULT_RESULT_LIMIT = 10

# Graphiti's own base label on every entity node -- see graph_service.py's
# BASE_ENTITY_LABEL for the same convention.
BASE_ENTITY_LABEL = "Entity"


def _primary_type(labels: list[str] | None) -> str:
    for label in labels or []:
        if label != BASE_ENTITY_LABEL:
            return label
    return BASE_ENTITY_LABEL


@dataclass
class RetrievedNode:
    uuid: str
    name: str
    type: str
    score: float


@dataclass
class RetrievedFact:
    edge_uuid: str
    name: str
    fact: str
    confidence: float | None
    score: float
    source_node_uuid: str
    target_node_uuid: str


@dataclass
class RetrievalTrace:
    query: str
    seed_nodes: list[RetrievedNode] = field(default_factory=list)
    facts: list[RetrievedFact] = field(default_factory=list)


@dataclass
class Citation:
    index: int
    edge_uuid: str
    fact: str
    confidence: float | None


@dataclass
class ChatResult:
    answer: str
    citations: list[Citation]
    trace: RetrievalTrace


async def retrieve(
    graphiti: Graphiti, query: str, limit: int = DEFAULT_RESULT_LIMIT
) -> RetrievalTrace:
    config = COMBINED_HYBRID_SEARCH_CROSS_ENCODER.model_copy(deep=True)
    config.limit = limit

    results = await graphiti.search_(query, config=config)

    seed_nodes = [
        RetrievedNode(uuid=node.uuid, name=node.name, type=_primary_type(node.labels), score=score)
        for node, score in zip(results.nodes, results.node_reranker_scores, strict=False)
    ]
    facts = [
        RetrievedFact(
            edge_uuid=edge.uuid,
            name=edge.name,
            fact=edge.fact,
            confidence=(edge.attributes or {}).get("confidence"),
            score=score,
            source_node_uuid=edge.source_node_uuid,
            target_node_uuid=edge.target_node_uuid,
        )
        for edge, score in zip(results.edges, results.edge_reranker_scores, strict=False)
    ]
    return RetrievalTrace(query=query, seed_nodes=seed_nodes, facts=facts)


async def ask(
    graphiti: Graphiti,
    question: str,
    *,
    api_key: str | None,
    model: str,
    limit: int = DEFAULT_RESULT_LIMIT,
) -> ChatResult:
    trace = await retrieve(graphiti, question, limit=limit)

    if not trace.facts:
        return ChatResult(
            answer="I don't have any facts in the graph relevant to that question yet.",
            citations=[],
            trace=trace,
        )

    answer = await llm.generate_chat_answer(
        question=question,
        facts=[(f.fact, f.confidence) for f in trace.facts],
        api_key=api_key,
        model=model,
    )
    citations = [
        Citation(index=i + 1, edge_uuid=f.edge_uuid, fact=f.fact, confidence=f.confidence)
        for i, f in enumerate(trace.facts)
    ]
    return ChatResult(answer=answer, citations=citations, trace=trace)
