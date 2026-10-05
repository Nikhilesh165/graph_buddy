import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { AppDataProvider } from './lib/AppDataProvider'
import { DashboardPage } from './pages/DashboardPage'
import { DiscoveryPage } from './pages/DiscoveryPage'
import { OntologyPage } from './pages/OntologyPage'
import { SourcesPage } from './pages/SourcesPage'

// The two pages that render GraphCanvas (Graph Explorer, and Chat via the
// Retrieval Inspector) pull in the force-graph library -- the bulk of the
// bundle -- so they're split into their own chunk, loaded on first visit.
const GraphPage = lazy(() => import('./pages/GraphPage').then((m) => ({ default: m.GraphPage })))
const ChatPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })))

// Multi-page shell (docs/UI_REHAUL_PLAN.md): AppDataProvider holds the
// health checks + ontology state every page needs; AppShell renders the
// sidebar nav and the routed page in its content outlet.
function App() {
  return (
    <AppDataProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/ontology" element={<OntologyPage />} />
            <Route
              path="/graph"
              element={
                <Suspense fallback={null}>
                  <GraphPage />
                </Suspense>
              }
            />
            <Route
              path="/chat"
              element={
                <Suspense fallback={null}>
                  <ChatPage />
                </Suspense>
              }
            />
            <Route path="/discovery" element={<DiscoveryPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppDataProvider>
  )
}

export default App
