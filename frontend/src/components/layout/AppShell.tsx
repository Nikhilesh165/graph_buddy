import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  MessageSquare,
  Menu,
  Share2,
  UploadCloud,
  Workflow,
  X,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { useAppData, type BadgeState } from '../../lib/appDataContext'

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/sources', label: 'Sources', icon: UploadCloud },
  { to: '/ontology', label: 'Ontology Studio', icon: Workflow },
  { to: '/graph', label: 'Graph Explorer', icon: Share2 },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
]

const STATE_DOT: Record<BadgeState, string> = {
  ok: 'bg-success',
  error: 'bg-destructive',
  unreachable: 'bg-destructive',
  checking: 'bg-warning animate-pulse',
}

function HealthDot({ label, state, detail }: { label: string; state: BadgeState; detail?: string }) {
  const title = `${label}: ${state}${detail ? ` — ${detail}` : ''}`
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={title}>
      <span className={cn('h-1.5 w-1.5 rounded-full', STATE_DOT[state])} aria-hidden="true" />
      {label}
    </span>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { backendState, graphState, graphDetail } = useAppData()

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          GB
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-foreground">Graph Buddy</span>
          <span className="text-[11px] text-muted-foreground">Living knowledge graph</span>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="flex flex-col gap-1.5 border-t border-border px-5 py-4">
        <HealthDot label="Backend" state={backendState} />
        <HealthDot label="Graph DB" state={graphState} detail={graphDetail} />
      </div>
    </div>
  )
}

/** App-wide shell: a fixed sidebar for navigation between pages (Overview,
 * Sources, Ontology Studio, Graph Explorer, Chat) plus the content outlet.
 * Replaces the old App.tsx's single scrolling column of stacked panels --
 * per docs/UI_REHAUL_PLAN.md, each of those panels is now its own route. */
export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card md:block">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar (overlay) */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setMobileNavOpen(false)} />
          <div className="relative flex w-64 flex-col border-r border-border bg-card animate-slide-in-right shadow-xl">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">Graph Buddy</span>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
