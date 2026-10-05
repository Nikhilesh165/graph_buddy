import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Brain,
  Check,
  CircleX,
  FileSearch,
  GitBranchPlus,
  Loader2,
  Quote,
  Radar,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import {
  acceptProposal,
  consolidateMemory,
  getDiscoveryFeed,
  getDiscoverySettings,
  getMemoryOverview,
  getVocabulary,
  listProposals,
  rejectProposal,
} from '../api/client'
import { PageHeader } from '../components/layout/PageHeader'
import { Badge, type BadgeVariant } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { useAppData } from '../lib/appDataContext'
import { describeChange, RISK_LABEL } from '../lib/ontologyChanges'
import { timeAgo } from '../lib/time'
import type {
  ConsolidationRun,
  DiscoveryEvent,
  DiscoveryEventKind,
  DiscoverySettings,
  MemoryOverview,
  OntologyAutonomy,
  OntologyChangeProposal,
  RiskLevel,
  VocabularyEntry,
} from '../types'

const AUTONOMY_EXPLANATION: Record<OntologyAutonomy, string> = {
  manual: 'Every ontology change the AI suggests waits for your review.',
  assisted:
    'Refinements (new properties, relation endpoints, descriptions) apply automatically; new types wait for review.',
  autonomous:
    'New types, relations and refinements apply automatically; renames and removals always wait for review.',
}

const RISK_BADGE: Record<RiskLevel, BadgeVariant> = {
  low: 'secondary',
  medium: 'default',
  high: 'destructive',
}

