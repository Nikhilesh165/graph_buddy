import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { useAppData, type BadgeState } from '../../lib/appDataContext'
import { useCommandPalette } from '../../lib/commandContext'
import { MOD_KEY } from '../../lib/platform'
import { useStatusBarSlot } from './statusBarContext'

const DOT: Record<BadgeState, string> = {
  ok: 'bg-success',
  error: 'bg-destructive',
  unreachable: 'bg-destructive',
  checking: 'bg-warning animate-pulse',
}

const STATE_LABEL: Record<BadgeState, string> = {
  ok: 'connected',
  error: 'error',
  unreachable: 'unreachable',
  checking: 'checking…',
}

function Health({ label, state, detail }: { label: string; state: BadgeState; detail?: string }) {
  return (
    <span
      className="flex items-center gap-1.5"
      title={`${label}: ${STATE_LABEL[state]}${detail ? ` — ${detail}` : ''}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT[state])} aria-hidden="true" />
      <span>{label}</span>
      <span className="sr-only">{STATE_LABEL[state]}</span>
    </span>
  )
}

/** Bottom status bar: service health and ontology version on the left, a
 * page-owned slot (hints, counts) and the palette shortcut on the right. */
export function StatusBar({ slotRef }: { slotRef: (el: HTMLElement | null) => void }) {
  const { backendState, graphState, graphDetail, ontology, hasOntology } = useAppData()
  const { setOpen } = useCommandPalette()

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-sidebar px-3 text-[11px] text-muted-foreground">
      <Health label="Backend" state={backendState} />
      <Health label="Graph DB" state={graphState} detail={graphDetail} />
      <span className="hidden sm:inline">{hasOntology ? `Ontology v${ontology?.version_number}` : 'No ontology yet'}</span>
      <div ref={slotRef} className="ml-auto hidden min-w-0 items-center gap-4 truncate md:flex" />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-1 rounded-sm px-1 hover:bg-hover hover:text-foreground sm:flex"
      >
        {MOD_KEY} K <span className="text-faint-foreground">commands</span>
      </button>
    </footer>
  )
}

/** Render page-specific content into the status bar while mounted. */
export function StatusBarItem({ children }: { children: ReactNode }) {
  const slot = useStatusBarSlot()
  return slot ? createPortal(<span className="flex items-center gap-1.5 truncate">{children}</span>, slot) : null
}
