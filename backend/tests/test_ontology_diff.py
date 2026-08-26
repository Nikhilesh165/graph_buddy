from app.models.ontology import EntityType, OntologyVersion, RelationType
from app.services.ontology_service import compute_diff


def _version(entity_types: list[EntityType], relation_types: list[RelationType]) -> OntologyVersion:
    return OntologyVersion(
        version_number=1,
        entity_types=[et.model_dump() for et in entity_types],
        relation_types=[rt.model_dump() for rt in relation_types],
        created_by="bootstrap",
    )


def test_diff_against_no_previous_version_marks_everything_added() -> None:
    diff = compute_diff(
        None,
        [EntityType(name="Person"), EntityType(name="Company")],
        [RelationType(name="WORKS_AT", source_types=["Person"], target_types=["Company"])],
    )

    assert diff.added_entity_types == ["Company", "Person"]
    assert diff.added_relation_types == ["WORKS_AT"]
    assert diff.removed_entity_types == []
    assert diff.modified_entity_types == []
    assert not diff.is_empty


def test_diff_detects_no_change() -> None:
    entity_types = [EntityType(name="Person", description="A person")]
    relation_types = [RelationType(name="KNOWS", source_types=["Person"], target_types=["Person"])]
    old = _version(entity_types, relation_types)

    diff = compute_diff(old, entity_types, relation_types)

    assert diff.is_empty


def test_diff_detects_removed_entity_type() -> None:
    old = _version([EntityType(name="Person"), EntityType(name="Company")], [])

    diff = compute_diff(old, [EntityType(name="Person")], [])

    assert diff.removed_entity_types == ["Company"]
    assert diff.added_entity_types == []
    assert diff.modified_entity_types == []


def test_diff_detects_modified_entity_type() -> None:
    old = _version([EntityType(name="Person", description="old description")], [])

    diff = compute_diff(old, [EntityType(name="Person", description="new description")], [])

    assert diff.modified_entity_types == ["Person"]
    assert diff.added_entity_types == []
    assert diff.removed_entity_types == []


def test_diff_detects_added_and_removed_relation_types() -> None:
    old = _version(
        [EntityType(name="Person")],
        [RelationType(name="KNOWS", source_types=["Person"], target_types=["Person"])],
    )

    diff = compute_diff(
        old,
        [EntityType(name="Person")],
        [RelationType(name="MANAGES", source_types=["Person"], target_types=["Person"])],
    )

    assert diff.added_relation_types == ["MANAGES"]
    assert diff.removed_relation_types == ["KNOWS"]
