import { useEffect, useMemo, useRef, useState } from 'react'
import { forceCollide } from 'd3-force'
import { Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react'
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d'
import { getGraphNode } from '../api/client'
import { Button } from './ui/Button'
import { formatConfidence } from '../lib/confidence'
import { categoricalColor, confidenceColor, confidenceRampCss, INK, MUTED, useThemeMode } from '../lib/palette'
import type { GraphEdge, GraphNode, NodeDetail } from '../types'

// Shared by GraphExplorer (Phase 3) and RetrievalInspector (Phase 5) --
// per docs/ARCHITECTURE.md §4: "Graph Explorer and Retrieval Inspector
// should share the same graph-rendering component ... not a separate
// visualization." Owns the canvas, the legend, and click-to-inspect node
// detail; the caller only supplies which nodes/edges to draw.

// The shape each graph node/link carries into force-graph -- kept separate
// from GraphNode/GraphEdge (types.ts) since force-graph wants `id`/
// `source`/`target`, not our API field names, plus the x/y/etc. it adds at
// runtime once the simulation starts.
type NodeDatum = { name: string; type: string }
type LinkDatum = { uuid: string; name: string; fact: string; confidence: number | null; pairKey: string }

export const LABEL_ZOOM_THRESHOLD = 1.4 // only draw node-name text once zoomed in this far, to avoid clutter
const NODE_RADIUS = 5

type Props = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Ontology entity-type names in definition order -- fixes each type's
   * color slot so it stays stable across filter changes and between this
   * component's two callers (lib/palette.ts's "never cycled" rule). */
  entityTypeOrder: string[]
  emptyMessage: string
  height?: number
  /** When set, that edge (by uuid) is drawn emphasized and every other edge
   * dimmed -- RetrievalInspector's "step through the trace" view. */
  focusEdgeUuid?: string | null
}

