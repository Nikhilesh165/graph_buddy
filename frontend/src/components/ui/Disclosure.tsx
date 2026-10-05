import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../lib/cn'

type Props = {
  title: ReactNode
  /** Extra content on the right of the header row (counts, actions). */
  meta?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  headerClassName?: string
  contentClassName?: string
}

/** Collapsible section with a rotating chevron -- the building block of
 * Obsidian's graph-settings panel and right-sidebar panes. Height animates
 * via the grid-template-rows 0fr -> 1fr trick, so no measuring is needed. */
export function Disclosure({
  title,
  meta,
  children,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  className,
  headerClassName,
  contentClassName,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen
  const contentId = useId()

  function toggle() {
    const next = !open
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <section className={className}>
      <div className={cn('flex items-center gap-2', headerClassName)}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          className="group/disclosure -ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 py-1 text-left text-[13px] font-semibold text-foreground hover:bg-hover"
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-faint-foreground transition-transform duration-200 ease-out-expo group-hover/disclosure:text-muted-foreground',
              open && 'rotate-90',
            )}
          />
          <span className="truncate">{title}</span>
        </button>
        {meta}
      </div>
      <div
        id={contentId}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-250 ease-out-expo',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={contentClassName}>{children}</div>
        </div>
      </div>
    </section>
  )
}
