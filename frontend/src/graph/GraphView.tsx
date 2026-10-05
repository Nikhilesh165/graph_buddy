import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ConfidenceMeter } from '../components/ui/ConfidenceMeter'
import { cn } from '../lib/cn'
import { humanizeRelation, pluralize } from '../lib/format'
import { GRAPH_THEME, typeColor } from '../lib/palette'
import { useThemeMode } from '../lib/themeContext'
import type { GraphEdge, GraphNode } from '../types'
import { GraphEngine, type HoverTarget, type Insets } from './engine'
import { DEFAULT_GRAPH_SETTINGS, type GraphSettings } from './settings'

// The one graph renderer in the app -- per docs/ARCHITECTURE.md §4, the
// Graph Explorer, the Retrieval Inspector, and Ontology Studio's schema view
// all draw through this component rather than separate visualizations.
// It's a thin React shell around graph/engine.ts: it owns the engine's
// lifecycle and forwards props into it; all drawing and physics live there.

export type GraphViewHandle = {
  fit: (ids?: Iterable<string>) => void
  zoomIn: () => void
  zoomOut: () => void
  centerOn: (id: string, zoom?: number) => void
  reheat: () => void
  followFit: (durationMs?: number) => void
  ensureVisible: (id: string) => void
  hasNode: (id: string) => boolean
}

type Props = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Ontology entity-type names in definition order -- fixes each type's
   * color slot so it stays stable across filters and between callers
   * (lib/palette.ts's "never cycled" rule). */
  entityTypeOrder: readonly string[]
  settings?: GraphSettings
  selectedNodeId?: string | null
  selectedEdgeId?: string | null
  /** Emphasize this edge and its endpoints, dimming the rest. */
  focusEdgeId?: string | null
  highlightNodeIds?: Set<string> | null
  /** Screen area covered by overlays, so fit/center frame the visible part. */
  insets?: Partial<Insets>
  onNodeClick?: (id: string) => void
  onNodeDoubleClick?: (id: string) => void
  onEdgeClick?: (id: string) => void
  onBackgroundClick?: () => void
  hoverCard?: boolean
  className?: string
  'aria-label'?: string
}

