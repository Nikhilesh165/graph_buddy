# Bug audit — October 2026

A line-by-line review of the backend (FastAPI + Graphiti), the frontend (React + force-graph), and their contract with the installed libraries (`graphiti-core` 0.29.3, `force-graph`, `pandas`, `python-docx`, `openai`). The GitHub tracker had no open issues, so everything below was found by reading the code and then reproducing it. Assumptions about library behavior were checked against the installed library source, not documentation.

**Result:** 28 defects fixed (1 security, 11 backend, 5 ingestion, 11 frontend; a few Low-severity frontend rows bundle closely related small fixes). Each one was reproduced before it was fixed. Eight further issues are listed under [Known issues](#known-issues-not-fixed) and left alone because they need a product or design decision.

Severity: **High** = feature broken or data lost/corrupted for common inputs · **Medium** = wrong results in realistic situations · **Low** = edge case, latent, or cosmetic.

---

## Security

| ID | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| S1 | High | `routes/sources.py` upload | **Path traversal.** The multipart filename was joined directly onto the upload dir, and neither Starlette nor python-multipart strips directory parts. `../../x.md` or `/abs/path/x.md` was written outside `uploads_dir`, and could overwrite any `.pdf/.docx/.csv/.txt/.md` file the server process can write. CORS doesn't help: a multipart POST is a CORS "simple request", so any web page the user visits could send it to a locally running backend. Reproduced: the file landed two directories above the upload root. | `_safe_filename()` keeps only the basename, splits on both `/` and `\` (Windows browsers), and strips NUL bytes. The extension check now runs on the sanitized name. |

## Backend correctness

| ID | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| B1 | High | `extraction_service.py` | **Extraction failed outright when an ontology property shared a name with a Graphiti built-in field** (`name`, `summary`, `uuid`, `labels`, `created_at`, …). `Graphiti.add_episode` runs `validate_entity_types`, which raises `EntityTypeValidationError`, so every chunk failed. LLM-bootstrapped ontologies very often include `Person.name`. | Entity and edge property models skip names reserved by `EntityNode`/`EntityEdge` (they duplicate built-ins anyway). They also skip names Pydantic rejects (`_x`, `model_config`). The bootstrap prompt now tells the model not to propose these names. |
| B2 | High | `routes/ontology.py`, `ontology_service.py` | **Ontology edits weren't validated at all.** A blank card saved from the Studio, or a type named `Product Line`, became an invalid Neo4j label, and Graphiti raised `NodeLabelValidationError` on every chunk. Relation types pointing at undefined entity types were silently never applied. Property names like `_secret` crashed `create_model`. | New `validate_ontology()` checks names (graph-label-safe, non-empty, unique), relation references, and property names. `PUT /ontology` returns **422** with every problem listed. Bootstrap returns **502** "unusable ontology, try again" instead of saving a broken version. |
| B3 | High | `graph_service.py` | **Node attributes were always empty in the Graph Explorer.** The code read `n.attributes`, but on Neo4j Graphiti stores entity attributes as top-level node properties; graphiti-core's own reader uses `properties(n)`. So every extracted ontology property was invisible. | All three queries return the node's properties as `[key, value]` pairs, minus Graphiti's core fields. The filtering happens in Cypher, so the ~1.5k-float `name_embedding` never leaves the database. |
| B4 | Medium | `routes/chat.py` `/history` | **Chat history returned the *oldest* 50 turns** (`ORDER BY created_at ASC LIMIT 50`). After 50 questions, new turns disappeared from the transcript on reload. A negative `limit` meant "no limit". | Select the newest N, then reverse into transcript order. `limit` is validated to 1–500. |
| B5 | Medium | all SQL models | **Every timestamp lost its UTC offset.** SQLite drops `tzinfo`, so `datetime.now(UTC)` came back naive and was serialized as `2026-10-05T08:06:04`. JavaScript parses that as the *viewer's local time*. This is latent in today's UI, which doesn't render timestamps, but the API contract was wrong. | New `UTCDateTime` column type normalizes to UTC on write and re-attaches UTC on read, so the API now emits `…Z`. Existing rows are already naive UTC, so no migration is needed. |
| B6 | Medium | `routes/sources.py` extract | **Concurrent extraction of the same source wasn't prevented.** Every chunk was written into the graph twice. Reproduced with two simultaneous requests. Separately, a crash mid-run left the source stuck at `extracting` forever. | The source is claimed with an atomic conditional `UPDATE … WHERE graphiti_status != 'extracting'`, and a second request gets **409**. At startup, sources orphaned at `extracting` are reset to `failed` ("interrupted"). |
| B7 | Medium | `extraction_service.py`, `routes/sources.py` | **Provenance was lost on partial failure.** Graphiti commits each episode as it goes, but when a later chunk failed, the `Episode` rows for chunks already in the graph were never written. Their entities then had no source file or excerpt in the node-detail panel. | `extract_source` raises `ExtractionError` carrying the partial summary, and the route persists those provenance rows before returning the 502. |
| B8 | Medium | `core/llm.py` | **Our direct OpenAI calls (bootstrap, chat) didn't set a reasoning effort, unlike Graphiti's own client.** On the default `gpt-5.5` they ran at the API's default, more expensive effort. Reasoning tokens count against `max_output_tokens` (1024 for chat), so long reasoning could leave no answer, which surfaced as a vague "did not return a text answer". | Reuse Graphiti's `_resolve_reasoning_effort` (gpt-5.5 → `none`, other reasoning models → `minimal`, non-reasoning models → omitted). Responses with `status="incomplete"` now raise with the actual reason (e.g. `max_output_tokens`). *Verified with a fake client only; there's no API key in the audit environment.* |
| B9 | Low | `routes/graph.py` | **`valid_from`/`valid_to` without a timezone filtered out every dated edge.** The neo4j driver sends a naive datetime as `LocalDateTime`, and comparing that to Graphiti's zoned `valid_at` yields `null`. The UI doesn't send these parameters yet. | Naive values are treated as UTC. |
| B10 | Low | `routes/chat.py` | A chat turn and its retrieval trace were committed separately, so a failure between the two left a turn whose "Explain" returned 404. | One commit for both. |
| B11 | Low | `routes/sources.py` | The upload was read fully into memory before the size limit was checked. | The spooled `UploadFile.size` is checked first. |

## Ingestion (parsing and chunking)

| ID | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| I1 | High | `parsing.py` DOCX | **Table content was dropped entirely** (`document.paragraphs` skips tables). Paragraphs were joined with single newlines, so the blank-line chunker saw the **whole document as one paragraph**: the sample handbook became 1 chunk even at `max_chars=500`. A long DOCX became one huge episode. | Walk paragraphs and tables in document order (`iter_inner_content`). Tables become ` \| `-separated rows. Blocks are separated by blank lines. The sample now gives 5 chunks at 500 characters. |
| I2 | Medium | `extraction_service.chunk_prose` | **Oversized paragraphs were never split.** Each extracted PDF page has no blank lines, so a chunk was always at least a full page, however small `extraction_chunk_chars` was. | Oversized paragraphs fall back to packing at line breaks. Text is still never cut mid-line. |
| I3 | Medium | `parsing.py` CSV | **pandas type inference rewrote cell values** in the source type extraction trusts most (weight 1.0): `02134` → `2134`, an integer column with one blank → floats (`42.0`), and `NA`/`null` → empty. | `dtype=str, keep_default_na=False`, plus `encoding_errors="replace"` to match the text parser. |
| I4 | Low | `extraction_service.chunk_csv` | Rows were split on raw newlines, so a quoted cell containing a line break was cut in half at a chunk boundary. | Rows are read and written with the `csv` module. |
| I5 | Low | `parsing.py` TXT/MD | A UTF-8 BOM leaked into the first chunk as `U+FEFF`. | Files are read as `utf-8-sig`. |

## Frontend

| ID | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| F1 | High | `GraphCanvas.tsx` | **The graph canvas was sized to the window, not its panel.** force-graph defaults `width` to `window.innerWidth`: a 1400px canvas sat inside an 854px panel, the graph was centered off-screen and clipped, and fit-to-view fit the invisible area. | A `ResizeObserver` passes the container's real width. The canvas mounts once that width is known. The unused `.graph-canvas-wrap` CSS rule is removed. |
| F2 | High | `GraphCanvas.tsx` | **An edge whose endpoint wasn't in the node list made force-graph throw `node not found`** as an uncaught error. This can happen in the Retrieval Inspector when a fact's endpoint couldn't be looked up. | Such links are dropped before they reach force-graph. |
| F3 | High | `OntologyStudio.tsx` | **You couldn't type more than one source/target entity type.** The input displayed `list.join(', ')` of the parsed value, so a typed comma was erased instantly: typing `Company, Person` produced `CompanyPerson`. | New `ListInput` keeps its own draft text, and re-syncs if the list changes from outside. |
| F4 | Medium | `GraphExplorer.tsx` | **Out-of-order responses showed stale data.** Every slider step fires a request; a slow earlier response could overwrite a newer one, leaving unfiltered data under the current filter. Reproduced. | Only the latest request may write state. The empty-state message now says when the *filters* exclude everything. |
| F5 | Medium | `GraphCanvas.tsx` | Clicking node A then node B quickly could show A's details under B's selection. | Same latest-request guard. |
| F6 | Medium | `api/client.ts` | FastAPI's request-validation 422s (where `detail` is a list) rendered as `HTTP 422: [object Object]`. | `formatDetail()` renders each item as `field: message`. |
| F7 | Medium | `Chat.tsx` | Answers' line breaks and lists collapsed into one run-on line. Pressing Enter to confirm an IME candidate (CJK input) sent a half-typed question. | `whitespace-pre-wrap` on questions and answers. Enter is ignored while `isComposing`. |
| F8 | Low | `SourcesPanel.tsx` | One shared spinner ID: when two sources ran at once, the first to finish cleared the other's spinner and re-enabled its button mid-run. The row badge read "not extracted" during extraction. `<ul>` had non-`<li>` children. | Per-source ID sets. The row shows `extracting` while running and the button is disabled. Proper `<li>` wrappers. |
| F9 | Low | `AppDataProvider.tsx` | Health badges were fetched once at load, so a Neo4j that started later (a case the backend's live check exists for) never showed as connected. | Polled every 30 s. |
| F10 | Low | `DashboardPage.tsx` | The normal "checking" state rendered as a red error badge on every load. Node and edge totals double-count entities shared across sources. | Neutral badge for "checking". The totals are labeled "summed across sources". |
| F11 | Low | `ui/Input.tsx`, `AppShell.tsx`, `index.css` | `resize-vertical` isn't a Tailwind utility, so textarea resizing styles were a no-op. The left-pinned mobile nav slid in from the right. | `resize-y`; added a slide-in-from-left animation. |

---

## Verification

**Backend:** `uv run pytest` passes **97 tests**: the 69 existing ones, unchanged, plus 28 new regression tests. `ruff check` is clean.
- To prove the new tests are real regression tests, they were run against the original application code with the test files kept: **22 fail** and `test_ontology_validation.py` can't even import (`validate_ontology` didn't exist). The only one that passes both ways is the oversize-upload test, which is expected: same outcome, rejected earlier.
- One-off reproduction scripts: S1 (file written outside the upload root), B5 (naive timestamps), and B6 (two concurrent `asyncio` requests. Originally both ran; now one returns 200, one 409, and `add_episode` is called once).

**Frontend:** `tsc -b`, `oxlint`, and `vite build` are clean. A Playwright run against production builds of the **original** and **fixed** code, with the backend API mocked:

| Check | Original | Fixed |
|---|---|---|
| F1 canvas width (854px panel) | 1400px | 852px |
| F3 typing `Company, Person` | `CompanyPerson` | `Company, Person` |
| F6 422 message | `[object Object]` | `entity_types.0.name: Field required` |
| F7 multi-line answer | collapsed | 3 lines (`pre-wrap`) |
| F2 trace with dangling edge | `node not found: ghost` thrown | no errors |
| F4 slow stale response vs. slider change | stale data shown | current data shown |

**Not verified live:** there's no Neo4j or OpenAI access in the audit environment. B3's Cypher (`[k IN keys(n) WHERE NOT k IN $reserved | [k, n[k]]]`, standard Neo4j 5 list comprehension plus dynamic property access) and B8's request shape are covered by unit tests against fakes, not by a real database or API call.

## Known issues (not fixed)

These need a design decision rather than a bug fix:

1. **Re-extraction duplicates episodes.** Re-running extraction on a source re-adds every chunk as a new episode. Graphiti dedupes entities and edges, but not episodes, and `episode_count` keeps accumulating. Fixing it needs an idempotency key per chunk (e.g. a content hash).
2. **Extraction runs inside the HTTP request.** Large files can outlast proxy or browser timeouts. `ARCHITECTURE.md` §5 already anticipates background jobs.
3. **No authentication, and cross-origin "simple" requests are accepted.** Any page the user visits can still trigger e.g. `POST /sources/{id}/extract`, which spends API credits. This is a stated MVP non-goal; S1 removed the worst consequence. Requiring a custom header or token would close it.
4. **Confidence weighting can compound.** For a deduplicated edge, Graphiti re-extracts attributes with the stored (already weighted) confidence as context. If the model echoes that value back, the source weight is applied a second time. Storing the raw LLM confidence separately would fix this, but needs a schema decision.
5. **Dashboard totals are upper bounds.** They are sums of per-source counts; exact numbers need a graph stats endpoint, which requires Neo4j.
6. **`OntologyVersion.version_number` has no unique constraint.** Simultaneous saves could produce duplicate version numbers. Low risk for a single user.
7. **The stale-`extracting` reset assumes one server process**, which is how the README runs it. With several workers, a restarting worker would reset a sibling's in-flight run.
8. **`ruff format` isn't enforced.** Three pre-existing files would be reformatted; they were left alone to keep this diff focused.
