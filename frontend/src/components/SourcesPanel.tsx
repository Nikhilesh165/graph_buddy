import { useEffect, useRef, useState } from 'react'
import { bootstrapOntology, extractSource, getSource, listSources, uploadSource } from '../api/client'
import type { OntologyVersion, SourceRead } from '../types'

type Props = {
  hasOntology: boolean
  onOntologyChange: (version: OntologyVersion) => void
}

export function SourcesPanel({ hasOntology, onOntologyChange }: Props) {
  const [sources, setSources] = useState<SourceRead[]>([])
  const [uploading, setUploading] = useState(false)
  const [bootstrappingId, setBootstrappingId] = useState<string | null>(null)
  const [extractingId, setExtractingId] = useState<string | null>(null)
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
    setBootstrappingId(sourceId)
    setError(null)
    try {
      const version = await bootstrapOntology(sourceId)
      onOntologyChange(version)
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

  return (
    <section className="panel">
      <h2>Sources</h2>
      <div className="upload-row">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.csv,.txt,.md"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleUpload(file)
          }}
        />
        {uploading && <span className="muted">Uploading & parsing…</span>}
      </div>

      {error && <p className="error-text">{error}</p>}

      {sources.length === 0 ? (
        <p className="muted">No sources uploaded yet.</p>
      ) : (
        <ul className="source-list">
          {sources.map((source) => (
            <li key={source.id} className="source-row">
              <div className="source-main">
                <span className="source-filename">{source.filename}</span>
                <span className={`source-status source-status--${source.status}`}>
                  {source.status}
                </span>
              </div>
              {source.status === 'failed' && (
                <span className="error-text">{source.parse_error}</span>
              )}
              {source.status === 'parsed' && (
                <div className="source-actions">
                  <button
                    type="button"
                    disabled={bootstrappingId === source.id}
                    onClick={() => void runBootstrap(source.id)}
                  >
                    {bootstrappingId === source.id
                      ? 'Bootstrapping…'
                      : 'Propose ontology from this source'}
                  </button>
                  <button
                    type="button"
                    disabled={!hasOntology || extractingId === source.id}
                    title={hasOntology ? undefined : 'Bootstrap or define an ontology first'}
                    onClick={() => void runExtract(source.id)}
                  >
                    {extractingId === source.id ? 'Extracting…' : 'Extract into graph'}
                  </button>
                  <span className={`graphiti-status graphiti-status--${source.graphiti_status}`}>
                    {source.graphiti_status === 'extracted'
                      ? `extracted: ${source.node_count} nodes, ${source.edge_count} edges`
                      : source.graphiti_status.replace('_', ' ')}
                  </span>
                  {source.graphiti_status === 'failed' && source.graphiti_error && (
                    <span className="error-text">{source.graphiti_error}</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
