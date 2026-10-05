import { useMemo, useState } from 'react'
import { ChevronRight, GitCompareArrows, Loader2, Plus, Trash2, X } from 'lucide-react'
import { updateOntology } from '../api/client'
import { GraphView } from '../graph/GraphView'
import { DEFAULT_GRAPH_SETTINGS } from '../graph/settings'
import { cn } from '../lib/cn'
import { humanizeRelation, pluralize } from '../lib/format'
import { typeColor } from '../lib/palette'
import { useThemeMode } from '../lib/themeContext'
import type { EntityType, GraphEdge, GraphNode, OntologyVersion, PropertyDef, RelationType } from '../types'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Input, Textarea } from './ui/Input'

// Parent must pass `key={ontology.id}` -- that remounts this component (and
// so re-derives entityTypes/relationTypes below) whenever the ontology
// version changes, instead of syncing local state from a prop in an effect.
type Props = {
  ontology: OntologyVersion
  onSaved: (version: OntologyVersion) => void
}

type Tab = 'types' | 'schema'

const SCHEMA_SETTINGS = {
  ...DEFAULT_GRAPH_SETTINGS,
  confidenceOpacity: false,
  edgeLabelsAlways: true,
  labelThreshold: 0,
  nodeSize: 1.6,
  linkDistance: 120,
  repelForce: 14,
}

function emptyEntityType(): EntityType {
  return { name: '', description: '', properties: [], examples: [] }
}

function emptyRelationType(): RelationType {
  return { name: '', description: '', source_types: [], target_types: [], properties: [] }
}

function emptyProperty(): PropertyDef {
  return { name: '', description: '', type: 'string' }
}

function DiffLine({ label, names, tone }: { label: string; names: string[]; tone: 'add' | 'remove' | 'modify' }) {
  if (names.length === 0) return null
  return (
    <li className="flex flex-wrap items-baseline gap-1.5">
      <span
        className={cn(
          'w-16 shrink-0 text-xs font-medium',
          tone === 'add' ? 'text-success' : tone === 'remove' ? 'text-destructive' : 'text-warning',
        )}
      >
        {label}
      </span>
      <span className="text-foreground">{names.join(', ')}</span>
    </li>
  )
}

