# Frontend UI rehaul plan

This documents the redesign of `frontend/` from a single scrolling page into
a multi-page app, why each decision was made, and what's implemented vs.
left for later. Written alongside the Phase 1 implementation described
below; update this file as later phases land.

> **Phase 2 has landed** — an Obsidian-style workspace and a purpose-built
> graph engine that replaces `react-force-graph-2d`. Phase 1's routing,
> page split, and lifted app data still stand; its design tokens, shell,
> and the whole "Graph simulation" section below are superseded. See
> [Phase 2](#phase-2--obsidian-style-workspace-and-a-purpose-built-graph-engine).

## Why

The Phase 1-5 frontend (docs/ROADMAP.md) was built as one column of stacked
panels — Sources, Ontology Studio, Graph Explorer, Chat — all on `/`,
gated by whether an ontology existed yet. That was the right call while the
app had five things to show and one person building it; it stops being
right once there's enough surface area that "where do I go to do X" isn't
obvious at a glance, and once the Graph Explorer's canvas has to compete
with everything else for vertical space. This plan turns each panel into
its own page with real navigation, and treats the graph canvas itself —
the app's actual differentiator per `docs/VISION.md` — as worth dedicated
design attention rather than a fixed-height box at the bottom of the
column.

## Design direction (21st.dev-informed)

UI direction was pulled from 21st.dev's component catalog via its MCP
connector rather than designed from a blank page: `search` across
dashboard-sidebar, chat-interface, and stat-card components surfaced the
shape this kind of "structured data + chat" product tends to take
(collapsible sidebar nav with a workspace switcher and grouped sections,
composer-at-the-bottom chat with auto-resizing input and circular send
button, KPI stat-card grids), and `get_component` pulled full reference
implementations for a dashboard sidebar shell and an agent-chat composer to
ground the actual Tailwind/shadcn conventions used (CSS-variable semantic
tokens — `bg-card`, `text-muted-foreground`, `border-border` — rounded-xl
cards, `lucide-react` icons, a `cn()` class-merge helper).

Those references were used as **direction**, not pasted in: this app hand-rolls
its own primitives (`components/ui/*`) instead of installing the
third-party components verbatim, to avoid pulling in dependencies the app
doesn't otherwise need (`framer-motion`, `recharts`, a workspace switcher
with no second workspace to switch to) and to keep every component's code
readable in the same voice as the rest of the codebase. The shadcn
CSS-variable token convention is real, though: `index.css` defines the
same `background`/`foreground`/`card`/`border`/`primary`/`muted-foreground`
variable set those references use, so the token names read the same way
if a real shadcn/21st.dev component is dropped in later.

## What changed (Phase 1 -- this branch)

