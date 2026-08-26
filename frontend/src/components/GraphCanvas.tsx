import { useMemo, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { getGraphNode } from '../api/client'
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
type LinkDatum = { uuid: string; name: string; fact: string; confidence: number | null }

export const LABEL_ZOOM_THRESHOLD = 1.4 // only draw node-name text once zoomed in this far, to avoid clutter

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
  height = 480,
  focusEdgeUuid = null,
}: Props) {
  const mode = useThemeMode()

  // Deliberately *not* reset when `nodes`/`edges` change (e.g. a filter
  // tweak in GraphExplorer): a still-present selection stays open across a
  // refresh, and a dropped-out one just stops matching anything on the
  // canvas -- harmless, and cheaper than syncing local state from a prop.
  // A caller that wants a hard reset (RetrievalInspector, per turn) gets it
  // by remounting this component with a `key`, same convention as
  // OntologyStudio's `key={ontology.id}`.
  const [selectedNodeUuid, setSelectedNodeUuid] = useState<string | null>(null)
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
      links: edges.map((e) => ({
        uuid: e.uuid,
        source: e.source,
        target: e.target,
        name: e.name,
        fact: e.fact,
        confidence: e.confidence,
      })),
    }),
    [nodes, edges],
  )

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

  if (nodes.length === 0) {
    return <p className="muted">{emptyMessage}</p>
  }

  return (
    <>
      <div className="graph-layout">
        <div className="graph-canvas-wrap">
          <ForceGraph2D<NodeDatum, LinkDatum>
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            nodeRelSize={4}
            linkColor={(link) => {
              const dimmed = focusEdgeUuid !== null && link.uuid !== focusEdgeUuid
              const base =
                link.confidence === null || link.confidence === undefined
                  ? MUTED[mode]
                  : confidenceColor(mode, link.confidence)
              return dimmed ? MUTED[mode] : base
            }}
            linkWidth={(link) => {
              const width = 1 + (link.confidence ?? 0) * 3
              if (focusEdgeUuid === null) return width
              return link.uuid === focusEdgeUuid ? width + 2 : Math.max(0.5, width - 1)
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
              const radius = 4
              ctx.beginPath()
              ctx.arc(x, y, radius, 0, 2 * Math.PI)
              ctx.fillStyle = colorForType(node.type)
              ctx.fill()
              if (selectedNodeUuid === node.id) {
                ctx.lineWidth = 1.5 / globalScale
                ctx.strokeStyle = INK[mode]
                ctx.stroke()
              }
              if (globalScale > LABEL_ZOOM_THRESHOLD) {
                const fontSize = 12 / globalScale
                ctx.font = `${fontSize}px system-ui, sans-serif`
                ctx.fillStyle = INK[mode]
                ctx.textBaseline = 'middle'
                ctx.fillText(node.name, x + radius + 2, y)
              }
            }}
            nodePointerAreaPaint={(node, color, ctx) => {
              const x = node.x ?? 0
              const y = node.y ?? 0
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(x, y, 7, 0, 2 * Math.PI)
              ctx.fill()
            }}
            onNodeClick={(node) => void openNode(String(node.id))}
            onBackgroundClick={() => setSelectedNodeUuid(null)}
            height={height}
          />
        </div>

        <aside className="graph-legend">
          <h3>Entity types</h3>
          <ul className="legend-list">
            {presentTypes.map((type) => (
              <li key={type}>
                <span className="legend-dot" style={{ background: colorForType(type) }} />
                {type}
              </li>
            ))}
          </ul>
          <h3>Confidence</h3>
          <div className="confidence-ramp" style={{ background: confidenceRampCss(mode) }} />
          <div className="confidence-ramp-labels">
            <span>low</span>
            <span>high</span>
          </div>
          <div className="legend-list">
            <span className="legend-dot" style={{ background: MUTED[mode] }} /> unscored
          </div>
        </aside>
      </div>

      {selectedNodeUuid && (
        <div className="node-detail">
          {nodeDetailLoading && <p className="muted">Loading node…</p>}
          {nodeDetailError && <p className="error-text">{nodeDetailError}</p>}
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
    <div className="node-detail-panel">
      <div className="panel-header">
        <h3>
          {node.name} <span className="muted">({node.type})</span>
        </h3>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {node.summary && <p>{node.summary}</p>}
      {attributeEntries.length > 0 && (
        <dl className="attribute-list">
          {attributeEntries.map(([key, value]) => (
            <div key={key} className="attribute-row">
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <h4>Relations ({neighbors.length})</h4>
      {neighbors.length === 0 ? (
        <p className="muted">No relations.</p>
      ) : (
        <ul className="neighbor-list">
          {neighbors.map((n) => (
            <li key={n.edge.uuid}>
              <span className="neighbor-direction">{n.direction === 'outgoing' ? '→' : '←'}</span>{' '}
              <button type="button" className="link-button" onClick={() => onSelectNode(n.node.uuid)}>
                {n.node.name}
              </button>
              <span className="muted">
                {' '}
                {n.edge.name.toLowerCase()} — {n.edge.fact}
              </span>
              <span className="confidence-badge">{formatConfidence(n.edge.confidence)}</span>
            </li>
          ))}
        </ul>
      )}

      <h4>Provenance ({provenance.length})</h4>
      {provenance.length === 0 ? (
        <p className="muted">No source excerpts recorded.</p>
      ) : (
        <ul className="provenance-list">
          {provenance.map((p) => (
            <li key={p.episode_uuid}>
              <div className="provenance-source">{p.source_filename ?? p.source_description}</div>
              {p.chunk_preview && <blockquote>{p.chunk_preview}</blockquote>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
