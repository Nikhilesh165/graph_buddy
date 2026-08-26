# Architecture

## 1. What the system actually does

Four things, layered on top of each other:

1. **Ontology inference** — look at whatever you upload and propose a schema (entity types, relation types, properties) for it, which you can edit.
2. **Graph construction** — extract entities/relations from your data *conforming to that ontology*, resolve duplicates, and build a graph.
3. **Memory** — treat every ingested document and every conversation turn as an *episode*; consolidate episodes over time into durable semantic facts and higher-level summaries; let facts have validity windows instead of being permanently true.
4. **Discovery cycle** — a background loop that watches your conversations and mines them for signals the ontology/graph is missing, and proposes changes.

The UI's job is to make (2) inspectable (graph explorer) and to make the thing everyone hides — *why did the assistant answer this way* — inspectable too (retrieval trace viewer).

## 2. Component map

```
Sources ──▶ Ingestion ──▶ Extraction ──▶ Graph Store (Graphiti) ◀── Memory Consolidation (periodic)
 (files)     (parse/      (LLM, ontology-                │                       ▲
              chunk)       guided NER/RE)                │                       │
                                                           ▼                       │
                                                    Ontology Registry ──────▶ Discovery Cycle
                                                    (versioned schema)        (reads conversations,
                                                           ▲                   proposes ontology diffs)
                                                           │                       ▲
                                                           │                       │
                    Retrieval Engine ◀── Chat/API ─────────┘                Conversation Log
                    (hybrid: vector +          │
                     graph traversal +         ▼
                     community summaries)  Retrieval Trace Store
                            │
                            ▼
                        Frontend: Graph Explorer · Ontology Studio ·
                                  Chat · Retrieval Inspector · Discovery Feed
```

