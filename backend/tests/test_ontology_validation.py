from app.models.ontology import EntityType, PropertyDef, RelationType
from app.services.ontology_service import is_valid_property_name, validate_ontology


def test_valid_ontology_has_no_problems() -> None:
    problems = validate_ontology(
        [
            EntityType(name="Person", properties=[PropertyDef(name="job_title")]),
            EntityType(name="Company"),
        ],
        [RelationType(name="WORKS_AT", source_types=["Person"], target_types=["Company"])],
    )

    assert problems == []


def test_entity_type_names_must_be_safe_graph_labels() -> None:
    problems = validate_ontology(
        [EntityType(name="Product Line"), EntityType(name="2ndParty"), EntityType(name="")], []
    )

    assert len(problems) == 3


def test_duplicate_and_undefined_names_reported() -> None:
    problems = validate_ontology(
        [EntityType(name="Person"), EntityType(name="Person")],
        [
            RelationType(name="KNOWS", source_types=["Person"], target_types=["Person"]),
            RelationType(name="KNOWS", source_types=["Robot"], target_types=["Person"]),
        ],
    )

    assert "Duplicate entity type 'Person'" in problems
    assert "Duplicate relation type 'KNOWS'" in problems
    assert any("undefined entity type(s): Robot" in p for p in problems)


def test_property_names_must_be_pydantic_safe_and_unique() -> None:
    problems = validate_ontology(
        [
            EntityType(
                name="Person",
                properties=[
                    PropertyDef(name="_secret"),
                    PropertyDef(name="model_config"),
                    PropertyDef(name="start date"),
                    PropertyDef(name="age"),
                    PropertyDef(name="age"),
                    PropertyDef(name=""),
                ],
            )
        ],
        [],
    )

    assert len(problems) == 5


def test_reserved_graphiti_field_names_are_allowed_but_skipped_at_extraction() -> None:
    # `name` duplicates Graphiti's built-in; validation tolerates it (older
    # bootstrapped ontologies often have one) and extraction_service drops it.
    person = EntityType(name="Person", properties=[PropertyDef(name="name")])
    assert validate_ontology([person], []) == []
    assert is_valid_property_name("name")
