import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  Loader2,
  Network,
  Play,
  RefreshCw,
  ScanSearch,
  Search,
  SearchX,
  Share2,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { getGraph, getGraphNode } from '../api/client'
import { StatusBarItem } from '../components/layout/StatusBar'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Kbd } from '../components/ui/Kbd'
import { cn } from '../lib/cn'
import { useCommandPalette, type Command } from '../lib/commandContext'
import { humanizeRelation, pluralize } from '../lib/format'
import { typeColor } from '../lib/palette'
import { mergeSettings, usePersistentState } from '../lib/storage'
import { useThemeMode } from '../lib/themeContext'
import { useDebounced } from '../lib/useDebounced'
import { useMediaQuery } from '../lib/useMediaQuery'
import { usePresence } from '../lib/usePresence'
import type { GraphEdge, GraphNode, GraphQueryResult, NodeDetail, OntologyVersion } from '../types'
import { GraphControls } from './GraphControls'
import { GraphInspector, type InspectorSelection } from './GraphInspector'
import { GraphLegend } from './GraphLegend'
import { GraphSettingsPanel } from './GraphSettingsPanel'
import { GraphView, type GraphViewHandle } from './GraphView'
import { neighborhood } from './neighborhood'
import { DEFAULT_GRAPH_SETTINGS, type GraphFilterState } from './settings'

type Props = {
  ontology: OntologyVersion
}

const INSPECTOR_WIDTH = 360
const PANEL_WIDTH = 288
const EDGE_GAP = 12
const REPLAY_MS = 5200

function sameSelection(a: InspectorSelection | null, b: InspectorSelection | null): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id)
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]')
}

/** The Graph Explorer as a full-bleed workspace, modeled on Obsidian's
 * graph view: the canvas fills the pane, and search, settings, legend,
 * camera controls, and the node inspector float over it. Filters that the
 * backend can apply (types, relations, confidence, search, limit) are
 * server-side, as before; local-graph, legend spotlight, and replay are
 * client-side views over what's loaded. */
