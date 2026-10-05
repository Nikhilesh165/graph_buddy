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
        description="The entity and relation types the graph is structured around. The AI discovery cycle maintains them as data and conversations arrive -- review its proposals in Discovery, or edit directly here."
      />
      {ontology ? (
        <OntologyStudio key={ontology.id} ontology={ontology} onSaved={setOntology} />
      ) : (
        <EmptyState
          icon={Workflow}
          title="No ontology yet"
          description="Upload a source -- the AI derives a starting ontology from it automatically."
        />
      )}
    </div>
  )
}
