"""Application settings, loaded from a single root-level .env file.

The .env lives at the repo root (sibling to /backend and /frontend) rather than
inside /backend, since docker-compose (Neo4j credentials) and the frontend
(VITE_API_BASE_URL) conceptually share the same environment file layout. We
resolve its path explicitly so `uv run uvicorn ...` works the same whether
it's invoked from the repo root or from /backend.
"""

from functools import lru_cache
from pathlib import Path

from graphiti_core.llm_client.openai_base_client import (
    DEFAULT_MODEL as GRAPHITI_DEFAULT_OPENAI_MODEL,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py -> repo root is three parents up, backend/ is two.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_ROOT.parent
_ENV_FILE = _REPO_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    app_env: str = "development"

    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "changeme"

    # OpenAI serves both inference (extraction, ontology proposals, chat) and
    # embeddings -- see ARCHITECTURE.md §5. Model defaults are pulled from
    # graphiti-core's own maintained constant rather than hardcoded here, so
    # they stay current with whatever the installed library version ships.
    openai_api_key: str | None = None
    openai_model: str = GRAPHITI_DEFAULT_OPENAI_MODEL

    cors_origins: list[str] = ["http://localhost:5173"]

    # --- Phase 1: sources + ontology ---
    sqlite_path: Path = _BACKEND_ROOT / "data" / "graph_buddy.db"
    uploads_dir: Path = _BACKEND_ROOT / "data" / "uploads"
    max_upload_mb: int = 25
    openai_ontology_model: str = GRAPHITI_DEFAULT_OPENAI_MODEL
    ontology_bootstrap_sample_chars: int = 8000

    # --- Phase 2: extraction ---
    extraction_chunk_chars: int = 3000  # prose (paragraph-packed)
    extraction_chunk_rows: int = 50  # CSV (header repeated per chunk)


@lru_cache
def get_settings() -> Settings:
    return Settings()
