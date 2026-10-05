import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Sparkles,
  UploadCloud,
  Workflow,
} from 'lucide-react'
import { discoverSource, extractSource, getSource, listSources, uploadSource } from '../api/client'
import { Badge, type BadgeVariant } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { cn } from '../lib/cn'
import { useAppData } from '../lib/appDataContext'
import type { SourceDiscoveryResult, SourceRead, SourceStatus, GraphitiStatus } from '../types'

const STATUS_BADGE: Record<SourceStatus, BadgeVariant> = {
  parsed: 'success',
  failed: 'destructive',
  uploaded: 'warning',
}

const GRAPHITI_BADGE: Record<GraphitiStatus, BadgeVariant> = {
  extracted: 'success',
  extracting: 'warning',
  failed: 'destructive',
  not_extracted: 'secondary',
}

// How often to re-check sources whose background work (the post-upload
// discovery pass, optional auto-extract) is still running.
const POLL_MS = 1500

function isDiscovering(source: SourceRead): boolean {
  return source.discovery_status === 'pending' || source.discovery_status === 'running'
}

function isBusy(source: SourceRead): boolean {
  return isDiscovering(source) || source.graphiti_status === 'extracting'
}

function describeOutcome(result: SourceDiscoveryResult): string {
  const parts: string[] = []
  if (result.applied) {
    parts.push(
      `applied ${result.applied.changes.length} change${result.applied.changes.length === 1 ? '' : 's'} (now v${result.ontology.version_number})`,
    )
  }
  if (result.pending) {
    parts.push(
      `${result.pending.changes.length} change${result.pending.changes.length === 1 ? '' : 's'} need${result.pending.changes.length === 1 ? 's' : ''} review in Discovery`,
    )
  }
  return parts.length ? `AI analysis: ${parts.join('; ')}.` : 'AI analysis: the ontology already covers this source.'
}

/** Upload + per-source pipeline status. Since docs/MEMORY_AND_DISCOVERY.md
 * §3, the ontology isn't something the user bootstraps here by hand: every
 * upload kicks off a background AI discovery pass server-side (bootstrap
 * when there's no ontology, evolve it otherwise), which this panel polls
 * and reflects. "Re-analyze" re-runs that pass on demand. */
