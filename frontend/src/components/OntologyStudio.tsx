import { useState } from 'react'
import { Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { updateOntology } from '../api/client'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardContent } from './ui/Card'
import { Input, Textarea } from './ui/Input'
import type { EntityType, OntologyVersion, PropertyDef, RelationType } from '../types'

// Parent must pass `key={ontology.id}` -- that remounts this component (and
// so re-derives entityTypes/relationTypes below) whenever the ontology
// version changes, instead of syncing local state from a prop in an effect.
type Props = {
  ontology: OntologyVersion
  onSaved: (version: OntologyVersion) => void
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

function csvToList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

function DiffLine({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null
  return (
    <li className="flex flex-wrap items-baseline gap-1.5">
      <span className="font-medium text-foreground">{label}:</span>
      <span className="text-muted-foreground">{names.join(', ')}</span>
    </li>
  )
}

export function OntologyStudio({ ontology, onSaved }: Props) {
  const [entityTypes, setEntityTypes] = useState<EntityType[]>(ontology.entity_types)
  const [relationTypes, setRelationTypes] = useState<RelationType[]>(ontology.relation_types)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDirty =
    JSON.stringify(entityTypes) !== JSON.stringify(ontology.entity_types) ||
    JSON.stringify(relationTypes) !== JSON.stringify(ontology.relation_types)

  const diff = ontology.diff
  const diffHasChanges = diff !== null && Object.values(diff).some((names) => names.length > 0)

  function updateEntityType(index: number, patch: Partial<EntityType>) {
    setEntityTypes((prev) => prev.map((et, i) => (i === index ? { ...et, ...patch } : et)))
  }

  function updateRelationType(index: number, patch: Partial<RelationType>) {
    setRelationTypes((prev) => prev.map((rt, i) => (i === index ? { ...rt, ...patch } : rt)))
  }

  function updateEntityProperty(entityIndex: number, propIndex: number, patch: Partial<PropertyDef>) {
    updateEntityType(entityIndex, {
      properties: entityTypes[entityIndex].properties.map((p, i) =>
        i === propIndex ? { ...p, ...patch } : p,
      ),
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="outline">version {ontology.version_number || '—'}</Badge>
        {ontology.created_by && ontology.version_number > 0 && <span>via {ontology.created_by}</span>}
      </div>

      {diffHasChanges && diff && (
        <Card className="border-primary/30 bg-accent/40">
          <CardContent className="flex flex-col gap-2 py-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" /> What changed in this version
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              <DiffLine label="Added entity types" names={diff.added_entity_types} />
              <DiffLine label="Removed entity types" names={diff.removed_entity_types} />
              <DiffLine label="Modified entity types" names={diff.modified_entity_types} />
              <DiffLine label="Added relation types" names={diff.added_relation_types} />
              <DiffLine label="Removed relation types" names={diff.removed_relation_types} />
              <DiffLine label="Modified relation types" names={diff.modified_relation_types} />
            </ul>
          </CardContent>
        </Card>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Entity types</h3>
          <Button size="sm" variant="outline" onClick={() => setEntityTypes((prev) => [...prev, emptyEntityType()])}>
            <Plus className="h-3.5 w-3.5" /> Entity type
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {entityTypes.map((et, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start gap-2">
                <Input
                  placeholder="Name"
                  value={et.name}
                  onChange={(e) => updateEntityType(i, { name: e.target.value })}
                  className="font-medium"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove entity type"
                  onClick={() => setEntityTypes((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
              <Textarea
                placeholder="Description"
                value={et.description}
                onChange={(e) => updateEntityType(i, { description: e.target.value })}
                className="mt-2 min-h-[44px]"
              />
              <div className="mt-3 flex flex-col gap-2 border-l-2 border-border pl-3">
                {et.properties.map((p, pi) => (
                  <div key={pi} className="flex gap-2">
                    <Input
                      placeholder="property name"
                      value={p.name}
                      onChange={(e) => updateEntityProperty(i, pi, { name: e.target.value })}
                    />
                    <Input
                      placeholder="description"
                      value={p.description}
                      onChange={(e) => updateEntityProperty(i, pi, { description: e.target.value })}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove property"
                      onClick={() =>
                        updateEntityType(i, { properties: et.properties.filter((_, idx) => idx !== pi) })
                      }
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-fit"
                  onClick={() => updateEntityType(i, { properties: [...et.properties, emptyProperty()] })}
                >
                  <Plus className="h-3.5 w-3.5" /> Property
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Relation types</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRelationTypes((prev) => [...prev, emptyRelationType()])}
          >
            <Plus className="h-3.5 w-3.5" /> Relation type
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {relationTypes.map((rt, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start gap-2">
                <Input
                  placeholder="Name"
                  value={rt.name}
                  onChange={(e) => updateRelationType(i, { name: e.target.value })}
                  className="font-medium"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove relation type"
                  onClick={() => setRelationTypes((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
              <Textarea
                placeholder="Description"
                value={rt.description}
                onChange={(e) => updateRelationType(i, { description: e.target.value })}
                className="mt-2 min-h-[44px]"
              />
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  placeholder="Source entity types (comma-separated)"
                  value={rt.source_types.join(', ')}
                  onChange={(e) => updateRelationType(i, { source_types: csvToList(e.target.value) })}
                />
                <Input
                  placeholder="Target entity types (comma-separated)"
                  value={rt.target_types.join(', ')}
                  onChange={(e) => updateRelationType(i, { target_types: csvToList(e.target.value) })}
                />
              </div>
            </Card>
          ))}
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="sticky bottom-4 flex justify-end">
        <Button disabled={!isDirty || saving} onClick={() => void handleSave()} size="lg" className="shadow-lg">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? 'Saving…' : 'Save ontology'}
        </Button>
      </div>
    </div>
  )
}
