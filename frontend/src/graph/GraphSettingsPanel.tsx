import type { CSSProperties } from 'react'
import { Play, RotateCcw, SlidersHorizontal, Square, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Disclosure } from '../components/ui/Disclosure'
import { Slider } from '../components/ui/Slider'
import { Switch } from '../components/ui/Switch'
import { cn } from '../lib/cn'
import { CONFIDENCE_STEP } from '../lib/confidence'
import { humanizeRelation } from '../lib/format'
import { usePersistentState } from '../lib/storage'
import { usePresence } from '../lib/usePresence'
import {
  DEFAULT_GRAPH_SETTINGS,
  FORCE_KEYS,
  LIMIT_OPTIONS,
  SETTING_RANGES,
  type GraphFilterState,
  type GraphSettings,
} from './settings'

type Chip = { name: string; count: number; color?: string }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: GraphSettings
  onSettingsChange: (settings: GraphSettings) => void
  filters: GraphFilterState
  onFiltersChange: (patch: Partial<GraphFilterState>) => void
  onResetFilters: () => void
  entityTypes: Chip[]
  relationTypes: Chip[]
  replaying: boolean
  onReplayToggle: () => void
  /** Number of active filters, badged on the closed panel's button. */
  activeFilterCount: number
  className?: string
  style?: CSSProperties
}

/** Obsidian's graph-view settings panel: a floating card of collapsible
 * Filters / Display / Forces sections, every change applied live. */
