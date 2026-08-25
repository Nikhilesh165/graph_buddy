# Roadmap

Each phase should end with something demoable, not just "code exists." Ordered by dependency, not by difficulty.

## Phase 0 — Foundations
- Repo scaffolding: `/backend` (FastAPI), `/frontend` (React+TS), `/docs`.
- Stand up Graphiti locally; confirm current supported graph backend and pin one (see ARCHITECTURE.md §3.4).
- Health-check API + empty React shell wired to it.
- **Demo:** backend boots, Graphiti connects, frontend loads a blank shell.

## Phase 1 — Ingestion + ontology bootstrap
- File upload endpoint (PDF/DOCX/CSV/TXT/MD) + parsing per type.
- LLM ontology-bootstrap pass over a sample of an uploaded source.
- Ontology Studio v0: view + hand-edit proposed entity/relation types.
- **Demo:** upload a file, see a proposed ontology you can edit.

## Phase 2 — Extraction + graph build
- Ontology-guided extraction into Graphiti episodes.
- Entity resolution/dedup (Graphiti-assisted).
- **Demo:** upload a file, graph populates with entities/relations you can query directly against Graphiti.

## Phase 3 — Graph visualization UI
- Graph Explorer: interactive render, filters by type/time, node detail panel with provenance link back to source.
- **Demo:** browse the graph built in Phase 2 visually, click a node, see where it came from.

## Phase 4 — Chat + retrieval
- Hybrid retrieval (vector + graph traversal) over the graph.
- Chat UI with inline citations.
- **Demo:** ask a question about uploaded data, get a cited answer.

## Phase 5 — Retrieval analysis UI
- Persist a trace object per query (seed nodes, hops, scores, final context).
- Retrieval Inspector: highlight the used subgraph on the Graph Explorer component, step through the trace.
- **Demo:** ask a question, then open "explain this answer" and see exactly which nodes/edges/hops produced it.

## Phase 6 — Memory consolidation
- Scheduled community-detection + summary job.
- Contradiction flagging.
- Configurable retention policy for episodic detail.
- **Demo:** after enough data, broad questions get answered from community summaries instead of huge context dumps; conflicting facts show up flagged.

## Phase 7 — Discovery cycle
- Post-conversation scan → ontology diff proposals with evidence.
- Discovery Feed UI: accept/reject queue, auto-apply for low-risk additive changes.
- Backfill extraction on ontology acceptance.
- **Demo:** have a conversation that mentions something outside the current ontology, see a proposal appear, accept it, see historical data get backfilled.

## Phase 8 — Beyond MVP
- Data warehouse connectors (schema introspection → ontology seeding from structured sources).
- Multi-tenant model (org/user scoping on graph + ontology + conversations).
- Auth.
- Sharing / collaborative editing.

## Sequencing notes
- Phases 1–2 (ingestion → graph) and Phase 3 (visualization) can run in parallel once the graph schema stabilizes — visualization only needs *a* populated graph, not the final extraction pipeline.
- Phase 5 (retrieval inspector) depends on Phase 4's trace object existing; don't start the inspector UI before the trace schema is settled, or it'll get rebuilt.
- Phase 7 (discovery cycle) depends on Phase 4 (there need to be conversations to learn from) and reuses the Phase 1 ontology-diff mechanism, so build ontology diffing as a reusable primitive in Phase 1 rather than one-off code.
