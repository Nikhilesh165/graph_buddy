import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { AppDataProvider } from './lib/AppDataContext'
import { ChatPage } from './pages/ChatPage'
import { DashboardPage } from './pages/DashboardPage'
import { GraphPage } from './pages/GraphPage'
import { OntologyPage } from './pages/OntologyPage'
import { SourcesPage } from './pages/SourcesPage'

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
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/chat" element={<ChatPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppDataProvider>
  )
}

export default App
