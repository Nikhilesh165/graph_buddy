import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { AppDataProvider } from './lib/AppDataProvider'
import { CommandProvider } from './lib/CommandProvider'
import { ThemeProvider } from './lib/ThemeProvider'
import { ChatPage } from './pages/ChatPage'
import { DashboardPage } from './pages/DashboardPage'
import { GraphPage } from './pages/GraphPage'
import { OntologyPage } from './pages/OntologyPage'
import { SourcesPage } from './pages/SourcesPage'

// ThemeProvider (light/dark + override), AppDataProvider (health, ontology,
// sources every page shares), CommandProvider (the ⌘K registry), then the
// routed workspace inside AppShell.
function App() {
  return (
    <ThemeProvider>
      <AppDataProvider>
        <CommandProvider>
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
        </CommandProvider>
      </AppDataProvider>
    </ThemeProvider>
  )
}

export default App
