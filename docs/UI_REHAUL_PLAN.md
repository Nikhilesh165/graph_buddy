# Frontend UI rehaul plan

This documents the redesign of `frontend/` from a single scrolling page into
a multi-page app, why each decision was made, and what's implemented vs.
left for later. Written alongside the Phase 1 implementation described
below (all of it is in this branch); update this file as later phases land.

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

- **A real command palette** (⌘K) for jumping between pages / searching
  sources or entities directly, now that there's more than one page to
  jump between — the dashboard-sidebar reference pulled from 21st.dev had
  one; it wasn't built here because there's nothing yet to search across
  pages for beyond what each page's own search box already covers.
- **Time-slider on the Graph Explorer**, per `docs/VISION.md`'s own
  "future directions" — bi-temporal edges already exist in the data model;
  this rehaul's graph work (curvature, force tuning) is now the base a
  time-scrubbing view would sit on top of.
- **Persisted per-viewer UI state** (last-visited page, collapsed sidebar
  on desktop, a11y prefers-reduced-motion opt-out for the force
  simulation) — none of it needed a redesign decision, just wasn't in
  scope for this pass.
