import { PageHeader } from '../components/layout/PageHeader'
import { SourcesPanel } from '../components/SourcesPanel'
import { useAppData } from '../lib/appDataContext'

export function SourcesPage() {
  const { hasOntology, setOntology } = useAppData()

  return (
    <div>
      <PageHeader
        title="Sources"
        description="Upload documents, then propose an ontology and extract them into the graph."
      />
      <SourcesPanel hasOntology={hasOntology} onOntologyChange={setOntology} />
    </div>
  )
}
