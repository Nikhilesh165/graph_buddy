import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getGraphHealth, getHealth, getOntology } from '../api/client'
import type { OntologyVersion } from '../types'
import { AppDataContext, type AppData, type BadgeState } from './appDataContext'

/** Backend/graph-DB health checks and the current ontology version, lifted
 * out of the old single-page App.tsx so every page (Dashboard, Sources,
 * Ontology, Graph, Chat) can read/update the same ontology without
 * threading it through router props. Fetched once on mount, same as
 * before -- pages that mutate the ontology (Sources' auto-bootstrap,
 * Ontology Studio's save) call `setOntology` to push the new version back
 * in, same flow the old App.tsx used with local state. */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const [backendState, setBackendState] = useState<BadgeState>('checking')
  const [graphState, setGraphState] = useState<BadgeState>('checking')
  const [graphDetail, setGraphDetail] = useState<string | undefined>(undefined)
  const [ontology, setOntology] = useState<OntologyVersion | null>(null)

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
  }, [])

  const entityTypeOrder = useMemo(() => ontology?.entity_types.map((et) => et.name) ?? [], [ontology])

  const value: AppData = {
    backendState,
    graphState,
    graphDetail,
    ontology,
    setOntology,
    entityTypeOrder,
    hasOntology: (ontology?.version_number ?? 0) > 0,
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
