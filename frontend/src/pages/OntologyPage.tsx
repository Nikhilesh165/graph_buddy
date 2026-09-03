import { PageHeader } from '../components/layout/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { OntologyStudio } from '../components/OntologyStudio'
import { useAppData } from '../lib/appDataContext'
import { Workflow } from 'lucide-react'

export function OntologyPage() {
  const { ontology, setOntology } = useAppData()

  return (
    <div>
      <PageHeader
        title="Ontology Studio"
        description="The entity and relation types the graph is structured around -- edit them directly, or let extraction propose changes."
      />
      {ontology ? (
        <OntologyStudio key={ontology.id} ontology={ontology} onSaved={setOntology} />
      ) : (
        <EmptyState
          icon={Workflow}
          title="No ontology yet"
          description="Upload a source and bootstrap an ontology from it to get started."
        />
      )}
    </div>
  )
}
