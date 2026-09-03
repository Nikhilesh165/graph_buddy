import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2, MessageSquareText, Sparkles } from 'lucide-react'
import { askChat, getChatHistory } from '../api/client'
import type { ChatTurn } from '../types'
import { formatConfidence } from '../lib/confidence'
import { Button } from './ui/Button'

function TurnCitations({ citations }: { citations: ChatTurn['citations'] }) {
  if (citations.length === 0) return null
  return (
    <ol className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-xs text-muted-foreground">
      {citations.map((c) => (
        <li key={c.index}>
          <span className="font-mono text-foreground">[{c.index}]</span> {c.fact}
          <span className="ml-1.5 font-mono">{formatConfidence(c.confidence)}</span>
        </li>
      ))}
    </ol>
  )
}

type Props = {
  onExplain: (turnId: string) => void
}

export function Chat({ onExplain }: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    getChatHistory()
      .then(setTurns)
      .catch((err: Error) => setHistoryError(err.message))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' })
  }, [turns.length])

  // Auto-grow the composer textarea up to a cap, same pattern as most chat
  // UIs -- avoids a fixed-height box that either wastes space or clips.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [question])

  async function handleAsk() {
    const q = question.trim()
    if (!q || asking) return
    setAsking(true)
    setAskError(null)
    try {
      const turn = await askChat(q)
      setTurns((prev) => [...prev, turn])
      setQuestion('')
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Failed to get an answer')
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="flex h-[calc(100svh-9rem)] flex-col rounded-xl border border-border bg-card">
      {historyError && <p className="px-5 pt-4 text-sm text-destructive">{historyError}</p>}

      {turns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <MessageSquareText className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <p className="text-sm text-muted-foreground">
            No questions asked yet — extract a source into the graph, then ask something about it.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            {turns.map((turn) => (
              <div key={turn.id} className="flex flex-col gap-2">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-secondary px-3.5 py-2 text-sm text-secondary-foreground">
                    {turn.question}
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-border bg-background px-4 py-3 text-sm leading-relaxed text-foreground">
                    {turn.answer}
                    <TurnCitations citations={turn.citations} />
                    {turn.retrieved_count > 0 && (
                      <button
                        type="button"
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        onClick={() => onExplain(turn.id)}
                      >
                        <Sparkles className="h-3 w-3" /> Explain this answer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      )}

      {askError && <p className="px-5 text-sm text-destructive">{askError}</p>}

      <div className="border-t border-border p-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-input bg-background px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/50">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="Ask something about your data…"
            value={question}
            disabled={asking}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleAsk()
              }
            }}
            className="max-h-40 flex-1 resize-none bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <Button
            size="icon"
            disabled={asking || !question.trim()}
            onClick={() => void handleAsk()}
            aria-label="Send"
            className="mb-0.5 shrink-0 rounded-full"
          >
            {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
