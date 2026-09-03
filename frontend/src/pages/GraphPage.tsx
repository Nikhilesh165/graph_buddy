import { Share2 } from 'lucide-react'
import { PageHeader } from '../components/layout/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { GraphExplorer } from '../components/GraphExplorer'
import { useAppData } from '../lib/appDataContext'

export function GraphPage() {
  const { ontology, hasOntology } = useAppData()

  return (
    <div>
      <PageHeader
        title="Graph Explorer"
        description="Filter by entity type or confidence, search facts, and click a node to inspect its neighborhood and provenance."
      />
      {hasOntology && ontology ? (
        <GraphExplorer ontology={ontology} />
      ) : (
        <EmptyState
          icon={Share2}
          title="Nothing to explore yet"
          description="Extract at least one source into the graph before there's anything to visualize here."
        />
      )}
    </div>
  )
}
