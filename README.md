# Graph Buddy

An application that builds a **knowledge graph + ontology layer** from your uploaded data (and, later, connected data warehouses), backed by an **episodic/semantic memory system** with a background **data discovery cycle** that learns from your conversations — with a UI to **visualize the graph** and **inspect the retrieval process** behind every answer.

This repo is at the planning stage. See [`docs/VISION.md`](docs/VISION.md) for why this is worth building, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system design, and [`docs/ROADMAP.md`](docs/ROADMAP.md) for the phased build plan.

## Decisions locked in for the MVP

- **First data source:** file upload (PDF/DOCX/CSV/TXT/MD) — no warehouse connectors yet.
- **Memory engine:** [Graphiti](https://github.com/getzep/graphiti) (Zep's temporal knowledge graph library) rather than a bespoke memory layer.
- **Graph backend:** Neo4j, run as a single local Docker container. (Kuzu — the embedded, zero-server option — is deprecated in Graphiti; its successor, LadybugDB, isn't merged upstream yet. See `docs/ARCHITECTURE.md` §3.4.)
- **Tenancy:** single-tenant. No auth/org model in the MVP.
