import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { getGraph } from '../api/client'
import { CONFIDENCE_STEP } from '../lib/confidence'
import { GraphCanvas } from './GraphCanvas'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Input } from './ui/Input'
import { cn } from '../lib/cn'
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
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search facts & names…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Min confidence
            <input
              type="range"
              min={0}
              max={1}
              step={CONFIDENCE_STEP}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="accent-primary"
            />
            <span className="w-9 font-mono text-xs text-foreground">{minConfidence.toFixed(2)}</span>
          </label>

          <Button size="sm" variant="outline" onClick={() => void loadGraph()} disabled={loading} className="ml-auto">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {presentTypes.length === 0 ? (
            <span className="text-sm text-muted-foreground">No entity types yet.</span>
          ) : (
            presentTypes.map((type) => (
              <button
                type="button"
                key={type}
                onClick={() => toggleType(type)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
                  noneSelected || selectedTypes.includes(type)
                    ? 'border-border bg-secondary text-secondary-foreground opacity-100'
                    : 'border-border/60 text-muted-foreground opacity-50 hover:opacity-80',
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: colorForType(type) }} />
                {type}
              </button>
            ))
          )}
        </div>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.truncated && (
        <p className="text-sm text-muted-foreground">
          Showing the {data.edges.length} most recent matching facts — narrow the filters to see the rest.
        </p>
      )}

      <Card className="p-4">
        <GraphCanvas
          nodes={data?.nodes ?? []}
          edges={data?.edges ?? []}
          entityTypeOrder={entityTypeOrder}
          emptyMessage={
            loading ? 'Loading graph…' : 'No graph data yet — extract a source into the graph first.'
          }
          height={620}
        />
      </Card>
    </div>
  )
}
