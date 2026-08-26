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
facts + the exact context handed to the LLM), not just a flat citation list.
docs/ROADMAP.md's sequencing notes call this out explicitly: "Phase 5
(retrieval inspector) depends on Phase 4's trace object existing; don't
start the inspector UI before the trace schema is settled, or it'll get
rebuilt." app/models/retrieval_trace.py is this object's persisted form
(Phase 5); this module only builds it.

Graphiti's hybrid search is one combined call across bm25/cosine/BFS methods
with a single reranking pass, not a stepped multi-hop traversal we control --
so "hops" per docs/ARCHITECTURE.md §3.6 isn't a distinct field this trace
can honestly populate. What we do have and record: which nodes the search
itself surfaced (`seed_nodes`, `is_seed=True`) vs. which were only pulled in
to name a fact's other endpoint (`is_seed=False`, see `_lookup_nodes`), every
retrieved fact with its confidence and rerank score, and the exact formatted
context string sent to the LLM.
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
    # True if the hybrid search itself surfaced this node; False if it was
    # only backfilled to name a fact's source/target (see _lookup_nodes) --
    # the Retrieval Inspector distinguishes "why this node" from "just
    # context" using this flag.
    is_seed: bool = True


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
    # The exact facts block handed to the LLM (app.core.llm.format_facts'
    # output) -- populated by `ask`; empty for a bare `retrieve()` call,
    # which has no answer to build context for.
    final_context: str = ""


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


async def _lookup_nodes(graphiti: Graphiti, uuids: list[str]) -> list[RetrievedNode]:
    """Backfill name/type for node uuids the trace needs (a fact's endpoint)
    but that the entity search didn't itself return. Talks to Neo4j directly
    via `graphiti.driver.execute_query` -- the same low-level entry point
    graph_service.py uses (see that module's docstring for why) -- rather
    than `graphiti_core.nodes.EntityNode.get_by_uuids`, so this only needs
    the `execute_query` double our tests already stand up.
    """
    if not uuids:
        return []
    query = """
        MATCH (n:Entity)
        WHERE n.uuid IN $uuids
        RETURN n.uuid AS uuid, n.name AS name, labels(n) AS labels
    """
    records, _, _ = await graphiti.driver.execute_query(query, uuids=uuids, routing_="r")
    return [
        RetrievedNode(
            uuid=row["uuid"],
            name=row["name"],
            type=_primary_type(row.get("labels")),
            score=0.0,
            is_seed=False,
        )
        for row in (dict(r) for r in records)
    ]


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

    # Entity search and edge search are independent hybrid queries -- a
    # fact's source/target isn't guaranteed to already be in seed_nodes.
    known_uuids = {n.uuid for n in seed_nodes}
    endpoint_uuids = {uuid for f in facts for uuid in (f.source_node_uuid, f.target_node_uuid)}
    missing_uuids = sorted(u for u in endpoint_uuids if u and u not in known_uuids)
    seed_nodes += await _lookup_nodes(graphiti, missing_uuids)

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

    trace.final_context = llm.format_facts([(f.fact, f.confidence) for f in trace.facts])
    answer = await llm.generate_chat_answer(
        question=question,
        facts_context=trace.final_context,
        api_key=api_key,
        model=model,
    )
    citations = [
        Citation(index=i + 1, edge_uuid=f.edge_uuid, fact=f.fact, confidence=f.confidence)
        for i, f in enumerate(trace.facts)
    ]
    return ChatResult(answer=answer, citations=citations, trace=trace)
