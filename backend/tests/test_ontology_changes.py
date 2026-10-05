from app.models.discovery import OntologyChange
from app.models.ontology import EntityType, OntologyProposal, PropertyDef, RelationType
from app.services import ontology_changes as oc


def _base() -> tuple[list[EntityType], list[RelationType]]:
    return (
        [
            EntityType(name="Person", description="A person"),
            EntityType(name="Project", description="A project"),
        ],
        [RelationType(name="WORKS_ON", source_types=["Person"], target_types=["Project"])],
    )


def test_add_entity_and_relation_in_one_batch_regardless_of_order() -> None:
    entities, relations = _base()
    changes = [
        # Relation listed first but references the type added after it --
        # phase ordering applies entity adds first.
        OntologyChange(
            op="add_relation_type",
            target="BUYS",
            relation_type=RelationType(
                name="BUYS", source_types=["customer"], target_types=["Project"]
            ),
        ),
        OntologyChange(op="add_entity_type", target="Customer"),
    ]

    result = oc.apply_changes(entities, relations, changes)

    assert result.skipped == []
    assert [et.name for et in result.entity_types] == ["Person", "Project", "Customer"]
    buys = next(rt for rt in result.relation_types if rt.name == "BUYS")
    # Endpoint names are resolved case-insensitively to the canonical spelling.
    assert buys.source_types == ["Customer"]


def test_duplicate_and_invalid_names_are_skipped_not_raised() -> None:
    entities, relations = _base()
    changes = [
        OntologyChange(op="add_entity_type", target="person"),  # case-insensitive clash
        OntologyChange(op="add_entity_type", target="Bad Name"),
        OntologyChange(op="add_entity_type", target="Entity"),  # Graphiti-reserved
        OntologyChange(op="add_entity_type", target="Team"),
    ]

    result = oc.apply_changes(entities, relations, changes)

    assert [c.target for c in result.applied] == ["Team"]
    reasons = {s.change.target: s.reason for s in result.skipped}
    assert "already exists" in reasons["person"]
    assert "valid" in reasons["Bad Name"]
    assert "valid" in reasons["Entity"]


def test_inputs_are_not_mutated() -> None:
    entities, relations = _base()
    oc.apply_changes(
        entities,
        relations,
        [
            OntologyChange(
                op="add_entity_property",
                target="Person",
                property_def=PropertyDef(name="email"),
            )
        ],
    )
    assert entities[0].properties == []


def test_property_add_normalizes_type_and_rejects_duplicates_and_system_fields() -> None:
    entities, relations = _base()
    changes = [
        OntologyChange(
            op="add_entity_property",
            target="Project",
            property_def=PropertyDef(name="budget", type="Decimal"),
        ),
        OntologyChange(
            op="add_entity_property",
            target="Project",
            property_def=PropertyDef(name="Budget"),
        ),
        OntologyChange(
            op="add_relation_property",
            target="WORKS_ON",
            property_def=PropertyDef(name="confidence", type="number"),
        ),
        OntologyChange(
            op="add_relation_property",
            target="works_on",
            property_def=PropertyDef(name="role"),
        ),
    ]

    result = oc.apply_changes(entities, relations, changes)

    project = next(et for et in result.entity_types if et.name == "Project")
    assert [(p.name, p.type) for p in project.properties] == [("budget", "string")]
    assert [p.name for p in result.relation_types[0].properties] == ["role"]
    assert len(result.skipped) == 2


def test_relation_with_unknown_endpoints_is_skipped() -> None:
    entities, relations = _base()
    result = oc.apply_changes(
        entities,
        relations,
        [
            OntologyChange(
                op="add_relation_type",
                target="OWNS",
                source_types=["Person"],
                target_types=["Vehicle"],
            )
        ],
    )
    assert result.applied == []
    assert "no known" in result.skipped[0].reason


def test_extend_endpoints_and_update_description() -> None:
    entities, relations = _base()
    changes = [
        OntologyChange(op="add_entity_type", target="Contractor"),
        OntologyChange(
            op="extend_relation_endpoints", target="WORKS_ON", source_types=["Contractor"]
        ),
        OntologyChange(op="update_description", target="Project", description="An initiative"),
    ]

    result = oc.apply_changes(entities, relations, changes)

    assert result.skipped == []
    assert result.relation_types[0].source_types == ["Person", "Contractor"]
    project = next(et for et in result.entity_types if et.name == "Project")
    assert project.description == "An initiative"


def test_rename_entity_updates_relation_endpoints() -> None:
    entities, relations = _base()
    result = oc.apply_changes(
        entities,
        relations,
        [OntologyChange(op="rename_entity_type", target="Person", new_name="Employee")],
    )
    assert [et.name for et in result.entity_types] == ["Employee", "Project"]
    assert result.relation_types[0].source_types == ["Employee"]


def test_remove_entity_drops_relations_left_without_endpoints() -> None:
    entities, relations = _base()
    result = oc.apply_changes(
        entities, relations, [OntologyChange(op="remove_entity_type", target="Project")]
    )
    assert [et.name for et in result.entity_types] == ["Person"]
    assert result.relation_types == []


def test_partition_by_policy() -> None:
    low = OntologyChange(
        op="add_entity_property", target="Person", property_def=PropertyDef(name="x")
    )
    medium = OntologyChange(op="add_entity_type", target="Team")
    high = OntologyChange(op="remove_entity_type", target="Person")
    changes = [low, medium, high]

    assert oc.partition_by_policy(changes, "manual") == ([], changes)
    assert oc.partition_by_policy(changes, "assisted") == ([low], [medium, high])
    assert oc.partition_by_policy(changes, "autonomous") == ([low, medium], [high])
    assert oc.max_risk(changes) == "high"
    assert oc.max_risk([]) == "low"


def test_changes_from_bootstrap_round_trips_through_apply() -> None:
    proposal = OntologyProposal(
        entity_types=[EntityType(name="Person"), EntityType(name="Company")],
        relation_types=[
            RelationType(name="WORKS_AT", source_types=["Person"], target_types=["Company"])
        ],
    )

    result = oc.apply_changes([], [], oc.changes_from_bootstrap(proposal))

    assert result.skipped == []
    assert result.entity_types == proposal.entity_types
    assert result.relation_types == proposal.relation_types


def test_describe_change_is_plain_language() -> None:
    change = OntologyChange(
        op="add_relation_type",
        target="WORKS_AT",
        relation_type=RelationType(
            name="WORKS_AT", source_types=["Person"], target_types=["Company"]
        ),
    )
    assert oc.describe_change(change) == "Add relation WORKS_AT (Person → Company)"


def test_refers_to_type_ignores_case_plural_and_name_formatting() -> None:
    assert oc.refers_to_type("contracts", ["Contract"])
    assert oc.refers_to_type("purchase orders", ["PurchaseOrder"])
    assert oc.refers_to_type("companies", ["Company"])
    assert oc.refers_to_type("addresses", ["Address"])
    assert oc.refers_to_type("works at", ["WORKS_AT"])
    # Real synonyms and unrelated terms are not the type's own name.
    assert not oc.refers_to_type("clients", ["Customer"])
    assert not oc.refers_to_type("invoices", ["Contract", "Customer"])
