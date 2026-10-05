"""SQLite storage for app-level metadata (sources, ontology versions) --
distinct from Neo4j/Graphiti's graph, which Phase 1 doesn't touch at all (see
docs/ROADMAP.md Phase 1 vs. Phase 2). A single local file, no server, same
"no infra" spirit as the local-disk upload storage.

A module-level engine (set by `init_engine` at app startup) backs the
`get_session` FastAPI dependency, so routes can just `Depends(get_session)`
and tests can swap it out via `app.dependency_overrides[get_session]`.

Schema evolution: there's no Alembic here, and `SQLModel.metadata.create_all`
only creates *missing tables* -- it never adds a column to a table that
already exists. `_add_missing_columns` covers the one kind of change this
app makes in practice (a new nullable/defaulted column on an existing table,
e.g. ChatTurn.conversation_id for the memory work in
docs/MEMORY_AND_DISCOVERY.md), so a developer's existing
`backend/data/graph_buddy.db` keeps working after a pull instead of failing
with "no such column". Anything beyond additive columns (renames, type
changes, drops) is out of scope for this helper and would warrant a real
migration tool.
"""

from collections.abc import Generator, Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, inspect, literal, text
from sqlalchemy.sql.schema import ScalarElementColumnDefault
from sqlmodel import Session, SQLModel, create_engine

from app.core.config import Settings

_engine: Engine | None = None


def init_engine(settings: Settings) -> Engine:
    global _engine
    settings.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    _engine = create_engine(
        f"sqlite:///{settings.sqlite_path}",
        connect_args={"check_same_thread": False},
    )
    return _engine


def _add_missing_columns(engine: Engine) -> list[str]:
    """ALTER TABLE ... ADD COLUMN for every model column the on-disk table
    lacks. Added columns are always nullable (SQLite can't add a NOT NULL
    column without a default), and carry the model's scalar default as a SQL
    DEFAULT so pre-existing rows read back a sensible value (e.g. a new
    `status` column defaulting to "not_run") instead of NULL. Returns the
    "table.column" names it added, for logging/tests.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    added: list[str] = []
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # create_all handles whole new tables
            existing_columns = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" '
                ddl += column.type.compile(dialect=engine.dialect)
                if isinstance(column.default, ScalarElementColumnDefault):
                    default_sql = literal(column.default.arg).compile(
                        dialect=engine.dialect, compile_kwargs={"literal_binds": True}
                    )
                    ddl += f" DEFAULT {default_sql}"
                conn.execute(text(ddl))
                added.append(f"{table.name}.{column.name}")
            # create_all only builds indexes alongside a brand-new table, so
            # an index on a column added above would otherwise never exist.
            for index in table.indexes:
                index.create(conn, checkfirst=True)
    return added


def create_db_and_tables(engine: Engine) -> None:
    # Import models so their tables are registered on SQLModel.metadata before
    # create_all runs.
    from app.models import chat as _chat  # noqa: F401
    from app.models import conversation as _conversation  # noqa: F401
    from app.models import discovery as _discovery  # noqa: F401
    from app.models import episode as _episode  # noqa: F401
    from app.models import memory as _memory  # noqa: F401
    from app.models import ontology as _ontology  # noqa: F401
    from app.models import retrieval_trace as _retrieval_trace  # noqa: F401
    from app.models import source as _source  # noqa: F401

    _add_missing_columns(engine)
    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    if _engine is None:
        raise RuntimeError("Database engine not initialized -- call init_engine() at startup")
    with Session(_engine) as session:
        yield session


@contextmanager
def session_scope() -> Iterator[Session]:
    """A fresh Session outside of FastAPI's request-scoped `get_session` --
    for background work (post-upload discovery, the periodic consolidation
    loop) that outlives the request that triggered it, by which point the
    request's own session has already been closed.
    """
    if _engine is None:
        raise RuntimeError("Database engine not initialized -- call init_engine() at startup")
    with Session(_engine) as session:
        yield session
