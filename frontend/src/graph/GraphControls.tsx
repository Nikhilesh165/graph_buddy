import type { CSSProperties } from 'react'
import { Maximize, Minimize, Minus, Network, Plus, ScanSearch } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Kbd } from '../components/ui/Kbd'
import { Tooltip } from '../components/ui/Tooltip'
import { cn } from '../lib/cn'

type Props = {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  localGraph: boolean
  canLocalGraph: boolean
  onToggleLocalGraph: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  className?: string
  style?: CSSProperties
}

function Hint({ label, keys }: { label: string; keys?: string }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      {keys && <Kbd>{keys}</Kbd>}
    </span>
  )
}

/** Bottom-right camera toolbar. Every action also has a keyboard shortcut
 * (shown in its tooltip). */
export function GraphControls({
  onZoomIn,
  onZoomOut,
  onFit,
  localGraph,
  canLocalGraph,
  onToggleLocalGraph,
  fullscreen,
  onToggleFullscreen,
  className,
  style,
}: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Graph view controls"
      className={cn(
        'flex items-center gap-0.5 rounded-lg border border-border bg-popover/90 p-0.5 shadow-float backdrop-blur-md',
        className,
      )}
      style={style}
    >
      <Tooltip label={<Hint label="Zoom out" keys="−" />}>
        <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={onZoomOut}>
          <Minus className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Tooltip label={<Hint label="Zoom in" keys="+" />}>
        <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={onZoomIn}>
          <Plus className="h-4 w-4" />
        </Button>
      </Tooltip>
      <div className="mx-0.5 h-4 w-px bg-border" />
      <Tooltip label={<Hint label="Fit to view" keys="F" />}>
        <Button variant="ghost" size="icon-sm" aria-label="Fit graph to view" onClick={onFit}>
          <ScanSearch className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Tooltip label={canLocalGraph ? <Hint label="Local graph" keys="L" /> : 'Select a node to see its local graph'}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={localGraph ? 'Show full graph' : 'Show local graph of the selected node'}
          aria-pressed={localGraph}
          disabled={!canLocalGraph}
          onClick={onToggleLocalGraph}
          className={cn(localGraph && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground')}
        >
          <Network className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Tooltip label={<Hint label={fullscreen ? 'Exit full screen' : 'Full screen'} />}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
      </Tooltip>
    </div>
  )
}
