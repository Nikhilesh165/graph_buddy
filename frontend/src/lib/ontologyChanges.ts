import type { OntologyChange, RiskLevel } from '../types'

// Mirrors backend/app/services/ontology_changes.py's describe_change and
// risk labels, so proposals read the same in the Discovery page as in the
// feed entries the backend writes.

export function describeChange(change: OntologyChange): string {
  switch (change.op) {
    case 'add_entity_type':
      return `Add entity type ${change.target}`
    case 'add_relation_type': {
      const sources = (change.relation_type?.source_types ?? change.source_types).join(', ') || '?'
      const targets = (change.relation_type?.target_types ?? change.target_types).join(', ') || '?'
      return `Add relation ${change.target} (${sources} → ${targets})`
    }
    case 'add_entity_property':
    case 'add_relation_property':
      return `Add property '${change.property_def?.name ?? '?'}' to ${change.target}`
    case 'extend_relation_endpoints':
      return `Extend ${change.target} endpoints (sources: ${change.source_types.join(', ') || '—'}; targets: ${change.target_types.join(', ') || '—'})`
    case 'update_description':
      return `Update the description of ${change.target}`
    case 'rename_entity_type':
    case 'rename_relation_type':
      return `Rename ${change.target} → ${change.new_name ?? '?'}`
    case 'remove_entity_type':
      return `Remove entity type ${change.target}`
    case 'remove_relation_type':
      return `Remove relation ${change.target}`
  }
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'refinement',
  medium: 'new structure',
  high: 'destructive',
}
