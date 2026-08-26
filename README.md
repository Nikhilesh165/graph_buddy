# Graph Buddy

An application that builds a **knowledge graph + ontology layer** from your uploaded data (and, later, connected data warehouses), backed by an **episodic/semantic memory system** with a background **data discovery cycle** that learns from your conversations — with a UI to **visualize the graph** and **inspect the retrieval process** behind every answer.

This repo is at the planning stage. See [`docs/VISION.md`](docs/VISION.md) for why this is worth building, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system design, and [`docs/ROADMAP.md`](docs/ROADMAP.md) for the phased build plan.

## Decisions locked in for the MVP

- **First data source:** file upload (PDF/DOCX/CSV/TXT/MD) — no warehouse connectors yet.
- **Memory engine:** [Graphiti](https://github.com/getzep/graphiti) (Zep's temporal knowledge graph library) rather than a bespoke memory layer.
- **Graph backend:** Neo4j, run as a single local Docker container. (Kuzu — the embedded, zero-server option — is deprecated in Graphiti; its successor, LadybugDB, isn't merged upstream yet. See `docs/ARCHITECTURE.md` §3.4.)
- **Tenancy:** single-tenant. No auth/org model in the MVP.

## Getting started

Phase 0 and Phase 1 (see [`docs/ROADMAP.md`](docs/ROADMAP.md)) are built: a FastAPI backend wired to [Graphiti](https://github.com/getzep/graphiti)/Neo4j, file upload + per-type parsing (PDF/DOCX/CSV/TXT/MD) into a local SQLite store, an LLM ontology-bootstrap pass, and a React+TS frontend (health status, Sources, Ontology Studio).

```sh
cp .env.example .env        # fill in ANTHROPIC_API_KEY and OPENAI_API_KEY (embeddings)
docker compose up -d        # starts Neo4j

cd backend && uv sync
uv run uvicorn app.main:app --reload   # http://localhost:8000

cd frontend && npm install
npm run dev                            # http://localhost:5173
```

The frontend's two status badges (Backend, Graph DB) reflect `GET /health` and `GET /health/graph`. The backend boots even without Neo4j or API keys configured — `/health/graph` reports the specific error instead of the app crashing, and uploading a source + bootstrapping an ontology work independently of Graphiti/Neo4j entirely (see `docs/ARCHITECTURE.md` §3.1–3.2 — extraction into the graph is Phase 2).

Run the backend test suite with `cd backend && uv run pytest` (no live Neo4j or API keys required — Graphiti and the ontology-bootstrap LLM call are both mocked).
