# Memory & AI-driven discovery

This is the analysis and design for two linked changes, and a record of what the first implementation slice (this branch) built:

1. **The chatbot gets episodic and periodic memory that serves ontology-specific query resolution.** It should know what was said earlier in a conversation, recall related past exchanges, learn how the user talks about the ontology, and use all of that to work out which ontology types and entities a question is about before it searches the graph.
2. **The ontology stops being a setup step the user does once.** It becomes AI-maintained, as part of a discovery cycle that runs over both incoming data and conversations. The user reviews what the AI does instead of writing the ontology.

It extends `ARCHITECTURE.md` §3.4 (memory), §3.5 (discovery cycle) and §3.6 (retrieval), and covers ROADMAP Phases 6–7. Where this design departs from those documents, it says so and gives the reason.

---

## 1. Where the codebase stood

| Capability | Before | Gap |
|---|---|---|
| Conversation context | `ChatTurn` was a flat, append-only log. Every question was answered on its own. | A follow-up such as "and who manages her?" had nothing to resolve "her" against. |
| Episodic memory | Turns were stored but never read back into a later answer. | Nothing let a new question benefit from past exchanges. |
| Query understanding | The raw question went straight to Graphiti's hybrid search, with no ontology involved. | The ontology shaped extraction only. Retrieval ignored it, even though `SearchFilters` supports filtering by edge type and node label. |
| Periodic memory | None. `search_` already returned community results, but nothing ever built communities. | No consolidation, no summaries, no digest (Phase 6). |
| Ontology lifecycle | The *frontend* auto-bootstrapped from the first upload only, and later uploads never touched the ontology. "Propose ontology" overwrote it from one file's sample. | The ontology went stale from the second upload onward, and evolving it was entirely manual. |
| Discovery cycle | `compute_diff` existed as a reusable primitive. Nothing used it for proposals. | No proposals, review queue or feed (Phase 7). |

Some things already in place made this tractable. Graphiti's search takes filters, BFS origins, and community/episode search. The ontology was versioned, with diffs. Chat turns were persisted precisely so that Phase 7 would have something to mine. And the retrieval trace was a structured object that could grow new fields.

---

## 2. Memory model

```
                ┌───────────────────── one chat turn ─────────────────────┐
question ──▶ working memory ──▶ resolve vs ontology ──▶ anchor ──▶ recall ──▶ retrieve ──▶ answer
             (this thread's      (LLM: standalone       (mentions   (episodes:   (open + typed   (facts +
              last N turns +      rewrite, intent,       → graph     similarity   searches,       memory +
              rolling summary)    types, mentions,       nodes)      + shared     ontology-       community
                                  vocabulary, gaps)                  entities)    matched first)  summaries)
                                         │                                                         │
                                         ▼                                                         ▼
                              learned vocabulary  ◀──────── persisted episode (plan, entities, embedding) + trace
                                         ▲                                                         │
                                         └──── periodic consolidation: summaries · gap mining → discovery · communities · digest
```

Four tiers of memory, each with one job:

| Tier | What it holds | Written | Read by |
|---|---|---|---|
| **Working** | The current conversation's last `MEMORY_WORKING_TURNS` turns, verbatim, plus its rolling summary | Every turn; the summary on consolidation | Resolver and answer |
| **Episodic** | Every turn, as an episode carrying its grounded query plan, the graph entities it touched, and an embedding | Every turn | Recall (answer) and gap mining (consolidation) |
| **Semantic: vocabulary** | User term → ontology type mappings, with reinforcement counts | Every turn | Resolver |
| **Semantic: graph** | The knowledge graph and Graphiti community summaries | Extraction; communities on consolidation | Retrieval |

### 2.1 Working memory: conversations

`Conversation` (`app/models/conversation.py`) groups turns. `POST /chat` takes an optional `conversation_id`. Leaving it out starts a new conversation, and the response carries the new id. Each turn's resolver and answer see the thread's recent turns. Older turns are covered by the conversation's rolling `summary`, which periodic consolidation maintains (§2.4), so working memory never grows without bound. Turns asked before conversations existed are gathered into a single "Earlier questions" thread at startup (`memory_service.adopt_orphan_turns`).

### 2.2 Episodic memory: turns as episodes

Each `ChatTurn` now stores:

- `standalone_query`: the self-contained rewrite that retrieval actually searched for.
- `query_plan`: the grounded `QueryPlan`, including `unmapped_terms`, which is the discovery cycle's main conversational signal.
- `entity_uuids`: the graph nodes the turn's retrieval surfaced. This is the episodic→semantic link.
- `embedding`: an embedding of the standalone query, from Graphiti's own configured embedder.

`memory_service.recall` scores past episodes from any conversation as cosine similarity, plus a bonus for overlap between the new question's anchored entities and the entities each past turn touched. It returns the top `MEMORY_RECALL_K` episodes above `MEMORY_RECALL_MIN_SCORE`. Recalled episodes go to the answer, not to retrieval, as context such as "you asked this last week and the graph had nothing on budgets".

**Deliberate departure from ARCHITECTURE.md §3.4.** The original sketch wrote every conversation turn into Graphiti as an episode. This design does not, for two reasons:

- **Circular confidence.** The graph records what the *sources* say. Assistant answers are built from graph facts. Re-ingesting them would create "new" facts that corroborate the facts they came from, which inflates the corroboration-based confidence in §3.7 in a loop.
- **Cost.** It would add one extraction LLM pass per chat turn.

Conversations still shape the graph, but through the discovery cycle's ontology proposals (§3.3) rather than by writing facts directly. Episodic memory lives in SQLite next to the turns it describes.

### 2.3 Ontology-aware query resolution

`chat_service.run_turn` runs these steps:

1. **Resolve.** One structured LLM call, `llm.resolve_query`, receives the ontology outline, the learned vocabulary and working memory. It returns a `QueryPlan` with these fields:
   - `standalone_query`: the coreference-resolved rewrite.
   - `intent`: lookup, relationship, aggregate, overview, temporal or comparison.
   - `entity_types` and `relation_types`.
   - `entity_mentions`.
   - `term_mappings`: synonyms, such as "clients" → Customer.
   - `unmapped_terms`.

   If the call fails, the turn falls back to searching for the question verbatim, and the trace records the error.
2. **Ground** (`ground_plan`). The plan is checked against the real ontology. Unknown type names are dropped, names are canonicalized case-insensitively, and term mappings to non-existent types are discarded. Terms that merely *are* a type's name are removed from `unmapped_terms`, modulo case, plural and CamelCase (`refers_to_type`). When the question names only entity types, the relation types touching them are derived from the ontology.
3. **Anchor** (`find_anchors`). Mentioned entities are matched to graph nodes by name, case-insensitively.
4. **Recall** episodic memory, as described in §2.2.
5. **Retrieve.** Graphiti's open hybrid search always runs, seeded with the anchors as BFS origins. When the plan is grounded, two more searches run:
   - a *typed edge search* filtered to the plan's relation types
   - a *typed node search* filtered to its entity types

   Ontology-matched facts are ranked first and flagged `ontology_match`, and the open search fills the remaining slots. This ordering can be explained in the Inspector, which blending two rerank passes' scores would not allow.
6. **Answer.** The answer prompt gets the facts, conversation memory, and community summaries when the intent is broad (aggregate or overview). Citations still come from facts only.

**The `node_labels` trap.** In graphiti-core's *edge* search, `SearchFilters.node_labels` constrains **both** endpoints (`n:A|B AND m:A|B`). Filtering "which customers filed tickets" by `[Customer]` would therefore return only Customer→Customer edges. Typed edge search filters on relation types only, and `node_labels` is used only for node search. Labels are also validated before use, because graphiti-core rejects unsafe label names and a hand-edited ontology isn't name-checked.

The trace stores `resolution`, `memory` and `communities`. The Retrieval Inspector renders them as "Query resolution", "Memory used" and "Background summaries", and chat bubbles show the rewrite, the mapped types and any not-in-ontology terms inline.

### 2.4 Periodic memory: consolidation

`consolidation_service.run_cycle` runs every `CONSOLIDATION_INTERVAL_MINUTES` (default 360, `0` disables the schedule) through an in-process asyncio task (`app/core/scheduler.py`), or on demand through `POST /memory/consolidate`. A lock ensures cycles never overlap. Each cycle runs four steps, and each is independent: a failure is recorded in the run's stats and digest, and the remaining steps still run.

