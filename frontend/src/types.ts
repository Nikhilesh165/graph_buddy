// Mirrors backend/app/models/{source,ontology}.py's *Read / value-type shapes.

export type SourceStatus = 'uploaded' | 'parsed' | 'failed'
export type GraphitiStatus = 'not_extracted' | 'extracting' | 'extracted' | 'failed'

export type SourceRead = {
  id: string
  filename: string
  content_type: string
  size_bytes: number
  status: SourceStatus
  parse_error: string | null
  char_count: number
  row_count: number | null
  text_preview: string | null
  created_at: string
  graphiti_status: GraphitiStatus
  graphiti_error: string | null
  episode_count: number
  node_count: number
  edge_count: number
  extracted_at: string | null
}

export type SampleFact = {
  fact: string
  confidence: number | null
}

export type ExtractionResult = {
  source_id: string
  episodes_added: number
  nodes_touched: number
  edges_touched: number
  sample_facts: SampleFact[]
}

export type PropertyDef = {
  name: string
  description: string
  type: string
}

export type EntityType = {
  name: string
  description: string
  properties: PropertyDef[]
  examples: string[]
}

export type RelationType = {
  name: string
  description: string
  source_types: string[]
  target_types: string[]
  properties: PropertyDef[]
}

export type OntologyDiff = {
  added_entity_types: string[]
  removed_entity_types: string[]
  modified_entity_types: string[]
  added_relation_types: string[]
  removed_relation_types: string[]
  modified_relation_types: string[]
}

export type OntologyVersionSource = 'bootstrap' | 'user_edit'

export type OntologyVersion = {
  id: string
  version_number: number
  entity_types: EntityType[]
  relation_types: RelationType[]
  created_by: OntologyVersionSource
  source_id: string | null
  diff: OntologyDiff | null
  created_at: string
}
