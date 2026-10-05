import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, MessageSquare, Waypoints } from 'lucide-react'
import { getChatHistory, getGraph } from '../api/client'
import { DocumentPage } from '../components/layout/DocumentPage'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { FileIcon } from '../components/ui/FileIcon'
import { Skeleton } from '../components/ui/Skeleton'
import { GraphView } from '../graph/GraphView'
import { DEFAULT_GRAPH_SETTINGS } from '../graph/settings'
import { cn } from '../lib/cn'
import { useAppData } from '../lib/appDataContext'
import { formatRelative, pluralize } from '../lib/format'
import type { ChatTurn, GraphQueryResult } from '../types'

const PREVIEW_SETTINGS = { ...DEFAULT_GRAPH_SETTINGS, edgeLabels: false, showArrows: false, labelThreshold: 0.6 }

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="bg-background px-4 py-3.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-faint-foreground">{hint}</div>}
    </div>
  )
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="text-[13px] font-semibold text-foreground">{children}</h2>
      {action}
    </div>
  )
}

export function DashboardPage() {
  const { ontology, hasOntology, sources, entityTypeOrder } = useAppData()
  const navigate = useNavigate()
  const [turns, setTurns] = useState<ChatTurn[] | null>(null)
  const [preview, setPreview] = useState<GraphQueryResult | null>(null)

  useEffect(() => {
    getChatHistory()
      .then(setTurns)
      .catch(() => setTurns([]))
  }, [])

  useEffect(() => {
    if (!hasOntology) return
    getGraph({ limit: 150 })
      .then(setPreview)
      .catch(() => setPreview({ nodes: [], edges: [], truncated: false }))
  }, [hasOntology])

  const parsed = sources?.filter((s) => s.status === 'parsed') ?? []
  const extracted = parsed.filter((s) => s.graphiti_status === 'extracted')
  const totalNodes = parsed.reduce((sum, s) => sum + s.node_count, 0)
  const totalEdges = parsed.reduce((sum, s) => sum + s.edge_count, 0)

  const steps = [
    { done: (sources?.length ?? 0) > 0, label: 'Upload a source', hint: 'A document, spreadsheet, or transcript', to: '/sources?upload=1' },
    { done: hasOntology, label: 'Bootstrap an ontology', hint: 'Proposed automatically from your first source', to: '/sources' },
    { done: extracted.length > 0, label: 'Extract a source into the graph', hint: 'Entities and facts, scored for confidence', to: '/sources' },
    { done: (turns?.length ?? 0) > 0, label: 'Ask your first question', hint: 'Every answer cites the facts it used', to: '/chat' },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const loaded = sources !== null && turns !== null

  return (
    <DocumentPage width={56}>
      <PageHeader
        title="Overview"
        description="Your knowledge graph at a glance — what's been ingested, how it's structured, and what you've asked of it."
        actions={
          hasOntology && (
            <Link to="/graph">
              <Button variant="secondary">
                <Waypoints className="h-4 w-4" /> Open graph view
              </Button>
            </Link>
          )
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
        <Stat label="Sources" value={sources ? sources.length : '—'} hint={`${extracted.length} extracted`} />
        <Stat label="Entities" value={totalNodes.toLocaleString()} hint="nodes touched by extraction" />
        <Stat label="Facts" value={totalEdges.toLocaleString()} hint="relations between entities" />
        <Stat
          label="Ontology"
          value={hasOntology ? `v${ontology?.version_number}` : '—'}
          hint={
            hasOntology
              ? `${pluralize(ontology?.entity_types.length ?? 0, 'type')} · ${pluralize(ontology?.relation_types.length ?? 0, 'relation')}`
              : 'not bootstrapped yet'
          }
        />
      </div>

      {loaded && doneCount < steps.length && (
        <section className="mb-8">
          <SectionTitle action={<span className="text-xs tabular-nums text-faint-foreground">{doneCount} of {steps.length} done</span>}>
            Getting started
          </SectionTitle>
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ul className="flex flex-col">
            {steps.map((step) => (
              <li key={step.label}>
                <Link
                  to={step.to}
                  className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-hover"
                >
                  <span
                    className={cn(
                      'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                      step.done ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong',
                    )}
                  >
                    {step.done && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13.5px]', step.done ? 'text-faint-foreground line-through' : 'text-foreground')}>
                      {step.label}
                    </span>
                    {!step.done && <span className="block text-xs text-faint-foreground">{step.hint}</span>}
                  </span>
                  {!step.done && (
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-faint-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasOntology && (
        <section className="mb-8">
          <SectionTitle
            action={
              <Link to="/graph" className="flex items-center gap-1 text-xs font-medium text-accent-foreground hover:underline">
                Open graph view <ArrowRight className="h-3 w-3" />
              </Link>
            }
          >
            Graph
          </SectionTitle>
          <div className="relative h-72 overflow-hidden rounded-lg border border-border bg-background-alt">
            {preview === null ? (
              <Skeleton className="absolute inset-0 rounded-none" />
            ) : preview.nodes.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                <p className="text-[13px] text-muted-foreground">Nothing extracted yet.</p>
                <Link to="/sources" className="text-xs font-medium text-accent-foreground hover:underline">
                  Extract a source →
                </Link>
              </div>
            ) : (
              <>
                <GraphView
                  className="absolute inset-0"
                  nodes={preview.nodes}
                  edges={preview.edges}
                  entityTypeOrder={entityTypeOrder}
                  settings={PREVIEW_SETTINGS}
                  onNodeClick={(id) => navigate(`/graph?node=${encodeURIComponent(id)}`)}
                />
                <div className="pointer-events-none absolute bottom-2 left-2.5 rounded-md bg-popover/80 px-1.5 py-0.5 text-[11px] text-muted-foreground backdrop-blur-sm">
                  {preview.truncated ? 'Latest 150 facts · ' : ''}click a node to open it
                </div>
              </>
            )}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <section>
          <SectionTitle
            action={
              <Link to="/sources" className="text-xs font-medium text-accent-foreground hover:underline">
                All sources
              </Link>
            }
          >
            Recent sources
          </SectionTitle>
          {sources === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : sources.length === 0 ? (
            <p className="text-[13px] text-faint-foreground">No sources uploaded yet.</p>
          ) : (
            <ul className="flex flex-col">
              {sources.slice(0, 5).map((source) => {
                return (
                  <li key={source.id}>
                    <Link
                      to={`/sources?focus=${source.id}`}
                      className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-hover"
                    >
                      <FileIcon filename={source.filename} className="h-4 w-4 shrink-0 text-faint-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">{source.filename}</span>
                      <span className="shrink-0 text-xs text-faint-foreground">{formatRelative(source.created_at)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle
            action={
              <Link to="/chat" className="text-xs font-medium text-accent-foreground hover:underline">
                Open chat
              </Link>
            }
          >
            Recent questions
          </SectionTitle>
          {turns === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : turns.length === 0 ? (
            <p className="text-[13px] text-faint-foreground">No questions asked yet.</p>
          ) : (
            <ul className="flex flex-col">
              {[...turns]
                .reverse()
                .slice(0, 5)
                .map((turn) => (
                  <li key={turn.id}>
                    <Link to="/chat" className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-hover">
                      <MessageSquare className="h-4 w-4 shrink-0 text-faint-foreground" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">{turn.question}</span>
                      <span className="shrink-0 text-xs text-faint-foreground">{formatRelative(turn.created_at)}</span>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </DocumentPage>
  )
}
