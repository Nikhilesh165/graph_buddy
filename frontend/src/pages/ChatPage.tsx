import { useCallback, useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { listConversations } from '../api/client'
import { PageHeader } from '../components/layout/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { Sheet } from '../components/ui/Sheet'
import { Chat } from '../components/Chat'
import { ConversationList } from '../components/ConversationList'
import { RetrievalInspector } from '../components/RetrievalInspector'
import { useAppData } from '../lib/appDataContext'
import type { Conversation } from '../types'

export function ChatPage() {
  const { hasOntology, entityTypeOrder } = useAppData()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Remount key for <Chat>: changes when the user switches or starts a
  // thread, but not when a new thread receives its id from its first turn.
  const [chatKey, setChatKey] = useState('new')
  const [loaded, setLoaded] = useState(false)
  const [inspectingTurnId, setInspectingTurnId] = useState<string | null>(null)

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await listConversations())
    } catch {
      // the list is navigation sugar; the chat itself still works
    }
  }, [])

  // Open the most recent conversation by default, so returning to Chat
  // picks up where the user left off (with its working memory).
  useEffect(() => {
    listConversations()
      .then((list) => {
        setConversations(list)
        if (list.length > 0) {
          setSelectedId(list[0].id)
          setChatKey(list[0].id)
        }
      })
      .catch(() => setConversations([]))
      .finally(() => setLoaded(true))
  }, [])

  function selectConversation(id: string) {
    setSelectedId(id)
    setChatKey(id)
  }

  function startNewConversation() {
    setSelectedId(null)
    setChatKey(`new-${Date.now()}`)
  }

  return (
    <div>
      <PageHeader
        title="Chat"
        description="Ask questions in plain language -- each one is resolved against the ontology and your conversation memory, and every answer cites the facts it drew on."
      />
      {!hasOntology ? (
        <EmptyState
          icon={MessageSquare}
          title="Nothing to chat about yet"
          description="Extract at least one source into the graph before asking questions over it."
        />
      ) : (
        loaded && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
            <ConversationList
              conversations={conversations}
              selectedId={selectedId}
              onSelect={selectConversation}
              onNew={startNewConversation}
            />
            <Chat
              key={chatKey}
              conversationId={selectedId}
              onConversationStarted={setSelectedId}
              onTurnAdded={() => void refreshConversations()}
              onExplain={setInspectingTurnId}
            />
          </div>
        )
      )}

      <Sheet
        open={inspectingTurnId !== null}
        onClose={() => setInspectingTurnId(null)}
        title="Retrieval Inspector"
        description="How the question was resolved, what memory it used, and the exact subgraph retrieval pulled in."
      >
        {inspectingTurnId && (
          <RetrievalInspector key={inspectingTurnId} turnId={inspectingTurnId} entityTypeOrder={entityTypeOrder} />
        )}
      </Sheet>
    </div>
  )
}