export function GraphExplorer({ ontology }: Props) {
  const mode = useThemeMode()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const rootRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<GraphViewHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // --- filters ----------------------------------------------------------
  // Type filters and the selected node live in the URL so the sidebar,
  // the command palette, and shared links can deep-link into the graph.
  const typesParam = searchParams.get('types') ?? ''
  const entityTypes = useMemo(() => typesParam.split(',').filter(Boolean), [typesParam])
  const relsParam = searchParams.get('rels') ?? ''
  const relationTypes = useMemo(() => relsParam.split(',').filter(Boolean), [relsParam])
  const selectedNodeId = searchParams.get('node')

  const [minConfidence, setMinConfidence] = useState(0)
  const [limit, setLimit] = usePersistentState('graph.limit', 300)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput.trim(), 280)
  const debouncedConfidence = useDebounced(minConfidence, 180)

  const [settings, setSettings] = usePersistentState('graph.settings', DEFAULT_GRAPH_SETTINGS, mergeSettings)
  const [panelOpen, setPanelOpen] = usePersistentState('graph.panelOpen', false)

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          mutate(next)
          return next
        },
        { replace: true },
      ),
    [setSearchParams],
  )

  const setListParam = useCallback(
    (key: string, values: string[]) =>
      updateParams((p) => {
        if (values.length > 0) p.set(key, values.join(','))
        else p.delete(key)
      }),
    [updateParams],
  )
  const setEntityTypes = useCallback((types: string[]) => setListParam('types', types), [setListParam])
  const setRelationTypes = useCallback((rels: string[]) => setListParam('rels', rels), [setListParam])

  const filters: GraphFilterState = { minConfidence, limit, entityTypes, relationTypes }
  const filtersActive = entityTypes.length > 0 || relationTypes.length > 0 || minConfidence > 0 || search !== ''

  function updateFilters(patch: Partial<GraphFilterState>) {
    if (patch.minConfidence !== undefined) setMinConfidence(patch.minConfidence)
    if (patch.limit !== undefined) setLimit(patch.limit)
    if (patch.entityTypes !== undefined) setEntityTypes(patch.entityTypes)
    if (patch.relationTypes !== undefined) setRelationTypes(patch.relationTypes)
  }

  function resetFilters() {
    setMinConfidence(0)
    updateParams((p) => {
      p.delete('types')
      p.delete('rels')
    })
    setSearchInput('')
  }

  // --- data -------------------------------------------------------------
  // `loading` is derived (the latest request hasn't settled yet) rather
  // than set at the top of the effect; the previous graph stays on screen
  // while the next one loads, so filter changes animate instead of flash.
  const [data, setData] = useState<GraphQueryResult | null>(null)
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const requestKey = JSON.stringify([typesParam, relsParam, debouncedConfidence, search, limit, reloadToken])
  const loading = settled?.key !== requestKey
  const error = settled?.key === requestKey ? settled.error : null

  useEffect(() => {
    let cancelled = false
    getGraph({
      entityTypes: entityTypes.length > 0 ? entityTypes : undefined,
      relationTypes: relationTypes.length > 0 ? relationTypes : undefined,
      minConfidence: debouncedConfidence,
      search: search || undefined,
      limit,
    })
      .then((result) => {
        if (cancelled) return
        setData(result)
        setSettled({ key: requestKey, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled) setSettled({ key: requestKey, error: err instanceof Error ? err.message : 'Failed to load graph' })
      })
    return () => {
      cancelled = true
    }
    // requestKey encodes every input the request reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  const entityTypeOrder = useMemo(() => ontology.entity_types.map((et) => et.name), [ontology])
  const colorForType = useCallback((type: string) => typeColor(mode, entityTypeOrder, type), [mode, entityTypeOrder])

  // --- node details (cached for instant back/forward) --------------------
  const [details, setDetails] = useState<Record<string, NodeDetail>>({})
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({})
  const [detailRetry, setDetailRetry] = useState(0)

  useEffect(() => {
    if (!selectedNodeId || details[selectedNodeId] || detailErrors[selectedNodeId]) return
    let cancelled = false
    const id = selectedNodeId
    getGraphNode(id)
      .then((detail) => {
        if (!cancelled) setDetails((prev) => ({ ...prev, [id]: detail }))
      })
      .catch((err: unknown) => {
        if (!cancelled) setDetailErrors((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : 'Failed to load node' }))
      })
    return () => {
      cancelled = true
    }
  }, [selectedNodeId, details, detailErrors, detailRetry])

  function reload() {
    setDetails({})
    setDetailErrors({})
    setReloadToken((t) => t + 1)
  }

  // Everything we know about nodes/edges -- the loaded graph plus anything
  // seen in node details (neighbors that are filtered out of the view).
  const nodeIndex = useMemo(() => {
    const map = new Map<string, GraphNode>()
    for (const detail of Object.values(details)) {
      map.set(detail.node.uuid, detail.node)
      for (const n of detail.neighbors) map.set(n.node.uuid, n.node)
    }
    for (const n of data?.nodes ?? []) map.set(n.uuid, n)
    return map
  }, [data, details])

  const edgeIndex = useMemo(() => {
    const map = new Map<string, GraphEdge>()
    for (const detail of Object.values(details)) for (const n of detail.neighbors) map.set(n.edge.uuid, n.edge)
    for (const e of data?.edges ?? []) map.set(e.uuid, e)
    return map
  }, [data, details])

  const loadedNodeIds = useMemo(() => new Set((data?.nodes ?? []).map((n) => n.uuid)), [data])

  // --- selection + history ------------------------------------------------
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const selection: InspectorSelection | null = selectedNodeId
    ? { kind: 'node', id: selectedNodeId }
    : selectedEdgeId
      ? { kind: 'edge', id: selectedEdgeId }
      : null
  const [history, setHistory] = useState<{ stack: InspectorSelection[]; index: number }>(() =>
    selectedNodeId ? { stack: [{ kind: 'node', id: selectedNodeId }], index: 0 } : { stack: [], index: -1 },
  )
  const [localRoot, setLocalRoot] = useState<string | null>(null)
  const [localDepth, setLocalDepth] = usePersistentState('graph.localDepth', 1)
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null)

  const applySelection = useCallback(
    (sel: InspectorSelection | null) => {
      updateParams((p) => {
        if (sel?.kind === 'node') p.set('node', sel.id)
        else p.delete('node')
      })
      setSelectedEdgeId(sel?.kind === 'edge' ? sel.id : null)
      setHoverEdgeId(null)
      if (sel?.kind === 'node') setLocalRoot((root) => (root ? sel.id : root))
    },
    [updateParams],
  )

  // Centering waits for the render that actually shows the new selection
  // (react-router applies URL updates in a transition), so the camera
  // targets the area the open inspector leaves visible.
  const centerRequest = useRef<string | null>(null)
  useEffect(() => {
    if (!centerRequest.current || centerRequest.current !== selectedNodeId) return
    graphRef.current?.centerOn(centerRequest.current)
    centerRequest.current = null
  })

  function select(sel: InspectorSelection | null, options: { center?: boolean } = {}) {
    if (sameSelection(sel, selection)) {
      if (sel?.kind === 'node' && options.center) graphRef.current?.centerOn(sel.id)
      return
    }
    if (sel?.kind === 'node' && options.center) centerRequest.current = sel.id
    applySelection(sel)
    if (sel) {
      setHistory((h) => {
        const stack = [...h.stack.slice(0, h.index + 1), sel].slice(-60)
        return { stack, index: stack.length - 1 }
      })
    }
  }

  function goHistory(delta: number) {
    const index = history.index + delta
    if (index < 0 || index >= history.stack.length) return
    const target = history.stack[index]
    setHistory({ ...history, index })
    applySelection(target)
    if (target.kind === 'node') centerRequest.current = target.id
  }

  function closeInspector() {
    applySelection(null)
  }

  // Keep the inspected node out from under the inspector panel.
  useEffect(() => {
    if (!selectedNodeId) return
    const timer = window.setTimeout(() => graphRef.current?.ensureVisible(selectedNodeId), 60)
    return () => window.clearTimeout(timer)
  }, [selectedNodeId])

  // Deep link (`/graph?node=...`): once the first layout has mostly
  // settled, glide to the linked node.
  const pendingCenter = useRef(selectedNodeId)
  useEffect(() => {
    const id = pendingCenter.current
    if (!id || !data) return
    pendingCenter.current = null
    const timer = window.setTimeout(() => graphRef.current?.centerOn(id, 1.6), 1100)
    return () => window.clearTimeout(timer)
  }, [data])

  // --- local graph ------------------------------------------------------
  const localActive = localRoot !== null && loadedNodeIds.has(localRoot)
  const localIds = useMemo(
    () => (localActive && data && localRoot ? neighborhood(data.edges, localRoot, localDepth) : null),
    [localActive, data, localRoot, localDepth],
  )

  function toggleLocalGraph() {
    if (localRoot) setLocalRoot(null)
    else if (selectedNodeId && loadedNodeIds.has(selectedNodeId)) setLocalRoot(selectedNodeId)
  }

  // Frame the neighborhood whenever it changes; frame everything on exit.
  const localKey = localIds ? `${localRoot}:${localDepth}:${localIds.size}` : ''
  const previousLocalKey = useRef('')
  useEffect(() => {
    if (localKey === previousLocalKey.current) return
    const wasLocal = previousLocalKey.current !== ''
    previousLocalKey.current = localKey
    if (localIds) graphRef.current?.fit(localIds)
    else if (wasLocal) graphRef.current?.fit()
  }, [localKey, localIds])

  // --- replay (Obsidian's "animate"): regrow the graph in the order
  // facts were recorded -------------------------------------------------
  // A replay belongs to the data it started from; new data (a filter
  // change) ends it implicitly.
  const [replayState, setReplay] = useState<{ shown: number; source: GraphQueryResult | null } | null>(null)
  const replay = replayState && replayState.source === data ? replayState : null
  const [graphEpoch, setGraphEpoch] = useState(0)
  const replayOrder = useMemo(
    () => [...(data?.edges ?? [])].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')),
    [data],
  )

  function toggleReplay() {
    if (replay) {
      setReplay(null)
      return
    }
    setLocalRoot(null)
    setGraphEpoch((e) => e + 1) // fresh engine: the layout regrows from nothing
    setReplay({ shown: 0, source: data })
  }

  useEffect(() => {
    if (!replay) return
    const total = replayOrder.length
    if (replay.shown >= total) {
      const timer = window.setTimeout(() => setReplay(null), 600)
      return () => window.clearTimeout(timer)
    }
    const steps = Math.min(64, Math.max(1, total))
    const stepSize = Math.ceil(total / steps)
    const timer = window.setTimeout(
      () => {
        setReplay((r) => (r ? { ...r, shown: Math.min(total, r.shown + stepSize) } : r))
        graphRef.current?.followFit(1400)
      },
      replay.shown === 0 ? 200 : REPLAY_MS / steps,
    )
    return () => window.clearTimeout(timer)
  }, [replay, replayOrder.length])

  // --- what the canvas draws --------------------------------------------
  const view = useMemo(() => {
    if (!data) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] }
    if (!replay && !localIds) return { nodes: data.nodes, edges: data.edges }
    let edges = replay ? replayOrder.slice(0, replay.shown) : data.edges
    if (localIds) edges = edges.filter((e) => localIds.has(e.source) && localIds.has(e.target))
    const ids = new Set<string>()
    for (const e of edges) {
      ids.add(e.source)
      ids.add(e.target)
    }
    return { nodes: data.nodes.filter((n) => ids.has(n.uuid)), edges }
  }, [data, replay, replayOrder, localIds])

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of view.nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
    return counts
  }, [view.nodes])

  const legendEntries = useMemo(() => {
    const rank = (t: string) => {
      const i = entityTypeOrder.indexOf(t)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return [...typeCounts.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([name, count]) => ({ name, count, color: colorForType(name) }))
  }, [typeCounts, entityTypeOrder, colorForType])

  const entityChips = useMemo(() => {
    const names = [...entityTypeOrder]
    for (const t of typeCounts.keys()) if (!names.includes(t)) names.push(t)
    return names.map((name) => ({ name, count: typeCounts.get(name) ?? 0, color: colorForType(name) }))
  }, [entityTypeOrder, typeCounts, colorForType])

  const relationChips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of data?.edges ?? []) counts.set(e.name, (counts.get(e.name) ?? 0) + 1)
    const names = ontology.relation_types.map((rt) => rt.name)
    for (const name of counts.keys()) if (!names.includes(name)) names.push(name)
    return names.map((name) => ({ name, count: counts.get(name) ?? 0 }))
  }, [data, ontology])

  const [hoverType, setHoverType] = useState<string | null>(null)
  const highlight = useMemo(() => {
    if (!hoverType) return null
    return new Set(view.nodes.filter((n) => n.type === hoverType).map((n) => n.uuid))
  }, [hoverType, view.nodes])

  // --- inspector presence -------------------------------------------------
  const { mounted: inspectorMounted, closing: inspectorClosing } = usePresence(selection !== null, 200)
  const [shownSelection, setShownSelection] = useState(selection)
  if (selection && !sameSelection(selection, shownSelection)) setShownSelection(selection)
  const inspectorSelection = selection ?? shownSelection
  const inspectorOpen = selection !== null
  const rightOffset = inspectorOpen && isDesktop ? INSPECTOR_WIDTH + EDGE_GAP * 2 : EDGE_GAP
  // Screen area covered by floating panels, so fit / center-on frame the
  // part of the canvas you can actually see.
  const insets = useMemo(() => {
    if (!isDesktop) return { right: 0, bottom: inspectorOpen ? Math.round(window.innerHeight * 0.5) : 0 }
    const right = (inspectorOpen ? INSPECTOR_WIDTH + EDGE_GAP : 0) + (panelOpen ? PANEL_WIDTH + EDGE_GAP : 0)
    return { right, bottom: 0 }
  }, [inspectorOpen, isDesktop, panelOpen])

  // --- fullscreen -------------------------------------------------------
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void rootRef.current?.requestFullscreen?.()
  }

  // --- search: Enter jumps to the best-matching node ----------------------
  function jumpToSearchMatch() {
    const q = searchInput.trim().toLowerCase()
    if (!q || !data) return
    const nodes = data.nodes
    const match =
      nodes.find((n) => n.name.toLowerCase() === q) ??
      nodes.find((n) => n.name.toLowerCase().startsWith(q)) ??
      nodes.find((n) => n.name.toLowerCase().includes(q))
    if (match) select({ kind: 'node', id: match.uuid }, { center: true })
  }

  // --- keyboard shortcuts -------------------------------------------------
  const shortcuts = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    shortcuts.current = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case '/':
          e.preventDefault()
          searchRef.current?.focus()
          break
        case 'f':
        case 'F':
          graphRef.current?.fit(localIds ?? undefined)
          break
        case '+':
        case '=':
          graphRef.current?.zoomIn()
          break
        case '-':
        case '_':
          graphRef.current?.zoomOut()
          break
        case 'l':
        case 'L':
          toggleLocalGraph()
          break
        case '[':
          goHistory(-1)
          break
        case ']':
          goHistory(1)
          break
        case 'Escape':
          if (selection) closeInspector()
          else if (localRoot) setLocalRoot(null)
          break
        default:
          return
      }
    }
  })
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => shortcuts.current(e)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // --- command palette: graph actions + every loaded node ---------------
  // Commands call through `actions` (refreshed every render) so they always
  // see current state; they're built in an effect, where reading refs is
  // allowed, and only rebuilt when the node list changes.
  const { register, unregister } = useCommandPalette()
  const actions = useRef({ select, toggleLocalGraph, toggleReplay, setPanelOpen, fit: () => {} })
  useEffect(() => {
    actions.current = {
      select,
      toggleLocalGraph,
      toggleReplay,
      setPanelOpen,
      fit: () => graphRef.current?.fit(localIds ?? undefined),
    }
  })
  useEffect(() => {
    const list: Command[] = [
      { id: 'graph:fit', title: 'Fit graph to view', group: 'Graph', icon: ScanSearch, shortcut: ['F'], run: () => actions.current.fit() },
      {
        id: 'graph:local',
        title: 'Toggle local graph',
        group: 'Graph',
        icon: Network,
        shortcut: ['L'],
        keywords: 'neighborhood focus depth',
        run: () => actions.current.toggleLocalGraph(),
      },
      {
        id: 'graph:settings',
        title: 'Toggle graph settings',
        group: 'Graph',
        icon: SlidersHorizontal,
        keywords: 'filters display forces',
        run: () => actions.current.setPanelOpen((o) => !o),
      },
      {
        id: 'graph:replay',
        title: 'Replay graph growth',
        group: 'Graph',
        icon: Play,
        keywords: 'animate timelapse history',
        run: () => actions.current.toggleReplay(),
      },
      {
        id: 'graph:search',
        title: 'Search the graph',
        group: 'Graph',
        icon: Search,
        shortcut: ['/'],
        run: () => searchRef.current?.focus(),
      },
    ]
    for (const node of data?.nodes ?? []) {
      list.push({
        id: `node:${node.uuid}`,
        title: node.name,
        subtitle: node.type,
        group: 'Nodes',
        color: colorForType(node.type),
        run: () => actions.current.select({ kind: 'node', id: node.uuid }, { center: true }),
      })
    }
    register('graph', list)
  }, [data, colorForType, register])
  useEffect(() => () => unregister('graph'), [unregister])

  // --- render -----------------------------------------------------------
  const edgeForInspector = inspectorSelection?.kind === 'edge' ? (edgeIndex.get(inspectorSelection.id) ?? null) : null
  const nodeDetail = inspectorSelection?.kind === 'node' ? (details[inspectorSelection.id] ?? null) : null
  const nodeError = inspectorSelection?.kind === 'node' ? (detailErrors[inspectorSelection.id] ?? null) : null
  const showEmpty = !!data && view.nodes.length === 0 && !replay && !loading
  const localRootName = localRoot ? nodeIndex.get(localRoot)?.name : undefined

  const activeChips: { key: string; label: string; onRemove: () => void }[] = [
    ...entityTypes.map((t) => ({
      key: `t:${t}`,
      label: t,
      onRemove: () => setEntityTypes(entityTypes.filter((x) => x !== t)),
    })),
    ...relationTypes.map((r) => ({
      key: `r:${r}`,
      label: humanizeRelation(r),
      onRemove: () => setRelationTypes(relationTypes.filter((x) => x !== r)),
    })),
    ...(minConfidence > 0
      ? [{ key: 'c', label: `confidence ≥ ${minConfidence.toFixed(2)}`, onRemove: () => setMinConfidence(0) }]
      : []),
  ]

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden bg-background">
      <StatusBarItem>
        <span className="text-faint-foreground">Drag to pan · Scroll to zoom · Click a node to inspect · Double-click to focus</span>
      </StatusBarItem>
      <GraphView
        key={graphEpoch}
        ref={graphRef}
        className="absolute inset-0"
        nodes={view.nodes}
        edges={view.edges}
        entityTypeOrder={entityTypeOrder}
        settings={settings}
        selectedNodeId={selectedNodeId}
        selectedEdgeId={selectedEdgeId}
        focusEdgeId={hoverEdgeId}
        highlightNodeIds={highlight}
        insets={insets}
        onNodeClick={(id) => select({ kind: 'node', id })}
        onNodeDoubleClick={(id) => graphRef.current?.centerOn(id, 2.2)}
        onEdgeClick={(id) => select({ kind: 'edge', id })}
        onBackgroundClick={() => selection && closeInspector()}
      />

      {/* Loading bar */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden transition-opacity duration-300',
          loading ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="h-full w-1/2 animate-progress bg-primary" />
      </div>

      {/* Top-left: search + status */}
      <div className="pointer-events-none absolute left-3 right-16 top-3 flex flex-col items-start gap-2 md:right-auto">
        <div className="pointer-events-auto flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-popover/90 pl-2.5 pr-1.5 shadow-float backdrop-blur-md transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20 md:w-80">
          {loading && searchInput ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-faint-foreground" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-faint-foreground" />
          )}
          <input
            ref={searchRef}
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') jumpToSearchMatch()
              if (e.key === 'Escape') {
                e.stopPropagation()
                if (searchInput) setSearchInput('')
                else e.currentTarget.blur()
              }
            }}
            placeholder="Search facts and names…"
            aria-label="Search the graph"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint-foreground"
          />
          {searchInput ? (
            <Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => setSearchInput('')}>
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Kbd className="hidden md:inline-flex">/</Kbd>
          )}
        </div>

        <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="rounded-md bg-popover/80 px-1.5 py-0.5 tabular-nums backdrop-blur-sm">
            {data ? `${pluralize(view.nodes.length, 'node')} · ${pluralize(view.edges.length, 'link')}` : 'Loading…'}
          </span>
          {data?.truncated && !localIds && (
            <span
              className="rounded-md bg-warning/12 px-1.5 py-0.5 text-warning"
              title="Only the most recently recorded facts are loaded. Narrow the filters or raise “Facts loaded” in settings."
            >
              Showing latest {data.edges.length}
            </span>
          )}
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex h-5 items-center gap-0.5 rounded-full bg-accent pl-2 pr-0.5 text-[11px] font-medium text-accent-foreground"
            >
              {chip.label}
              <button
                type="button"
                aria-label={`Remove filter ${chip.label}`}
                onClick={chip.onRemove}
                className="rounded-full p-0.5 hover:bg-accent-foreground/15"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Reload graph"
            title="Reload"
            onClick={reload}
            className="bg-popover/80 backdrop-blur-sm"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Top-center: local graph pill */}
      {localIds && (
        <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center md:top-3">
          <div className="pointer-events-auto flex h-9 animate-pop-in items-center gap-1 rounded-full border border-border bg-popover/95 pl-3 pr-1 text-[13px] shadow-float backdrop-blur-md">
            <Network className="h-3.5 w-3.5 text-accent-foreground" />
            <span className="max-w-40 truncate font-medium text-foreground">{localRootName ?? 'Local graph'}</span>
            <span className="ml-1 text-faint-foreground">depth</span>
            <div role="radiogroup" aria-label="Local graph depth" className="flex rounded-full bg-secondary p-0.5">
              {[1, 2, 3].map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={localDepth === d}
                  onClick={() => setLocalDepth(d)}
                  className={cn(
                    'h-6 w-6 rounded-full text-xs font-medium tabular-nums transition-colors',
                    localDepth === d ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Exit local graph" onClick={() => setLocalRoot(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Top-right: settings */}
      <GraphSettingsPanel
        className="absolute bottom-14 top-3 transition-[right] duration-300 ease-out-expo"
        open={panelOpen}
        onOpenChange={setPanelOpen}
        settings={settings}
        onSettingsChange={setSettings}
        filters={filters}
        onFiltersChange={updateFilters}
        onResetFilters={resetFilters}
        entityTypes={entityChips}
        relationTypes={relationChips}
        replaying={replay !== null}
        onReplayToggle={toggleReplay}
        activeFilterCount={entityTypes.length + relationTypes.length + (minConfidence > 0 ? 1 : 0)}
        style={{ right: rightOffset }}
      />

      {/* Bottom-right: camera controls */}
      <GraphControls
        className="absolute bottom-3 transition-[right] duration-300 ease-out-expo"
        style={{ right: rightOffset }}
        onZoomIn={() => graphRef.current?.zoomIn()}
        onZoomOut={() => graphRef.current?.zoomOut()}
        onFit={() => graphRef.current?.fit(localIds ?? undefined)}
        localGraph={localIds !== null}
        canLocalGraph={localIds !== null || (!!selectedNodeId && loadedNodeIds.has(selectedNodeId))}
        onToggleLocalGraph={toggleLocalGraph}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      {/* Bottom-left: legend */}
      <GraphLegend
        className="absolute bottom-3 left-3 hidden sm:block"
        entries={legendEntries}
        selected={entityTypes}
        onToggle={(t) => setEntityTypes(entityTypes.includes(t) ? entityTypes.filter((x) => x !== t) : [...entityTypes, t])}
        onHover={setHoverType}
      />

      {/* Center: empty / error states */}
      {showEmpty && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="pointer-events-auto rounded-xl border border-border bg-popover/90 shadow-float backdrop-blur-md">
            {filtersActive ? (
              <EmptyState
                icon={SearchX}
                title="No facts match these filters"
                description="Try a broader search, a lower confidence threshold, or fewer type filters."
                action={
                  <Button size="sm" variant="secondary" onClick={resetFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Share2}
                title="The graph is empty"
                description="Extract a source into the graph and its entities and facts will appear here."
                action={
                  <Link to="/sources">
                    <Button size="sm">Go to Sources</Button>
                  </Link>
                }
              />
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center px-4 md:bottom-6">
          <div
            role="alert"
            className="pointer-events-auto flex max-w-lg animate-rise-in items-center gap-2.5 rounded-lg border border-destructive/30 bg-popover px-3 py-2 text-[13px] shadow-popover"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1 text-foreground">{data ? `Couldn't refresh the graph: ${error}` : error}</span>
            <Button size="xs" variant="secondary" onClick={reload}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Right: inspector */}
      {inspectorMounted && inspectorSelection && (
        <GraphInspector
          className={cn(
            isDesktop
              ? 'absolute bottom-3 right-3 top-3 rounded-lg border'
              : 'absolute inset-x-0 bottom-0 h-[52%] rounded-t-xl border-t',
            isDesktop
              ? inspectorClosing
                ? 'animate-slide-out-right'
                : 'animate-slide-in-right'
              : inspectorClosing
                ? 'animate-slide-out-down'
                : 'animate-slide-in-up',
          )}
          style={isDesktop ? { width: INSPECTOR_WIDTH } : undefined}
          selection={inspectorSelection}
          detail={nodeDetail}
          detailLoading={inspectorSelection.kind === 'node' && !nodeDetail && !nodeError}
          detailError={nodeError}
          onRetry={() => {
            if (!selectedNodeId) return
            setDetailErrors((prev) => {
              const next = { ...prev }
              delete next[selectedNodeId]
              return next
            })
            setDetailRetry((t) => t + 1)
          }}
          edge={edgeForInspector}
          edgeSource={edgeForInspector ? (nodeIndex.get(edgeForInspector.source) ?? null) : null}
          edgeTarget={edgeForInspector ? (nodeIndex.get(edgeForInspector.target) ?? null) : null}
          colorForType={colorForType}
          isInGraph={(id) => loadedNodeIds.has(id)}
          onSelectNode={(id) => select({ kind: 'node', id }, { center: loadedNodeIds.has(id) })}
          onSelectEdge={(id) => select({ kind: 'edge', id })}
          onHoverEdge={setHoverEdgeId}
          onCenter={() => {
            if (inspectorSelection.kind === 'node') graphRef.current?.centerOn(inspectorSelection.id)
            else if (edgeForInspector) graphRef.current?.fit([edgeForInspector.source, edgeForInspector.target])
          }}
          localGraph={localIds !== null}
          onToggleLocalGraph={toggleLocalGraph}
          canGoBack={history.index > 0}
          canGoForward={history.index < history.stack.length - 1}
          onBack={() => goHistory(-1)}
          onForward={() => goHistory(1)}
          onClose={closeInspector}
        />
      )}
    </div>
  )
}
