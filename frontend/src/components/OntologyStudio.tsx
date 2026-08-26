import { useState } from 'react'
import { updateOntology } from '../api/client'
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
    <li>
      {label}: {names.join(', ')}
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
    <section className="panel">
      <div className="panel-header">
        <h2>Ontology Studio</h2>
        <span className="muted">
          version {ontology.version_number || '—'}
          {ontology.created_by && ontology.version_number > 0 ? ` (${ontology.created_by})` : ''}
        </span>
      </div>

      {diffHasChanges && diff && (
        <ul className="diff-summary">
          <DiffLine label="Added entity types" names={diff.added_entity_types} />
          <DiffLine label="Removed entity types" names={diff.removed_entity_types} />
          <DiffLine label="Modified entity types" names={diff.modified_entity_types} />
          <DiffLine label="Added relation types" names={diff.added_relation_types} />
          <DiffLine label="Removed relation types" names={diff.removed_relation_types} />
          <DiffLine label="Modified relation types" names={diff.modified_relation_types} />
        </ul>
      )}

      <h3>Entity types</h3>
      {entityTypes.map((et, i) => (
        <fieldset key={i} className="type-card">
          <div className="type-card-row">
            <input
              placeholder="Name"
              value={et.name}
              onChange={(e) => updateEntityType(i, { name: e.target.value })}
            />
            <button type="button" onClick={() => setEntityTypes((prev) => prev.filter((_, idx) => idx !== i))}>
              Remove
            </button>
          </div>
          <textarea
            placeholder="Description"
            value={et.description}
            onChange={(e) => updateEntityType(i, { description: e.target.value })}
          />
          <div className="properties">
            {et.properties.map((p, pi) => (
              <div key={pi} className="property-row">
                <input
                  placeholder="property name"
                  value={p.name}
                  onChange={(e) => updateEntityProperty(i, pi, { name: e.target.value })}
                />
                <input
                  placeholder="description"
                  value={p.description}
                  onChange={(e) => updateEntityProperty(i, pi, { description: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() =>
                    updateEntityType(i, { properties: et.properties.filter((_, idx) => idx !== pi) })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => updateEntityType(i, { properties: [...et.properties, emptyProperty()] })}
            >
              + property
            </button>
          </div>
        </fieldset>
      ))}
      <button type="button" onClick={() => setEntityTypes((prev) => [...prev, emptyEntityType()])}>
        + entity type
      </button>

      <h3>Relation types</h3>
      {relationTypes.map((rt, i) => (
        <fieldset key={i} className="type-card">
          <div className="type-card-row">
            <input
              placeholder="Name"
              value={rt.name}
              onChange={(e) => updateRelationType(i, { name: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setRelationTypes((prev) => prev.filter((_, idx) => idx !== i))}
            >
              Remove
            </button>
          </div>
          <textarea
            placeholder="Description"
            value={rt.description}
            onChange={(e) => updateRelationType(i, { description: e.target.value })}
          />
          <input
            placeholder="Source entity types (comma-separated)"
            value={rt.source_types.join(', ')}
            onChange={(e) => updateRelationType(i, { source_types: csvToList(e.target.value) })}
          />
          <input
            placeholder="Target entity types (comma-separated)"
            value={rt.target_types.join(', ')}
            onChange={(e) => updateRelationType(i, { target_types: csvToList(e.target.value) })}
          />
        </fieldset>
      ))}
      <button type="button" onClick={() => setRelationTypes((prev) => [...prev, emptyRelationType()])}>
        + relation type
      </button>

      {error && <p className="error-text">{error}</p>}

      <div className="save-row">
        <button type="button" disabled={!isDirty || saving} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : 'Save ontology'}
        </button>
      </div>
    </section>
  )
}
