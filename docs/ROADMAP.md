# Roadmap

Each phase should end with something demoable, not just "code exists." Ordered by dependency, not by difficulty.

## Phase 0 — Foundations
- Repo scaffolding: `/backend` (FastAPI), `/frontend` (React+TS), `/docs`.
- Docker Compose for Neo4j (single local container); wire Graphiti to it (see ARCHITECTURE.md §3.4 for why Neo4j over FalkorDB/Kuzu/LadybugDB).
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
- Confidence scoring at extraction — LLM confidence weighted by source-type reliability, stored on every edge (ARCHITECTURE.md §3.7). Build this now: retiring it later means every downstream phase (ranking, UI, trace) has to be reworked to add it back in.
- **Demo:** upload a file, graph populates with entities/relations, each edge carrying a confidence score, queryable directly against Graphiti.

## Phase 3 — Graph visualization UI
- Graph Explorer: interactive render, filters by type/time/confidence, node detail panel with provenance link back to source.
- Confidence rendered visually on edges (weight/opacity), not just as a queryable field.
- **Demo:** browse the graph built in Phase 2 visually, click a node, see where it came from and how confident the graph is in it.

## Phase 4 — Chat + retrieval
- Hybrid retrieval (vector + graph traversal) over the graph.
- Chat UI with inline citations.
- **Demo:** ask a question about uploaded data, get a cited answer.

## Phase 5 — Retrieval analysis UI
- Persist a trace object per query (seed nodes, hops, scores, confidence, final context).
- Retrieval Inspector: highlight the used subgraph on the Graph Explorer component, step through the trace, show per-fact confidence.
- **Demo:** ask a question, then open "explain this answer" and see exactly which nodes/edges/hops produced it and how confident each fact was.

## Phase 6 — Memory consolidation
- Scheduled community-detection + summary job.
- Confidence recomputation — corroboration raises it, contradictions and staleness lower it (ARCHITECTURE.md §3.7).
- Contradiction flagging.
- Change digest generation — plain-language summary of the cycle ("N new facts, 1 contradiction, confidence raised on Y"), written to the Discovery Feed store (ARCHITECTURE.md §3.4). A minimal read-only feed view is enough here; Phase 7 builds the full interactive Discovery Feed on top of the same store.
- Configurable retention policy for episodic detail.
- **Demo:** after enough data, broad questions get answered from community summaries instead of huge context dumps; conflicting facts show up flagged; opening the feed shows this cycle's digest in plain language.

## Phase 7 — Discovery cycle
- Post-conversation scan → ontology diff proposals with evidence.
- Discovery Feed UI: accept/reject queue for ontology proposals, unified with the change digests Phase 6 already writes to the same feed — auto-apply for low-risk additive changes.
- Backfill extraction on ontology acceptance.
- **Demo:** have a conversation that mentions something outside the current ontology, see a proposal appear alongside the periodic digest, accept it, see historical data get backfilled.

## Phase 8 — Beyond MVP
- Data warehouse connectors (schema introspection → ontology seeding from structured sources).
- Multi-tenant model (org/user scoping on graph + ontology + conversations).
- Auth.
- Sharing / collaborative editing.

## Sequencing notes
- Phases 1–2 (ingestion → graph) and Phase 3 (visualization) can run in parallel once the graph schema stabilizes — visualization only needs *a* populated graph, not the final extraction pipeline.
- Phase 5 (retrieval inspector) depends on Phase 4's trace object existing; don't start the inspector UI before the trace schema is settled, or it'll get rebuilt.
- Phase 7 (discovery cycle) depends on Phase 4 (there need to be conversations to learn from) and reuses the Phase 1 ontology-diff mechanism, so build ontology diffing as a reusable primitive in Phase 1 rather than one-off code.
- Confidence scoring is a Phase 2 primitive, not a Phase 5 or later add-on — Phases 3, 5, and 6 all render or recompute it, and retrofitting it after those exist means reworking each one to add a field they were built without.
