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

// Mirrors backend/app/api/routes/graph.py's *Read shapes (Phase 3: Graph
// Explorer). Unlike Source/OntologyVersion these aren't persisted rows --
// they're read live off Neo4j via app/services/graph_service.py on every
// request.

export type GraphNode = {
  uuid: string
  name: string
  type: string
  labels: string[]
  summary: string
  attributes: Record<string, unknown>
}

export type GraphEdge = {
  uuid: string
  source: string
  target: string
  name: string
  fact: string
  confidence: number | null
  valid_at: string | null
  invalid_at: string | null
  created_at: string | null
}

export type GraphQueryResult = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
}

export type GraphFilters = {
  entityTypes?: string[]
  relationTypes?: string[]
  minConfidence?: number
  search?: string
  limit?: number
}

export type Provenance = {
  episode_uuid: string
  source_description: string
  valid_at: string | null
  source_id: string | null
  source_filename: string | null
  chunk_preview: string | null
}

export type NodeNeighbor = {
  edge: GraphEdge
  direction: 'outgoing' | 'incoming'
  node: GraphNode
}

export type NodeDetail = {
  node: GraphNode
  neighbors: NodeNeighbor[]
  provenance: Provenance[]
}

// Mirrors backend/app/api/routes/chat.py's *Read shapes (Phase 4: chat +
// retrieval). Like ChatTurn on the backend, this is an append-only
// transcript, not a threaded multi-conversation model.

export type ChatCitation = {
  index: number
  edge_uuid: string
  fact: string
  confidence: number | null
}

export type ChatTurn = {
  id: string
  question: string
  answer: string
  citations: ChatCitation[]
  retrieved_count: number
  created_at: string
}

// Mirrors the retrieval-trace shapes in backend/app/api/routes/chat.py
// (Phase 5: Retrieval Inspector) -- one persisted trace per chat turn.

export type SeedNode = {
  uuid: string
  name: string
  type: string
  score: number
  is_seed: boolean
}

export type TracedFact = {
  edge_uuid: string
  name: string
  fact: string
  confidence: number | null
  score: number
  source_node_uuid: string
  target_node_uuid: string
}

export type RetrievalTrace = {
  turn_id: string
  query: string
  seed_nodes: SeedNode[]
  facts: TracedFact[]
  final_context: string
  created_at: string
}
