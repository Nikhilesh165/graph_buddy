import { Shapes } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DocumentPage } from '../components/layout/DocumentPage'
import { PageHeader } from '../components/layout/PageHeader'
import { OntologyStudio } from '../components/OntologyStudio'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { useAppData } from '../lib/appDataContext'

export function OntologyPage() {
  const { ontology, setOntology } = useAppData()

  return (
    <DocumentPage>
      <PageHeader
        title="Ontology"
        description="The entity and relation types the graph is structured around — edit them directly, or let extraction propose changes. Every save is a new version."
      />
      {ontology ? (
        <OntologyStudio key={ontology.id} ontology={ontology} onSaved={setOntology} />
      ) : (
        <EmptyState
          icon={Shapes}
          title="No ontology yet"
          description="Upload a source and an ontology will be proposed from it automatically."
          action={
            <Link to="/sources?upload=1">
              <Button size="sm">Upload a source</Button>
            </Link>
          }
        />
      )}
    </DocumentPage>
  )
}