1. **Conversation summaries.** Turns that have scrolled out of the working-memory window are folded into each conversation's rolling summary, once at least `CONSOLIDATION_SUMMARY_MIN_NEW_TURNS` are pending. Summary plus working window then cover the whole thread exactly once.
2. **Gap mining → discovery.** The cycle aggregates `unmapped_terms`, with counts and example questions, and the questions that retrieved nothing, then hands them to conversation-driven discovery (§3.3).
3. **Communities.** `graphiti.build_communities()` runs when new episodes have arrived since the last successful rebuild. This feeds the broad-intent answers in §2.3.
4. **Digest.** A plain-language summary goes to the Discovery Feed, but only when something happened. A "nothing new" entry every six hours would be noise.

Each step records its own high-water mark only on success (`gap_mining_until`, `community_episode_count`). A failed step is retried over the same window next cycle instead of being skipped.

Two departures from earlier plans:

- The schedule is a small asyncio loop, not APScheduler as suggested in ARCHITECTURE.md §5. That is enough for one fixed-interval job in one process.
- Confidence recomputation, contradiction flagging and retention, the rest of Phase 6, are **not** in this cycle yet (§5).

---

## 3. AI-driven ontology: the discovery cycle

```
 upload ─▶ parse ─▶ discover (bootstrap | evolve) ─▶ [auto-extract] ─▶ graph
                          │                                              │
                          ▼                                              ▼
              change set ─▶ policy ─┬─ auto-apply ─▶ new ontology version (created_by=discovery)
                          ▲         └─ queue ──────▶ Discovery Feed: accept / dismiss
                          │
 chat turns ─▶ resolver's unmapped terms + unanswered questions ─▶ consolidation gap mining
```

### 3.1 Data side: every upload is analyzed

`POST /sources` parses the file and returns. The discovery pass then runs as a background task (`pipeline.run_source_discovery_job`), and its progress is tracked on the source row as `discovery_status` / `discovery_error`.

- **No ontology yet:** the pass is a bootstrap (`llm.propose_ontology`, unchanged), expressed as a change set of add operations.
- **Ontology exists:** `llm.propose_ontology_changes` compares the new document's sample with the current ontology and proposes the *smallest* change set needed. It reuses or refines existing types before adding new ones, and never removes a type just because this document doesn't mention it.
- **Optional auto-extract:** with `AUTO_EXTRACT_ON_UPLOAD`, the source is then extracted under the updated ontology. This is off by default, because extraction costs one LLM call per chunk.

The Sources page polls the row ("AI analyzing", with Extract disabled until the ontology settles), then refreshes the ontology and the review-count badge. "Re-analyze with AI" (`POST /discovery/sources/{id}`) re-runs the pass synchronously and replaces the old "Propose ontology" button, which started from scratch. Sources extracted under an older ontology version are flagged for re-extraction. Jobs cut short by a server restart are marked failed at startup, so the UI never polls them forever.

### 3.2 Change sets, risk and autonomy

Changes are **operations**, not ontology snapshots (`OntologyChange`):

- `add_entity_type`, `add_relation_type`
- `add_entity_property`, `add_relation_property`
- `extend_relation_endpoints`, `update_description`
- `rename_*`, `remove_*`

A proposal can wait in the review queue while the ontology moves on. Replaying "add property `budget` to Project" onto the ontology *as it is at accept time* still makes sense. Swapping in a stale snapshot would silently revert everything that happened in between.

`ontology_changes.apply_changes` is pure and forgiving. It applies changes in dependency order, so a relation can reference a type added in the same set. It resolves names case-insensitively and validates them against graphiti-core's safe-label rule and reserved labels. A change that no longer makes sense against the current ontology is *skipped with a reason*, never raised.

| Risk | Operations | `manual` | `assisted` | `autonomous` (default) |
|---|---|---|---|---|
| low | add property, extend relation endpoints, update description | review | **auto** | **auto** |
| medium | add entity type, add relation type | review | review | **auto** |
| high | rename, remove | review | review | review |

High-risk changes are never auto-applied, because renames and removals can orphan graph data that was extracted under the old name (§5, item 2). The default is `autonomous`, because the requirement is that the ontology be AI-driven. Set `ONTOLOGY_AUTONOMY` to dial it back.

`discovery_service.record_change_set` applies the policy as follows:

