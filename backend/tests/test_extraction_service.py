from app.core.config import Settings
from app.models.ontology import EntityType, PropertyDef, RelationType
from app.models.source import Source
from app.services.extraction_service import (
    build_edge_type_map,
    build_edge_type_models,
    build_entity_type_models,
    chunk_csv,
    chunk_prose,
    chunk_source,
    reliability_weight,
)


def test_build_entity_type_models_includes_declared_properties() -> None:
    entity_types = [
        EntityType(
            name="Person",
            description="A person",
            properties=[PropertyDef(name="age", description="their age", type="integer")],
        )
    ]

    models = build_entity_type_models(entity_types)

    assert set(models.keys()) == {"Person"}
    fields = models["Person"].model_fields
    assert "age" in fields
    assert fields["age"].annotation == int | None


def test_build_edge_type_models_always_injects_confidence() -> None:
    relation_types = [RelationType(name="KNOWS", source_types=["Person"], target_types=["Person"])]

    models = build_edge_type_models(relation_types)

    fields = models["KNOWS"].model_fields
    assert "confidence" in fields
    assert fields["confidence"].annotation is float
    instance = models["KNOWS"]()
    assert instance.confidence == 0.7  # DEFAULT_CONFIDENCE


def test_build_edge_type_models_confidence_overrides_ontology_property() -> None:
    # An ontology that (oddly) declares its own "confidence" property must not
    # be able to shadow the system-injected float field.
    relation_types = [
        RelationType(
            name="KNOWS",
            source_types=["Person"],
            target_types=["Person"],
            properties=[PropertyDef(name="confidence", description="bogus", type="string")],
        )
    ]

    models = build_edge_type_models(relation_types)

    assert models["KNOWS"].model_fields["confidence"].annotation is float


def test_build_edge_type_map_covers_every_source_target_pair() -> None:
    relation_types = [
        RelationType(
            name="WORKS_AT",
            source_types=["Person", "Contractor"],
            target_types=["Company"],
        )
    ]

    edge_map = build_edge_type_map(relation_types)

    assert edge_map[("Person", "Company")] == ["WORKS_AT"]
    assert edge_map[("Contractor", "Company")] == ["WORKS_AT"]


def test_reliability_weight_by_extension() -> None:
    assert reliability_weight("data.csv") == 1.0
    assert reliability_weight("notes.txt") == 0.85
    assert reliability_weight("report.pdf") == 0.8
    assert reliability_weight("unknown.xyz") == 0.8  # default


def test_chunk_prose_packs_paragraphs_up_to_budget() -> None:
    paragraphs = ["A" * 40, "B" * 40, "C" * 40]
    text = "\n\n".join(paragraphs)

    chunks = chunk_prose(text, max_chars=90)

    assert len(chunks) == 2
    assert "A" * 40 in chunks[0]
    assert "B" * 40 in chunks[0]
    assert "C" * 40 in chunks[1]


def test_chunk_prose_oversized_paragraph_is_its_own_chunk() -> None:
    text = "A" * 500
    assert chunk_prose(text, max_chars=100) == [text]


def test_chunk_prose_empty_text() -> None:
    assert chunk_prose("   \n\n  ", max_chars=100) == []


def test_chunk_csv_repeats_header_per_chunk() -> None:
    header = "name,age"
    rows = [f"person{i},{i}" for i in range(5)]
    text = "\n".join([header, *rows])

    chunks = chunk_csv(text, rows_per_chunk=2)

    assert len(chunks) == 3
    for chunk in chunks:
        assert chunk.startswith(header)
    assert "person0,0" in chunks[0]
    assert "person4,4" in chunks[2]


def test_chunk_csv_header_only() -> None:
    assert chunk_csv("name,age", rows_per_chunk=10) == ["name,age"]


def test_chunk_source_dispatches_by_extension() -> None:
    settings = Settings(extraction_chunk_chars=1000, extraction_chunk_rows=2)

    csv_source = Source(
        filename="data.csv",
        content_type="text/csv",
        file_path="/tmp/data.csv",
        size_bytes=1,
        parsed_text="name,age\na,1\nb,2\nc,3\n",
    )
    assert len(chunk_source(csv_source, settings)) == 2

    txt_source = Source(
        filename="note.txt",
        content_type="text/plain",
        file_path="/tmp/note.txt",
        size_bytes=1,
        parsed_text="hello world",
    )
    assert chunk_source(txt_source, settings) == ["hello world"]


def test_chunk_source_empty_parsed_text() -> None:
    settings = Settings()
    source = Source(
        filename="empty.txt",
        content_type="text/plain",
        file_path="/tmp/empty.txt",
        size_bytes=0,
        parsed_text=None,
    )
    assert chunk_source(source, settings) == []
