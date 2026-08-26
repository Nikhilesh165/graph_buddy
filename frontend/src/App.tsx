import { useEffect, useState } from 'react'
import { getGraphHealth, getHealth } from './api/client'
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
  }, [])

  return (
    <main id="shell">
      <h1>Graph Buddy</h1>
      <p className="subtitle">Phase 0 — foundations</p>

      <section className="badges">
        <StatusBadge label="Backend" state={backendState} />
        <StatusBadge label="Graph DB" state={graphState} detail={graphDetail} />
      </section>

      <p className="hint">
        Graph DB unreachable? Run <code>docker compose up -d</code> from the repo root, then
        reload.
      </p>
    </main>
  )
}

export default App
