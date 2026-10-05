import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BookOpen, Brain, ChevronLeft, ChevronRight, Compass, Loader2 } from 'lucide-react'
import { getRetrievalTrace } from '../api/client'
import type { GraphEdge, GraphNode, RetrievalTrace } from '../types'
import { formatConfidence } from '../lib/confidence'
import { GraphCanvas } from './GraphCanvas'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'

function Section({ icon: Icon, title, children }: { icon: typeof Brain; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border px-3.5 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="flex flex-col gap-1.5 text-sm text-foreground">{children}</div>
    </div>
  )
}

function Chips({ label, items, variant = 'outline' }: { label: string; items: string[]; variant?: 'outline' | 'warning' }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {items.map((item) => (
        <Badge key={item} variant={variant} className="px-1.5 py-0 text-[11px] leading-5">
          {item}
        </Badge>
      ))}
    </div>
  )
}

/** Steps 1-4 of a turn (docs/MEMORY_AND_DISCOVERY.md §2.3): how the
 * question was resolved against the ontology, what memory fed it, and
 * which community summaries framed a broad answer. Absent for traces
 * recorded before resolution/memory existed. */
function ResolutionPanel({ trace }: { trace: RetrievalTrace }) {
  const { resolution, memory, communities } = trace
  if (!resolution && !memory && communities.length === 0) return null
  const plan = resolution?.plan
  const workingCount = memory?.working_turns.length ?? 0

  return (
    <div className="mb-5 flex flex-col gap-3">
      {resolution && plan && (
        <Section icon={Compass} title="Query resolution">
          <p>
            Searched for <span className="font-mono">“{trace.query}”</span>
            <span className="text-muted-foreground"> · intent: {plan.intent}</span>
          </p>
          {resolution.error && (
            <p className="text-xs text-destructive">
              Resolver unavailable ({resolution.error}) — searched the question verbatim.
            </p>
          )}
          <Chips label="Relation filter:" items={resolution.edge_types} />
          <Chips label="Entity filter:" items={resolution.node_labels} />
          <Chips label="Anchored on:" items={resolution.anchors.map((a) => `${a.name} (${a.type})`)} />
          <Chips label="Learned terms:" items={plan.term_mappings.map((m) => `${m.term} → ${m.maps_to}`)} />
          <Chips label="Not in ontology:" items={plan.unmapped_terms} variant="warning" />
          {!resolution.edge_types.length && !resolution.node_labels.length && !resolution.error && (
            <p className="text-xs text-muted-foreground">
              No ontology types matched — open hybrid search only.
            </p>
          )}
        </Section>
      )}

      {memory && (workingCount > 0 || memory.recalled.length > 0 || memory.conversation_summary) && (
        <Section icon={Brain} title="Memory used">
          {workingCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {workingCount} earlier turn{workingCount === 1 ? '' : 's'} of this conversation (working memory)
              {memory.conversation_summary ? ', plus its consolidated summary' : ''}.
            </p>
          )}
          {memory.conversation_summary && (
            <p className="rounded-md bg-accent/40 px-2.5 py-1.5 text-xs">{memory.conversation_summary}</p>
          )}
          {memory.recalled.map((r) => (
            <p key={r.turn_id} className="text-xs">
              <span className="text-muted-foreground">Recalled ({r.reason}, {r.score.toFixed(2)}):</span> “
              {r.question}”
            </p>
          ))}
        </Section>
      )}

      {communities.length > 0 && (
        <Section icon={BookOpen} title="Background summaries">
          {communities.map((c) => (
            <p key={c.uuid} className="text-xs">
              <span className="font-medium">{c.name}:</span> {c.summary}
            </p>
          ))}
        </Section>
      )}
    </div>
  )
}

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

          <div className="mt-4">
            <ResolutionPanel trace={trace} />
          </div>

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
              <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
                <span>confidence: {formatConfidence(currentFact.confidence)}</span>
                <span>rerank score: {currentFact.score.toFixed(3)}</span>
                {currentFact.ontology_match && (
                  <Badge variant="default" className="px-1.5 py-0 font-sans text-[10px] leading-4">
                    ontology match · {currentFact.name}
                  </Badge>
                )}
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
