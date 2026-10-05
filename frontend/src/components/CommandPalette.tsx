import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { cn } from '../lib/cn'
import { useCommandPalette, type Command } from '../lib/commandContext'
import { fuzzyMatch } from '../lib/fuzzy'
import { usePresence } from '../lib/usePresence'
import { Kbd } from './ui/Kbd'

// Group order when the query is empty. Unlisted groups sort after these.
const GROUP_ORDER = ['Navigation', 'Graph', 'Actions', 'Entity types', 'Sources', 'Nodes']
// Groups that would flood the empty state (hundreds of nodes) only show
// once you type.
const SEARCH_ONLY_GROUPS = new Set(['Nodes'])
const MAX_RESULTS = 60

type Result = { command: Command; indices: number[] }

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>
  const set = new Set(indices)
  const parts: ReactNode[] = []
  let run = ''
  let runMatched = false
  const flush = (key: number) => {
    if (!run) return
    parts.push(
      runMatched ? (
        <mark key={key} className="bg-transparent font-semibold text-accent-foreground">
          {run}
        </mark>
      ) : (
        <span key={key}>{run}</span>
      ),
    )
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    const matched = set.has(i)
    if (matched !== runMatched) {
      flush(i)
      runMatched = matched
    }
    run += text[i]
  }
  flush(text.length)
  return <>{parts}</>
}

/** ⌘K / ⌘P palette: fuzzy-search every registered command -- pages,
 * actions, entity types, sources, and (on the graph) every loaded node. */
export function CommandPalette() {
  const { open, setOpen, commands } = useCommandPalette()
  const { mounted, closing } = usePresence(open, 120)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  // Reset per opening (render-time adjustment, no effect round-trip).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setActive(0)
    }
  }

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => previouslyFocused?.focus?.()
  }, [open])

  const results: Result[] = useMemo(() => {
    const q = query.trim()
    if (!q) {
      const rank = (g: string) => {
        const i = GROUP_ORDER.indexOf(g)
        return i === -1 ? GROUP_ORDER.length : i
      }
      return commands
        .filter((c) => !SEARCH_ONLY_GROUPS.has(c.group))
        .map((command, i) => ({ command, indices: [], i }))
        .sort((a, b) => rank(a.command.group) - rank(b.command.group) || a.i - b.i)
        .map(({ command }) => ({ command, indices: [] }))
    }
    const scored: (Result & { score: number })[] = []
    for (const command of commands) {
      const title = fuzzyMatch(q, command.title)
      const extra = command.keywords || command.subtitle ? fuzzyMatch(q, `${command.subtitle ?? ''} ${command.keywords ?? ''}`) : null
      if (title) scored.push({ command, indices: title.indices, score: title.score })
      else if (extra) scored.push({ command, indices: [], score: extra.score - 300 })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS)
  }, [commands, query])

  const activeIndex = Math.min(active, Math.max(0, results.length - 1))

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function run(command: Command | undefined) {
    if (!command) return
    setOpen(false)
    // Let the palette start closing before a navigation re-renders the page.
    window.requestAnimationFrame(() => command.run())
  }

  if (!mounted) return null

  const grouped = query.trim() === ''
  const nodeCount = commands.filter((c) => c.group === 'Nodes').length

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <div
        className={cn('absolute inset-0 bg-scrim', closing ? 'animate-fade-out' : 'animate-fade-in')}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={cn(
          'relative flex w-full max-w-[600px] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-popover',
          closing ? 'animate-pop-out' : 'animate-pop-in',
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-faint-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => (results.length === 0 ? 0 : (Math.min(i, results.length - 1) + 1) % results.length))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => (results.length === 0 ? 0 : (Math.min(i, results.length - 1) - 1 + results.length) % results.length))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(results[activeIndex]?.command)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length > 0 ? `${listId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            placeholder={nodeCount > 0 ? `Search commands, pages, and ${nodeCount} nodes…` : 'Search commands and pages…'}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-faint-foreground"
          />
          <Kbd>esc</Kbd>
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label="Commands" className="max-h-[min(440px,58vh)] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-[13px] text-muted-foreground">No matching commands.</li>
          )}
          {results.map(({ command, indices }, index) => {
            const Icon = command.icon
            const showHeader = grouped && (index === 0 || results[index - 1].command.group !== command.group)
            return (
              <li key={command.id} role="presentation">
                {showHeader && (
                  <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-faint-foreground first:pt-1">
                    {command.group}
                  </div>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-index={index}
                  onMouseMove={() => index !== activeIndex && setActive(index)}
                  onClick={() => run(command)}
                  className={cn(
                    'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13.5px]',
                    index === activeIndex ? 'bg-active text-foreground' : 'text-foreground/90',
                  )}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center text-faint-foreground">
                    {command.color ? (
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: command.color }} />
                    ) : Icon ? (
                      <Icon className="h-4 w-4" strokeWidth={1.75} />
                    ) : null}
                  </span>
                  <span className="min-w-0 truncate">
                    <Highlight text={command.title} indices={indices} />
                  </span>
                  {command.subtitle && <span className="shrink-0 truncate text-xs text-faint-foreground">{command.subtitle}</span>}
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {!grouped && <span className="text-[11px] text-faint-foreground">{command.group}</span>}
                    {command.shortcut?.map((key) => <Kbd key={key}>{key}</Kbd>)}
                    {index === activeIndex && !command.shortcut && (
                      <CornerDownLeft className="h-3.5 w-3.5 text-faint-foreground" />
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-faint-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          {nodeCount === 0 && <span className="ml-auto">Open the graph to search its nodes here</span>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