Two things run through every layer rather than living in one box: **confidence** (every fact carries a corroboration-based score, set at extraction and revised at consolidation, surfaced everywhere from the graph to the retrieval trace — see §3.7) and the **change digest** (consolidation doesn't just update the graph silently — it writes a plain-language summary of what changed into the Discovery Feed — see §3.4).

## 3. Layer by layer

### 3.1 Ingestion
- Accepts PDF, DOCX, CSV/XLSX, TXT/MD to start.
- Parses to clean text + structural metadata (tables kept as tables, not flattened prose — matters a lot for CSV/XLSX).
- Chunking strategy differs by type: semantic/paragraph chunking for prose, row/schema-aware chunking for tabular data.
- Every chunk becomes a candidate **episode** with provenance (source file, page/row, ingested_at).

### 3.2 Ontology layer
- An **ontology** here = a versioned set of `EntityType {name, description, properties[], examples[]}` and `RelationType {name, source_types[], target_types[], properties[]}`.
- **Bootstrap:** on first upload (or a representative sample), an LLM pass proposes a starter ontology. Shown in the Ontology Studio for the user to accept/edit/reject before extraction runs at scale.
- **Evolution:** the ontology is never final. New types/relations get proposed by the discovery cycle and merged in as versioned diffs (so existing graph data can be migrated/backfilled against the new schema).
- This registry is the contract that both extraction and retrieval read from — it's what keeps entity extraction from being pure free-text NER.

### 3.3 Extraction
- Ontology-guided: given a chunk + current ontology, LLM extracts `(entity, type, properties)` and `(source, relation, target)` triples with an initial confidence score, plus provenance pointers back to the source span.
- Entity resolution / deduplication happens here — matching new mentions against existing graph nodes (name + type + embedding similarity), which is one of the things Graphiti already implements.
- Extraction results are written as Graphiti episodes, not directly as "facts" — see Memory below for why that distinction matters.
- The confidence score set here is a starting point, not the final word — see §3.7.

### 3.4 Graph store & memory (Graphiti)
Graphiti is a temporal knowledge graph library built for exactly this shape of problem (originally built for AI agent memory), and it gives us for free:
- **Bi-temporal edges** — every fact has `valid_at`/`invalid_at`, so "X worked at Y" can be superseded without deleting history. This *is* the episodic→semantic distinction: an episode is the raw, timestamped observation; the resolved graph is the current semantic state.
- **Incremental updates without full recompute** — needed since ingestion is continuous, not one batch.
- **Hybrid search** (semantic + BM25 + graph traversal) out of the box, which becomes the base of the retrieval engine.

Mapping onto the requested memory model:
- **Episodic memory** = Graphiti episodes: one per ingested chunk, one per conversation turn. Immutable, timestamped, provenance-attached.
- **Semantic memory** = the resolved entity/relation graph Graphiti maintains from those episodes — the "current understanding."
- **Periodic memory (consolidation)** = a scheduled job (nightly, or every N new episodes) that:
  1. Runs community detection (Leiden) over the graph and writes/updates community-summary nodes (GraphRAG-style), so broad questions don't require expanding thousands of edges.
  2. Recomputes confidence scores (§3.7) — corroboration from new episodes raises a fact's confidence, contradictions and staleness lower it.
  3. Flags contradictions (two overlapping facts with conflicting property values) for the discovery feed.
  4. Applies retention policy — old episodic detail can be archived/summarized while the semantic layer keeps the distilled fact, per a user-configurable retention setting.
  5. Writes a **change digest** for the cycle — a plain-language summary ("N new facts about X, 1 contradiction flagged, confidence raised on Y") — into the Discovery Feed. Consolidation is otherwise invisible batch work; the digest is what makes it a feature instead of a background job nobody ever opens.

**Backend decision (confirmed):** **Neo4j**, run as a single local Docker container in the single-tenant MVP.

This reverses the original plan of using an embedded backend to avoid running a server at all. That plan assumed Kuzu; as of this writing, Graphiti's Kuzu driver is **deprecated** (still ships, but emits a `DeprecationWarning`, and has open bugs — e.g. missing full-text-index setup, [getzep/graphiti#1258](https://github.com/getzep/graphiti/issues/1258)). Its intended successor, **LadybugDB** (MIT-licensed, API-compatible with Kuzu, embedded, no server), is not yet merged into `graphiti-core` — a working driver exists but is sitting on an open PR ([getzep/graphiti#1509](https://github.com/getzep/graphiti/issues/1509)) blocked on a prerequisite Kuzu fix. Revisit once that lands; it would remove the local Docker dependency entirely.

Of the two backends actively supported by Graphiti today, Neo4j vs. FalkorDB (a Redis-module backend, also not embedded — both require a running server/container):
- **Neo4j** is Graphiti's primary, best-tested backend — least likely to hit driver edge cases — and Neo4j Browser gives free ad-hoc graph inspection during Phases 1–2, before the Graph Explorer UI exists in Phase 3.
- **FalkorDB** is lighter-weight and faster to cold-start locally, with a smaller community and less Graphiti-specific mileage.

"Single-tenant to start" was never actually in tension with running one local Docker container — the thing worth avoiding was managed/cloud infra, not a container on localhost. Neo4j's tooling and maturity outweigh FalkorDB's lighter footprint for the MVP; FalkorDB stays the fallback if local resource usage becomes a real problem.

**Migration note:** if this ever needs a lighter local story, re-evaluate LadybugDB once merged upstream, or FalkorDB. If it needs to scale beyond single-tenant (Phase 8), Neo4j has the most mature path (Aura, clustering, Enterprise).

### 3.5 Discovery cycle
Runs after each conversation (and optionally on a schedule):
1. Read the conversation transcript.
2. Extract: new entity/relation mentions, questions the graph couldn't answer well, terms the user used that don't map to existing ontology types.
3. Diff against the current ontology → generate proposed changes with supporting evidence (quotes, confidence).
4. Auto-apply low-risk additive changes (e.g. a new property on an existing type); queue structural changes (new entity type, renamed relation) for human review in the Discovery Feed.
5. On acceptance, backfill: re-run extraction over historical episodes that are now in-scope for the new schema element.

This is the "learns from your conversations about your data" piece — it's explicitly a proposal/review loop, not silent auto-mutation of the ontology, to keep the graph trustworthy.

### 3.6 Retrieval + retrieval trace
- Hybrid retrieval: entity/vector search to find seed nodes → k-hop graph traversal → optionally pull in community summaries for broad/aggregate questions → rerank → assemble context.
- **Every retrieval produces a trace object**, stored (not just logged): seed nodes + scores, each expansion hop with the edges traversed and why, nodes/edges actually included in the final context, final prompt.
- Each fact in the trace carries its current confidence score (§3.7) — retrieval can rank/filter by it, and the Inspector can show *why* a low-corroboration fact was still used.
- This trace is a first-class artifact the UI reads — see below.

### 3.7 Confidence & corroboration
A fact's confidence is a composite, computed and revised over its whole lifecycle — not a single LLM logprob frozen at extraction time:

- **Set at extraction (§3.3):** the LLM's own confidence in the triple, weighted by source-type reliability (a structured table cell is more reliable than an inferred claim in prose).
- **Revised at consolidation (§3.4):** corroboration from independent episodes raises it, contradictions lower it, and staleness (no reinforcing episode in a long time) decays it.
- **Stored on the edge** as a `confidence` property, versioned alongside the bi-temporal `valid_at`/`invalid_at` fields it sits next to.
- **Surfaced everywhere, not just computed:** edge weight/opacity in the Graph Explorer, a per-fact score in the Retrieval Inspector, and inline on chat citations — the same number, one source of truth, rendered in three places.

This is built in from Phase 2 (extraction) rather than retrofitted later, so retrieval has something real to rank by from day one instead of the UI growing a score with nothing behind it.

## 4. UI surfaces

| Surface | Purpose |
|---|---|
| Sources | Upload files, see parse/extraction status per file |
| Ontology Studio | Visual schema editor; review queue for discovery-cycle proposals |
| Graph Explorer | Interactive graph view, filter by type/time/confidence, node detail with provenance back to source doc |
| Chat | Ask questions, answers with inline citations and confidence to graph nodes |
| Retrieval Inspector | Per-answer: highlights the exact subgraph used, hop-by-hop trace, scores and confidence — the "explain this answer" view |
| Discovery Feed | Timeline combining periodic-memory change digests (§3.4) and pending ontology suggestions to accept or reject |

Graph Explorer and Retrieval Inspector should share the same graph-rendering component — the inspector is really "Graph Explorer with a highlighted subgraph and a trace sidebar," not a separate visualization.

## 5. Suggested stack

- **Backend:** Python + FastAPI (Graphiti is Python-native, no cross-language boundary).
- **Graph/memory:** Graphiti on **Neo4j** (single local Docker container for the single-tenant MVP) — see §3.4 for why.
- **LLM:** Claude Sonnet for extraction/ontology proposals/chat; a cheaper model for high-volume background discovery-cycle scanning if cost becomes a concern.
- **File parsing:** per-type parsers (start simple: `pdfplumber`/`python-docx`/`pandas`; revisit if quality demands `unstructured.io`).
- **Frontend:** React + TypeScript; graph rendering via `react-force-graph` or `Sigma.js` (large graphs) — reuse the same component for Ontology Studio's schema diagram (smaller, structured) and Graph Explorer (larger, force-directed).
- **Background jobs:** APScheduler is enough for MVP single-tenant; move to Celery/RQ only if/when this needs to scale out.
- **Storage:** local disk for uploaded files in MVP; swap for object storage later without touching the ingestion contract.

## 6. Explicit non-goals for MVP

- No data warehouse connectors (Phase 8+).
- No multi-tenant/auth (single-tenant to start; add org/user scoping to the graph + ontology models later rather than bolting on afterward — see roadmap note).
- No real-time collaborative graph editing.
