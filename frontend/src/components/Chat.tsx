import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Check, Copy, Loader2, Sparkles } from 'lucide-react'
import { askChat, getChatHistory } from '../api/client'
import type { ChatCitation, ChatTurn } from '../types'
import { useAppData } from '../lib/appDataContext'
import { formatRelative } from '../lib/format'
import { Button } from './ui/Button'
import { ConfidenceMeter } from './ui/ConfidenceMeter'
import { Kbd } from './ui/Kbd'
import { Skeleton } from './ui/Skeleton'

type Props = {
  onExplain: (turnId: string) => void
}

/** Replace `[n]` markers in an answer with citation chips; hovering one
 * shows the fact it points at. */
function AnswerText({ answer, citations }: { answer: string; citations: ChatCitation[] }) {
  const byIndex = useMemo(() => new Map(citations.map((c) => [c.index, c])), [citations])
  const parts = answer.split(/(\[\d+\])/g)
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\[(\d+)\]$/.exec(part)
        const citation = match ? byIndex.get(Number(match[1])) : undefined
        if (!citation) return <Fragment key={i}>{part}</Fragment>
        return (
          <span key={i} className="group/cite relative inline-block align-baseline">
            <a
              href={`#cite-${citation.edge_uuid}`}
              className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-[5px] bg-accent px-1 font-mono text-[10.5px] font-semibold text-accent-foreground no-underline transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              {citation.index}
            </a>
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-64 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-2 text-xs leading-snug text-popover-foreground opacity-0 shadow-float transition-opacity duration-150 group-hover/cite:opacity-100 group-hover/cite:delay-150"
            >
              {citation.fact}
              <span className="mt-1 flex">
                <ConfidenceMeter value={citation.confidence} />
              </span>
            </span>
          </span>
        )
      })}
    </>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        })
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-[14px] leading-relaxed text-secondary-foreground">
        {children}
      </div>
    </div>
  )
}

function AssistantMark() {
  return (
    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/12 text-accent-foreground">
      <Sparkles className="h-3.5 w-3.5" />
    </div>
  )
}

export function Chat({ onExplain }: Props) {
  const { ontology } = useAppData()
  const [turns, setTurns] = useState<ChatTurn[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [askError, setAskError] = useState<{ question: string; message: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    getChatHistory()
      .then(setTurns)
      .catch((err: Error) => {
        setHistoryError(err.message)
        setTurns([])
      })
  }, [])

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: turns && turns.length > 0 ? 'smooth' : 'auto' })
  }, [turns, pending])

  // Auto-grow the composer textarea up to a cap -- avoids a fixed-height
  // box that either wastes space or clips.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [question])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const suggestions = useMemo(() => {
    const types = ontology?.entity_types.map((et) => et.name) ?? []
    const list: string[] = []
    if (types[0]) list.push(`What do we know about each ${types[0]}?`)
    if (types[0] && types[1]) list.push(`How are ${types[0]}s connected to ${types[1]}s?`)
    if (types[2]) list.push(`Which ${types[2]}s come up most often?`)
    list.push('Summarize the most important facts in the graph')
    return list.slice(0, 4)
  }, [ontology])

  async function ask(text: string) {
    const q = text.trim()
    if (!q || pending) return
    setPending(q)
    setQuestion('')
    setAskError(null)
    try {
      const turn = await askChat(q)
      setTurns((prev) => [...(prev ?? []), turn])
    } catch (err) {
      setAskError({ question: q, message: err instanceof Error ? err.message : 'Failed to get an answer' })
      setQuestion(q)
    } finally {
      setPending(null)
      textareaRef.current?.focus()
    }
  }

  const empty = turns !== null && turns.length === 0 && !pending

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-7 px-5 pb-8 pt-8 sm:px-8">
          {historyError && <p className="text-[13px] text-destructive">{historyError}</p>}

          {turns === null && (
            <div className="flex flex-col gap-6" aria-busy="true">
              <Skeleton className="ml-auto h-9 w-2/3 rounded-2xl" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {empty && (
            <div className="flex animate-rise-in flex-col items-center pt-[8vh] text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/12 text-accent-foreground">
                <Sparkles className="h-5 w-5" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Ask your knowledge graph</h2>
              <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
                Answers are grounded in the facts extracted from your sources, cite what they used, and can be
                inspected hop by hop.
              </p>
              <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void ask(s)}
                    className="rounded-lg border border-border px-3 py-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:border-border-strong hover:bg-hover hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns?.map((turn) => (
            <article key={turn.id} className="flex flex-col gap-3">
              <UserBubble>{turn.question}</UserBubble>
              <div className="flex gap-3">
                <AssistantMark />
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap text-[14.5px] leading-[1.7] text-foreground">
                    <AnswerText answer={turn.answer} citations={turn.citations} />
                  </div>

                  {turn.citations.length > 0 && (
                    <ol className="mt-3 flex flex-col gap-1 border-l-2 border-border pl-3">
                      {turn.citations.map((c) => (
                        <li
                          key={c.index}
                          id={`cite-${c.edge_uuid}`}
                          className="flex scroll-mt-24 items-start gap-2 text-[12.5px] leading-snug text-muted-foreground target:text-foreground"
                        >
                          <span className="mt-px font-mono text-[11px] font-semibold text-accent-foreground">{c.index}</span>
                          <span className="min-w-0 flex-1">{c.fact}</span>
                          <ConfidenceMeter value={c.confidence} className="mt-0.5 shrink-0" />
                        </li>
                      ))}
                    </ol>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center gap-1 text-xs text-faint-foreground">
                    {turn.retrieved_count > 0 && (
                      <Button size="xs" variant="ghost" className="text-accent-foreground" onClick={() => onExplain(turn.id)}>
                        <Sparkles className="h-3 w-3" /> Explain this answer
                      </Button>
                    )}
                    <CopyButton text={turn.answer} />
                    <span className="ml-1">{formatRelative(turn.created_at)}</span>
                  </div>
                </div>
              </div>
            </article>
          ))}

          {pending && (
            <article className="flex flex-col gap-3" aria-live="polite">
              <UserBubble>{pending}</UserBubble>
              <div className="flex gap-3">
                <AssistantMark />
                <div className="flex items-center gap-1 pt-2" aria-label="Thinking">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint-foreground"
                      style={{ animationDelay: `${i * 140}ms` }}
                    />
                  ))}
                  <span className="ml-2 text-xs text-faint-foreground">Searching the graph…</span>
                </div>
              </div>
            </article>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background px-4 pb-4 pt-3 sm:px-8">
        <div className="mx-auto w-full max-w-[46rem]">
          {askError && (
            <div role="alert" className="mb-2 flex items-center gap-2 text-[13px] text-destructive">
              <span className="min-w-0 flex-1 truncate">{askError.message}</span>
              <Button size="xs" variant="secondary" onClick={() => void ask(askError.question)}>
                Retry
              </Button>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-border bg-input px-3 py-2 shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20">
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="Ask something about your data…"
              aria-label="Your question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void ask(question)
                }
              }}
              className="max-h-44 min-h-6 flex-1 resize-none bg-transparent py-1 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-faint-foreground"
            />
            <Button
              size="icon-sm"
              disabled={!!pending || !question.trim()}
              onClick={() => void ask(question)}
              aria-label="Send"
              className="mb-0.5 rounded-lg"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-faint-foreground">
            <Kbd>↵</Kbd> to send · <Kbd>Shift</Kbd> <Kbd>↵</Kbd> for a new line
          </p>
        </div>
      </div>
    </div>
  )
}