const EVENT_ICON: Record<DiscoveryEventKind, typeof Sparkles> = {
  ontology_bootstrapped: Sparkles,
  ontology_evolved: GitBranchPlus,
  proposal_pending: AlertCircle,
  proposal_accepted: Check,
  proposal_rejected: X,
  source_analyzed: FileSearch,
  discovery_failed: CircleX,
  consolidation_digest: Brain,
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1.5 text-xl font-semibold tabular-nums text-foreground sm:text-2xl">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}

function ProposalCard({
  proposal,
  busy,
  onAccept,
  onReject,
}: {
  proposal: OntologyChangeProposal
  busy: boolean
  onAccept: () => void
  onReject: () => void
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">
            {proposal.trigger === 'conversation' ? 'from your conversations' : 'from an upload'}
          </Badge>
          <Badge variant={RISK_BADGE[proposal.risk]}>{RISK_LABEL[proposal.risk]}</Badge>
          <span>{timeAgo(proposal.created_at)}</span>
        </div>
        {proposal.summary && <p className="text-sm text-foreground">{proposal.summary}</p>}
        <ul className="flex flex-col gap-1.5">
          {proposal.changes.map((change, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium text-foreground">{describeChange(change)}</span>
              {change.rationale && <span className="text-muted-foreground"> — {change.rationale}</span>}
            </li>
          ))}
        </ul>
        {proposal.evidence.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Evidence ({proposal.evidence.length})</summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {proposal.evidence.map((e, i) => (
                <li key={i} className="flex gap-1.5">
                  <Quote className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {e.quote}
                    {e.origin && <span className="text-muted-foreground/70"> — {e.origin}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={onAccept}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
            <X className="h-3.5 w-3.5" /> Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function FeedItem({ event }: { event: DiscoveryEvent }) {
  const Icon = EVENT_ICON[event.kind] ?? Sparkles
  const failed = event.kind === 'discovery_failed'
  return (
    <li className="flex gap-3">
      <div
        className={
          failed
            ? 'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive'
            : 'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground'
        }
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-sm font-medium text-foreground">{event.title}</span>
          <span className="text-xs text-muted-foreground">{timeAgo(event.created_at)}</span>
        </div>
        {event.body && (
          <p className="mt-0.5 whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">
            {event.body}
          </p>
        )}
      </div>
    </li>
  )
}

type DiscoveryData = {
  proposals: OntologyChangeProposal[]
  feed: DiscoveryEvent[]
  vocabulary: VocabularyEntry[]
  overview: MemoryOverview
}

async function loadDiscoveryData(): Promise<DiscoveryData> {
  const [proposals, feed, vocabulary, overview] = await Promise.all([
    listProposals('pending'),
    getDiscoveryFeed(),
    getVocabulary(),
    getMemoryOverview(),
  ])
  return { proposals, feed, vocabulary, overview }
}

/** The Discovery Feed (docs/ARCHITECTURE.md §4, docs/MEMORY_AND_DISCOVERY.md
 * §3): where the AI-maintained ontology and periodic memory become
 * visible. Pending ontology proposals to accept or dismiss, the timeline
 * of what discovery and consolidation did, and the vocabulary the chatbot
 * has learned. */
export function DiscoveryPage() {
  const { setOntology, refreshOntology, refreshPendingProposals } = useAppData()
  const [data, setData] = useState<DiscoveryData | null>(null)
  const [settings, setSettings] = useState<DiscoverySettings | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [consolidating, setConsolidating] = useState(false)
  const [lastRun, setLastRun] = useState<ConsolidationRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadDiscoveryData()
      .then(setData)
      .catch((err: Error) => setError(err.message))
    getDiscoverySettings()
      .then(setSettings)
      .catch(() => setSettings(null))
  }, [])

  async function reload() {
    try {
      setData(await loadDiscoveryData())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load discovery data')
    }
  }

  async function decide(proposal: OntologyChangeProposal, accept: boolean) {
    setDecidingId(proposal.id)
    setError(null)
    try {
      const decision = accept ? await acceptProposal(proposal.id) : await rejectProposal(proposal.id)
      setOntology(decision.ontology)
      if (decision.proposal.status === 'failed') {
        setError(decision.proposal.error ?? 'None of the suggested changes still apply.')
      }
      await reload()
      void refreshPendingProposals()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record the decision')
    } finally {
      setDecidingId(null)
    }
  }

  async function consolidate() {
    setConsolidating(true)
    setError(null)
    try {
      setLastRun(await consolidateMemory())
      await reload()
      // Consolidation can evolve the ontology from conversation gaps.
      void refreshOntology()
      void refreshPendingProposals()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Consolidation failed')
    } finally {
      setConsolidating(false)
    }
  }

  const proposals = data?.proposals ?? []
  const feed = data?.feed ?? []
  const vocabulary = data?.vocabulary ?? []
  const overview = data?.overview ?? null
  const lastConsolidation = overview?.last_run
  const interval = settings?.consolidation_interval_minutes ?? overview?.consolidation_interval_minutes

  return (
    <div>
      <PageHeader
        title="Discovery"
        description="The AI keeps the ontology in step with your data and conversations -- review what it proposes, and see what periodic memory consolidation learned."
        actions={
          <Button variant="outline" disabled={consolidating} onClick={() => void consolidate()}>
            {consolidating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Consolidate memory now
          </Button>
        }
      />

      {error && (
        <p className="mb-4 flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {lastRun && (
        <Card className="mb-6 border-primary/30 bg-accent/40">
          <CardContent className="flex gap-2.5 py-4">
            <Brain className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <div className="text-sm font-semibold text-foreground">Consolidation finished</div>
              <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">{lastRun.digest}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Ontology autonomy"
          value={settings?.ontology_autonomy ?? '—'}
          hint={settings ? AUTONOMY_EXPLANATION[settings.ontology_autonomy] : undefined}
        />
        <StatTile
          label="Conversations"
          value={overview ? String(overview.conversations) : '—'}
          hint={overview ? `${overview.episodes} episodes in memory` : undefined}
        />
        <StatTile
          label="Learned terms"
          value={overview ? String(overview.vocabulary_terms) : '—'}
          hint="How you name ontology types"
        />
        <StatTile
          label="Last consolidation"
          value={lastConsolidation ? timeAgo(lastConsolidation.started_at) : 'never'}
          hint={interval ? `scheduled every ${interval >= 60 ? `${interval / 60}h` : `${interval}m`}` : 'schedule off'}
        />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          Needs your review
          {proposals.length > 0 && <Badge variant="warning">{proposals.length}</Badge>}
        </h2>
        {proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to review — the AI applies what your autonomy setting allows and queues the rest here.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                busy={decidingId === proposal.id}
                onAccept={() => void decide(proposal, true)}
                onReject={() => void decide(proposal, false)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-muted-foreground" /> Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {feed.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing yet. Upload a source and the AI's ontology work shows up here, along with each
                memory-consolidation digest.
              </p>
            ) : (
              <ul className="flex flex-col gap-4">
                {feed.map((event) => (
                  <FeedItem key={event.id} event={event} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" /> Learned vocabulary
            </CardTitle>
          </CardHeader>
          <CardContent>
            {vocabulary.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                As you chat, the words you use for ontology types (“clients” for Customer) are learned
                here and used to resolve later questions.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {vocabulary.map((v) => (
                  <li key={`${v.term}:${v.maps_to}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">
                      “{v.term}” <span className="text-muted-foreground">→</span>{' '}
                      <span className="font-medium">{v.maps_to}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{v.hits}×</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