export function GraphCanvas({
  nodes,
  edges,
  entityTypeOrder,
  emptyMessage,
  height = 520,
  focusEdgeUuid = null,
}: Props) {
  const mode = useThemeMode()
  const fgRef = useRef<ForceGraphMethods<NodeObject<NodeDatum>, never> | undefined>(undefined)

  // Deliberately *not* reset when `nodes`/`edges` change (e.g. a filter
  // tweak in GraphExplorer): a still-present selection stays open across a
  // refresh, and a dropped-out one just stops matching anything on the
  // canvas -- harmless, and cheaper than syncing local state from a prop.
  // A caller that wants a hard reset (RetrievalInspector, per turn) gets it
  // by remounting this component with a `key`, same convention as
  // OntologyStudio's `key={ontology.id}`.
  const [selectedNodeUuid, setSelectedNodeUuid] = useState<string | null>(null)
  const [hoveredNodeUuid, setHoveredNodeUuid] = useState<string | null>(null)
  const [nodeDetail, setNodeDetail] = useState<NodeDetail | null>(null)
  const [nodeDetailLoading, setNodeDetailLoading] = useState(false)
  const [nodeDetailError, setNodeDetailError] = useState<string | null>(null)

  const typeColorIndex = useMemo(() => {
    const map = new Map<string, number>()
    entityTypeOrder.forEach((name, i) => map.set(name, i))
    return map
  }, [entityTypeOrder])

  function colorForType(type: string): string {
    const index = typeColorIndex.get(type)
    return index === undefined ? MUTED[mode] : categoricalColor(mode, index)
  }

  const presentTypes = useMemo(() => {
    const names = new Set<string>()
    for (const n of nodes) names.add(n.type)
    return Array.from(names)
  }, [nodes])

  const graphData = useMemo(
    () => ({
      nodes: nodes.map((n) => ({ id: n.uuid, name: n.name, type: n.type })),
      // `pairKey` is order-independent (A->B and B->A share one key) so
      // linkCurvature below can detect and curve apart edges that share a
      // node pair -- straight, overlapping lines would otherwise be
      // indistinguishable.
      links: edges.map((e) => ({
        uuid: e.uuid,
        source: e.source,
        target: e.target,
        name: e.name,
        fact: e.fact,
        confidence: e.confidence,
        pairKey: [e.source, e.target].sort().join('|'),
      })),
    }),
    [nodes, edges],
  )

  const pairCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const link of graphData.links) counts.set(link.pairKey, (counts.get(link.pairKey) ?? 0) + 1)
    return counts
  }, [graphData])

  // Force tuning for a readable, gently-settling layout: more repulsion so
  // nodes don't clump, a collision force so labels/circles don't overlap
  // once zoomed in, and a slower alpha decay so the layout eases into place
  // instead of snapping.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const charge = fg.d3Force('charge')
    if (charge) charge.strength(-160).distanceMax(600)
    const link = fg.d3Force('link')
    if (link) link.distance(70)
    fg.d3Force('collide', forceCollide(NODE_RADIUS + 6))
    fg.d3ReheatSimulation()
  }, [graphData])

  async function openNode(uuid: string) {
    setSelectedNodeUuid(uuid)
    setNodeDetail(null)
    setNodeDetailError(null)
    setNodeDetailLoading(true)
    try {
      const detail = await getGraphNode(uuid)
      setNodeDetail(detail)
    } catch (err) {
      setNodeDetailError(err instanceof Error ? err.message : 'Failed to load node')
    } finally {
      setNodeDetailLoading(false)
    }
  }

  function zoomBy(factor: number) {
    const fg = fgRef.current
    if (!fg) return
    fg.zoom(fg.zoom() * factor, 250)
  }

  function fitView() {
    fgRef.current?.zoomToFit(400, 48)
  }

  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-gradient-to-b from-transparent to-accent/20">
          <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
            <Button size="icon" variant="outline" aria-label="Zoom in" className="bg-card/90 backdrop-blur" onClick={() => zoomBy(1.4)}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" aria-label="Zoom out" className="bg-card/90 backdrop-blur" onClick={() => zoomBy(1 / 1.4)}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" aria-label="Fit to view" className="bg-card/90 backdrop-blur" onClick={fitView}>
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>

          <ForceGraph2D<NodeDatum, LinkDatum>
            ref={fgRef}
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            nodeRelSize={NODE_RADIUS}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            cooldownTicks={250}
            linkCurvature={(link) => ((pairCounts.get(link.pairKey) ?? 1) > 1 ? 0.28 : 0)}
            linkColor={(link) => {
              const dimmed = focusEdgeUuid !== null && link.uuid !== focusEdgeUuid
              const base =
                link.confidence === null || link.confidence === undefined
                  ? MUTED[mode]
                  : confidenceColor(mode, link.confidence)
              return dimmed ? MUTED[mode] : base
            }}
            linkWidth={(link) => {
              const width = 1 + Math.sqrt(link.confidence ?? 0.15) * 2.5
              if (focusEdgeUuid === null) return width
              return link.uuid === focusEdgeUuid ? width + 2 : Math.max(0.4, width - 1)
            }}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkLabel={(link) =>
              `${link.name}: ${link.fact} (confidence: ${formatConfidence(link.confidence)})`
            }
            nodeLabel={(node) => `${node.name} (${node.type})`}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const x = node.x ?? 0
              const y = node.y ?? 0
              const isSelected = selectedNodeUuid === node.id
              const isHovered = hoveredNodeUuid === node.id
              const radius = isHovered ? NODE_RADIUS + 1 : NODE_RADIUS
              const color = colorForType(node.type)

              if (isSelected || isHovered) {
                ctx.beginPath()
                ctx.arc(x, y, radius + 4, 0, 2 * Math.PI)
                ctx.fillStyle = isSelected ? `${color}33` : `${color}22`
                ctx.fill()
              }

              ctx.beginPath()
              ctx.arc(x, y, radius, 0, 2 * Math.PI)
              ctx.fillStyle = color
              ctx.fill()
              if (isSelected) {
                ctx.lineWidth = 1.75 / globalScale
                ctx.strokeStyle = INK[mode]
                ctx.stroke()
              }

              if (globalScale > LABEL_ZOOM_THRESHOLD) {
                const fontSize = 12 / globalScale
                ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`
                const label = node.name
                const metrics = ctx.measureText(label)
                const padX = 4 / globalScale
                const padY = 2 / globalScale
                const boxX = x + radius + 3 / globalScale
                const boxY = y - fontSize / 2 - padY
                const boxW = metrics.width + padX * 2
                const boxH = fontSize + padY * 2

                ctx.fillStyle = mode === 'dark' ? 'rgba(16,17,22,0.78)' : 'rgba(251,251,250,0.82)'
                if (typeof ctx.roundRect === 'function') {
                  ctx.beginPath()
                  ctx.roundRect(boxX, boxY, boxW, boxH, 3 / globalScale)
                  ctx.fill()
                } else {
                  ctx.fillRect(boxX, boxY, boxW, boxH)
                }

                ctx.fillStyle = INK[mode]
                ctx.textBaseline = 'middle'
                ctx.fillText(label, boxX + padX, y)
              }
            }}
            nodePointerAreaPaint={(node, color, ctx) => {
              const x = node.x ?? 0
              const y = node.y ?? 0
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(x, y, 8, 0, 2 * Math.PI)
              ctx.fill()
            }}
            onNodeClick={(node) => void openNode(String(node.id))}
            onNodeHover={(node) => setHoveredNodeUuid(node ? String(node.id) : null)}
            onBackgroundClick={() => setSelectedNodeUuid(null)}
            height={height}
          />
        </div>

        <aside className="w-full shrink-0 lg:w-44">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Entity types
          </h3>
          <ul className="mb-5 flex flex-col gap-1.5">
            {presentTypes.map((type) => (
              <li key={type} className="flex items-center gap-2 text-sm text-foreground">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: colorForType(type) }}
                />
                {type}
              </li>
            ))}
          </ul>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Confidence
          </h3>
          <div className="h-2 rounded-full" style={{ background: confidenceRampCss(mode) }} />
          <div className="mb-4 mt-1 flex justify-between text-[11px] text-muted-foreground">
            <span>low</span>
            <span>high</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MUTED[mode] }} /> unscored
          </div>
        </aside>
      </div>

      {selectedNodeUuid && (
        <div className="mt-5 rounded-lg border border-border bg-card p-5">
          {nodeDetailLoading && <p className="text-sm text-muted-foreground">Loading node…</p>}
          {nodeDetailError && <p className="text-sm text-destructive">{nodeDetailError}</p>}
          {nodeDetail && (
            <NodeDetailPanel
              detail={nodeDetail}
              onSelectNode={(uuid) => void openNode(uuid)}
              onClose={() => setSelectedNodeUuid(null)}
            />
          )}
        </div>
      )}
    </>
  )
}

function NodeDetailPanel({
  detail,
  onSelectNode,
  onClose,
}: {
  detail: NodeDetail
  onSelectNode: (uuid: string) => void
  onClose: () => void
}) {
  const { node, neighbors, provenance } = detail
  const attributeEntries = Object.entries(node.attributes).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  )

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">
          {node.name} <span className="font-normal text-muted-foreground">({node.type})</span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close node detail"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {node.summary && <p className="mt-2 text-sm text-foreground">{node.summary}</p>}
      {attributeEntries.length > 0 && (
        <dl className="mt-3 flex flex-col gap-1">
          {attributeEntries.map(([key, value]) => (
            <div key={key} className="flex gap-2 text-sm">
              <dt className="min-w-[110px] text-muted-foreground">{key}</dt>
              <dd className="text-foreground">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <h4 className="mb-2 mt-5 text-sm font-semibold text-foreground">Relations ({neighbors.length})</h4>
      {neighbors.length === 0 ? (
        <p className="text-sm text-muted-foreground">No relations.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {neighbors.map((n) => (
            <li key={n.edge.uuid} className="text-sm">
              <span className="text-muted-foreground">{n.direction === 'outgoing' ? '→' : '←'}</span>{' '}
              <button
                type="button"
                className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                onClick={() => onSelectNode(n.node.uuid)}
              >
                {n.node.name}
              </button>
              <span className="text-muted-foreground"> {n.edge.name.toLowerCase()} — {n.edge.fact}</span>
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                {formatConfidence(n.edge.confidence)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h4 className="mb-2 mt-5 text-sm font-semibold text-foreground">Provenance ({provenance.length})</h4>
      {provenance.length === 0 ? (
        <p className="text-sm text-muted-foreground">No source excerpts recorded.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {provenance.map((p) => (
            <li key={p.episode_uuid} className="border-l-2 border-border pl-3">
              <div className="font-mono text-xs text-foreground">{p.source_filename ?? p.source_description}</div>
              {p.chunk_preview && (
                <blockquote className="mt-1 text-sm italic text-muted-foreground">{p.chunk_preview}</blockquote>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
