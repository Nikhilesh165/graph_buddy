import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  MessageSquare,
  Share2,
  UploadCloud,
  Workflow,
} from 'lucide-react'
import { getChatHistory, listSources } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { PageHeader } from '../components/layout/PageHeader'
import { useAppData } from '../lib/appDataContext'
import type { SourceRead } from '../types'

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}

type QuickLink = {
  to: string
  icon: typeof UploadCloud
  title: string
  description: string
}

const QUICK_LINKS: QuickLink[] = [
  { to: '/sources', icon: UploadCloud, title: 'Add a source', description: 'Upload a doc, sheet, or transcript to feed the graph.' },
  { to: '/ontology', icon: Workflow, title: 'Shape the ontology', description: 'Review or edit the entity & relation types the graph uses.' },
  { to: '/graph', icon: Share2, title: 'Explore the graph', description: 'Filter, search, and inspect nodes visually.' },
  { to: '/chat', icon: MessageSquare, title: 'Ask a question', description: 'Chat over your data with cited, inspectable answers.' },
]

export function DashboardPage() {
  const { ontology, backendState, graphState } = useAppData()
  const [sources, setSources] = useState<SourceRead[] | null>(null)
  const [chatTurnCount, setChatTurnCount] = useState<number | null>(null)

  useEffect(() => {
    listSources()
      .then(setSources)
      .catch(() => setSources([]))
    getChatHistory()
      .then((turns) => setChatTurnCount(turns.length))
      .catch(() => setChatTurnCount(null))
  }, [])

  const parsedSources = sources?.filter((s) => s.status === 'parsed') ?? []
  const totalNodes = parsedSources.reduce((sum, s) => sum + s.node_count, 0)
  const totalEdges = parsedSources.reduce((sum, s) => sum + s.edge_count, 0)
  const extractedCount = parsedSources.filter((s) => s.graphiti_status === 'extracted').length
  const hasOntology = (ontology?.version_number ?? 0) > 0

  const steps = [
    { done: (sources?.length ?? 0) > 0, label: 'Upload a source', to: '/sources' },
    { done: hasOntology, label: 'Bootstrap or define an ontology', to: '/sources' },
    { done: extractedCount > 0, label: 'Extract a source into the graph', to: '/sources' },
    { done: (chatTurnCount ?? 0) > 0, label: 'Ask your first question', to: '/chat' },
  ]
  const allStepsDone = steps.every((s) => s.done)

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Your knowledge graph at a glance -- sources, ontology, and what's extracted so far."
        actions={
          <>
            <Badge variant={backendState === 'ok' ? 'success' : 'destructive'}>Backend {backendState}</Badge>
            <Badge variant={graphState === 'ok' ? 'success' : 'destructive'}>Graph DB {graphState}</Badge>
          </>
        }
      />

      {!allStepsDone && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {steps.map((step) => (
              <Link
                key={step.label}
                to={step.to}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 -mx-2 text-sm transition-colors hover:bg-accent"
              >
                {step.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                )}
                <span className={step.done ? 'text-muted-foreground line-through' : 'text-foreground'}>
                  {step.label}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sources" value={sources ? String(sources.length) : '—'} hint={`${extractedCount} extracted`} />
        <StatCard label="Graph nodes" value={String(totalNodes)} />
        <StatCard label="Graph edges" value={String(totalEdges)} />
        <StatCard
          label="Ontology"
          value={hasOntology ? `v${ontology!.version_number}` : '—'}
          hint={hasOntology ? `${ontology!.entity_types.length} entity types` : 'not bootstrapped yet'}
        />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-foreground">Quick actions</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_LINKS.map(({ to, icon: Icon, title, description }) => (
          <Link key={to} to={to} className="group">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="flex h-full flex-col py-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </div>
                <div className="mt-3 flex items-center gap-1 text-sm font-medium text-foreground">
                  {title}
                  <ArrowRight className="h-3.5 w-3.5 -translate-x-0.5 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
