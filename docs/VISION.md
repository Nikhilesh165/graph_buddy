# Vision

This is the "why" document. `ARCHITECTURE.md` and `ROADMAP.md` are what we're building and in what order; this is why it's worth building and where it goes after the MVP.

## The problem

Three specific failure modes this app is a bet against:

1. **Structure gets flattened.** Standard RAG (chunk → embed → vector search) throws away relationships. "Which customers who complained about latency also churned in Q3" is a multi-hop, relational question — a vector store answers it badly because it was never designed to represent the *join*, only the text.
2. **Semantic layers are a one-time consulting project, not a living thing.** Ontology and data-modeling work (dbt semantic layers, data catalogs, Palantir-style ontologies) is expensive, manually maintained, and stale within months. Most teams — and nearly all individuals — never get one at all because the upfront cost never pencils out.
3. **AI answers about your data are black boxes.** "The assistant said X" isn't good enough once the stakes go up — compliance, financial figures, anything you'd have to defend in a meeting. Nobody can point at *why* without re-deriving it by hand.

The thesis: **make the semantic layer a byproduct of use instead of a project, and make the resulting reasoning inspectable by default.**

## Who this is for

- **A solo analyst or consultant** juggling interview transcripts, reports, and spreadsheets for one engagement, who currently keeps the connections between them in their head.
- **A small team** (product, support, research) whose institutional knowledge is scattered across docs, tickets, and postmortems, where "how does this incident relate to that customer complaint" is a real question nobody can answer fast.
- **Someone exploring a warehouse they didn't design** — wants to ask a business question in plain language but wants to *see the join path* before trusting the number, because wrong joins are how bad numbers get into board decks.
- **Anyone in an audit-sensitive domain** (legal, healthcare, finance) where an answer without a provenance chain is worthless regardless of how correct it is.
- **A power user's "second brain"** — years of notes and articles where the value isn't retrieval, it's that the system's model of your interests gets sharper over time instead of just getting bigger.

## Why this beats the obvious alternatives

| Alternative | Why it falls short |
|---|---|
| ChatGPT/Claude + file upload, typical LangChain RAG | No persistent structure, no multi-hop reasoning, answers are unauditable, memory doesn't survive or improve across sessions |
| BI/dashboard tools (Looker, Tableau) | Require someone to have already asked the question and built the metric — no open-ended exploration, no NL interface |
| Data catalogs (Alation, Atlan) | Metadata-focused and mostly static/human-curated — not a live, queryable graph, no conversational retrieval |
| Palantir-style ontology platforms | Conceptually closest, but it's an enterprise consulting engagement — heavy, expensive, opaque, nothing like self-bootstrapping from a file upload |
| Hand-built Neo4j + ETL | Someone has to design the ontology and write the extraction pipeline by hand — this app's whole bet is automating that bootstrap and keeping it alive |

## The core value proposition

Most tools give you either structure (BI, catalogs) or fluency (chatbots) — this tries to give you both, and to make the structure get *better* instead of stale. The two feedback loops in the architecture are the value, not just plumbing:

- **The discovery cycle** means the ontology gets more accurate the more you use it, not staler — attacking failure mode #2 directly.
- **The retrieval trace UI** means every answer carries its receipts — attacking failure mode #3, and it's the feature that makes this defensible in front of a skeptical stakeholder in a way a chat bubble never is.

Confidence scoring and the periodic change digest (now baked into `ARCHITECTURE.md` §3.7 and §3.4) are extensions of that same thesis: trust isn't just "show your work once," it's "keep telling me how sure you are, and what changed."

## Future directions (post-MVP)

These didn't make the MVP plan, but each is a natural extension of a system that already exists by Phase 8 — worth revisiting once the core loop is running.

### Contradictions as a first-class view
The Discovery Feed (Phase 6/7) already flags contradictions as one entry type among others. When two sources disagree, that's often the *most* valuable thing to surface — not a footnote in a timeline. A dedicated "Tensions" view, filterable and separate from routine digest noise, would let a user triage disagreements directly instead of scrolling past them.

### Domain ontology starter templates
The LLM-driven bootstrap (Phase 1) works from a blank slate every time. A library of starter templates (customer support, research, sales, compliance) — pre-defined entity/relation types a user starts from and edits rather than generates from scratch — would meaningfully improve cold-start ontology quality and is cheap to build once a few real ontologies exist to generalize from.

### Ontology export
Right now the ontology is a walled garden — useful inside this app, invisible outside it. Exporting it as a schema or API other tools can consume (feed into a dbt semantic layer, another team's pipeline, a docs generator) turns it from a feature into reusable infrastructure. This is a real moat if the app ever needs to plug into something the user already has, rather than asking them to route everything through it.

### Time-slider on the Graph Explorer
Bi-temporal edges (`valid_at`/`invalid_at`) are already in the data model for free via Graphiti — the MVP just doesn't expose them. A time-slider on the Graph Explorer ("how did this entity's relationships look 3 months ago") is mostly UI work on data that already exists, and it's a genuinely differentiated feature: almost nothing in this space lets you rewind the graph.
