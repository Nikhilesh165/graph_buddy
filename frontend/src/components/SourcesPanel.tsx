import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Loader2, RotateCw, Sparkles, UploadCloud, Workflow, X } from 'lucide-react'
import { bootstrapOntology, extractSource, getSource, uploadSource } from '../api/client'
import { useAppData } from '../lib/appDataContext'
import { cn } from '../lib/cn'
import { formatBytes, formatRelative, pluralize } from '../lib/format'
import type { SourceRead } from '../types'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { FileIcon } from './ui/FileIcon'
import { Skeleton } from './ui/Skeleton'

const ACCEPT = '.pdf,.docx,.csv,.txt,.md'

type Props = {
  /** Lets the page header's "Upload" button open the file picker. */
  registerUploadTrigger?: (open: () => void) => void
}

/** Uploaded sources as a file list, with upload (button, drop anywhere on
 * the page, multiple files at once), ontology bootstrap, and extraction.
 * The first parsed upload auto-bootstraps an ontology when none exists,
 * same as before this redesign. */
export function SourcesPanel({ registerUploadTrigger }: Props) {
  const { sources, sourcesError, hasOntology, setOntology, upsertSource } = useAppData()
  const [searchParams, setSearchParams] = useSearchParams()
  const [queue, setQueue] = useState<{ total: number; done: number; current: string } | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [bootstrappingId, setBootstrappingId] = useState<string | null>(null)
  const [extractingId, setExtractingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropzoneRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)
  // Avoids double-firing the auto-bootstrap if hasOntology hasn't re-rendered yet.
  const autoBootstrapFired = useRef(false)

  useEffect(() => {
    registerUploadTrigger?.(() => fileInputRef.current?.click())
  }, [registerUploadTrigger])

  // Deep links: `?focus=<id>` scrolls to and flashes a row (sidebar,
  // palette, Overview); `?upload=1` draws attention to the dropzone.
  const focusId = searchParams.get('focus')
  const uploadParam = searchParams.get('upload')
  const [handledFocus, setHandledFocus] = useState<string | null>(null)
  if (sources && focusId !== handledFocus) {
    setHandledFocus(focusId)
    setFlashId(focusId)
  }
  useEffect(() => {
    if (!flashId) return
    document.getElementById(`source-${flashId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = window.setTimeout(() => setFlashId(null), 1600)
    return () => window.clearTimeout(timer)
  }, [flashId])

  useEffect(() => {
    if (!uploadParam) return
    dropzoneRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    dropzoneRef.current?.focus()
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('upload')
        return next
      },
      { replace: true },
    )
  }, [uploadParam, setSearchParams])

  async function runBootstrap(sourceId: string) {
    setBootstrappingId(sourceId)
    setError(null)
    try {
      const version = await bootstrapOntology(sourceId)
      setOntology(version)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ontology bootstrap failed')
    } finally {
      setBootstrappingId(null)
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
        upsertSource(await getSource(sourceId))
      } catch {
        // best-effort refresh; the error banner already covers the failure
      }
      setExtractingId(null)
    }
  }

  async function handleUpload(files: File[]) {
    if (files.length === 0 || queue) return
    setError(null)
    const failures: string[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setQueue({ total: files.length, done: i, current: file.name })
      try {
        const source = await uploadSource(file)
        upsertSource(source)
        if (source.status === 'parsed' && !hasOntology && !autoBootstrapFired.current) {
          autoBootstrapFired.current = true
          await runBootstrap(source.id)
        }
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`)
      }
    }
    setQueue(null)
    if (failures.length > 0) setError(failures.join('\n'))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Drop anywhere on the page, not just the dropzone.
  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragDepth.current++
    setDragActive(true)
  }
  function onDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    void handleUpload(Array.from(e.dataTransfer.files ?? []))
  }

  const uploading = queue !== null
  const isEmpty = sources !== null && sources.length === 0

  return (
    <div
      className="relative"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT}
        disabled={uploading}
        className="hidden"
        onChange={(e) => void handleUpload(Array.from(e.target.files ?? []))}
      />

      <div
        ref={dropzoneRef}
        tabIndex={-1}
        className={cn(
          'flex items-center gap-4 rounded-lg border border-dashed px-4 outline-none transition-colors focus-visible:border-ring focus:border-ring',
          isEmpty ? 'flex-col py-14 text-center' : 'py-3',
          dragActive ? 'border-primary bg-accent' : 'border-border-strong',
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg bg-background-alt text-faint-foreground',
            isEmpty ? 'h-12 w-12' : 'h-9 w-9',
          )}
        >
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" strokeWidth={1.75} />}
        </div>
        <div className={cn('min-w-0 flex-1', isEmpty && 'flex-none')}>
          <p className="text-[13.5px] font-medium text-foreground">
            {uploading
              ? `Uploading ${queue.current}${queue.total > 1 ? ` (${queue.done + 1} of ${queue.total})` : ''}…`
              : isEmpty
                ? 'Drop your first source here'
                : 'Drop files anywhere on this page to upload'}
          </p>
          <p className="text-xs text-faint-foreground">PDF, DOCX, CSV, TXT, or Markdown · multiple files at once</p>
        </div>
        <Button variant={isEmpty ? 'default' : 'secondary'} size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          Choose files
        </Button>
      </div>

      {(error || sourcesError) && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-[13px]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 whitespace-pre-line text-foreground">{error ?? sourcesError}</p>
          {error && (
            <button type="button" aria-label="Dismiss" onClick={() => setError(null)} className="rounded-sm p-0.5 text-muted-foreground hover:bg-hover">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {sources === null ? (
        <div className="mt-6 flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        sources.length > 0 && (
          <>
            <div className="mb-2 mt-8 flex items-center justify-between text-xs text-faint-foreground">
              <span>{pluralize(sources.length, 'source')}</span>
              <span>{pluralize(sources.filter((s) => s.graphiti_status === 'extracted').length, 'extracted', 'extracted')}</span>
            </div>
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
              {sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  flash={flashId === source.id}
                  hasOntology={hasOntology}
                  bootstrapping={bootstrappingId === source.id}
                  extracting={extractingId === source.id}
                  onBootstrap={() => void runBootstrap(source.id)}
                  onExtract={() => void runExtract(source.id)}
                />
              ))}
            </ul>
          </>
        )
      )}

      {dragActive && !isEmpty && (
        <div className="pointer-events-none fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-scrim">
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-primary bg-popover px-10 py-8 shadow-popover">
            <UploadCloud className="h-6 w-6 text-accent-foreground" />
            <p className="text-sm font-medium text-foreground">Drop to upload</p>
          </div>
        </div>
      )}
    </div>
  )
}

