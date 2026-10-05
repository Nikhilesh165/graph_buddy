import { PageHeader } from '../components/layout/PageHeader'
import { SourcesPanel } from '../components/SourcesPanel'

export function SourcesPage() {
  return (
    <div>
      <PageHeader
        title="Sources"
        description="Upload documents -- the AI derives or evolves the ontology from each one, then extract them into the graph."
      />
      <SourcesPanel />
    </div>
  )
}