1. Dry-run the whole set against the current ontology, dropping no-ops.
2. Split the set by policy.
3. Auto-apply its share as a new version with `created_by="discovery"` and a `note`. A low-risk change that depends on a queued type (a property on a new type, say) is queued *with* it rather than lost.
4. Queue the rest as a pending proposal. Suggestions already awaiting review aren't queued twice (`change_key`).
5. Write feed events.

This function is deliberately synchronous (§6).

### 3.3 Conversation side: gap mining

Gap mining runs in consolidation (§2.4). It collects terms the resolver couldn't map onto any type, each with how often it was asked and example questions, plus the questions that retrieved no facts. `llm.propose_ontology_changes(evidence_kind="conversation")` turns these into a change set under the same policy. Terms that have since become types stop counting as gaps, matched modulo plural and formatting. A proposal that adds a type only pays off once sources are re-extracted under it (§5, item 1).

### 3.4 Review queue and Discovery Feed

Accepting (`POST /discovery/proposals/{id}/accept`) replays the operations onto the current ontology. A proposal whose operations no longer apply is marked `failed`, with the reasons. Dismissing (`.../reject`) is recorded too.

The Discovery page shows:

- pending proposals, with their changes, rationale, risk and evidence quotes
- the activity feed: bootstraps, evolutions, pending reviews, decisions, failures and consolidation digests
- the learned vocabulary
- the autonomy setting
- a "Consolidate memory now" button

The sidebar shows how many proposals are waiting for review.

---

## 4. Implemented in this branch

**Backend.** Every new behavior is covered by tests, 125 in the suite, all run without Neo4j or an API key.

| Area | Files |
|---|---|
| Models | `models/conversation.py`, `models/discovery.py`, `models/memory.py`; new columns on `ChatTurn`, `RetrievalTraceRecord`, `Source`, `OntologyVersion` |
| Schema evolution | `core/db.py` `_add_missing_columns`: additive `ALTER TABLE` (with scalar defaults and indexes) so existing `graph_buddy.db` files keep working |
| Change-set primitive | `services/ontology_changes.py` |
| Discovery | `services/discovery_service.py`, `services/pipeline.py`, `api/routes/discovery.py` |
| Memory + resolution | `services/memory_service.py`, `services/chat_service.py`, `api/routes/chat.py` |
| Consolidation | `services/consolidation_service.py`, `core/scheduler.py`, `api/routes/memory.py` |
| LLM calls | `core/llm.py`: `propose_ontology_changes`, `resolve_query`, `summarize_conversation`; memory and background context in `generate_chat_answer` |
| Concurrency | `GraphitiState.write_lock` serializes extraction and community rebuilds; a consolidation lock prevents overlapping cycles |

**API additions:**

- **Conversations:** `GET/POST /chat/conversations`; `POST /chat {question, conversation_id?}`; `GET /chat/history?conversation_id=`.
- **Discovery:** `GET /discovery/feed`, `GET /discovery/proposals?status=`, `POST /discovery/proposals/{id}/accept|reject`, `POST /discovery/sources/{id}`, `GET /discovery/settings`.
- **Memory:** `GET /memory/overview`, `GET /memory/vocabulary`, `GET /memory/runs`, `POST /memory/consolidate`.

**Settings**, all optional, defaults in `core/config.py`:

| Group | Settings |
|---|---|
| Discovery | `ONTOLOGY_AUTONOMY`, `AUTO_DISCOVER_ON_UPLOAD`, `AUTO_EXTRACT_ON_UPLOAD` |
| Chat and memory | `QUERY_RESOLUTION_ENABLED`, `CHAT_RESULT_LIMIT`, `MEMORY_WORKING_TURNS`, `MEMORY_RECALL_K`, `MEMORY_RECALL_MIN_SCORE`, `MEMORY_VOCABULARY_LIMIT` |
| Consolidation | `CONSOLIDATION_INTERVAL_MINUTES`, `CONSOLIDATION_SUMMARY_MIN_NEW_TURNS`, `CONSOLIDATION_BUILD_COMMUNITIES` |

**Frontend:**

- Chat has conversations, with an inline interpretation for each question.
- The Retrieval Inspector shows resolution and memory sections.
- A new Discovery page holds the review queue and feed.
- Sources shows server-side discovery status and polls it.
- The Studio shows "via AI discovery" with the version note.
- Graph Explorer and Chat are lazy-loaded, which takes the main bundle from 496 kB to 303 kB.

---

## 5. What it still takes