**Dependencies added:** `tailwindcss` v4 (+ `@tailwindcss/vite`),
`react-router-dom`, `lucide-react`, `clsx` + `tailwind-merge` (the `cn()`
helper), `d3-force` (typed access to the graph's force-simulation knobs).
No component-framework dependency (no shadcn CLI, no Radix) — the few
primitives needed (`Button`, `Card`, `Badge`, `Input`/`Textarea`, `Sheet`,
`EmptyState`) are ~30-80 lines each in `components/ui/`.

**Design tokens:** `index.css` now defines a shadcn-style semantic palette
(`--background`, `--foreground`, `--card`, `--primary`, `--muted-foreground`,
etc.) as CSS custom properties, light values on `:root` and dark
overrides under `@media (prefers-color-scheme: dark)` — same
system-preference-only theming the app already had (`lib/palette.ts`'s
`useThemeMode`), just extended to a full token set instead of the four
variables (`--text`, `--text-h`, `--bg`, `--border`) it had before. Tailwind's
`@theme inline` block maps those onto utility classes (`bg-card`,
`text-muted-foreground`, ...). `lib/palette.ts` itself — the canvas's own
categorical/confidence color ramps — is untouched; canvas drawing needs
concrete hex per mode, not CSS variables, and its own comment already
explains why. `--primary` reuses that file's `CATEGORICAL[0]` blue so the
brand accent and the graph's entity-type-1 color agree.

**Routing & shell:** `App.tsx` now wraps the app in `react-router-dom`,
with `AppShell` (a fixed sidebar) rendering the active route in its
outlet. `lib/appDataContext.ts` + `lib/AppDataContext.tsx` lift the health
checks and ontology state that used to live in `App.tsx`'s `useState`
calls into a context, so every page can read/update the same ontology
without prop-drilling through routes.

**Pages** (`src/pages/`), one per route:

| Route | Page | Notes |
|---|---|---|
| `/` | `DashboardPage` | New. Stat cards (sources, graph nodes/edges, ontology version), a "getting started" checklist that disappears once all four steps are done, quick-action cards to each other page. |
| `/sources` | `SourcesPage` | Wraps `SourcesPanel` (restyled: drag-and-drop dropzone, card rows, status pills). |
| `/ontology` | `OntologyPage` | Wraps `OntologyStudio` (restyled: cards, diff banner). |
| `/graph` | `GraphPage` | Wraps `GraphExplorer` (restyled filters bar; see below for the canvas itself). |
| `/chat` | `ChatPage` | Wraps `Chat` (restyled as a real chat UI); owns the "explain this answer" slide-over. |

Business logic in each wrapped component (`SourcesPanel`, `OntologyStudio`,
`GraphExplorer`, `Chat`, `RetrievalInspector`) is unchanged — same state,
same API calls, same effects — only the JSX/markup and styling changed to
Tailwind. `RetrievalInspector` is the one structural change: it used to be
its own full-width section pushed into the page below Chat; it's now
rendered inside `components/ui/Sheet.tsx`, a right-side slide-over that
`ChatPage` opens on "Explain this answer" and closes on backdrop
click/Escape/the close button — closer to how "inspect this answer"
actually gets used (a side reference while the conversation stays visible)
than a second full page section.

Graph Explorer and Chat both show an `EmptyState` card instead of being
hidden from the nav entirely when there's no ontology/graph yet (the old
app didn't render those sections at all pre-bootstrap) — you can now see
where you're headed and what unlocks it, rather than the nav item just not
existing yet.

## Graph simulation: smoother, more readable

This was the other explicit ask, and it's the app's actual differentiator
per `docs/VISION.md` ("almost nothing in this space lets you rewind the
graph" — the graph view is not a decoration). Changes, all in
`components/GraphCanvas.tsx`:

- **Force tuning.** Default `react-force-graph-2d` forces are tuned for
  generic graphs, not for a legend-driven entity/relation graph with
  variable-confidence edges. Charge (repulsion) strength is increased to
  `-160` with a `distanceMax` cap so far-apart clusters don't keep pushing
  each other across the canvas; link distance is set to `70px` so
  connected nodes have breathing room; a `forceCollide` (from `d3-force`,
  radius `NODE_RADIUS + 6`) is added — the default simulation has no
  collision force at all, so nodes can end up drawn on top of each other
  at rest.
- **Smoother settling, not a snap.** `d3AlphaDecay` is lowered slightly
  (`0.02` vs. the library default `~0.0228`) and `d3VelocityDecay` lowered
  more (`0.3` vs. `0.4`, so nodes keep more momentum per tick) — together
  the layout eases into place over ~250 cooldown ticks instead of
  jittering and stopping abruptly.
- **Curved parallel edges.** Two facts between the same pair of nodes used
  to draw as one indistinguishable line. Edges are now grouped by an
  order-independent `(source, target)` pair key; any pair with more than
  one edge gets `linkCurvature` bowed apart (`0.28`) so both are visible
  and clickable — pairs with a single edge stay straight, which reads more
  precisely than curving everything.
- **Readable labels.** Node labels (still zoom-gated past
  `LABEL_ZOOM_THRESHOLD`, unchanged) now draw a theme-aware translucent
  background pill behind the text instead of bare text over the canvas —
  legible over overlapping edges and node fills instead of fighting them
  for contrast.
- **Hover state + softer selection.** Nodes now respond to hover (a subtle
  halo) in addition to click-to-select (a stronger halo + ring), both
  drawn as a soft radial fill in the node's own color rather than a hard
  outline, which reads as depth rather than a UI chrome overlay.
- **Zoom/fit controls.** A small button cluster (zoom in / zoom out / fit
  to view) overlays the canvas — `zoomToFit()` in particular matters once
  a layout has spread out under the new charge strength; previously the
  only way to re-center was to zoom out further via scroll.
- **A softer canvas backdrop.** The canvas wrapper now sits on a subtle
  accent-tinted gradient instead of a flat card background, so the graph
  reads as a distinct "space" rather than another panel.

None of this changes `GraphCanvas`'s props or its role as the single
shared renderer for both `GraphExplorer` and `RetrievalInspector`
(`docs/ARCHITECTURE.md` §4's constraint) — both callers get the tuning for
free.

## What this phase deliberately left alone

- **No explicit light/dark toggle.** Theming is still system-preference-only
  (`useThemeMode`'s `matchMedia` listener); Tailwind's tokens follow the
  same `@media (prefers-color-scheme: dark)` pattern the app already used
  for its four original CSS variables, just extended. Adding a toggle is a
  small, separable follow-up (a `data-theme` attribute + a
  `localStorage`-backed override) if wanted later.
- **No new backend surface.** Every page still calls the same
  `api/client.ts` functions with the same shapes; the dashboard's stats
  are computed client-side from `listSources()` + `getChatHistory()`
  (summing `node_count`/`edge_count` already present on each `SourceRead`)
  rather than a new aggregate endpoint.
- **Mobile nav is functional, not polished.** `AppShell` collapses the
  sidebar into a hamburger-triggered overlay under `md:`, which works but
  wasn't the focus — this app's real usage is desktop-width graph
  exploration.

## Future directions

- ~~**A real command palette** (⌘K)~~ — done in Phase 2.
- **Time-slider on the Graph Explorer**, per `docs/VISION.md`'s own
  "future directions" — still open; see Phase 2's "Left for later".
- ~~**Persisted per-viewer UI state**~~ and ~~an explicit light/dark
  toggle~~ — done in Phase 2, along with `prefers-reduced-motion` support.

---

## Phase 2 — Obsidian-style workspace and a purpose-built graph engine

### Why

The ask was a complete rehaul of the graph viewer toward an Obsidian-vault
feel — calm motion, readability, ease of use — and a UI that reads as a
professional application. Phase 1's tuning of `react-force-graph-2d` had hit
the library's ceiling:

- **The layout reset on every filter change.** `GraphCanvas` rebuilt its
  node objects in a `useMemo` per data change, and force-graph keeps
  positions by object identity — so every filter tweak re-exploded the
  layout from scratch and destroyed the viewer's mental map.
- **Visual state changed in hard steps.** Hover and selection redrew
  instantly; there was no way to ease a whole neighborhood into focus
  while the rest fades back, which is most of what makes Obsidian's graph
  feel calm.
- **Labels couldn't be made readable at scale.** Node names were all-or-
  nothing past one zoom threshold, drawn per node with no collision
  handling, so dense regions turned into overlapping text.
- **Physics and drawing ran on separate loops**, and the canvas kept
  repainting while idle.

### Design language

`index.css` now carries an Obsidian-style token set: a neutral grey ramp
(`base-00` … `base-100`), one violet accent, flat surfaces separated by
hairline borders instead of shadows, and three text weights (`foreground`
/ `muted-foreground` / `faint-foreground`). Token names stay shadcn-style,
so utilities read the same as before.

- **Explicit theme toggle.** Dark mode is class-driven (`<html
  class="dark">`) via `lib/ThemeProvider.tsx` — system / light / dark,
  persisted — with a pre-paint script in `index.html` so dark-mode users
  never see a light flash. Tailwind's `dark:` variant is remapped to the
  class. The canvas reads its colors from `GRAPH_THEME` in
  `lib/palette.ts` (canvas can't use CSS variables), kept in step with
  the tokens; the validated entity-type `CATEGORICAL` palette is
  unchanged.
- **Self-hosted fonts.** Inter and JetBrains Mono ship via `@fontsource`
  instead of the Google Fonts CDN, so the UI renders in its typeface
  offline or behind a strict proxy.
- **Motion** uses one easing family (`ease-out-expo`) and short durations;
  overlays animate both in *and* out (`lib/usePresence.ts`), and
  `prefers-reduced-motion` disables decorative motion everywhere,
  including the graph (which then settles its layout synchronously).

### The workspace

`components/layout/AppShell.tsx` is modeled on Obsidian's window:

- **Ribbon** — a thin icon strip: sidebar toggle, one icon per view,
  command palette and theme toggle pinned to the bottom.
- **Explorer sidebar** — the "vault": uploaded sources as files (with
  extraction-status dots, linking to `/sources?focus=<id>`), entity types
  (graph-colored, linking to `/graph?types=<name>`), and relation types
  (`/graph?rels=<name>`). Collapsible (`⌘\`) and drag-resizable, both
  persisted.
- **Title bar** with a breadcrumb and an always-visible "Search or jump to…"
  entry point; **status bar** with service health, ontology version, and a
  slot pages render into (`StatusBarItem` — the graph shows interaction
  hints there).
- **Command palette** (`⌘K` / `⌘P`; Ctrl elsewhere) — fuzzy search over
  every registered command. The shell registers navigation, theme,
  sidebar, upload, entity types, and sources; the Graph Explorer
  registers graph actions plus one command per loaded node, so it doubles
  as Obsidian's quick switcher for entities (`lib/commandContext.ts`).
- Every view renders into a full-height `<main>` and owns its scrolling:
  document pages (Overview, Sources, Ontology) use a centered
  readable-width column with an inline title (`DocumentPage`,
  `PageHeader`); the graph is full-bleed; chat is a full-height column.
- Under `md`, the ribbon and sidebar collapse into a slide-in drawer, and
  the graph inspector becomes a bottom sheet.

### The graph engine (`src/graph/engine.ts`)

A framework-agnostic canvas renderer (~1,600 lines, no dependency beyond
`d3-force`), wrapped for React by `graph/GraphView.tsx`. It is still the
*one* renderer in the app (ARCHITECTURE.md §4): Graph Explorer, Retrieval
Inspector, the Overview preview, and Ontology Studio's new schema view
all draw through `GraphView`.

**Motion**
- Physics and drawing share one `requestAnimationFrame` loop (d3's timer
  is stopped; the simulation is ticked per frame). The loop **goes fully
  idle** once the layout, camera, and every transition have settled, and
  wakes on input or data.
- Every visual state is an eased per-element value (exponential approach
  with a time constant), never a swap: hover/selection dimming, emphasis,
  selection rings, label visibility, and nodes/links entering (scale-in
  with a slight overshoot) or leaving (fade in place).
- The camera eases: wheel zoom is anchored to the cursor and smoothed
  against a target camera so rapid ticks compose; fit / center-on / zoom
  buttons are timed flights; a pan carries its release velocity into an
  inertial glide; while a fresh layout blooms, the camera tracks it.

**Layout continuity**
- `setData` *merges* into the running simulation: surviving nodes keep
  position and velocity, new nodes spawn beside an already-placed
  neighbor, removed ones freeze and fade. Nodes that leave are remembered,
  so toggling a filter or local graph off brings everything back where
  you last saw it.
- Reheating is proportional to how much changed, and a no-op refresh
  doesn't reheat at all.

**Readability**
- Node radius grows with degree (hubs read as hubs); everything is drawn
  in screen space, so text and hairlines stay crisp at any zoom and DPR.
- Labels fade in with zoom (the "text fade threshold" slider), earlier for
  hubs; are placed **greedily by priority on a collision grid** so they
  never overlap; and get a background-colored halo instead of a box.
- Relation names are drawn along emphasized links (and every link at close
  zoom), rotated to stay upright. Parallel facts between the same pair bow
  apart symmetrically.
- Confidence is encoded as link opacity, with unscored facts dashed (so
  "nobody scored this" never reads as "scored zero") — the same number
  the inspector and chat citations show as a meter.

**Interaction**
- Hover (or select) a node: its neighborhood stays lit with accent-colored
  links and relation labels while everything else recedes. Hover a link
  for its fact. Drag nodes; pinch on touch; double-click to focus.
- Hover re-evaluates when the camera moves under a still cursor.

### Graph view UI (`src/graph/`)

- **Search** (top-left, `/` or `⌘F`): server-side filter over facts and
  names as before; Enter jumps to the best-matching node.
- **Settings panel** (top-right, closed by default like Obsidian's;
  badge counts active filters): *Filters* — minimum confidence, facts
  loaded (100–1000), entity-type and relation chips; *Display* — color by
  type, arrows, confidence as opacity (with a key), relation labels, text
  fade threshold, node size, link thickness; *Forces* — center, repel,
  link force, link distance. All live, all persisted, each section
  resettable; plus **Replay growth** (Obsidian's "animate": the graph
  regrows in the order facts were recorded).
- **Legend** (bottom-left): hover a type to spotlight its nodes; click to
  toggle it in the type filter.
- **Toolbar** (bottom-right): zoom, fit, local graph, full screen.
- **Inspector** (right pane): a node's properties (Obsidian-style property
  rows), summary, **Outgoing links** and **Backlinks** (hovering one
  highlights that fact on the canvas; clicking a name walks to it), and
  **Sources** with excerpts; or, for a fact, its endpoints, confidence,
  and bi-temporal dates. Back/forward history (`[` / `]`), and details
  are cached for instant navigation.
- **Local graph** (`L`): the selected node's 1–3-hop neighborhood, framed
  automatically; selecting another node walks the local graph with it.
- **URL state**: `?types=`, `?rels=`, and `?node=` are the source of
  truth, so the sidebar, palette, and shared links deep-link into an
  exact view. Fits and centering account for open panels, so nodes never
  land under the inspector.

| Shortcut | Action |
|---|---|
| `⌘K` / `⌘P` | Command palette (pages, actions, types, sources, nodes) |
| `⌘\` | Toggle sidebar |
| `/`, `⌘F` | Focus graph search (Enter jumps to the best match) |
| `F` | Fit graph (or the local graph) to view |
| `+` / `−` | Zoom |
| `L` | Toggle local graph for the selected node |
| `[` / `]` | Back / forward through inspected nodes and facts |
| `Esc` | Close the inspector, then exit local graph |
| `↑` / `↓` | Step through facts in the Retrieval Inspector |

### Other pages

- **Overview** — a stats strip, a task-list "getting started" with
  progress, a live graph preview (click a node to open it in the graph),
  recent sources and questions.
- **Sources** — a file list with status pills and metadata; upload many
  files at once, by button or by dropping anywhere on the page;
  `?focus=<id>` scrolls to and flashes a row.
- **Ontology** — collapsible type rows color-keyed to the graph; relation
  endpoints picked from entity-type chips instead of comma-separated text;
  a sticky unsaved-changes bar (discard / save); the version diff as a
  callout; and a **Schema graph** tab drawing entity types and allowed
  relations through `GraphView` (as ARCHITECTURE.md §4 anticipated).
- **Chat** — the question appears immediately with a "searching the graph"
  indicator; `[n]` markers become citation chips that show their fact on
  hover; copy and "Explain this answer" actions; starter prompts derived
  from the ontology. The **Retrieval Inspector** renders the trace through
  `GraphView` and lists facts as a ranked, clickable timeline.

Business logic is unchanged: same API calls and shapes, same
auto-bootstrap on first upload, same ontology versioning. Sources moved
into `AppDataProvider` so the sidebar, Overview, and Sources page share
one list.

### How it was verified

`tsc -b` and `oxlint` are clean, and the production build is smaller than
before (≈439 kB vs ≈496 kB JS) despite the added UI, because the custom
engine is lighter than `react-force-graph-2d` and its dependencies.
Behavior was checked in headless Chromium (Playwright) against mocked API
responses, in dark, light, and a 390 px mobile viewport: palette → jump to
node → inspector → hover → local graph → settings; every page; the
Retrieval Inspector. With 700 nodes / 1,000 facts the layout animated at a
steady 60 fps (worst frame 16.8 ms, software rendering), and once settled
the app scheduled **zero** animation frames.

### Left for later

- **Time slider** over `valid_at` / `invalid_at` (VISION.md) — the
  inspector now shows the dates and Replay animates by recorded time; a
  true "as of" scrubber is the natural next step on top of the engine.
- **Highlight-only search** — search filters server-side; a client-side
  "dim non-matches" mode would keep surrounding context visible.
- **Automated UI tests** — the repo has no frontend test setup; the
  Playwright checks above were run ad hoc.