function SourceRow({
  source,
  flash,
  hasOntology,
  bootstrapping,
  extracting,
  onBootstrap,
  onExtract,
}: {
  source: SourceRead
  flash: boolean
  hasOntology: boolean
  bootstrapping: boolean
  extracting: boolean
  onBootstrap: () => void
  onExtract: () => void
}) {
  const parsed = source.status === 'parsed'
  const extracted = source.graphiti_status === 'extracted'

  return (
    <li
      id={`source-${source.id}`}
      className={cn(
        'group flex flex-col gap-2 bg-background px-4 py-3 transition-colors duration-700 sm:flex-row sm:items-center sm:gap-4',
        flash && 'bg-accent duration-150',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <FileIcon filename={source.filename} className="mt-0.5 h-4 w-4 shrink-0 text-faint-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-medium text-foreground">{source.filename}</span>
            {source.status === 'failed' ? (
              <Badge variant="destructive">parse failed</Badge>
            ) : extracted ? (
              <Badge variant="success">
                <CheckCircle2 /> extracted
              </Badge>
            ) : source.graphiti_status === 'failed' ? (
              <Badge variant="destructive">extraction failed</Badge>
            ) : source.graphiti_status === 'extracting' || extracting ? (
              <Badge variant="warning">extracting…</Badge>
            ) : (
              <Badge variant="secondary">not extracted</Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-faint-foreground">
            <span>{formatBytes(source.size_bytes)}</span>
            <span aria-hidden="true">·</span>
            <span>uploaded {formatRelative(source.created_at)}</span>
            {parsed && source.row_count !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>{pluralize(source.row_count, 'row')}</span>
              </>
            )}
            {extracted && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {pluralize(source.node_count, 'entity', 'entities')}, {pluralize(source.edge_count, 'fact')}
                </span>
              </>
            )}
          </div>
          {source.status === 'failed' && source.parse_error && (
            <p className="mt-1 text-xs text-destructive">{source.parse_error}</p>
          )}
          {source.graphiti_status === 'failed' && source.graphiti_error && (
            <p className="mt-1 text-xs text-destructive">{source.graphiti_error}</p>
          )}
        </div>
      </div>

      {parsed && (
        <div className="flex shrink-0 items-center gap-1.5 pl-7 sm:pl-0">
          <Button size="sm" variant="ghost" disabled={bootstrapping} onClick={onBootstrap} title="Propose an ontology from this source">
            {bootstrapping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Propose ontology
          </Button>
          <Button
            size="sm"
            variant={extracted ? 'secondary' : 'default'}
            disabled={!hasOntology || extracting}
            title={hasOntology ? undefined : 'Bootstrap or define an ontology first'}
            onClick={onExtract}
          >
            {extracting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : extracted ? (
              <RotateCw className="h-3.5 w-3.5" />
            ) : (
              <Workflow className="h-3.5 w-3.5" />
            )}
            {extracted ? 'Re-extract' : 'Extract'}
          </Button>
        </div>
      )}
    </li>
  )
}
