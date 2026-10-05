import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Plus, Spline, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useAppData } from '../../lib/appDataContext'
import { humanizeRelation } from '../../lib/format'
import { typeColor } from '../../lib/palette'
import { usePersistentState } from '../../lib/storage'
import { useThemeMode } from '../../lib/themeContext'
import type { SourceRead } from '../../types'
import { FileIcon } from '../ui/FileIcon'
import { NAV_ITEMS } from './nav'

function sourceDot(source: SourceRead): { className: string; label: string } {
  if (source.status === 'failed') return { className: 'bg-destructive', label: 'Parse failed' }
  if (source.graphiti_status === 'extracted') return { className: 'bg-success', label: 'Extracted into the graph' }
  if (source.graphiti_status === 'extracting') return { className: 'bg-warning animate-pulse', label: 'Extracting…' }
  if (source.graphiti_status === 'failed') return { className: 'bg-destructive', label: 'Extraction failed' }
  return { className: 'bg-border-strong', label: 'Not extracted yet' }
}

type SectionKey = 'sources' | 'entities' | 'relations'

/** Obsidian's file explorer, for this app's "vault": uploaded sources as
 * files, and the ontology's entity/relation types as shortcuts into the
 * graph filtered to that type. */
export function Sidebar({
  onNavigate,
  onClose,
  showNav = false,
}: {
  onNavigate?: () => void
  /** Renders a close button in the header (the mobile drawer). */
  onClose?: () => void
  showNav?: boolean
}) {
  const { sources, ontology } = useAppData()
  const mode = useThemeMode()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const [open, setOpen] = usePersistentState<Record<SectionKey, boolean>>('sidebar.sections', {
    sources: true,
    entities: true,
    relations: false,
  })
  const toggle = (key: SectionKey) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  const entityOrder = ontology?.entity_types.map((et) => et.name) ?? []
  const onGraph = location.pathname === '/graph'

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pl-3.5 pr-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-primary text-[10px] font-bold text-primary-foreground">
          G
        </div>
        <span className="truncate text-[13px] font-semibold text-foreground">Graph Buddy</span>
        <Link
          to="/sources?upload=1"
          onClick={onNavigate}
          aria-label="Upload a source"
          title="Upload a source"
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-2">
        {showNav && (
          <nav aria-label="Views" className="mb-3 flex flex-col gap-px border-b border-border pb-3">
            {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => {
              const active = end ? location.pathname === to : location.pathname.startsWith(to)
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px]',
                    active ? 'bg-active font-medium text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                  {label}
                </Link>
              )
            })}
          </nav>
        )}

        <TreeSection title="Sources" count={sources?.length} open={open.sources} onToggle={() => toggle('sources')}>
          {sources === null ? (
            <TreeNote>Loading…</TreeNote>
          ) : sources.length === 0 ? (
            <TreeNote>
              No sources yet.{' '}
              <Link to="/sources?upload=1" onClick={onNavigate} className="text-accent-foreground hover:underline">
                Upload one
              </Link>
            </TreeNote>
          ) : (
            sources.map((source) => {
              const dot = sourceDot(source)
              const active = location.pathname === '/sources' && params.get('focus') === source.id
              return (
                <TreeLink key={source.id} to={`/sources?focus=${source.id}`} active={active} onClick={onNavigate} title={source.filename}>
                  <FileIcon filename={source.filename} className="h-3.5 w-3.5 shrink-0 text-faint-foreground" />
                  <span className="min-w-0 flex-1 truncate">{source.filename}</span>
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot.className)} title={dot.label} aria-label={dot.label} />
                </TreeLink>
              )
            })
          )}
        </TreeSection>

        <TreeSection
          title="Entity types"
          count={ontology?.entity_types.length}
          open={open.entities}
          onToggle={() => toggle('entities')}
        >
          {!ontology || ontology.entity_types.length === 0 ? (
            <TreeNote>Bootstrap an ontology to see types here.</TreeNote>
          ) : (
            ontology.entity_types.map((et) => {
              const active = onGraph && params.get('types') === et.name
              return (
                <TreeLink
                  key={et.name}
                  to={`/graph?types=${encodeURIComponent(et.name)}`}
                  active={active}
                  onClick={onNavigate}
                  title={et.description || et.name}
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    <span className="h-2 w-2 rounded-full" style={{ background: typeColor(mode, entityOrder, et.name) }} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{et.name}</span>
                </TreeLink>
              )
            })
          )}
        </TreeSection>

        <TreeSection
          title="Relations"
          count={ontology?.relation_types.length}
          open={open.relations}
          onToggle={() => toggle('relations')}
        >
          {!ontology || ontology.relation_types.length === 0 ? (
            <TreeNote>No relation types yet.</TreeNote>
          ) : (
            ontology.relation_types.map((rt) => {
              const active = onGraph && params.get('rels') === rt.name
              return (
                <TreeLink
                  key={rt.name}
                  to={`/graph?rels=${encodeURIComponent(rt.name)}`}
                  active={active}
                  onClick={onNavigate}
                  title={rt.description || rt.name}
                >
                  <Spline className="h-3.5 w-3.5 shrink-0 text-faint-foreground" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate">{humanizeRelation(rt.name)}</span>
                </TreeLink>
              )
            })
          )}
        </TreeSection>
      </div>
    </div>
  )
}

function TreeSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="group/section mb-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-1 rounded-md px-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-faint-foreground hover:bg-hover hover:text-muted-foreground"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-200 ease-out-expo', open && 'rotate-90')} />
        <span className="flex-1">{title}</span>
        {count !== undefined && (
          <span className="tabular-nums opacity-0 transition-opacity group-hover/section:opacity-100">{count}</span>
        )}
      </button>
      <div
        className={cn('grid transition-[grid-template-rows] duration-250 ease-out-expo', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="ml-[13px] flex flex-col gap-px border-l border-border py-0.5 pl-1.5">{children}</div>
        </div>
      </div>
    </section>
  )
}

function TreeLink({
  to,
  active,
  onClick,
  title,
  children,
}: {
  to: string
  active: boolean
  onClick?: () => void
  title?: string
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      title={title}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors',
        active ? 'bg-active text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
      )}
    >
      {children}
    </Link>
  )
}

function TreeNote({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-xs leading-relaxed text-faint-foreground">{children}</p>
}
