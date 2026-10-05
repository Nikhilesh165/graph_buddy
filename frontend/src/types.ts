// Mirrors backend/app/models/{source,ontology}.py's *Read / value-type shapes.

export type SourceStatus = 'uploaded' | 'parsed' | 'failed'
export type GraphitiStatus = 'not_extracted' | 'extracting' | 'extracted' | 'failed'
export type DiscoveryStatus = 'not_run' | 'pending' | 'running' | 'completed' | 'failed'

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
  extracted_ontology_version: number | null
  discovery_status: DiscoveryStatus
  discovery_error: string | null
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

export type OntologyVersionSource = 'bootstrap' | 'user_edit' | 'discovery'

export type OntologyVersion = {
  id: string
  version_number: number
  entity_types: EntityType[]
  relation_types: RelationType[]
  created_by: OntologyVersionSource
  source_id: string | null
  diff: OntologyDiff | null
  created_at: string
  note: string | null
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
// retrieval), now threaded into conversations with episodic memory and
// ontology-aware query resolution (docs/MEMORY_AND_DISCOVERY.md §2).

export type QueryIntent = 'lookup' | 'relationship' | 'aggregate' | 'overview' | 'temporal' | 'comparison'

export type EntityMention = {
  name: string
  entity_type: string | null
}

export type TermMapping = {
  term: string
  kind: 'entity_type' | 'relation_type'
  maps_to: string
}

export type QueryPlan = {
  standalone_query: string
  intent: QueryIntent
  entity_types: string[]
  relation_types: string[]
  entity_mentions: EntityMention[]
  term_mappings: TermMapping[]
  unmapped_terms: string[]
  uses_conversation_context: boolean
}

export type Conversation = {
  id: string
  title: string
  summary: string
  turn_count: number
  created_at: string
  updated_at: string
}

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
  conversation_id: string | null
  query_plan: QueryPlan | null
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
  ontology_match: boolean
}

export type TraceResolution = {
  plan: QueryPlan
  edge_types: string[]
  node_labels: string[]
  anchors: { uuid: string; name: string; type: string }[]
  error: string | null
}

export type TraceMemory = {
  conversation_summary: string
  working_turns: { turn_id: string; question: string }[]
  recalled: { turn_id: string; question: string; score: number; reason: string }[]
  vocabulary: { term: string; maps_to: string }[]
}

export type TracedCommunity = {
  uuid: string
  name: string
  summary: string
  score: number
}

export type RetrievalTrace = {
  turn_id: string
  query: string
  seed_nodes: SeedNode[]
  facts: TracedFact[]
  final_context: string
  created_at: string
  // Null for traces recorded before query resolution and memory existed.
  resolution: TraceResolution | null
  memory: TraceMemory | null
  communities: TracedCommunity[]
}

// Mirrors backend/app/models/discovery.py (the AI discovery cycle) and
// backend/app/models/memory.py (periodic consolidation).

export type ChangeOp =
  | 'add_entity_type'
  | 'add_relation_type'
  | 'add_entity_property'
  | 'add_relation_property'
  | 'extend_relation_endpoints'
  | 'update_description'
  | 'rename_entity_type'
  | 'rename_relation_type'
  | 'remove_entity_type'
  | 'remove_relation_type'

export type RiskLevel = 'low' | 'medium' | 'high'

export type OntologyChange = {
  op: ChangeOp
  target: string
  entity_type: EntityType | null
  relation_type: RelationType | null
  property_def: PropertyDef | null
  source_types: string[]
  target_types: string[]
  new_name: string | null
  description: string | null
  rationale: string
}

export type Evidence = {
  quote: string
  origin: string
}

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed'

export type OntologyChangeProposal = {
  id: string
  status: ProposalStatus
  trigger: 'source' | 'conversation' | 'manual'
  source_id: string | null
  base_version_number: number
  summary: string
  changes: OntologyChange[]
  evidence: Evidence[]
  risk: RiskLevel
  auto_applied: boolean
  resulting_version_id: string | null
  error: string | null
  created_at: string
  decided_at: string | null
}

export type ProposalDecision = {
  proposal: OntologyChangeProposal
  ontology: OntologyVersion
}

export type SourceDiscoveryResult = {
  source: SourceRead
  ontology: OntologyVersion
  applied: OntologyChangeProposal | null
  pending: OntologyChangeProposal | null
  skipped: string[]
}

export type DiscoveryEventKind =
  | 'ontology_bootstrapped'
  | 'ontology_evolved'
  | 'proposal_pending'
  | 'proposal_accepted'
  | 'proposal_rejected'
  | 'source_analyzed'
  | 'discovery_failed'
  | 'consolidation_digest'

export type DiscoveryEvent = {
  id: string
  kind: DiscoveryEventKind
  title: string
  body: string
  payload: Record<string, unknown>
  created_at: string
}

export type OntologyAutonomy = 'manual' | 'assisted' | 'autonomous'

export type DiscoverySettings = {
  ontology_autonomy: OntologyAutonomy
  auto_discover_on_upload: boolean
  auto_extract_on_upload: boolean
  consolidation_interval_minutes: number
}

export type ConsolidationRun = {
  id: string
  trigger: 'schedule' | 'manual'
  status: 'running' | 'completed' | 'failed'
  started_at: string
  finished_at: string | null
  stats: Record<string, unknown>
  digest: string
  error: string | null
}

export type VocabularyEntry = {
  term: string
  kind: 'entity_type' | 'relation_type'
  maps_to: string
  hits: number
  last_seen_at: string
}

export type MemoryOverview = {
  conversations: number
  episodes: number
  vocabulary_terms: number
  pending_proposals: number
  consolidation_interval_minutes: number
  last_run: ConsolidationRun | null
}
