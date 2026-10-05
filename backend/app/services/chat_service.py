"""Phase 4: hybrid retrieval + chat with inline citations, extended with
ontology-aware query resolution and memory. See docs/ARCHITECTURE.md §3.6
(Retrieval + retrieval trace), §4 (Chat), and docs/MEMORY_AND_DISCOVERY.md §2.

A turn (`run_turn`) now goes:

1. **Working memory** -- the conversation's recent turns + rolling summary
   (app/services/memory_service.py).
2. **Resolve** the question against the ontology (one structured LLM call,
   app/core/llm.py `resolve_query`): rewrite it to stand alone, classify
   intent, and name the ontology entity/relation types it's about. The plan
   is then *grounded* (`ground_plan`): type names the ontology doesn't have
   are dropped, and relation types are derived from the ontology when the
   question only names entity types.
3. **Anchor** named entities in the question to graph nodes (`find_anchors`).
4. **Recall** older episodes by similarity / shared entities.
5. **Retrieve** (`retrieve`): Graphiti's open hybrid search, plus -- when
   the plan is grounded in the ontology -- a typed edge search filtered to
   the plan's relation types and a typed node search filtered to its entity
   types, both seeded from the anchors. Ontology-matched facts go first.
6. **Answer** with the facts, memory, and (for broad questions) community
   summaries from periodic consolidation.

Retrieval goes through Graphiti's advanced `search_` with the
`COMBINED_HYBRID_SEARCH_CROSS_ENCODER` recipe -- bm25 + cosine similarity +
breadth-first graph traversal for both edges and nodes, reranked by a cross
encoder (graphiti_client.py already configures graphiti-core's default
OpenAIRerankerClient for this, so it needs no new external dependency beyond
the OPENAI_API_KEY already used for embeddings).

Why typed edge search filters on `edge_types` and never `node_labels`:
graphiti-core's edge filter applies `node_labels` to *both* endpoints
(`n:A|B AND m:A|B`, see graphiti_core/search/search_filters.py), so
filtering "which customers filed tickets" by [Customer] would only return
Customer-to-Customer edges. Relation types carry the question's shape
without that trap; `node_labels` is only used for the node search.

`RetrievalTrace` is deliberately a structured object (seed nodes + scored
facts + the exact context handed to the LLM, and now the resolution and
memory used), not just a flat citation list -- app/models/retrieval_trace.py
is its persisted form, read by the Retrieval Inspector.

Graphiti's hybrid search is one combined call across bm25/cosine/BFS methods
with a single reranking pass, not a stepped multi-hop traversal we control --
so "hops" per docs/ARCHITECTURE.md §3.6 isn't a distinct field this trace
can honestly populate. What we do have and record: which nodes the search
itself surfaced (`seed_nodes`, `is_seed=True`) vs. which were only pulled in
to name a fact's other endpoint (`is_seed=False`, see `_lookup_nodes`), every
retrieved fact with its confidence, rerank score and whether the typed
(ontology-filtered) search found it, and the exact formatted context string
sent to the LLM.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from graphiti_core import Graphiti
from graphiti_core.search.search_config_recipes import (
    COMBINED_HYBRID_SEARCH_CROSS_ENCODER,
    EDGE_HYBRID_SEARCH_CROSS_ENCODER,
    NODE_HYBRID_SEARCH_CROSS_ENCODER,
)
from graphiti_core.search.search_filters import SearchFilters
from sqlmodel import Session

from app.core import llm
from app.core.config import Settings
from app.models.chat import BROAD_INTENTS, QueryPlan, TermMapping
from app.models.conversation import Conversation
from app.models.ontology import EntityType, RelationType
from app.services import memory_service, ontology_service
from app.services.memory_service import MemoryContext
from app.services.ontology_changes import is_valid_type_name

logger = logging.getLogger(__name__)

DEFAULT_RESULT_LIMIT = 10
MAX_ANCHORS = 10
MAX_BACKGROUND_COMMUNITIES = 3

# Graphiti's own base label on every entity node -- see graph_service.py's
# BASE_ENTITY_LABEL for the same convention.
BASE_ENTITY_LABEL = "Entity"

NO_FACTS_ANSWER = "I don't have any facts in the graph relevant to that question yet."


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
    # True if the ontology-typed search found it (see module docstring).
    ontology_match: bool = False


@dataclass
class RetrievedCommunity:
    uuid: str
    name: str
    summary: str
    score: float


@dataclass
class ResolvedQuery:
    """A QueryPlan grounded against the current ontology, plus what
    retrieval will actually do with it."""

    plan: QueryPlan
    # Relation types the typed edge search filters on: the plan's own, or
    # (when it only named entity types) every relation touching them.
    edge_types: list[str] = field(default_factory=list)
    # Entity types the typed node search filters on.
    node_labels: list[str] = field(default_factory=list)
    anchors: list[RetrievedNode] = field(default_factory=list)
    # Set when the resolver LLM call failed and the turn fell back to
    # searching for the question verbatim.
    error: str | None = None

    @property
    def is_typed(self) -> bool:
        return bool(self.edge_types or self.node_labels)

    def to_trace(self) -> dict:
        return {
            "plan": self.plan.model_dump(),
            "edge_types": self.edge_types,
            "node_labels": self.node_labels,
            "anchors": [{"uuid": a.uuid, "name": a.name, "type": a.type} for a in self.anchors],
            "error": self.error,
        }


@dataclass
class RetrievalTrace:
    query: str
    seed_nodes: list[RetrievedNode] = field(default_factory=list)
    facts: list[RetrievedFact] = field(default_factory=list)
    communities: list[RetrievedCommunity] = field(default_factory=list)
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
    # Community summaries actually handed to the answer as background.
    background: list[RetrievedCommunity] = field(default_factory=list)


@dataclass
class TurnResult:
    chat: ChatResult
    resolved: ResolvedQuery
    memory: MemoryContext
    embedding: list[float] | None


# --- Resolution ---


def ground_plan(
    plan: QueryPlan, entity_types: list[EntityType], relation_types: list[RelationType]
) -> ResolvedQuery:
    """Keep only ontology type names the ontology actually has (spelled
    canonically), and work out what the typed searches filter on. The LLM
    is told to use exact names, but nothing downstream should trust that."""
    entities = {et.name.lower(): et.name for et in entity_types}
    relations = {rt.name.lower(): rt for rt in relation_types}

    def canonical_entity(name: str | None) -> str | None:
        return entities.get(name.strip().lower()) if name else None

    def canonical_relation(name: str) -> str | None:
        relation = relations.get(name.strip().lower())
        return relation.name if relation else None

    plan_entity_types = list(
        dict.fromkeys(n for n in map(canonical_entity, plan.entity_types) if n)
    )
    plan_relation_types = list(
        dict.fromkeys(n for n in map(canonical_relation, plan.relation_types) if n)
    )
    mentions = [
        m.model_copy(update={"entity_type": canonical_entity(m.entity_type)})
        for m in plan.entity_mentions
    ]
    term_mappings = []
    for mapping in plan.term_mappings:
        target = (
            canonical_entity(mapping.maps_to)
            if mapping.kind == "entity_type"
            else canonical_relation(mapping.maps_to)
        )
        if target:
            term_mappings.append(TermMapping(term=mapping.term, kind=mapping.kind, maps_to=target))
    # A term the resolver couldn't map but that *is* a type name (modulo
    # case) isn't a gap.
    unmapped = [
        t
        for t in plan.unmapped_terms
        if t.strip() and t.strip().lower() not in entities and t.strip().lower() not in relations
    ]

    grounded = plan.model_copy(
        update={
            "entity_types": plan_entity_types,
            "relation_types": plan_relation_types,
            "entity_mentions": mentions,
            "term_mappings": term_mappings,
            "unmapped_terms": unmapped,
        }
    )

    if plan_relation_types:
        edge_types = plan_relation_types
    else:
        wanted = set(plan_entity_types)
        edge_types = [
            rt.name
            for rt in relation_types
            if wanted & (set(rt.source_types) | set(rt.target_types))
        ]
    return ResolvedQuery(
        plan=grounded,
        # Hand-edited ontologies aren't name-validated, and graphiti-core
        # rejects unsafe labels outright -- only filter on ones it accepts.
        edge_types=[n for n in edge_types if is_valid_type_name(n)],
        node_labels=[n for n in plan_entity_types if is_valid_type_name(n)],
    )


async def find_anchors(graphiti: Graphiti, names: list[str]) -> list[RetrievedNode]:
    """Graph nodes whose name matches an entity the question mentions
    (case-insensitive exact match) -- the seeds typed retrieval traverses
    out from."""
    wanted = list(dict.fromkeys(n.strip().lower() for n in names if n.strip()))
    if not wanted:
        return []
    query = """
        UNWIND $names AS wanted
        MATCH (n:Entity)
        WHERE toLower(n.name) = wanted
        RETURN DISTINCT n.uuid AS uuid, n.name AS name, labels(n) AS labels
        LIMIT $limit
    """
    records, _, _ = await graphiti.driver.execute_query(
        query, names=wanted, limit=MAX_ANCHORS, routing_="r"
    )
    return [
        RetrievedNode(
            uuid=row["uuid"],
            name=row["name"],
            type=_primary_type(row.get("labels")),
            score=1.0,
        )
        for row in (dict(r) for r in records)
    ]


# --- Retrieval ---


async def _lookup_nodes(graphiti: Graphiti, uuids: list[str]) -> list[RetrievedNode]:
    """Backfill name/type for node uuids the trace needs (a fact's endpoint)
    but that the entity search didn't itself return. Talks to Neo4j directly
    via `graphiti.driver.execute_query` -- the same low-level entry point
    graph_service.py uses (see that module's docstring) -- rather
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


def _facts_from(results, *, ontology_match: bool) -> list[RetrievedFact]:
    return [
        RetrievedFact(
            edge_uuid=edge.uuid,
            name=edge.name,
            fact=edge.fact,
            confidence=(edge.attributes or {}).get("confidence"),
            score=score,
            source_node_uuid=edge.source_node_uuid,
            target_node_uuid=edge.target_node_uuid,
            ontology_match=ontology_match,
        )
        for edge, score in zip(results.edges, results.edge_reranker_scores, strict=False)
    ]


def _nodes_from(results) -> list[RetrievedNode]:
    return [
        RetrievedNode(uuid=node.uuid, name=node.name, type=_primary_type(node.labels), score=score)
        for node, score in zip(results.nodes, results.node_reranker_scores, strict=False)
    ]


async def retrieve(
    graphiti: Graphiti,
    query: str,
    limit: int = DEFAULT_RESULT_LIMIT,
    *,
    resolved: ResolvedQuery | None = None,
) -> RetrievalTrace:
    anchors = resolved.anchors if resolved else []
    origins = [a.uuid for a in anchors] or None

    open_config = COMBINED_HYBRID_SEARCH_CROSS_ENCODER.model_copy(deep=True)
    open_config.limit = limit
    open_results = await graphiti.search_(query, config=open_config, bfs_origin_node_uuids=origins)

    typed_facts: list[RetrievedFact] = []
    typed_nodes: list[RetrievedNode] = []
    if resolved and resolved.edge_types:
        edge_config = EDGE_HYBRID_SEARCH_CROSS_ENCODER.model_copy(deep=True)
        edge_config.limit = limit
        typed_facts = _facts_from(
            await graphiti.search_(
                query,
                config=edge_config,
                search_filter=SearchFilters(edge_types=resolved.edge_types),
                bfs_origin_node_uuids=origins,
            ),
            ontology_match=True,
        )
    if resolved and resolved.node_labels:
        node_config = NODE_HYBRID_SEARCH_CROSS_ENCODER.model_copy(deep=True)
        node_config.limit = limit
        typed_nodes = _nodes_from(
            await graphiti.search_(
                query,
                config=node_config,
                search_filter=SearchFilters(node_labels=resolved.node_labels),
            )
        )

    # Ontology-matched results first (the question is *about* those types),
    # then the open search fills the rest -- an explainable ordering the
    # Inspector can show, rather than blending two rerank passes' scores.
    facts: list[RetrievedFact] = []
    seen_edges: set[str] = set()
    for fact in [*typed_facts, *_facts_from(open_results, ontology_match=False)]:
        if fact.edge_uuid not in seen_edges and len(facts) < limit:
            seen_edges.add(fact.edge_uuid)
            facts.append(fact)

    seed_nodes: list[RetrievedNode] = []
    seen_nodes: set[str] = set()
    for node in [*anchors, *typed_nodes, *_nodes_from(open_results)]:
        if node.uuid not in seen_nodes:
            seen_nodes.add(node.uuid)
            seed_nodes.append(node)

    communities = [
        RetrievedCommunity(uuid=c.uuid, name=c.name, summary=c.summary, score=score)
        for c, score in zip(
            getattr(open_results, "communities", []),
            getattr(open_results, "community_reranker_scores", []),
            strict=False,
        )
    ]

    # Entity search and edge search are independent hybrid queries -- a
    # fact's source/target isn't guaranteed to already be in seed_nodes.
    endpoint_uuids = {uuid for f in facts for uuid in (f.source_node_uuid, f.target_node_uuid)}
    missing_uuids = sorted(u for u in endpoint_uuids if u and u not in seen_nodes)
    seed_nodes += await _lookup_nodes(graphiti, missing_uuids)

    return RetrievalTrace(query=query, seed_nodes=seed_nodes, facts=facts, communities=communities)


# --- Answering ---


def format_background(communities: list[RetrievedCommunity]) -> str:
    return "\n".join(f"- {c.name}: {c.summary}" for c in communities if c.summary)


async def ask(
    graphiti: Graphiti,
    question: str,
    *,
    api_key: str | None,
    model: str,
    limit: int = DEFAULT_RESULT_LIMIT,
    resolved: ResolvedQuery | None = None,
    memory: MemoryContext | None = None,
) -> ChatResult:
    query = resolved.plan.standalone_query.strip() if resolved else ""
    trace = await retrieve(graphiti, query or question, limit=limit, resolved=resolved)

    if not trace.facts:
        return ChatResult(answer=NO_FACTS_ANSWER, citations=[], trace=trace)

    background: list[RetrievedCommunity] = []
    if resolved and resolved.plan.intent in BROAD_INTENTS:
        background = [c for c in trace.communities if c.summary][:MAX_BACKGROUND_COMMUNITIES]

    question_text = question
    if query and query != question.strip():
        question_text = f"{question}\n(Resolved, in context, to: {query})"

    trace.final_context = llm.format_facts([(f.fact, f.confidence) for f in trace.facts])
    answer = await llm.generate_chat_answer(
        question=question_text,
        facts_context=trace.final_context,
        api_key=api_key,
        model=model,
        memory_context=memory.answer_block() if memory else "",
        background_context=format_background(background),
    )
    citations = [
        Citation(index=i + 1, edge_uuid=f.edge_uuid, fact=f.fact, confidence=f.confidence)
        for i, f in enumerate(trace.facts)
    ]
    return ChatResult(answer=answer, citations=citations, trace=trace, background=background)


async def _embed(graphiti: Graphiti, text: str) -> list[float] | None:
    try:
        return list(await graphiti.embedder.create(input_data=[text]))
    except Exception as exc:  # noqa: BLE001 - recall is an enhancement; never fail a turn on it
        logger.warning("Embedding for episodic memory failed: %s", exc)
        return None


async def run_turn(
    session: Session,
    graphiti: Graphiti,
    *,
    conversation: Conversation,
    question: str,
    settings: Settings,
) -> TurnResult:
    """One chat turn end to end -- see the module docstring for the steps.
    Persisting the turn is the caller's job (app/api/routes/chat.py)."""
    ontology = ontology_service.get_latest_version(session)
    entity_types = ontology.entity_types_typed() if ontology else []
    relation_types = ontology.relation_types_typed() if ontology else []

    memory = memory_service.working_memory(session, conversation, settings.memory_working_turns)
    memory.vocabulary = memory_service.vocabulary(session, settings.memory_vocabulary_limit)

    plan = QueryPlan.passthrough(question)
    resolution_error: str | None = None
    if settings.query_resolution_enabled:
        try:
            plan = await llm.resolve_query(
                question=question,
                ontology=llm.ontology_outline(entity_types, relation_types),
                vocabulary=memory.vocabulary_block(),
                memory=memory.resolver_block(),
                api_key=settings.openai_api_key,
                model=settings.openai_model,
            )
        except Exception as exc:  # noqa: BLE001 - degrade to verbatim search
            logger.warning("Query resolution failed for %r: %s", question, exc)
            resolution_error = str(exc)
    if not plan.standalone_query.strip():
        plan = plan.model_copy(update={"standalone_query": question})

    resolved = ground_plan(plan, entity_types, relation_types)
    resolved.error = resolution_error
    resolved.anchors = await find_anchors(graphiti, [m.name for m in plan.entity_mentions])

    embedding = await _embed(graphiti, resolved.plan.standalone_query)
    memory.recalled = memory_service.recall(
        session,
        query_embedding=embedding,
        anchor_uuids=[a.uuid for a in resolved.anchors],
        exclude_turn_ids={t.turn_id for t in memory.working},
        k=settings.memory_recall_k,
        min_score=settings.memory_recall_min_score,
    )

    chat = await ask(
        graphiti,
        question,
        api_key=settings.openai_api_key,
        model=settings.openai_model,
        limit=settings.chat_result_limit,
        resolved=resolved,
        memory=memory,
    )
    return TurnResult(chat=chat, resolved=resolved, memory=memory, embedding=embedding)
