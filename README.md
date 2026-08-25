# Graph Buddy

An application that builds a **knowledge graph + ontology layer** from your uploaded data (and, later, connected data warehouses), backed by an **episodic/semantic memory system** with a background **data discovery cycle** that learns from your conversations — with a UI to **visualize the graph** and **inspect the retrieval process** behind every answer.

This repo is at the planning stage. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system design and [`docs/ROADMAP.md`](docs/ROADMAP.md) for the phased build plan.

## Decisions locked in for the MVP

- **First data source:** file upload (PDF/DOCX/CSV/TXT/MD) — no warehouse connectors yet.
- **Memory engine:** [Graphiti](https://github.com/getzep/graphiti) (Zep's temporal knowledge graph library) rather than a bespoke memory layer.
- **Tenancy:** single-tenant. No auth/org model in the MVP.