export const GraphView = forwardRef<GraphViewHandle, Props>(function GraphView(
  {
    nodes,
    edges,
    entityTypeOrder,
    settings = DEFAULT_GRAPH_SETTINGS,
    selectedNodeId = null,
    selectedEdgeId = null,
    focusEdgeId = null,
    highlightNodeIds = null,
    insets,
    onNodeClick,
    onNodeDoubleClick,
    onEdgeClick,
    onBackgroundClick,
    hoverCard = true,
    className,
    'aria-label': ariaLabel,
  },
  ref,
) {
  const mode = useThemeMode()
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<GraphEngine | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverTarget>(null)

  // Latest-callback ref: the engine is created once, but the handlers it
  // calls must see current props.
  const handlers = useRef({ onNodeClick, onNodeDoubleClick, onEdgeClick, onBackgroundClick })
  useEffect(() => {
    handlers.current = { onNodeClick, onNodeDoubleClick, onEdgeClick, onBackgroundClick }
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const engine = new GraphEngine(container, GRAPH_THEME[mode], {
      onNodeClick: (id) => handlers.current.onNodeClick?.(id),
      onNodeDoubleClick: (id) => handlers.current.onNodeDoubleClick?.(id),
      onLinkClick: (id) => handlers.current.onEdgeClick?.(id),
      onBackgroundClick: () => handlers.current.onBackgroundClick?.(),
      onHoverChange: setHover,
    })
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
    // The engine lives for the component's lifetime; theme/data/settings
    // are pushed in by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Colors before data, so the first setData already paints type colors.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setTheme(GRAPH_THEME[mode])
    engine.setColorFunction((type) => typeColor(mode, entityTypeOrder, type))
  }, [mode, entityTypeOrder])

  useEffect(() => {
    engineRef.current?.setSettings(settings)
  }, [settings])

  useEffect(() => {
    engineRef.current?.setData(
      nodes.map((n) => ({ id: n.uuid, name: n.name, type: n.type })),
      edges.map((e) => ({ id: e.uuid, source: e.source, target: e.target, name: e.name, confidence: e.confidence })),
    )
  }, [nodes, edges])

  useEffect(() => {
    engineRef.current?.setSelection(selectedNodeId, selectedEdgeId)
  }, [selectedNodeId, selectedEdgeId])

  useEffect(() => {
    engineRef.current?.setFocusLink(focusEdgeId)
  }, [focusEdgeId])

  useEffect(() => {
    engineRef.current?.setHighlight(highlightNodeIds)
  }, [highlightNodeIds])

  const insetTop = insets?.top ?? 0
  const insetRight = insets?.right ?? 0
  const insetBottom = insets?.bottom ?? 0
  const insetLeft = insets?.left ?? 0
  useEffect(() => {
    engineRef.current?.setInsets({ top: insetTop, right: insetRight, bottom: insetBottom, left: insetLeft })
  }, [insetTop, insetRight, insetBottom, insetLeft])

  useImperativeHandle(
    ref,
    () => ({
      fit: (ids) => engineRef.current?.fit(ids),
      zoomIn: () => engineRef.current?.zoomBy(1.5),
      zoomOut: () => engineRef.current?.zoomBy(1 / 1.5),
      centerOn: (id, zoom) => engineRef.current?.centerOn(id, zoom),
      reheat: () => engineRef.current?.reheat(),
      followFit: (durationMs) => engineRef.current?.followFit(durationMs),
      ensureVisible: (id) => engineRef.current?.ensureVisible(id),
      hasNode: (id) => engineRef.current?.hasNode(id) ?? false,
    }),
    [],
  )

  // Hover card follows the pointer by writing a transform directly -- no
  // React render per mouse move.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !hoverCard) return
    function onMove(e: PointerEvent) {
      const card = cardRef.current
      if (!card || !container) return
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const flipX = x + 16 + card.offsetWidth > rect.width - 8
      const flipY = y + 18 + card.offsetHeight > rect.height - 8
      const left = flipX ? x - 12 - card.offsetWidth : x + 16
      const top = flipY ? y - 12 - card.offsetHeight : y + 18
      card.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
    }
    container.addEventListener('pointermove', onMove)
    return () => container.removeEventListener('pointermove', onMove)
  }, [hoverCard])

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.uuid, n])), [nodes])
  const edgeById = useMemo(() => new Map(edges.map((e) => [e.uuid, e])), [edges])
  const degree = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of edges) {
      counts.set(e.source, (counts.get(e.source) ?? 0) + 1)
      counts.set(e.target, (counts.get(e.target) ?? 0) + 1)
    }
    return counts
  }, [edges])

  const hoveredNode = hover?.kind === 'node' ? nodeById.get(hover.id) : undefined
  const hoveredEdge = hover?.kind === 'link' ? edgeById.get(hover.id) : undefined

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel ?? `Knowledge graph: ${pluralize(nodes.length, 'node')}, ${pluralize(edges.length, 'link')}`}
      className={cn('relative overflow-hidden', className)}
    >
      {hoverCard && (
        <div
          ref={cardRef}
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-0 top-0 z-20 max-w-72 rounded-md border border-border bg-popover/95 px-2.5 py-2 text-popover-foreground shadow-float backdrop-blur-sm',
            'transition-opacity duration-150',
            hoveredNode || hoveredEdge ? 'opacity-100 delay-200' : 'opacity-0',
          )}
        >
          {hoveredNode && (
            <>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: typeColor(mode, entityTypeOrder, hoveredNode.type) }}
                />
                {hoveredNode.type}
                <span className="text-faint-foreground">·</span>
                {pluralize(degree.get(hoveredNode.uuid) ?? 0, 'link')}
              </div>
              <div className="mt-0.5 text-[13px] font-medium leading-snug">{hoveredNode.name}</div>
            </>
          )}
          {hoveredEdge && (
            <>
              <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span className="font-medium uppercase tracking-wide">{humanizeRelation(hoveredEdge.name)}</span>
                <ConfidenceMeter value={hoveredEdge.confidence} />
              </div>
              <p className="mt-1 line-clamp-3 text-[12.5px] leading-snug">{hoveredEdge.fact}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
})
