# Graph Buddy

An application that builds a **knowledge graph + ontology layer** from your uploaded data (and, later, connected data warehouses), backed by an **episodic/semantic memory system** with a background **data discovery cycle** that learns from your conversations — with a UI to **visualize the graph** and **inspect the retrieval process** behind every answer.

This repo is at the planning stage. See [`docs/VISION.md`](docs/VISION.md) for why this is worth building, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system design, and [`docs/ROADMAP.md`](docs/ROADMAP.md) for the phased build plan.

## Decisions locked in for the MVP

- **First data source:** file upload (PDF/DOCX/CSV/TXT/MD) — no warehouse connectors yet.
- **Memory engine:** [Graphiti](https://github.com/getzep/graphiti) (Zep's temporal knowledge graph library) rather than a bespoke memory layer.
- **Graph backend:** Neo4j, run as a single local Docker container. (Kuzu — the embedded, zero-server option — is deprecated in Graphiti; its successor, LadybugDB, isn't merged upstream yet. See `docs/ARCHITECTURE.md` §3.4.)
- **Tenancy:** single-tenant. No auth/org model in the MVP.

## Getting started

Phases 0-5 (see [`docs/ROADMAP.md`](docs/ROADMAP.md)) are built: a FastAPI backend wired to [Graphiti](https://github.com/getzep/graphiti)/Neo4j, file upload + per-type parsing (PDF/DOCX/CSV/TXT/MD) into a local SQLite store, an LLM ontology-bootstrap pass, ontology-guided extraction into Graphiti episodes (chunked, with a confidence score on every edge), and a React+TS frontend covering health status, Sources, Ontology Studio, the Graph Explorer, Chat, and the Retrieval Inspector.

```sh
cp .env.example .env        # fill in OPENAI_API_KEY (inference + embeddings, see ARCHITECTURE.md §5)
docker compose up -d        # starts Neo4j

cd backend && uv sync
uv run uvicorn app.main:app --reload   # http://localhost:8000

cd frontend && npm install
npm run dev                            # http://localhost:5173
```

The frontend's two status badges (Backend, Graph DB) reflect `GET /health` and `GET /health/graph`. The backend boots even without Neo4j or an API key configured — `/health/graph` reports the specific error instead of the app crashing, and uploading a source + bootstrapping an ontology work independently of Graphiti/Neo4j entirely (see `docs/ARCHITECTURE.md` §3.1–3.2). Extraction and chat do need a reachable Neo4j and `OPENAI_API_KEY` — they return a clean 503/502 rather than crashing when those aren't available.

Run the backend test suite with `cd backend && uv run pytest` (no live Neo4j or API key required — Graphiti and every LLM call are mocked).

Want something to upload right away? [`examples/sample-sources/`](examples/sample-sources) has five example files (PDF/DOCX/CSV/TXT/MD) describing a fictional startup, with the same people, projects, and customers recurring across all five -- good for exercising ontology bootstrap and extraction end to end.
