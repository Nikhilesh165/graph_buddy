import { useEffect, useMemo, useState } from 'react'
import { getGraphHealth, getHealth, getOntology } from './api/client'
import { Chat } from './components/Chat'
import { GraphExplorer } from './components/GraphExplorer'
import { OntologyStudio } from './components/OntologyStudio'
import { RetrievalInspector } from './components/RetrievalInspector'
import { SourcesPanel } from './components/SourcesPanel'
import type { OntologyVersion } from './types'
import './App.css'

type BadgeState = 'checking' | 'ok' | 'error' | 'unreachable'

function StatusBadge({ label, state, detail }: { label: string; state: BadgeState; detail?: string }) {
  return (
    <div className={`badge badge--${state}`}>
      <span className="badge-dot" aria-hidden="true" />
      <span className="badge-label">{label}</span>
      <span className="badge-state">{state}</span>
      {detail ? <span className="badge-detail">{detail}</span> : null}
    </div>
  )
}

function App() {
  const [backendState, setBackendState] = useState<BadgeState>('checking')
  const [graphState, setGraphState] = useState<BadgeState>('checking')
  const [graphDetail, setGraphDetail] = useState<string | undefined>(undefined)
  const [ontology, setOntology] = useState<OntologyVersion | null>(null)
  const [inspectingTurnId, setInspectingTurnId] = useState<string | null>(null)
  const entityTypeOrder = useMemo(
    () => ontology?.entity_types.map((et) => et.name) ?? [],
    [ontology],
  )

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

  return (
    <main id="shell">
      <h1>Graph Buddy</h1>
      <p className="subtitle">Phase 5 — retrieval analysis</p>

      <section className="badges">
        <StatusBadge label="Backend" state={backendState} />
        <StatusBadge label="Graph DB" state={graphState} detail={graphDetail} />
      </section>

      <p className="hint">
        Graph DB unreachable? Run <code>docker compose up -d</code> from the repo root, then
        reload. (Sources/ontology below work independently of it.)
      </p>

      {ontology && (
        <SourcesPanel hasOntology={ontology.version_number > 0} onOntologyChange={setOntology} />
      )}

      {ontology && (
        <OntologyStudio key={ontology.id} ontology={ontology} onSaved={setOntology} />
      )}

      {ontology && ontology.version_number > 0 && <GraphExplorer ontology={ontology} />}

      {ontology && ontology.version_number > 0 && <Chat onExplain={setInspectingTurnId} />}

      {inspectingTurnId && (
        <RetrievalInspector
          key={inspectingTurnId}
          turnId={inspectingTurnId}
          entityTypeOrder={entityTypeOrder}
          onClose={() => setInspectingTurnId(null)}
        />
      )}
    </main>
  )
}

export default App
