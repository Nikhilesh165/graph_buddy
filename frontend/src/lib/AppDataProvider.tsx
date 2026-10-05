import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getGraphHealth, getHealth, getOntology, listProposals } from '../api/client'
import type { OntologyVersion } from '../types'
import { AppDataContext, type AppData, type BadgeState } from './appDataContext'

/** Backend/graph-DB health checks and the current ontology version, lifted
 * out of the old single-page App.tsx so every page (Dashboard, Sources,
 * Ontology, Graph, Chat) can read/update the same ontology without
 * threading it through router props. Fetched once on mount, same as
 * before -- pages that mutate the ontology (Sources' auto-bootstrap,
 * Ontology Studio's save) call `setOntology` to push the new version back
 * in, same flow the old App.tsx used with local state. Since the AI
 * discovery cycle (docs/MEMORY_AND_DISCOVERY.md §3) also changes the
 * ontology server-side, pages that trigger it call `refreshOntology` /
 * `refreshPendingProposals` once it settles. */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const [backendState, setBackendState] = useState<BadgeState>('checking')
  const [graphState, setGraphState] = useState<BadgeState>('checking')
  const [graphDetail, setGraphDetail] = useState<string | undefined>(undefined)
  const [ontology, setOntology] = useState<OntologyVersion | null>(null)
  const [pendingProposals, setPendingProposals] = useState(0)

  const refreshOntology = useCallback(async () => {
    try {
      setOntology(await getOntology())
    } catch {
      // keep whatever we had -- a transient fetch failure shouldn't blank the Studio
    }
  }, [])

  const refreshPendingProposals = useCallback(async () => {
    try {
      setPendingProposals((await listProposals('pending')).length)
    } catch {
      // best-effort badge
    }
  }, [])

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

    listProposals('pending')
      .then((proposals) => setPendingProposals(proposals.length))
      .catch(() => setPendingProposals(0))
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
    refreshOntology,
    pendingProposals,
    refreshPendingProposals,
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
