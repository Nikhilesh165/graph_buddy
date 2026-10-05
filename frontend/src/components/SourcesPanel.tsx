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
import { bootstrapOntology, extractSource, getSource, listSources, uploadSource } from '../api/client'
import { Badge, type BadgeVariant } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { cn } from '../lib/cn'
import type { OntologyVersion, SourceRead, SourceStatus, GraphitiStatus } from '../types'

type Props = {
  hasOntology: boolean
  onOntologyChange: (version: OntologyVersion) => void
}

const STATUS_BADGE: Record<SourceStatus, BadgeVariant> = {
  parsed: 'success',
  failed: 'destructive',
  uploaded: 'warning',
}

function withId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return new Set(ids).add(id)
}

function withoutId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids)
  next.delete(id)
  return next
}

const GRAPHITI_BADGE: Record<GraphitiStatus, BadgeVariant> = {
  extracted: 'success',
  extracting: 'warning',
  failed: 'destructive',
  not_extracted: 'secondary',
}

export function SourcesPanel({ hasOntology, onOntologyChange }: Props) {
  const [sources, setSources] = useState<SourceRead[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  // Sets, not a single id: two sources can be bootstrapping/extracting at
  // once, and with one shared id the first to finish cleared the other's
  // spinner and re-enabled its button mid-run.
  const [bootstrappingIds, setBootstrappingIds] = useState<ReadonlySet<string>>(new Set())
  const [extractingIds, setExtractingIds] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Avoids double-firing the auto-bootstrap if hasOntology hasn't re-rendered yet.
  const autoBootstrapFired = useRef(false)

  useEffect(() => {
    listSources()
      .then(setSources)
      .catch((err: Error) => setError(err.message))
  }, [])

  async function runBootstrap(sourceId: string) {
    setBootstrappingIds((ids) => withId(ids, sourceId))
    setError(null)
    try {
      const version = await bootstrapOntology(sourceId)
      onOntologyChange(version)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ontology bootstrap failed')
    } finally {
      setBootstrappingIds((ids) => withoutId(ids, sourceId))
    }
  }

  async function runExtract(sourceId: string) {
    setExtractingIds((ids) => withId(ids, sourceId))
    // Mirror the backend's own status while the (long) request runs, rather
    // than leaving the row's badge reading "not extracted" until it returns.
    setSources((prev) =>
      prev.map((s) => (s.id === sourceId ? { ...s, graphiti_status: 'extracting', graphiti_error: null } : s)),
    )
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
      setExtractingIds((ids) => withoutId(ids, sourceId))
    }
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const source = await uploadSource(file)
      setSources((prev) => [source, ...prev])
      if (source.status === 'parsed' && !hasOntology && !autoBootstrapFired.current) {
        autoBootstrapFired.current = true
        await runBootstrap(source.id)
      }
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
          <p className="text-xs text-muted-foreground">PDF, DOCX, CSV, TXT, or Markdown</p>
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
          {sources.map((source) => (
            <li key={source.id}>
              <Card className="px-4 py-3.5">
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
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bootstrappingIds.has(source.id)}
                      onClick={() => void runBootstrap(source.id)}
                    >
                      {bootstrappingIds.has(source.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      Propose ontology
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !hasOntology || extractingIds.has(source.id) || source.graphiti_status === 'extracting'
                      }
                      title={hasOntology ? undefined : 'Bootstrap or define an ontology first'}
                      onClick={() => void runExtract(source.id)}
                    >
                      {extractingIds.has(source.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Workflow className="h-3.5 w-3.5" />
                      )}
                      Extract into graph
                    </Button>
                    <Badge variant={GRAPHITI_BADGE[source.graphiti_status]} className="gap-1">
                      {source.graphiti_status === 'extracted' && <CheckCircle2 className="h-3 w-3" />}
                      {source.graphiti_status === 'extracted'
                        ? `${source.node_count} nodes, ${source.edge_count} edges`
                        : source.graphiti_status.replace('_', ' ')}
                    </Badge>
                    {source.graphiti_status === 'failed' && source.graphiti_error && (
                      <span className="text-xs text-destructive">{source.graphiti_error}</span>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
