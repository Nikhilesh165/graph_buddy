import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import { Chat } from '../components/Chat'
import { RetrievalInspector } from '../components/RetrievalInspector'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Sheet } from '../components/ui/Sheet'
import { useAppData } from '../lib/appDataContext'

export function ChatPage() {
  const { hasOntology, entityTypeOrder } = useAppData()
  const [inspectingTurnId, setInspectingTurnId] = useState<string | null>(null)
  // Keep the last-inspected turn rendered while the sheet animates closed.
  const [shownTurnId, setShownTurnId] = useState<string | null>(null)
  if (inspectingTurnId && inspectingTurnId !== shownTurnId) setShownTurnId(inspectingTurnId)

  return (
    <>
      {hasOntology ? (
        <Chat onExplain={setInspectingTurnId} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={MessageSquare}
            title="Nothing to chat about yet"
            description="Extract at least one source into the graph before asking questions over it."
            action={
              <Link to="/sources">
                <Button size="sm">Go to Sources</Button>
              </Link>
            }
          />
        </div>
      )}

      <Sheet
        open={inspectingTurnId !== null}
        onClose={() => setInspectingTurnId(null)}
        title="Retrieval Inspector"
        description="The exact subgraph this answer's retrieval pulled in, fact by fact."
      >
        {shownTurnId && <RetrievalInspector key={shownTurnId} turnId={shownTurnId} entityTypeOrder={entityTypeOrder} />}
      </Sheet>
    </>
  )
}
