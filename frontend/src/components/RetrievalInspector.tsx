import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, Sparkles } from 'lucide-react'
import { getRetrievalTrace } from '../api/client'
import type { GraphEdge, GraphNode, RetrievalTrace } from '../types'
import { GraphView } from '../graph/GraphView'
import { DEFAULT_GRAPH_SETTINGS } from '../graph/settings'
import { cn } from '../lib/cn'
import { humanizeRelation, pluralize } from '../lib/format'
import { typeColor } from '../lib/palette'
import { useThemeMode } from '../lib/themeContext'
import { Button } from './ui/Button'
import { ConfidenceMeter } from './ui/ConfidenceMeter'
import { Disclosure } from './ui/Disclosure'
import { Kbd } from './ui/Kbd'
import { Skeleton } from './ui/Skeleton'

// A trace is a handful of facts: show every name, and give nodes room.
const TRACE_SETTINGS = { ...DEFAULT_GRAPH_SETTINGS, labelThreshold: 0, linkDistance: 90 }

type Props = {
  turnId: string
  entityTypeOrder: string[]
}

// The "explain this answer" view (docs/ROADMAP.md Phase 5): renders the
// exact subgraph a chat answer's retrieval pulled in through the shared
// GraphView (docs/ARCHITECTURE.md §4), with the trace's facts as a ranked,
// clickable timeline -- the stepped-to fact is emphasized on the canvas.
// Rendered inside ui/Sheet.tsx by ChatPage, which remounts this with
// `key={turnId}` per inspected turn so state starts fresh for every turn.
export function RetrievalInspector({ turnId, entityTypeOrder }: Props) {
  const mode = useThemeMode()
  const listRef = useRef<HTMLOListElement>(null)
  const [trace, setTrace] = useState<RetrievalTrace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)

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
  const seeds = trace?.seed_nodes.filter((n) => n.is_seed) ?? []

  function step(delta: number) {
    setStepIndex((i) => Math.max(0, Math.min(facts.length - 1, i + delta)))
  }

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${stepIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [stepIndex])

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-5" aria-busy="true">
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading trace…
        </p>
        <Skeleton className="h-80 w-full rounded-lg" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  if (error || !trace) {
    return <p className="p-5 text-[13px] text-destructive">{error ?? 'Trace unavailable.'}</p>
  }

  return (
    <div
      className="flex flex-col gap-4 p-5 outline-none"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'j') {
          e.preventDefault()
          step(1)
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'k') {
          e.preventDefault()
          step(-1)
        }
      }}
    >
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">Question</div>
        <p className="mt-1 text-[15px] font-medium leading-snug text-foreground">“{trace.query}”</p>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {pluralize(facts.length, 'fact')} retrieved from {pluralize(seeds.length, 'seed node')}
          {seeds.length > 0 && ': '}
          {seeds.map((s, i) => (
            <span key={s.uuid}>
              {i > 0 && ', '}
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: typeColor(mode, entityTypeOrder, s.type) }} />
                {s.name}
              </span>
            </span>
          ))}
        </p>
      </div>

      {facts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">
          No facts were retrieved for this question.
        </p>
      ) : (
        <>
          <div className="relative h-[340px] overflow-hidden rounded-lg border border-border bg-background-alt">
            <GraphView
              className="absolute inset-0"
              nodes={nodes}
              edges={edges}
              entityTypeOrder={entityTypeOrder}
              settings={TRACE_SETTINGS}
              focusEdgeId={currentFact?.edge_uuid ?? null}
              onEdgeClick={(id) => {
                const index = facts.findIndex((f) => f.edge_uuid === id)
                if (index >= 0) setStepIndex(index)
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-[13px] font-semibold text-foreground">
              Retrieved facts <span className="font-normal text-faint-foreground">ranked by rerank score</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="mr-1 hidden items-center gap-1 text-[11px] text-faint-foreground sm:flex">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </span>
              <Button size="icon-sm" variant="outline" disabled={stepIndex === 0} onClick={() => step(-1)} aria-label="Previous fact">
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                disabled={stepIndex >= facts.length - 1}
                onClick={() => step(1)}
                aria-label="Next fact"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <ol ref={listRef} className="flex flex-col gap-1" aria-label="Retrieved facts">
            {facts.map((fact, index) => {
              const active = index === stepIndex
              return (
                <li key={fact.edge_uuid} data-index={index}>
                  <button
                    type="button"
                    aria-current={active ? 'step' : undefined}
                    onClick={() => setStepIndex(index)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
                      active ? 'border-accent-foreground/40 bg-accent' : 'border-transparent hover:bg-hover',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                        active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground',
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug text-foreground">{fact.fact}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint-foreground">
                        <span className="font-semibold uppercase tracking-wide">{humanizeRelation(fact.name)}</span>
                        <ConfidenceMeter value={fact.confidence} />
                        <span className="font-mono tabular-nums">rerank {fact.score.toFixed(3)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      )}

      <Disclosure
        title={
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent-foreground" /> Exact context sent to the model
          </span>
        }
        defaultOpen={false}
        className="border-t border-border pt-2"
        contentClassName="pt-2"
      >
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-code-bg p-3 font-mono text-xs leading-relaxed text-foreground">
          {trace.final_context || '(empty)'}
        </pre>
      </Disclosure>
    </div>
  )
}
