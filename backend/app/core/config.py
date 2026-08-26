"""Application settings, loaded from a single root-level .env file.

The .env lives at the repo root (sibling to /backend and /frontend) rather than
inside /backend, since docker-compose (Neo4j credentials) and the frontend
(VITE_API_BASE_URL) conceptually share the same environment file layout. We
resolve its path explicitly so `uv run uvicorn ...` works the same whether
it's invoked from the repo root or from /backend.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py -> repo root is three parents up.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_ENV_FILE = _REPO_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    app_env: str = "development"

    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "changeme"

    anthropic_api_key: str | None = None
    anthropic_model: str | None = None  # None -> graphiti-core's own default

    openai_api_key: str | None = None

    cors_origins: list[str] = ["http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
