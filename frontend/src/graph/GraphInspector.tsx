import { useMemo, type CSSProperties, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CalendarOff,
  CalendarPlus,
  Crosshair,
  FileText,
  Hash,
  Link2,
  Network,
  Tag,
  X,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ConfidenceMeter } from '../components/ui/ConfidenceMeter'
import { Disclosure } from '../components/ui/Disclosure'
import { Skeleton } from '../components/ui/Skeleton'
import { cn } from '../lib/cn'
import { formatConfidence } from '../lib/confidence'
import { formatDate, humanizeRelation, pluralize } from '../lib/format'
import type { GraphEdge, GraphNode, NodeDetail, NodeNeighbor } from '../types'

export type InspectorSelection = { kind: 'node'; id: string } | { kind: 'edge'; id: string }

type Props = {
  selection: InspectorSelection
  /** Node detail for a node selection (null while loading). */
  detail: NodeDetail | null
  detailLoading: boolean
  detailError: string | null
  onRetry: () => void
  /** For an edge selection: the edge plus whatever we know of its ends. */
  edge: GraphEdge | null
  edgeSource: GraphNode | null
  edgeTarget: GraphNode | null
  colorForType: (type: string) => string
  /** Whether a node id is drawn in the current graph (can be centered). */
  isInGraph: (nodeId: string) => boolean
  onSelectNode: (id: string) => void
  onSelectEdge: (id: string) => void
  onHoverEdge: (id: string | null) => void
  onCenter: () => void
  localGraph: boolean
  onToggleLocalGraph: () => void
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onClose: () => void
  className?: string
  style?: CSSProperties
}

/** The graph's right-hand pane, modeled on Obsidian's right sidebar: the
 * selected note's properties, its outgoing links and backlinks, and where
 * it came from -- with back/forward history across what you've opened. */
export function GraphInspector(props: Props) {
  const { selection, canGoBack, canGoForward, onBack, onForward, onClose, onCenter, localGraph, onToggleLocalGraph } = props
  const isNode = selection.kind === 'node'

  return (
    <aside
      aria-label={isNode ? 'Node details' : 'Fact details'}
      className={cn('flex flex-col overflow-hidden border-border bg-popover/95 shadow-popover backdrop-blur-md', props.className)}
      style={props.style}
    >
      <header className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border px-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="Back" title="Back  [" disabled={!canGoBack} onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Forward" title="Forward  ]" disabled={!canGoForward} onClick={onForward}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <span className="ml-1.5 flex-1 truncate text-xs font-medium uppercase tracking-wide text-faint-foreground">
          {isNode ? 'Node' : 'Fact'}
        </span>
        {isNode && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={localGraph ? 'Show full graph' : 'Show local graph'}
            aria-pressed={localGraph}
            title="Local graph  L"
            onClick={onToggleLocalGraph}
            className={cn(localGraph && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground')}
          >
            <Network className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Center in view" title="Center in view" onClick={onCenter}>
          <Crosshair className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close details" title="Close  Esc" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {isNode ? <NodeBody {...props} /> : <EdgeBody {...props} />}
      </div>
    </aside>
  )
}

function NodeBody({
  detail,
  detailLoading,
  detailError,
  onRetry,
  colorForType,
  isInGraph,
  onSelectNode,
  onSelectEdge,
  onHoverEdge,
}: Props) {
  const grouped = useMemo(() => {
    const outgoing: NodeNeighbor[] = []
    const incoming: NodeNeighbor[] = []
    for (const n of detail?.neighbors ?? []) (n.direction === 'outgoing' ? outgoing : incoming).push(n)
    const sort = (list: NodeNeighbor[]) =>
      list.sort((a, b) => a.edge.name.localeCompare(b.edge.name) || a.node.name.localeCompare(b.node.name))
    return { outgoing: sort(outgoing), incoming: sort(incoming) }
  }, [detail])

  if (detailError) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <p className="text-[13px] text-muted-foreground">{detailError}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }

  if (!detail || detailLoading) {
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading node">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="mt-1 h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="mt-4 h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  const { node, provenance } = detail
  const attributes = Object.entries(node.attributes).filter(([, v]) => v !== null && v !== undefined && v !== '')
  const linkCount = detail.neighbors.length

  return (
    <div className="animate-fade-in pb-4">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorForType(node.type) }} />
          {node.type}
        </div>
        <h2 className="mt-1 text-lg font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere]">
          {node.name}
        </h2>
        {node.summary && <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{node.summary}</p>}
      </div>

      <dl className="mx-4 mb-2 overflow-hidden rounded-md border border-border text-[13px]">
        <PropertyRow icon={<Tag />} label="type" value={node.type} />
        <PropertyRow icon={<Link2 />} label="links" value={pluralize(linkCount, 'link')} />
        {attributes.map(([key, value]) => (
          <PropertyRow key={key} icon={<Hash />} label={key} value={formatAttribute(value)} />
        ))}
      </dl>

      <LinkSection
        title="Outgoing links"
        items={grouped.outgoing}
        colorForType={colorForType}
        isInGraph={isInGraph}
        onSelectNode={onSelectNode}
        onSelectEdge={onSelectEdge}
        onHoverEdge={onHoverEdge}
      />
      <LinkSection
        title="Backlinks"
        items={grouped.incoming}
        colorForType={colorForType}
        isInGraph={isInGraph}
        onSelectNode={onSelectNode}
        onSelectEdge={onSelectEdge}
        onHoverEdge={onHoverEdge}
      />

      <Disclosure
        title="Sources"
        meta={<Count n={provenance.length} />}
        className="border-t border-border px-3 pt-1"
        contentClassName="flex flex-col gap-2 pb-2 pl-1 pt-1"
      >
        {provenance.length === 0 ? (
          <p className="px-1 text-[13px] text-faint-foreground">No source excerpts recorded.</p>
        ) : (
          provenance.map((p) => (
            <figure key={p.episode_uuid} className="rounded-md border border-border bg-background-alt px-3 py-2.5">
              <figcaption className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <FileText className="h-3.5 w-3.5 shrink-0 text-faint-foreground" />
                <span className="truncate">{p.source_filename ?? p.source_description}</span>
              </figcaption>
              {p.chunk_preview && (
                <blockquote className="mt-1.5 border-l-2 border-accent-foreground/40 pl-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  {p.chunk_preview}
                </blockquote>
              )}
            </figure>
          ))
        )}
      </Disclosure>
    </div>
  )
}

