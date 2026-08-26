import { useEffect, useRef, useState } from 'react'
import { askChat, getChatHistory } from '../api/client'
import type { ChatTurn } from '../types'

function formatConfidence(value: number | null): string {
  return value === null ? 'unscored' : value.toFixed(2)
}

function TurnCitations({ citations }: { citations: ChatTurn['citations'] }) {
  if (citations.length === 0) return null
  return (
    <ol className="citation-list">
      {citations.map((c) => (
        <li key={c.index}>
          <span className="citation-index">[{c.index}]</span> {c.fact}
          <span className="confidence-badge">{formatConfidence(c.confidence)}</span>
        </li>
      ))}
    </ol>
  )
}

export function Chat() {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getChatHistory()
      .then(setTurns)
      .catch((err: Error) => setHistoryError(err.message))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' })
  }, [turns.length])

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
    <section className="panel panel--wide">
      <h2>Chat</h2>

      {historyError && <p className="error-text">{historyError}</p>}

      {turns.length === 0 ? (
        <p className="muted">
          No questions asked yet — extract a source into the graph, then ask something about it.
        </p>
      ) : (
        <div className="chat-transcript">
          {turns.map((turn) => (
            <div key={turn.id} className="chat-turn">
              <div className="chat-question">{turn.question}</div>
              <div className="chat-answer">
                {turn.answer}
                <TurnCitations citations={turn.citations} />
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {askError && <p className="error-text">{askError}</p>}

      <div className="chat-input-row">
        <input
          type="text"
          placeholder="Ask something about your data…"
          value={question}
          disabled={asking}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAsk()
          }}
        />
        <button type="button" disabled={asking || !question.trim()} onClick={() => void handleAsk()}>
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </div>
    </section>
  )
}
