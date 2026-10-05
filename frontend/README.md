# Graph Buddy — frontend

React + TypeScript, scaffolded with Vite. See the repo root [`README.md`](../README.md) for how this fits together with the backend and Neo4j.

```sh
npm install
npm run dev      # http://localhost:5173, expects the backend at VITE_API_BASE_URL (see .env.example)
npm run build    # type-check + production build
npm run lint      # oxlint
```

## Layout

```
src/
  graph/        the graph engine (engine.ts) and everything graph-view:
                GraphView (the one React renderer), GraphExplorer, settings
                panel, inspector, legend, controls
  components/   page-level components (Chat, SourcesPanel, OntologyStudio,
                RetrievalInspector, CommandPalette), layout/ (the
                Obsidian-style shell), ui/ (primitives)
  pages/        one component per route
  lib/          app data, theme, command registry, palette, hooks, helpers
  api/          typed client for the backend
```

Design notes, the graph engine's internals, and keyboard shortcuts are in
[`docs/UI_REHAUL_PLAN.md`](../docs/UI_REHAUL_PLAN.md) (Phase 2).
