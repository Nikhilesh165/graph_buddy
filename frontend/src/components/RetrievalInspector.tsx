import { useEffect, useMemo, useState } from 'react'
import { getRetrievalTrace } from '../api/client'
import type { GraphEdge, GraphNode, RetrievalTrace } from '../types'
import { formatConfidence } from '../lib/confidence'
import { GraphCanvas } from './GraphCanvas'

type Props = {
  turnId: string
  entityTypeOrder: string[]
  onClose: () => void
}

// The "explain this answer" view (docs/ROADMAP.md Phase 5): reuses
// GraphCanvas to render the exact subgraph a chat answer's retrieval pulled
// in, and lets the user step fact-by-fact through it with the currently
// stepped-to fact highlighted on the canvas.

// Caller (App.tsx) remounts this with `key={turnId}` per inspected turn,
// same convention as OntologyStudio's `key={ontology.id}` -- so this
// component's own state starts fresh for every turn and this effect only
// ever needs to do one thing: fetch.
export function RetrievalInspector({ turnId, entityTypeOrder, onClose }: Props) {
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
    <section className="panel panel--wide">
      <div className="panel-header">
        <h2>Retrieval Inspector</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {loading && <p className="muted">Loading trace…</p>}
      {error && <p className="error-text">{error}</p>}

      {trace && (
        <>
          <p className="muted">
            Query: <span className="citation-index">“{trace.query}”</span> — {facts.length} fact
            {facts.length === 1 ? '' : 's'} retrieved, {trace.seed_nodes.filter((n) => n.is_seed).length}{' '}
            seed node{trace.seed_nodes.filter((n) => n.is_seed).length === 1 ? '' : 's'}.
          </p>

          {facts.length > 0 && (
            <div className="trace-stepper">
              <button
                type="button"
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              >
                ← Prev
              </button>
              <span className="muted">
                Fact {stepIndex + 1} of {facts.length}
              </span>
              <button
                type="button"
                disabled={stepIndex >= facts.length - 1}
                onClick={() => setStepIndex((i) => Math.min(facts.length - 1, i + 1))}
              >
                Next →
              </button>
            </div>
          )}

          {currentFact && (
            <div className="trace-current-fact">
              <span className="citation-index">[{stepIndex + 1}]</span> {currentFact.fact}
              <span className="confidence-badge">
                confidence: {formatConfidence(currentFact.confidence)}
              </span>
              <span className="confidence-badge">rerank score: {currentFact.score.toFixed(3)}</span>
            </div>
          )}

          <GraphCanvas
            nodes={nodes}
            edges={edges}
            entityTypeOrder={entityTypeOrder}
            emptyMessage="No facts were retrieved for this question."
            focusEdgeUuid={currentFact?.edge_uuid ?? null}
          />

          <button
            type="button"
            className="link-button trace-context-toggle"
            onClick={() => setShowContext((v) => !v)}
          >
            {showContext ? 'Hide' : 'Show'} exact context sent to the model
          </button>
          {showContext && <pre className="trace-context">{trace.final_context || '(empty)'}</pre>}
        </>
      )}
    </section>
  )
}
