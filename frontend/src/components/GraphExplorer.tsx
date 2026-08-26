import { useEffect, useMemo, useState } from 'react'
import { getGraph } from '../api/client'
import { CONFIDENCE_STEP } from '../lib/confidence'
import { GraphCanvas } from './GraphCanvas'
import { categoricalColor, MUTED, useThemeMode } from '../lib/palette'
import type { GraphEdge, GraphNode, OntologyVersion } from '../types'

type Props = {
  ontology: OntologyVersion
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

  const entityTypeOrder = useMemo(() => ontology.entity_types.map((et) => et.name), [ontology])

  function colorForType(type: string): string {
    const index = entityTypeOrder.indexOf(type)
    return index === -1 ? MUTED[mode] : categoricalColor(mode, index)
  }

  const presentTypes = useMemo(() => {
    const names = new Set<string>(entityTypeOrder)
    if (data) for (const n of data.nodes) names.add(n.type)
    return Array.from(names)
  }, [entityTypeOrder, data])

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

      <GraphCanvas
        nodes={data?.nodes ?? []}
        edges={data?.edges ?? []}
        entityTypeOrder={entityTypeOrder}
        emptyMessage={
          loading ? 'Loading graph…' : 'No graph data yet — extract a source into the graph first.'
        }
      />
    </section>
  )
}