export function OntologyStudio({ ontology, onSaved }: Props) {
  const mode = useThemeMode()
  const [entityTypes, setEntityTypes] = useState<EntityType[]>(ontology.entity_types)
  const [relationTypes, setRelationTypes] = useState<RelationType[]>(ontology.relation_types)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('types')
  const [openEntity, setOpenEntity] = useState<number | null>(null)
  const [openRelation, setOpenRelation] = useState<number | null>(null)

  const isDirty =
    JSON.stringify(entityTypes) !== JSON.stringify(ontology.entity_types) ||
    JSON.stringify(relationTypes) !== JSON.stringify(ontology.relation_types)

  const diff = ontology.diff
  const diffHasChanges = diff !== null && Object.values(diff).some((names) => names.length > 0)
  // Colors follow the *saved* ontology's order, so a type keeps its graph
  // color while being edited.
  const colorOrder = useMemo(() => ontology.entity_types.map((et) => et.name), [ontology])
  const entityNames = entityTypes.map((et) => et.name).filter(Boolean)

  function updateEntityType(index: number, patch: Partial<EntityType>) {
    setEntityTypes((prev) => prev.map((et, i) => (i === index ? { ...et, ...patch } : et)))
  }

  function updateRelationType(index: number, patch: Partial<RelationType>) {
    setRelationTypes((prev) => prev.map((rt, i) => (i === index ? { ...rt, ...patch } : rt)))
  }

  function updateEntityProperty(entityIndex: number, propIndex: number, patch: Partial<PropertyDef>) {
    updateEntityType(entityIndex, {
      properties: entityTypes[entityIndex].properties.map((p, i) => (i === propIndex ? { ...p, ...patch } : p)),
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const version = await updateOntology(entityTypes, relationTypes)
      onSaved(version)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setEntityTypes(ontology.entity_types)
    setRelationTypes(ontology.relation_types)
    setError(null)
  }

  // Schema view: entity types as nodes, one edge per (relation, source
  // type, target type) the relation allows -- drawn by the same GraphView
  // as the data graph, as docs/ARCHITECTURE.md §4 intended.
  const schema = useMemo(() => {
    const typeNames = entityTypes.map((et) => et.name).filter(Boolean)
    const names = new Set(typeNames)
    const nodes: GraphNode[] = typeNames.map((name) => ({
      uuid: name,
      name,
      type: name,
      labels: [],
      summary: '',
      attributes: {},
    }))
    const edges: GraphEdge[] = []
    for (const rt of relationTypes) {
      for (const s of rt.source_types) {
        for (const t of rt.target_types) {
          if (!names.has(s) || !names.has(t) || !rt.name) continue
          edges.push({
            uuid: `${rt.name}:${s}->${t}`,
            source: s,
            target: t,
            name: rt.name,
            fact: rt.description || humanizeRelation(rt.name),
            confidence: null,
            valid_at: null,
            invalid_at: null,
            created_at: null,
          })
        }
      }
    }
    return { nodes, edges }
  }, [entityTypes, relationTypes])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Ontology view" className="inline-flex rounded-md bg-secondary p-0.5">
          {(['types', 'schema'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                'h-7 rounded-[5px] px-3 text-[13px] font-medium transition-colors',
                tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'types' ? 'Types' : 'Schema graph'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">v{ontology.version_number || '—'}</Badge>
          {ontology.created_by && ontology.version_number > 0 && <span>via {ontology.created_by.replace('_', ' ')}</span>}
        </div>
      </div>

      {diffHasChanges && diff && (
        <aside className="rounded-md border-l-2 border-accent-foreground bg-accent/60 px-4 py-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <GitCompareArrows className="h-4 w-4 text-accent-foreground" /> What changed in v{ontology.version_number}
          </div>
          <ul className="flex flex-col gap-1 text-[13px]">
            <DiffLine label="Added" tone="add" names={[...diff.added_entity_types, ...diff.added_relation_types]} />
            <DiffLine label="Removed" tone="remove" names={[...diff.removed_entity_types, ...diff.removed_relation_types]} />
            <DiffLine label="Modified" tone="modify" names={[...diff.modified_entity_types, ...diff.modified_relation_types]} />
          </ul>
        </aside>
      )}

      {tab === 'schema' ? (
        <div className="relative h-[520px] overflow-hidden rounded-lg border border-border bg-background-alt">
          {schema.nodes.length === 0 ? (
            <p className="flex h-full items-center justify-center text-[13px] text-muted-foreground">No entity types defined.</p>
          ) : (
            <GraphView
              className="absolute inset-0"
              nodes={schema.nodes}
              edges={schema.edges}
              entityTypeOrder={colorOrder}
              settings={SCHEMA_SETTINGS}
              aria-label={`Ontology schema: ${pluralize(schema.nodes.length, 'entity type')}, ${pluralize(schema.edges.length, 'allowed relation')}`}
              onNodeClick={(name) => {
                setTab('types')
                setOpenEntity(entityTypes.findIndex((et) => et.name === name))
              }}
            />
          )}
          <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-faint-foreground">
            Each link is a relation type an entity type may hold toward another · click a type to edit it
          </p>
        </div>
      ) : (
        <>
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-foreground">
                Entity types <span className="font-normal text-faint-foreground">{entityTypes.length}</span>
              </h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEntityTypes((prev) => [...prev, emptyEntityType()])
                  setOpenEntity(entityTypes.length)
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Entity type
              </Button>
            </div>
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
              {entityTypes.map((et, i) => {
                const open = openEntity === i
                return (
                  <li key={i} className="bg-background">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={open ? 'Collapse' : 'Expand'}
                        onClick={() => setOpenEntity(open ? null : i)}
                        className="rounded-sm p-0.5 text-faint-foreground hover:bg-hover hover:text-foreground"
                      >
                        <ChevronRight className={cn('h-4 w-4 transition-transform duration-200 ease-out-expo', open && 'rotate-90')} />
                      </button>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: typeColor(mode, colorOrder, et.name) }} />
                      <input
                        value={et.name}
                        placeholder="Type name"
                        aria-label="Entity type name"
                        onChange={(e) => updateEntityType(i, { name: e.target.value })}
                        className="min-w-0 flex-1 rounded-sm bg-transparent px-1 py-0.5 text-[13.5px] font-medium text-foreground outline-none placeholder:text-faint-foreground hover:bg-hover focus:bg-hover"
                      />
                      <span className="hidden shrink-0 text-xs text-faint-foreground sm:inline">
                        {pluralize(et.properties.length, 'property', 'properties')}
                      </span>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove entity type ${et.name || 'untitled'}`}
                        onClick={() => setEntityTypes((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {!open && et.description && (
                      <p className="-mt-1 truncate px-3 pb-2 pl-[52px] text-xs text-muted-foreground">{et.description}</p>
                    )}
                    {open && (
                      <div className="flex animate-fade-in flex-col gap-3 px-3 pb-3 pl-[52px]">
                        <Textarea
                          placeholder="What counts as this type?"
                          aria-label="Description"
                          value={et.description}
                          onChange={(e) => updateEntityType(i, { description: e.target.value })}
                          className="min-h-[56px]"
                        />
                        <div className="flex flex-col gap-1.5">
                          <div className="text-xs font-medium text-muted-foreground">Properties</div>
                          {et.properties.map((p, pi) => (
                            <div key={pi} className="flex gap-1.5">
                              <Input
                                placeholder="name"
                                aria-label="Property name"
                                value={p.name}
                                onChange={(e) => updateEntityProperty(i, pi, { name: e.target.value })}
                                className="w-40 font-mono text-xs"
                              />
                              <Input
                                placeholder="description"
                                aria-label="Property description"
                                value={p.description}
                                onChange={(e) => updateEntityProperty(i, pi, { description: e.target.value })}
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label="Remove property"
                                onClick={() => updateEntityType(i, { properties: et.properties.filter((_, idx) => idx !== pi) })}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            size="xs"
                            variant="ghost"
                            className="w-fit"
                            onClick={() => updateEntityType(i, { properties: [...et.properties, emptyProperty()] })}
                          >
                            <Plus className="h-3 w-3" /> Property
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
              {entityTypes.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-faint-foreground">No entity types.</li>}
            </ul>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-foreground">
                Relation types <span className="font-normal text-faint-foreground">{relationTypes.length}</span>
              </h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRelationTypes((prev) => [...prev, emptyRelationType()])
                  setOpenRelation(relationTypes.length)
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Relation type
              </Button>
            </div>
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
              {relationTypes.map((rt, i) => {
                const open = openRelation === i
                return (
                  <li key={i} className="bg-background">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={open ? 'Collapse' : 'Expand'}
                        onClick={() => setOpenRelation(open ? null : i)}
                        className="rounded-sm p-0.5 text-faint-foreground hover:bg-hover hover:text-foreground"
                      >
                        <ChevronRight className={cn('h-4 w-4 transition-transform duration-200 ease-out-expo', open && 'rotate-90')} />
                      </button>
                      <input
                        value={rt.name}
                        placeholder="RELATION_NAME"
                        aria-label="Relation type name"
                        onChange={(e) => updateRelationType(i, { name: e.target.value })}
                        className="w-44 min-w-0 shrink rounded-sm bg-transparent px-1 py-0.5 font-mono text-[12.5px] font-medium text-foreground outline-none placeholder:text-faint-foreground hover:bg-hover focus:bg-hover"
                      />
                      <span className="hidden min-w-0 flex-1 items-center gap-1 truncate text-xs text-muted-foreground sm:flex">
                        <TypeList names={rt.source_types} colorOrder={colorOrder} />
                        <span className="text-faint-foreground">→</span>
                        <TypeList names={rt.target_types} colorOrder={colorOrder} />
                      </span>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="ml-auto"
                        aria-label={`Remove relation type ${rt.name || 'untitled'}`}
                        onClick={() => setRelationTypes((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {open && (
                      <div className="flex animate-fade-in flex-col gap-3 px-3 pb-3 pl-[34px]">
                        <Textarea
                          placeholder="When does this relation hold?"
                          aria-label="Description"
                          value={rt.description}
                          onChange={(e) => updateRelationType(i, { description: e.target.value })}
                          className="min-h-[56px]"
                        />
                        <TypePicker
                          label="From"
                          options={entityNames}
                          selected={rt.source_types}
                          colorOrder={colorOrder}
                          onChange={(source_types) => updateRelationType(i, { source_types })}
                        />
                        <TypePicker
                          label="To"
                          options={entityNames}
                          selected={rt.target_types}
                          colorOrder={colorOrder}
                          onChange={(target_types) => updateRelationType(i, { target_types })}
                        />
                      </div>
                    )}
                  </li>
                )
              })}
              {relationTypes.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-faint-foreground">No relation types.</li>}
            </ul>
          </section>
        </>
      )}

      {error && <p className="text-[13px] text-destructive">{error}</p>}

      {isDirty && (
        <div className="sticky bottom-4 z-10 flex animate-rise-in items-center gap-3 rounded-lg border border-border bg-popover/95 py-2 pl-4 pr-2 shadow-popover backdrop-blur-md">
          <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
          <span className="flex-1 text-[13px] text-foreground">Unsaved changes — saving creates version {ontology.version_number + 1}.</span>
          <Button variant="ghost" size="sm" disabled={saving} onClick={discard}>
            Discard
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void handleSave()}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? 'Saving…' : 'Save ontology'}
          </Button>
        </div>
      )}
    </div>
  )
}

function TypeList({ names, colorOrder }: { names: string[]; colorOrder: string[] }) {
  const mode = useThemeMode()
  if (names.length === 0) return <span className="text-faint-foreground">any</span>
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      {names.map((name) => (
        <span key={name} className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: typeColor(mode, colorOrder, name) }} />
          {name}
        </span>
      ))}
    </span>
  )
}

function TypePicker({
  label,
  options,
  selected,
  colorOrder,
  onChange,
}: {
  label: string
  options: string[]
  selected: string[]
  colorOrder: string[]
  onChange: (next: string[]) => void
}) {
  const mode = useThemeMode()
  // Keep values the ontology references but no longer defines visible, so
  // they can be removed rather than silently kept.
  const all = [...options, ...selected.filter((s) => !options.includes(s))]
  return (
    <div className="flex items-start gap-3">
      <span className="w-10 shrink-0 pt-1 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">
        {all.map((name) => {
          const active = selected.includes(name)
          return (
            <button
              key={name}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? selected.filter((s) => s !== name) : [...selected, name])}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors',
                active
                  ? 'border-transparent bg-accent text-accent-foreground'
                  : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
                !options.includes(name) && 'line-through',
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: typeColor(mode, colorOrder, name) }} />
              {name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