export function GraphSettingsPanel({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  filters,
  onFiltersChange,
  onResetFilters,
  entityTypes,
  relationTypes,
  replaying,
  onReplayToggle,
  activeFilterCount,
  className,
  style,
}: Props) {
  const { mounted, closing } = usePresence(open, 140)
  const [sections, setSections] = usePersistentState('graph.panelSections', {
    filters: true,
    display: true,
    forces: false,
  })

  function set<K extends keyof GraphSettings>(key: K, value: GraphSettings[K]) {
    onSettingsChange({ ...settings, [key]: value })
  }

  const filtersActive =
    filters.minConfidence > 0 || filters.entityTypes.length > 0 || filters.relationTypes.length > 0
  const forcesChanged = FORCE_KEYS.some((key) => settings[key] !== DEFAULT_GRAPH_SETTINGS[key])
  const displayChanged = (Object.keys(DEFAULT_GRAPH_SETTINGS) as (keyof GraphSettings)[]).some(
    (key) => !FORCE_KEYS.includes(key as (typeof FORCE_KEYS)[number]) && settings[key] !== DEFAULT_GRAPH_SETTINGS[key],
  )

  return (
    <div className={cn('pointer-events-none flex flex-col items-end', className)} style={style}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={open ? 'Close graph settings' : 'Open graph settings'}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        title="Graph settings"
        className={cn(
          'pointer-events-auto relative h-9 w-9 border border-border bg-popover/90 shadow-float backdrop-blur-md transition-opacity',
          mounted && 'pointer-events-none opacity-0',
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
        {activeFilterCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">
            {activeFilterCount}
          </span>
        )}
      </Button>

      {mounted && (
        <div
          role="region"
          aria-label="Graph settings"
          className={cn(
            'pointer-events-auto absolute right-0 top-0 flex max-h-full w-[288px] origin-top-right flex-col overflow-hidden rounded-lg border border-border bg-popover/95 shadow-popover backdrop-blur-md',
            closing ? 'animate-pop-out' : 'animate-pop-in',
          )}
        >
          <div className="flex items-center justify-between border-b border-border py-1.5 pl-3 pr-1.5">
            <span className="text-[13px] font-semibold text-foreground">Graph settings</span>
            <Button variant="ghost" size="icon-sm" aria-label="Close graph settings" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
            <Disclosure
              title="Filters"
              open={sections.filters}
              onOpenChange={(v) => setSections((s) => ({ ...s, filters: v }))}
              meta={
                filtersActive && (
                  <button
                    type="button"
                    onClick={onResetFilters}
                    className="rounded-sm px-1 text-[11px] font-medium text-accent-foreground hover:underline"
                  >
                    Reset
                  </button>
                )
              }
              contentClassName="flex flex-col gap-2 pb-3 pl-5 pt-1"
            >
              <Slider
                label="Minimum confidence"
                value={filters.minConfidence}
                min={0}
                max={1}
                step={CONFIDENCE_STEP}
                format={(v) => (v === 0 ? 'any' : `≥ ${v.toFixed(2)}`)}
                onChange={(v) => onFiltersChange({ minConfidence: v })}
              />

              <div className="py-1">
                <div className="mb-1.5 text-[13px] text-muted-foreground">Facts loaded</div>
                <div role="radiogroup" aria-label="Facts loaded" className="grid grid-cols-4 rounded-md bg-secondary p-0.5">
                  {LIMIT_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={filters.limit === option}
                      onClick={() => onFiltersChange({ limit: option })}
                      className={cn(
                        'h-6 rounded-[5px] text-xs font-medium tabular-nums transition-colors',
                        filters.limit === option
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <ChipGroup
                label="Entity types"
                chips={entityTypes}
                selected={filters.entityTypes}
                onChange={(entityTypes) => onFiltersChange({ entityTypes })}
              />
              <ChipGroup
                label="Relations"
                chips={relationTypes}
                selected={filters.relationTypes}
                onChange={(relationTypes) => onFiltersChange({ relationTypes })}
                format={humanizeRelation}
              />
            </Disclosure>

            <Disclosure
              title="Display"
              open={sections.display}
              onOpenChange={(v) => setSections((s) => ({ ...s, display: v }))}
              className="border-t border-border pt-1"
              meta={
                displayChanged && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...DEFAULT_GRAPH_SETTINGS }
                      for (const key of FORCE_KEYS) next[key] = settings[key]
                      onSettingsChange(next)
                    }}
                    className="rounded-sm px-1 text-[11px] font-medium text-accent-foreground hover:underline"
                  >
                    Reset
                  </button>
                )
              }
              contentClassName="flex flex-col pb-3 pl-5 pt-0.5"
            >
              <Switch label="Color by entity type" checked={settings.colorByType} onCheckedChange={(v) => set('colorByType', v)} />
              <Switch label="Arrows" checked={settings.showArrows} onCheckedChange={(v) => set('showArrows', v)} />
              <Switch
                label="Confidence as opacity"
                checked={settings.confidenceOpacity}
                onCheckedChange={(v) => set('confidenceOpacity', v)}
              />
              {settings.confidenceOpacity && (
                <div className="mb-1 flex flex-col gap-1 rounded-md bg-background-alt px-2 py-1.5 text-[11px] text-faint-foreground">
                  <span className="flex items-center gap-2">
                    <svg width="26" height="6" aria-hidden="true" className="shrink-0 text-muted-foreground">
                      <defs>
                        <linearGradient id="confidence-key" x1="0" x2="1">
                          <stop offset="0" stopColor="currentColor" stopOpacity="0.15" />
                          <stop offset="1" stopColor="currentColor" stopOpacity="0.95" />
                        </linearGradient>
                      </defs>
                      <rect x="0" y="2" width="26" height="2" rx="1" fill="url(#confidence-key)" />
                    </svg>
                    fainter link = lower confidence
                  </span>
                  <span className="flex items-center gap-2">
                    <svg width="26" height="6" aria-hidden="true" className="shrink-0 text-muted-foreground">
                      <line x1="0" y1="3" x2="26" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
                    </svg>
                    dashed = unscored
                  </span>
                </div>
              )}
              <Switch label="Relation labels" checked={settings.edgeLabels} onCheckedChange={(v) => set('edgeLabels', v)} />
              <div className="mt-1.5 flex flex-col gap-1">
                <Slider
                  label="Text fade threshold"
                  value={settings.labelThreshold}
                  {...SETTING_RANGES.labelThreshold}
                  onChange={(v) => set('labelThreshold', v)}
                />
                <Slider label="Node size" value={settings.nodeSize} {...SETTING_RANGES.nodeSize} onChange={(v) => set('nodeSize', v)} />
                <Slider
                  label="Link thickness"
                  value={settings.linkThickness}
                  {...SETTING_RANGES.linkThickness}
                  onChange={(v) => set('linkThickness', v)}
                />
              </div>
            </Disclosure>

            <Disclosure
              title="Forces"
              open={sections.forces}
              onOpenChange={(v) => setSections((s) => ({ ...s, forces: v }))}
              className="border-t border-border pt-1"
              meta={
                forcesChanged && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...settings }
                      for (const key of FORCE_KEYS) next[key] = DEFAULT_GRAPH_SETTINGS[key]
                      onSettingsChange(next)
                    }}
                    className="rounded-sm px-1 text-[11px] font-medium text-accent-foreground hover:underline"
                  >
                    Reset
                  </button>
                )
              }
              contentClassName="flex flex-col gap-1 pb-3 pl-5 pt-0.5"
            >
              <Slider label="Center force" value={settings.centerForce} {...SETTING_RANGES.centerForce} onChange={(v) => set('centerForce', v)} />
              <Slider label="Repel force" value={settings.repelForce} {...SETTING_RANGES.repelForce} onChange={(v) => set('repelForce', v)} />
              <Slider label="Link force" value={settings.linkForce} {...SETTING_RANGES.linkForce} onChange={(v) => set('linkForce', v)} />
              <Slider
                label="Link distance"
                value={settings.linkDistance}
                {...SETTING_RANGES.linkDistance}
                onChange={(v) => set('linkDistance', v)}
              />
            </Disclosure>
          </div>

          <div className="flex items-center gap-1.5 border-t border-border p-2">
            <Button variant={replaying ? 'secondary' : 'default'} size="sm" className="flex-1" onClick={onReplayToggle}>
              {replaying ? <Square className="h-3 w-3" /> : <Play className="h-3.5 w-3.5" />}
              {replaying ? 'Stop replay' : 'Replay growth'}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Restore all graph settings to defaults"
              title="Restore defaults"
              disabled={!forcesChanged && !displayChanged}
              onClick={() => onSettingsChange(DEFAULT_GRAPH_SETTINGS)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ChipGroup({
  label,
  chips,
  selected,
  onChange,
  format = (s) => s,
}: {
  label: string
  chips: Chip[]
  selected: string[]
  onChange: (next: string[]) => void
  format?: (name: string) => string
}) {
  if (chips.length === 0) return null
  const all = selected.length === 0
  return (
    <div className="py-1">
      <div className="mb-1.5 text-[13px] text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          aria-pressed={all}
          onClick={() => onChange([])}
          className={cn(
            'h-6 rounded-full border px-2 text-xs font-medium transition-colors',
            all
              ? 'border-transparent bg-accent text-accent-foreground'
              : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
          )}
        >
          All
        </button>
        {chips.map((chip) => {
          const active = selected.includes(chip.name)
          return (
            <button
              key={chip.name}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? selected.filter((s) => s !== chip.name) : [...selected, chip.name])}
              className={cn(
                'inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors',
                active
                  ? 'border-transparent bg-accent text-accent-foreground'
                  : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
              )}
            >
              {chip.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: chip.color }} />}
              <span className="truncate">{format(chip.name)}</span>
              {chip.count > 0 && <span className="tabular-nums text-faint-foreground">{chip.count}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
