import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { getRetrievalTrace } from '../api/client'
import type { GraphEdge, GraphNode, RetrievalTrace } from '../types'
import { formatConfidence } from '../lib/confidence'
import { GraphCanvas } from './GraphCanvas'
import { Button } from './ui/Button'

type Props = {
  turnId: string
  entityTypeOrder: string[]
}

// The "explain this answer" view (docs/ROADMAP.md Phase 5): reuses
// GraphCanvas to render the exact subgraph a chat answer's retrieval pulled
// in, and lets the user step fact-by-fact through it with the currently
// stepped-to fact highlighted on the canvas. Rendered inside ui/Sheet.tsx's
// slide-over by ChatPage, which owns the open/close state and remounts
// this with `key={turnId}` per inspected turn (same convention as
// OntologyStudio's `key={ontology.id}`) so this component's own state
// starts fresh for every turn and its effect only ever needs to fetch.
export function RetrievalInspector({ turnId, entityTypeOrder }: Props) {
  const [trace, setTrace] = useState<RetrievalTrace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [showContext, setShowContext] = useState(false)

  useEffect(() => {
    getRetrievalTrace(turnId)
      .then(setTrace)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [turnId])

  const nodes: GraphNode[] = useMemo(
    () =>
      (trace?.seed_nodes ?? []).map((n) => ({
        uuid: n.uuid,
        name: n.name,
        type: n.type,
        labels: [],
        summary: '',
        attributes: {},
      })),
    [trace],
  )

  const edges: GraphEdge[] = useMemo(
    () =>
      (trace?.facts ?? []).map((f) => ({
        uuid: f.edge_uuid,
        source: f.source_node_uuid,
        target: f.target_node_uuid,
        name: f.name,
        fact: f.fact,
        confidence: f.confidence,
        valid_at: null,
        invalid_at: null,
        created_at: null,
      })),
    [trace],
  )

  const facts = trace?.facts ?? []
  const currentFact = facts[stepIndex]

  return (
    <div>
      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading trace…
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {trace && (
        <>
          <p className="text-sm text-muted-foreground">
            Query: <span className="font-mono text-foreground">“{trace.query}”</span> — {facts.length} fact
            {facts.length === 1 ? '' : 's'} retrieved, {trace.seed_nodes.filter((n) => n.is_seed).length}{' '}
            seed node{trace.seed_nodes.filter((n) => n.is_seed).length === 1 ? '' : 's'}.
          </p>

          {facts.length > 0 && (
            <div className="my-4 flex items-center gap-3">
              <Button
                size="icon"
                variant="outline"
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                aria-label="Previous fact"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                Fact {stepIndex + 1} of {facts.length}
              </span>
              <Button
                size="icon"
                variant="outline"
                disabled={stepIndex >= facts.length - 1}
                onClick={() => setStepIndex((i) => Math.min(facts.length - 1, i + 1))}
                aria-label="Next fact"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {currentFact && (
            <div className="mb-5 rounded-lg border border-border bg-accent/40 px-4 py-3 text-sm text-foreground">
              <span className="font-mono text-muted-foreground">[{stepIndex + 1}]</span> {currentFact.fact}
              <div className="mt-1.5 flex gap-3 font-mono text-xs text-muted-foreground">
                <span>confidence: {formatConfidence(currentFact.confidence)}</span>
                <span>rerank score: {currentFact.score.toFixed(3)}</span>
              </div>
            </div>
          )}

          <GraphCanvas
            nodes={nodes}
            edges={edges}
            entityTypeOrder={entityTypeOrder}
            emptyMessage="No facts were retrieved for this question."
            focusEdgeUuid={currentFact?.edge_uuid ?? null}
            height={380}
          />

          <button
            type="button"
            className="mt-5 text-sm font-medium text-primary hover:underline"
            onClick={() => setShowContext((v) => !v)}
          >
            {showContext ? 'Hide' : 'Show'} exact context sent to the model
          </button>
          {showContext && (
            <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-code-bg p-3 font-mono text-xs text-foreground">
              {trace.final_context || '(empty)'}
            </pre>
          )}
        </>
      )}
    </div>
  )
}
