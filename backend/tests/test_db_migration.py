from pathlib import Path

from sqlalchemy import inspect, text

from app.core.config import get_settings
from app.core.db import create_db_and_tables, init_engine


def test_existing_db_gets_new_columns_with_defaults(tmp_path: Path) -> None:
    """A database created before the memory/discovery columns existed keeps
    working: missing columns are added, and scalar defaults backfill old rows."""
    settings = get_settings()
    engine = init_engine(settings)
    with engine.begin() as conn:
        # The pre-memory shape of the `source` table (Phase 2).
        conn.execute(
            text(
                """
                CREATE TABLE source (
                    id VARCHAR PRIMARY KEY, filename VARCHAR NOT NULL,
                    content_type VARCHAR NOT NULL, file_path VARCHAR NOT NULL,
                    size_bytes INTEGER NOT NULL, status VARCHAR NOT NULL,
                    parse_error VARCHAR, parsed_text VARCHAR, char_count INTEGER NOT NULL,
                    row_count INTEGER, created_at DATETIME NOT NULL,
                    graphiti_status VARCHAR NOT NULL, graphiti_error VARCHAR,
                    episode_count INTEGER NOT NULL, node_count INTEGER NOT NULL,
                    edge_count INTEGER NOT NULL, extracted_at DATETIME
                )
                """
            )
        )
        conn.execute(
            text(
                "INSERT INTO source VALUES ('s1', 'a.txt', 'text/plain', '/tmp/a', 1, "
                "'parsed', NULL, 'hi', 2, NULL, '2026-01-01', 'extracted', NULL, 1, 1, 1, NULL)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE chatturn (id VARCHAR PRIMARY KEY, question VARCHAR NOT NULL, "
                "answer VARCHAR NOT NULL, citations JSON, retrieved_count INTEGER NOT NULL, "
                "created_at DATETIME NOT NULL)"
            )
        )

    create_db_and_tables(engine)

    inspector = inspect(engine)
    source_columns = {c["name"] for c in inspector.get_columns("source")}
    assert {"discovery_status", "discovery_error", "extracted_ontology_version"} <= source_columns
    chat_columns = {c["name"] for c in inspector.get_columns("chatturn")}
    assert {"conversation_id", "query_plan", "entity_uuids", "embedding"} <= chat_columns
    assert any(
        idx["column_names"] == ["conversation_id"] for idx in inspector.get_indexes("chatturn")
    )
    # Brand-new tables are created as usual.
    assert "conversation" in inspector.get_table_names()

    with engine.connect() as conn:
        status = conn.execute(text("SELECT discovery_status FROM source WHERE id='s1'")).scalar()
    assert status == "not_run"

    # Idempotent: a second boot adds nothing and doesn't fail.
    create_db_and_tables(engine)
