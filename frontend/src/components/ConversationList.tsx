import { MessageSquarePlus } from 'lucide-react'
import type { Conversation } from '../types'
import { cn } from '../lib/cn'
import { Button } from './ui/Button'

type Props = {
  conversations: Conversation[]
  selectedId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

/** Conversation threads (docs/MEMORY_AND_DISCOVERY.md §2.1) -- each is a
 * unit of working memory, so follow-ups resolve against *this* thread's
 * earlier turns. A side rail on desktop, a compact select on mobile. */
export function ConversationList({ conversations, selectedId, onSelect, onNew }: Props) {
  return (
    <>
      <div className="flex items-center gap-2 md:hidden">
        <select
          aria-label="Conversation"
          value={selectedId ?? ''}
          onChange={(e) => (e.target.value ? onSelect(e.target.value) : onNew())}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-sm text-foreground"
        >
          <option value="">New conversation</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title || 'Untitled'}
            </option>
          ))}
        </select>
        <Button size="icon" variant="outline" onClick={onNew} aria-label="New conversation">
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>

      <aside className="hidden flex-col gap-2 md:flex">
        <Button variant="outline" size="sm" onClick={onNew} className="justify-start">
          <MessageSquarePlus className="h-3.5 w-3.5" /> New conversation
        </Button>
        <nav className="flex max-h-[calc(100svh-12rem)] flex-col gap-0.5 overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              title={c.summary || c.title}
              className={cn(
                'flex flex-col rounded-md px-2.5 py-2 text-left transition-colors',
                c.id === selectedId
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <span className="truncate text-sm font-medium">{c.title || 'Untitled'}</span>
              <span className="text-[11px] text-muted-foreground">
                {c.turn_count} turn{c.turn_count === 1 ? '' : 's'}
                {c.summary ? ' · summarized' : ''}
              </span>
            </button>
          ))}
        </nav>
      </aside>
    </>
  )
}