function LinkSection({
  title,
  items,
  colorForType,
  isInGraph,
  onSelectNode,
  onSelectEdge,
  onHoverEdge,
}: {
  title: string
  items: NodeNeighbor[]
  colorForType: (type: string) => string
  isInGraph: (id: string) => boolean
  onSelectNode: (id: string) => void
  onSelectEdge: (id: string) => void
  onHoverEdge: (id: string | null) => void
}) {
  return (
    <Disclosure
      title={title}
      meta={<Count n={items.length} />}
      className="border-t border-border px-3 pt-1"
      contentClassName="flex flex-col pb-2 pt-0.5"
    >
      {items.length === 0 ? (
        <p className="px-1 pb-1 text-[13px] text-faint-foreground">None.</p>
      ) : (
        <ul className="flex flex-col" onMouseLeave={() => onHoverEdge(null)}>
          {items.map(({ edge, node }) => (
            <li
              key={edge.uuid}
              onMouseEnter={() => onHoverEdge(edge.uuid)}
              className="group/link rounded-md px-1.5 py-1.5 hover:bg-hover"
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorForType(node.type) }} />
                <button
                  type="button"
                  onClick={() => onSelectNode(node.uuid)}
                  onFocus={() => onHoverEdge(edge.uuid)}
                  onBlur={() => onHoverEdge(null)}
                  className="min-w-0 truncate text-left text-[13px] font-medium text-accent-foreground decoration-accent-foreground/40 underline-offset-2 hover:underline"
                >
                  {node.name}
                </button>
                {!isInGraph(node.uuid) && (
                  <span title="Not in the current view (filtered out)" className="shrink-0 text-[10px] text-faint-foreground">
                    hidden
                  </span>
                )}
                <span className="ml-auto shrink-0">
                  <ConfidenceMeter value={edge.confidence} compact />
                </span>
              </div>
              <button
                type="button"
                onClick={() => onSelectEdge(edge.uuid)}
                className="mt-0.5 line-clamp-2 w-full pl-4 text-left text-[12.5px] leading-snug text-muted-foreground hover:text-foreground"
              >
                <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint-foreground">
                  {humanizeRelation(edge.name)}
                </span>
                {edge.fact}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Disclosure>
  )
}

function EdgeBody({ edge, edgeSource, edgeTarget, colorForType, onSelectNode }: Props) {
  if (!edge) {
    return <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">This fact is no longer in view.</p>
  }

  const endpoint = (node: GraphNode | null, fallbackId: string) => (
    <button
      type="button"
      onClick={() => onSelectNode(node?.uuid ?? fallbackId)}
      className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background-alt px-2.5 py-2 text-left transition-colors hover:bg-hover"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: node ? colorForType(node.type) : 'var(--faint-foreground)' }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{node?.name ?? 'Unknown node'}</span>
        {node && <span className="block text-[11px] text-faint-foreground">{node.type}</span>}
      </span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-faint-foreground" />
    </button>
  )

  return (
    <div className="animate-fade-in px-4 pb-5 pt-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-accent-foreground">{humanizeRelation(edge.name)}</div>
      <blockquote className="mt-2 text-[15px] font-medium leading-relaxed text-foreground">{edge.fact}</blockquote>

      <div className="mt-4 flex flex-col items-stretch gap-1.5">
        {endpoint(edgeSource, edge.source)}
        <div className="flex items-center gap-2 pl-3 text-[11px] text-faint-foreground">
          <span className="h-3 w-px bg-border-strong" />
          {humanizeRelation(edge.name)}
        </div>
        {endpoint(edgeTarget, edge.target)}
      </div>

      <dl className="mt-4 overflow-hidden rounded-md border border-border text-[13px]">
        <PropertyRow
          icon={<Hash />}
          label="confidence"
          value={
            <span className="flex items-center gap-2">
              <ConfidenceMeter value={edge.confidence} compact />
              {formatConfidence(edge.confidence)}
            </span>
          }
        />
        <PropertyRow icon={<CalendarClock />} label="valid from" value={formatDate(edge.valid_at)} />
        <PropertyRow icon={<CalendarOff />} label="invalid at" value={edge.invalid_at ? formatDate(edge.invalid_at) : 'still valid'} />
        <PropertyRow icon={<CalendarPlus />} label="recorded" value={formatDate(edge.created_at, true)} />
      </dl>
    </div>
  )
}

/** One row of an Obsidian-style "Properties" block. */
function PropertyRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2 border-b border-border px-2.5 py-1 last:border-b-0">
      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-faint-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="min-w-0 flex-1 truncate text-foreground">{value}</dd>
    </div>
  )
}

function Count({ n }: { n: number }) {
  return <span className="pr-1 text-xs tabular-nums text-faint-foreground">{n}</span>
}

function formatAttribute(value: unknown): string {
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