export function SourcesPanel() {
  const { hasOntology, ontology, setOntology, refreshOntology, refreshPendingProposals } = useAppData()
  const [sources, setSources] = useState<SourceRead[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [extractingId, setExtractingId] = useState<string | null>(null)
  const [notices, setNotices] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pollTick, setPollTick] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentVersion = ontology?.version_number ?? 0
  const busyKey = sources
    .filter(isBusy)
    .map((s) => `${s.id}:${s.discovery_status}:${s.graphiti_status}`)
    .join('|')

  useEffect(() => {
    listSources()
      .then(setSources)
      .catch((err: Error) => setError(err.message))
  }, [])

  // Latest sources for the poller below, read at fire time -- keeps the
  // timer from resetting on every unrelated `sources` update.
  const sourcesRef = useRef(sources)
  useEffect(() => {
    sourcesRef.current = sources
  }, [sources])

  // Poll busy sources until their background work settles. `pollTick`
  // re-arms the timer after every round even when nothing changed yet.
  useEffect(() => {
    if (!busyKey) return
    const timer = window.setTimeout(() => {
      const busy = sourcesRef.current.filter(isBusy)
      void Promise.all(busy.map((s) => getSource(s.id).catch(() => null))).then((results) => {
        const updated = results.filter((r): r is SourceRead => r !== null)
        setSources((prev) => prev.map((s) => updated.find((u) => u.id === s.id) ?? s))
        const discoverySettled = updated.some(
          (u) => !isDiscovering(u) && busy.some((b) => b.id === u.id && isDiscovering(b)),
        )
        if (discoverySettled) {
          void refreshOntology()
          void refreshPendingProposals()
        }
        setPollTick((t) => t + 1)
      })
    }, POLL_MS)
    return () => window.clearTimeout(timer)
  }, [busyKey, pollTick, refreshOntology, refreshPendingProposals])

  async function runDiscovery(sourceId: string) {
    setAnalyzingId(sourceId)
    setError(null)
    try {
      const result = await discoverSource(sourceId)
      setSources((prev) => prev.map((s) => (s.id === sourceId ? result.source : s)))
      setOntology(result.ontology)
      setNotices((prev) => ({ ...prev, [sourceId]: describeOutcome(result) }))
      void refreshPendingProposals()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI analysis failed')
      try {
        const refreshed = await getSource(sourceId)
        setSources((prev) => prev.map((s) => (s.id === sourceId ? refreshed : s)))
      } catch {
        // best-effort refresh; the error banner already covers the failure
      }
    } finally {
      setAnalyzingId(null)
    }
  }

  async function runExtract(sourceId: string) {
    setExtractingId(sourceId)
    setError(null)
    try {
      await extractSource(sourceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      // Refresh either way -- on failure the backend still recorded
      // graphiti_status="failed" + graphiti_error on the source row, and
      // that's the source of truth for what's shown per-row, not the error
      // banner above.
      try {
        const refreshed = await getSource(sourceId)
        setSources((prev) => prev.map((s) => (s.id === sourceId ? refreshed : s)))
      } catch {
        // best-effort refresh; the error banner already covers the failure
      }
      setExtractingId(null)
    }
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const source = await uploadSource(file)
      setSources((prev) => [source, ...prev])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleUpload(file)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={cn(
          'border-dashed py-10 text-center transition-colors',
          dragActive ? 'border-primary bg-accent/60' : 'hover:border-primary/50',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.csv,.txt,.md"
          disabled={uploading}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleUpload(file)
          }}
        />
        <div className="flex flex-col items-center gap-2 px-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <UploadCloud className="h-5 w-5" strokeWidth={1.75} />
            )}
          </div>
          <p className="text-sm font-medium text-foreground">
            {uploading ? 'Uploading & parsing…' : 'Drop a file here, or browse'}
          </p>
          <p className="text-xs text-muted-foreground">
            PDF, DOCX, CSV, TXT, or Markdown — the AI derives or evolves the ontology from each upload.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="mt-1"
          >
            Choose file
          </Button>
        </div>
      </Card>

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sources uploaded yet.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {sources.map((source) => {
            const discovering = isDiscovering(source) || analyzingId === source.id
            const staleExtraction =
              source.graphiti_status === 'extracted' &&
              source.extracted_ontology_version !== null &&
              currentVersion > source.extracted_ontology_version
            return (
              <Card key={source.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="truncate font-mono text-sm text-foreground">{source.filename}</span>
                  </div>
                  <Badge variant={STATUS_BADGE[source.status]}>{source.status}</Badge>
                </div>

                {source.status === 'failed' && (
                  <p className="mt-2 text-xs text-destructive">{source.parse_error}</p>
                )}

                {source.status === 'parsed' && (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={discovering}
                        title="Have the AI compare this source with the current ontology and propose changes"
                        onClick={() => void runDiscovery(source.id)}
                      >
                        {discovering ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        {hasOntology ? 'Re-analyze with AI' : 'Derive ontology'}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!hasOntology || discovering || extractingId === source.id}
                        title={
                          discovering
                            ? 'Waiting for the AI to finish updating the ontology'
                            : hasOntology
                              ? undefined
                              : 'The ontology appears once the AI has analyzed a source'
                        }
                        onClick={() => void runExtract(source.id)}
                      >
                        {extractingId === source.id || source.graphiti_status === 'extracting' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Workflow className="h-3.5 w-3.5" />
                        )}
                        {staleExtraction ? 'Re-extract' : 'Extract into graph'}
                      </Button>
                      {discovering && (
                        <Badge variant="warning" className="gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> AI analyzing
                        </Badge>
                      )}
                      {!discovering && source.discovery_status === 'completed' && (
                        <Badge variant="secondary" className="gap-1">
                          <Sparkles className="h-3 w-3" /> ontology checked
                        </Badge>
                      )}
                      {!discovering && source.discovery_status === 'failed' && (
                        <Badge variant="destructive">analysis failed</Badge>
                      )}
                      <Badge variant={GRAPHITI_BADGE[source.graphiti_status]} className="gap-1">
                        {source.graphiti_status === 'extracted' && <CheckCircle2 className="h-3 w-3" />}
                        {source.graphiti_status === 'extracted'
                          ? `${source.node_count} nodes, ${source.edge_count} edges`
                          : source.graphiti_status.replace('_', ' ')}
                      </Badge>
                    </div>
                    {source.discovery_status === 'failed' && source.discovery_error && (
                      <p className="mt-2 text-xs text-destructive">{source.discovery_error}</p>
                    )}
                    {source.graphiti_status === 'failed' && source.graphiti_error && (
                      <p className="mt-2 text-xs text-destructive">{source.graphiti_error}</p>
                    )}
                    {notices[source.id] && (
                      <p className="mt-2 text-xs text-muted-foreground">{notices[source.id]}</p>
                    )}
                    {staleExtraction && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        The ontology has evolved since this source was extracted (v
                        {source.extracted_ontology_version} → v{currentVersion}) — re-extract to capture the new
                        types.
                      </p>
                    )}
                  </>
                )}
              </Card>
            )
          })}
        </ul>
      )}
    </div>
  )
}
