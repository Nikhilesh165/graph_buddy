import { useEffect, useMemo, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { getGraph, getGraphNode } from '../api/client'
import { categoricalColor, confidenceColor, confidenceRampCss, INK, MUTED, useThemeMode } from '../lib/palette'
import type { GraphEdge, GraphNode, NodeDetail, OntologyVersion } from '../types'

type Props = {
  ontology: OntologyVersion
}

// The shape each graph node/link carries into force-graph -- kept separate
// from GraphNode/GraphEdge (types.ts) since force-graph wants `id`/
// `source`/`target`, not our API field names, plus the x/y/etc. it adds at
// runtime once the simulation starts.
type NodeDatum = { name: string; type: string }
type LinkDatum = { name: string; fact: string; confidence: number | null }

const CANVAS_HEIGHT = 480
const CONFIDENCE_STEP = 0.05
const LABEL_ZOOM_THRESHOLD = 1.4 // only draw node-name text once zoomed in this far, to avoid clutter

function formatConfidence(value: number | null): string {
  return value === null ? 'unscored' : value.toFixed(2)
}

export function GraphExplorer({ ontology }: Props) {
  const mode = useThemeMode()

  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [minConfidence, setMinConfidence] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean } | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedNodeUuid, setSelectedNodeUuid] = useState<string | null>(null)
  const [nodeDetail, setNodeDetail] = useState<NodeDetail | null>(null)
  const [nodeDetailLoading, setNodeDetailLoading] = useState(false)
  const [nodeDetailError, setNodeDetailError] = useState<string | null>(null)

  // Debounce free-text search so every keystroke doesn't fire a request.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  async function loadGraph() {
    setLoading(true)
    setError(null)
    try {
      const result = await getGraph({
        entityTypes: selectedTypes.length > 0 ? selectedTypes : undefined,
        minConfidence,
        search: search || undefined,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadGraph()
    // Re-run only when a filter actually changes -- loadGraph itself is
    // recreated every render (it closes over state) and isn't a stable dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTypes, minConfidence, search])

  // Fixed slot per entity type, assigned in ontology-definition order -- see
  // lib/palette.ts: identity color must stay stable across filter changes.
  const typeColorIndex = useMemo(() => {
    const map = new Map<string, number>()
    ontology.entity_types.forEach((et, i) => map.set(et.name, i))
    return map
  }, [ontology.entity_types])

  function colorForType(type: string): string {
    const index = typeColorIndex.get(type)
    return index === undefined ? MUTED[mode] : categoricalColor(mode, index)
  }

  const presentTypes = useMemo(() => {
    const names = new Set<string>(ontology.entity_types.map((et) => et.name))
    if (data) for (const n of data.nodes) names.add(n.type)
    return Array.from(names)
  }, [ontology.entity_types, data])

  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] }
    return {
      nodes: data.nodes.map((n) => ({ id: n.uuid, name: n.name, type: n.type })),
      links: data.edges.map((e) => ({
        source: e.source,
        target: e.target,
        name: e.name,
        fact: e.fact,
        confidence: e.confidence,
      })),
    }
  }, [data])

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

  function toggleType(name: string) {
    setSelectedTypes((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    )
  }

  const noneSelected = selectedTypes.length === 0

  return (
    <section className="panel panel--wide">
      <div className="panel-header">
        <h2>Graph Explorer</h2>
        <button type="button" onClick={() => void loadGraph()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="graph-filters">
        <div className="graph-filter-types">
          {presentTypes.length === 0 ? (
            <span className="muted">No entity types yet.</span>
          ) : (
            presentTypes.map((type) => (
              <button
                type="button"
                key={type}
                className={`type-chip${noneSelected || selectedTypes.includes(type) ? ' type-chip--active' : ''}`}
                onClick={() => toggleType(type)}
              >
                <span className="type-chip-dot" style={{ background: colorForType(type) }} />
                {type}
              </button>
            ))
          )}
        </div>

        <label className="graph-filter-confidence">
          Min confidence: {minConfidence.toFixed(2)}
          <input
            type="range"
            min={0}
            max={1}
            step={CONFIDENCE_STEP}
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
          />
        </label>

        <input
          type="search"
          placeholder="Search facts & names…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {error && <p className="error-text">{error}</p>}
      {data?.truncated && (
        <p className="muted">
          Showing the {data.edges.length} most recent matching facts — narrow the filters to see
          the rest.
        </p>
      )}

      {!data || data.nodes.length === 0 ? (
        <p className="muted">
          {loading ? 'Loading graph…' : 'No graph data yet — extract a source into the graph first.'}
        </p>
      ) : (
        <div className="graph-layout">
          <div className="graph-canvas-wrap">
            <ForceGraph2D<NodeDatum, LinkDatum>
              graphData={graphData}
              backgroundColor="rgba(0,0,0,0)"
              nodeRelSize={4}
              linkColor={(link) =>
                link.confidence === null || link.confidence === undefined
                  ? MUTED[mode]
                  : confidenceColor(mode, link.confidence)
              }
              linkWidth={(link) => 1 + (link.confidence ?? 0) * 3}
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
              height={CANVAS_HEIGHT}
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
      )}

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
    </section>
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
