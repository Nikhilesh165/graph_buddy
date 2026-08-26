"""SQLite storage for app-level metadata (sources, ontology versions) --
distinct from Neo4j/Graphiti's graph, which Phase 1 doesn't touch at all (see
docs/ROADMAP.md Phase 1 vs. Phase 2). A single local file, no server, same
"no infra" spirit as the local-disk upload storage.

A module-level engine (set by `init_engine` at app startup) backs the
`get_session` FastAPI dependency, so routes can just `Depends(get_session)`
and tests can swap it out via `app.dependency_overrides[get_session]`.
"""

from collections.abc import Generator

from sqlalchemy import Engine
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


def create_db_and_tables(engine: Engine) -> None:
    # Import models so their tables are registered on SQLModel.metadata before
    # create_all runs.
    from app.models import ontology as _ontology  # noqa: F401
    from app.models import source as _source  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    if _engine is None:
        raise RuntimeError("Database engine not initialized -- call init_engine() at startup")
    with Session(_engine) as session:
        yield session
