import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { PageHeader } from '../components/layout/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { Sheet } from '../components/ui/Sheet'
import { Chat } from '../components/Chat'
import { RetrievalInspector } from '../components/RetrievalInspector'
import { useAppData } from '../lib/appDataContext'

export function ChatPage() {
  const { hasOntology, entityTypeOrder } = useAppData()
  const [inspectingTurnId, setInspectingTurnId] = useState<string | null>(null)

  return (
    <div>
      <PageHeader title="Chat" description="Ask questions in plain language -- every answer cites the facts it drew on." />
      {hasOntology ? (
        <Chat onExplain={setInspectingTurnId} />
      ) : (
        <EmptyState
          icon={MessageSquare}
          title="Nothing to chat about yet"
          description="Extract at least one source into the graph before asking questions over it."
        />
      )}

      <Sheet
        open={inspectingTurnId !== null}
        onClose={() => setInspectingTurnId(null)}
        title="Retrieval Inspector"
        description="The exact subgraph this answer's retrieval pulled in."
      >
        {inspectingTurnId && (
          <RetrievalInspector key={inspectingTurnId} turnId={inspectingTurnId} entityTypeOrder={entityTypeOrder} />
        )}
      </Sheet>
    </div>
  )
}
