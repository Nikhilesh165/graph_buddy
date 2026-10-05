"""Application settings, loaded from a single root-level .env file.

The .env lives at the repo root (sibling to /backend and /frontend) rather than
inside /backend, since docker-compose (Neo4j credentials) and the frontend
(VITE_API_BASE_URL) conceptually share the same environment file layout. We
resolve its path explicitly so `uv run uvicorn ...` works the same whether
it's invoked from the repo root or from /backend.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

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

    # --- Memory + AI-driven discovery (docs/MEMORY_AND_DISCOVERY.md) ---
    # How much the discovery cycle may change the ontology without asking:
    #   manual     -- queue every change for review in the Discovery Feed
    #   assisted   -- auto-apply refinements of existing types (new property,
    #                 extra relation endpoints, better description)
    #   autonomous -- also auto-apply new entity/relation types
    # Renames and removals are never auto-applied at any level.
    ontology_autonomy: Literal["manual", "assisted", "autonomous"] = "autonomous"
    # Run the discovery pass in the background after every successful upload
    # (bootstrap when there's no ontology yet, evolve it otherwise).
    auto_discover_on_upload: bool = True
    # Then extract the source into the graph under the updated ontology.
    # Off by default: extraction is one LLM call per chunk, and a large file
    # shouldn't start spending on upload without an explicit opt-in.
    auto_extract_on_upload: bool = False

    # Chat: resolve each question against the ontology + memory before
    # retrieval (one extra structured LLM call per question).
    query_resolution_enabled: bool = True
    chat_result_limit: int = 10
    # Working memory: how many recent turns of the same conversation the
    # resolver and the answer see verbatim.
    memory_working_turns: int = 6
    # Episodic recall: older turns (any conversation) pulled back in by
    # embedding similarity / shared graph entities.
    memory_recall_k: int = 3
    memory_recall_min_score: float = 0.35
    # Learned vocabulary entries ("accounts" -> Customer) shown to the resolver.
    memory_vocabulary_limit: int = 40

    # Periodic consolidation cycle; 0 disables the background schedule (the
    # manual POST /memory/consolidate trigger still works).
    consolidation_interval_minutes: int = 360
    # A conversation's rolling summary is refreshed once it has at least this
    # many turns not yet folded into it.
    consolidation_summary_min_new_turns: int = 4
    # Rebuild Graphiti community summaries when new episodes arrived since
    # the last cycle -- one LLM call per community, so it can be turned off.
    consolidation_build_communities: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