Ordered by how much each item unlocks.

1. **Backfill on ontology change.** This is the most important missing link. When discovery adds a type, already-extracted sources don't contain it until they're re-extracted, which is currently a manual "Re-extract" click.
   - Proposed design: a backfill job per source. Remove the source's old episodes via `graphiti.remove_episode`, using the uuids already in the `Episode` table, then re-extract under the new ontology, serialized under `write_lock`.
   - Trigger it automatically for sources whose `extracted_ontology_version` predates an applied change. A cheap relevance pre-check (does the source mention the new concept?) avoids re-extracting everything.
   - Make the cost bounded and configurable, the same way `AUTO_EXTRACT_ON_UPLOAD` is.
2. **Graph migration for renames and removals.** Accepting a rename changes the ontology but not the existing graph. It needs Cypher migrations run on accept: `MATCH (n:Old) SET n:New REMOVE n:Old` for entity types, and `SET e.name = 'NEW'` on `RELATES_TO` edges for relation types. Removals need a policy: keep the nodes untyped, or delete them.
3. **The rest of Phase 6 in the consolidation cycle:**
   - confidence recomputation from corroboration, contradiction and staleness (ARCHITECTURE.md §3.7)
   - contradiction flagging into the feed
   - a retention policy for episodic detail, chat turns included
4. **Evaluation harness.** A fixed question set over `examples/sample-sources/` that scores retrieval with resolution on and off (fact precision and recall, answerable rate) and tracks resolver failures. The resolver and discovery prompts should be tuned against it rather than by feel.
5. **Vocabulary → ontology.** Promote strongly reinforced aliases into the matching type's description, so that extraction, not just retrieval, recognizes the user's terms.
6. **Review ergonomics.** Partial acceptance of individual operations in a proposal; auto-expiring proposals that later changes made moot; and an autonomy control in the UI, which is currently an environment setting.

---

## 6. Assumptions and scaling limits

- **Single process.**
  - `record_change_set` and `accept_proposal` read the latest ontology, apply changes and save the next version with no `await` in between. Within one asyncio event loop that is atomic, so two discovery passes can't claim the same version number. That guarantee does not hold across multiple workers. Going beyond one process needs a unique constraint on `version_number`, retry on conflict, and a real job queue in place of `BackgroundTasks`.
  - Background jobs die with the process. Startup recovery marks them failed so they can be retried.
- **Recall scans embeddings in-process.** Recall loads the 500 most recent embedded turns and scores them in Python. That is fine for a single user, but at scale it should move to a vector index: Neo4j's own vector index, or sqlite-vec.
- **Cost per chat turn:** one resolver call, one embedding, one to three Graphiti searches (each with its own embedding and rerank), and the answer call. Setting `QUERY_RESOLUTION_ENABLED=false` brings this back to the Phase 4 profile.
- **Graph migrations are additive only.** `_add_missing_columns` handles new columns. Renames, type changes and drops need a real migration tool such as Alembic.

---

## 7. How this was verified

- **Unit and API tests.** `cd backend && uv run pytest` runs 125 tests with Graphiti and every LLM call mocked. They cover the change-set primitive, policy splits, dependency deferral, dedupe, the bootstrap and evolve paths, accept, reject and stale accept, background failure, auto-extract, the restart recovery, plan grounding, typed retrieval and its filter shapes, working memory and coreference, recall across conversations, vocabulary learning, resolver fallback, community background, the consolidation steps and their retry windows, the scheduler, and migrations against a pre-change database.
- **Frontend checks.** `npm run lint` (oxlint) and `npm run build` (`tsc -b` + Vite) both pass.
- **End to end in a browser.** The backend ran against a seeded SQLite database, with a deterministic, slow fake for the discovery LLM call, and Playwright drove the UI. The run covered:
  - an upload going through "AI analyzing" with Extract disabled, then settling
  - the ontology gaining the auto-applied type, and the review badge counting the queued destructive change
  - accept and dismiss from the Discovery page updating the ontology and the badge
  - "Consolidate memory now" producing a digest

  This run found three bugs that the unit tests had not, and all three are fixed with regression tests: duplicate queued suggestions across uploads, plural-insensitive gap matching, and digest grammar.
- **Not verified here:** live Neo4j and OpenAI. The sandbox has neither, so the prompts' real-world quality is the first thing to check on a real run (§5, item 4).
