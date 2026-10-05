from graphiti_core.search.search_filters import SearchFilters

from app.models.chat import EntityMention, QueryPlan, TermMapping
from app.models.ontology import EntityType, RelationType
from app.services import chat_service
from tests.conftest import FakeEntityEdge, FakeEntityNode, FakeGraphiti, FakeSearchResults

ENTITIES = [EntityType(name="Person"), EntityType(name="Customer"), EntityType(name="Ticket")]
RELATIONS = [
    RelationType(name="FILED", source_types=["Customer"], target_types=["Ticket"]),
    RelationType(name="MANAGES", source_types=["Person"], target_types=["Customer"]),
    RelationType(name="KNOWS", source_types=["Person"], target_types=["Person"]),
]


def test_ground_plan_canonicalizes_and_drops_unknown_types() -> None:
    plan = QueryPlan(
        standalone_query="Which customers filed tickets?",
        entity_types=["customer", "Invoice"],
        relation_types=["filed", "PAID"],
        entity_mentions=[EntityMention(name="Acme", entity_type="customer")],
        term_mappings=[
            TermMapping(term="clients", kind="entity_type", maps_to="CUSTOMER"),
            TermMapping(term="bills", kind="entity_type", maps_to="Invoice"),
        ],
        unmapped_terms=["invoices", "ticket", "Tickets"],
    )

    resolved = chat_service.ground_plan(plan, ENTITIES, RELATIONS)

    assert resolved.plan.entity_types == ["Customer"]
    assert resolved.plan.relation_types == ["FILED"]
    assert resolved.plan.entity_mentions[0].entity_type == "Customer"
    assert [(m.term, m.maps_to) for m in resolved.plan.term_mappings] == [("clients", "Customer")]
    # "ticket"/"Tickets" name a type, so they aren't gaps even if the
    # resolver said so.
    assert resolved.plan.unmapped_terms == ["invoices"]
    # Explicit relation types win over derived ones.
    assert resolved.edge_types == ["FILED"]
    assert resolved.node_labels == ["Customer"]
    assert resolved.is_typed


def test_ground_plan_derives_relation_types_from_entity_types() -> None:
    plan = QueryPlan(standalone_query="Tell me about our customers", entity_types=["Customer"])

    resolved = chat_service.ground_plan(plan, ENTITIES, RELATIONS)

    assert resolved.edge_types == ["FILED", "MANAGES"]


def test_ground_plan_skips_labels_graphiti_would_reject() -> None:
    entities = [EntityType(name="Sales Lead")]  # hand-edited, not a safe label
    plan = QueryPlan(standalone_query="leads?", entity_types=["Sales Lead"])

    resolved = chat_service.ground_plan(plan, entities, [])

    assert resolved.plan.entity_types == ["Sales Lead"]
    assert resolved.node_labels == []
    assert not resolved.is_typed


def test_passthrough_plan_is_untyped() -> None:
    resolved = chat_service.ground_plan(QueryPlan.passthrough("hi"), ENTITIES, RELATIONS)
    assert not resolved.is_typed


async def test_retrieve_runs_typed_searches_and_puts_ontology_matches_first() -> None:
    fake_graphiti = FakeGraphiti(should_connect=True)
    typed_edge = FakeEntityEdge(uuid="typed", fact="Acme filed T-1", name="FILED")
    shared_edge = FakeEntityEdge(uuid="shared", fact="Acme filed T-2", name="FILED")
    open_edge = FakeEntityEdge(uuid="open", fact="Acme is in Ohio", name="LOCATED_IN")
    calls: list[tuple[SearchFilters | None, list[str] | None]] = []

    async def search(query, *, config, search_filter=None, bfs_origin_node_uuids=None):
        calls.append((search_filter, bfs_origin_node_uuids))
        if search_filter is None:
            return FakeSearchResults(edges=[open_edge, shared_edge])
        if search_filter.edge_types:
            return FakeSearchResults(edges=[typed_edge, shared_edge])
        return FakeSearchResults(
            nodes=[FakeEntityNode(uuid="cust", name="Acme", labels=["Entity", "Customer"])]
        )

    fake_graphiti.search_.side_effect = search
    resolved = chat_service.ground_plan(
        QueryPlan(standalone_query="What did Acme file?", entity_types=["Customer"]),
        ENTITIES,
        RELATIONS,
    )
    resolved.anchors = [
        chat_service.RetrievedNode(uuid="anchor-1", name="Acme", type="Customer", score=1.0)
    ]

    trace = await chat_service.retrieve(fake_graphiti, "What did Acme file?", resolved=resolved)

    assert [f.edge_uuid for f in trace.facts] == ["typed", "shared", "open"]
    assert [f.ontology_match for f in trace.facts] == [True, True, False]
    (open_filter, open_origins), (edge_filter, edge_origins), (node_filter, _) = calls
    assert open_filter is None
    assert edge_filter.edge_types == ["FILED", "MANAGES"]
    assert edge_filter.node_labels is None  # never node_labels on edge search
    assert node_filter.node_labels == ["Customer"]
    # Graph traversal (BFS) for both edge searches starts from the anchors.
    assert open_origins == edge_origins == ["anchor-1"]
    # Anchor first, then typed node hits.
    assert [n.uuid for n in trace.seed_nodes][:2] == ["anchor-1", "cust"]


async def test_retrieve_caps_merged_facts_at_limit() -> None:
    fake_graphiti = FakeGraphiti(should_connect=True)
    fake_graphiti.search_.return_value = FakeSearchResults(
        edges=[FakeEntityEdge(uuid=f"e{i}", fact=f"fact {i}") for i in range(5)]
    )
    resolved = chat_service.ground_plan(
        QueryPlan(standalone_query="q", relation_types=["FILED"]), ENTITIES, RELATIONS
    )

    trace = await chat_service.retrieve(fake_graphiti, "q", limit=3, resolved=resolved)

    assert len(trace.facts) == 3


async def test_find_anchors_matches_names_case_insensitively() -> None:
    fake_graphiti = FakeGraphiti(should_connect=True)
    fake_graphiti.driver.execute_query.return_value = (
        [{"uuid": "n1", "name": "Priya Nair", "labels": ["Entity", "Person"]}],
        None,
        None,
    )

    anchors = await chat_service.find_anchors(fake_graphiti, ["Priya Nair", " priya nair ", ""])

    assert [(a.uuid, a.type) for a in anchors] == [("n1", "Person")]
    _, kwargs = fake_graphiti.driver.execute_query.call_args
    assert kwargs["names"] == ["priya nair"]


async def test_find_anchors_with_no_mentions_skips_the_query() -> None:
    fake_graphiti = FakeGraphiti(should_connect=True)
    assert await chat_service.find_anchors(fake_graphiti, []) == []
    fake_graphiti.driver.execute_query.assert_not_awaited()
