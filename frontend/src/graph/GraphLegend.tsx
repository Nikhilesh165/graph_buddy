import { ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'
import { usePersistentState } from '../lib/storage'

type Entry = { name: string; color: string; count: number }

type Props = {
  entries: Entry[]
  /** Entity-type filter (empty = all shown). */
  selected: string[]
  onToggle: (type: string) => void
  onHover: (type: string | null) => void
  className?: string
}

const MAX_VISIBLE = 8

/** Bottom-left color key. Hovering a type spotlights its nodes on the
 * canvas; clicking toggles it in the entity-type filter (same state as the
 * settings panel's chips). */
export function GraphLegend({ entries, selected, onToggle, onHover, className }: Props) {
  const [open, setOpen] = usePersistentState('graph.legendOpen', true)
  const [expanded, setExpanded] = usePersistentState('graph.legendExpanded', false)
  if (entries.length === 0) return null
  const visible = expanded ? entries : entries.slice(0, MAX_VISIBLE)
  const hidden = entries.length - visible.length

  return (
    <div
      className={cn(
        'w-48 overflow-hidden rounded-lg border border-border bg-popover/90 text-[12px] shadow-float backdrop-blur-md',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint-foreground hover:text-muted-foreground"
      >
        Legend
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', !open && '-rotate-90')} />
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-250 ease-out-expo',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="flex flex-col px-1 pb-1" onMouseLeave={() => onHover(null)}>
            {visible.map((entry) => {
              const dimmed = selected.length > 0 && !selected.includes(entry.name)
              return (
                <li key={entry.name}>
                  <button
                    type="button"
                    aria-pressed={selected.includes(entry.name)}
                    title={`Hover to spotlight, click to ${selected.includes(entry.name) ? 'remove from' : 'add to'} the filter`}
                    onMouseEnter={() => onHover(entry.name)}
                    onFocus={() => onHover(entry.name)}
                    onBlur={() => onHover(null)}
                    onClick={() => onToggle(entry.name)}
                    className={cn(
                      'flex h-6 w-full items-center gap-2 rounded-sm px-1.5 text-left transition-[background-color,opacity] hover:bg-hover',
                      dimmed && 'opacity-45',
                    )}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.color }} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{entry.name}</span>
                    <span className="tabular-nums text-faint-foreground">{entry.count}</span>
                  </button>
                </li>
              )
            })}
            {(hidden > 0 || expanded) && entries.length > MAX_VISIBLE && (
              <li>
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="w-full rounded-sm px-1.5 py-1 text-left text-faint-foreground hover:bg-hover hover:text-muted-foreground"
                >
                  {expanded ? 'Show fewer' : `+${hidden} more`}
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}
