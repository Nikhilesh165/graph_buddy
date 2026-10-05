import { Share2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { GraphExplorer } from '../graph/GraphExplorer'
import { useAppData } from '../lib/appDataContext'

export function GraphPage() {
  const { ontology, hasOntology } = useAppData()

  if (!hasOntology || !ontology) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={Share2}
          title="Nothing to explore yet"
          description="Extract at least one source into the graph before there's anything to visualize here."
          action={
            <Link to="/sources">
              <Button size="sm">Go to Sources</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return <GraphExplorer ontology={ontology} />
}
