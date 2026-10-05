import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getGraphHealth, getHealth, getOntology, listSources } from '../api/client'
import type { OntologyVersion, SourceRead } from '../types'
import { AppDataContext, type AppData, type BadgeState } from './appDataContext'

/** Backend/graph-DB health checks, the current ontology version, and the
 * sources list -- state every page (and the shell's sidebar + status bar)
 * reads, lifted here so none of it is threaded through router props. Pages
 * that mutate it (Sources' upload/extract/auto-bootstrap, Ontology Studio's
 * save) push the new values back in via `setOntology` / `upsertSource`. */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const [backendState, setBackendState] = useState<BadgeState>('checking')
  const [graphState, setGraphState] = useState<BadgeState>('checking')
  const [graphDetail, setGraphDetail] = useState<string | undefined>(undefined)
  const [ontology, setOntology] = useState<OntologyVersion | null>(null)
  const [sources, setSources] = useState<SourceRead[] | null>(null)
  const [sourcesError, setSourcesError] = useState<string | null>(null)

  useEffect(() => {
    getHealth()
      .then(() => setBackendState('ok'))
      .catch(() => setBackendState('unreachable'))

    getGraphHealth()
      .then((result) => {
        setGraphState(result.status === 'ok' ? 'ok' : 'error')
        setGraphDetail(result.detail)
      })
      .catch(() => setGraphState('unreachable'))

    getOntology()
      .then(setOntology)
      .catch(() => setOntology(null))

    listSources()
      .then(setSources)
      .catch((err: unknown) => {
        setSourcesError(err instanceof Error ? err.message : 'Failed to load sources')
        setSources([])
      })
  }, [])

  const upsertSource = useCallback((source: SourceRead) => {
    setSources((prev) => {
      const list = prev ?? []
      return list.some((s) => s.id === source.id)
        ? list.map((s) => (s.id === source.id ? source : s))
        : [source, ...list]
    })
  }, [])

  const entityTypeOrder = useMemo(() => ontology?.entity_types.map((et) => et.name) ?? [], [ontology])

  const value = useMemo<AppData>(
    () => ({
      backendState,
      graphState,
      graphDetail,
      ontology,
      setOntology,
      entityTypeOrder,
      hasOntology: (ontology?.version_number ?? 0) > 0,
      sources,
      sourcesError,
      upsertSource,
    }),
    [backendState, graphState, graphDetail, ontology, entityTypeOrder, sources, sourcesError, upsertSource],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
