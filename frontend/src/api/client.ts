import type {
  ChatTurn,
  ConsolidationRun,
  Conversation,
  DiscoveryEvent,
  DiscoverySettings,
  EntityType,
  ExtractionResult,
  GraphFilters,
  GraphQueryResult,
  MemoryOverview,
  NodeDetail,
  OntologyChangeProposal,
  OntologyVersion,
  ProposalDecision,
  ProposalStatus,
  RelationType,
  RetrievalTrace,
  SourceDiscoveryResult,
  SourceRead,
  VocabularyEntry,
} from '../types'

const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type HealthStatus = {
  status: 'ok' | 'error'
  detail?: string
}

async function unwrap<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: string }
      detail = body.detail ?? ''
    } catch {
      // body wasn't JSON -- fall through with just the status
    }
    throw new Error(`${path} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return (await response.json()) as T
}

async function getJson<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(`${API_BASE_URL}${path}`), path)
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    path,
  )
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(`${API_BASE_URL}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    path,
  )
}

export function getHealth(): Promise<HealthStatus> {
  return getJson<HealthStatus>('/health')
}

export function getGraphHealth(): Promise<HealthStatus> {
  return getJson<HealthStatus>('/health/graph')
}

export async function uploadSource(file: File): Promise<SourceRead> {
  const formData = new FormData()
  formData.append('file', file)
  return unwrap<SourceRead>(
    await fetch(`${API_BASE_URL}/sources`, { method: 'POST', body: formData }),
    '/sources',
  )
}

export function listSources(): Promise<SourceRead[]> {
  return getJson<SourceRead[]>('/sources')
}

export function getSource(id: string): Promise<SourceRead> {
  return getJson<SourceRead>(`/sources/${id}`)
}

export async function extractSource(sourceId: string): Promise<ExtractionResult> {
  const path = `/sources/${sourceId}/extract`
  return unwrap<ExtractionResult>(await fetch(`${API_BASE_URL}${path}`, { method: 'POST' }), path)
}

export function getOntology(): Promise<OntologyVersion> {
  return getJson<OntologyVersion>('/ontology')
}

export function getOntologyVersions(): Promise<OntologyVersion[]> {
  return getJson<OntologyVersion[]>('/ontology/versions')
}

export function bootstrapOntology(sourceId: string): Promise<OntologyVersion> {
  return postJson<OntologyVersion>('/ontology/bootstrap', { source_id: sourceId })
}

export function updateOntology(
  entityTypes: EntityType[],
  relationTypes: RelationType[],
): Promise<OntologyVersion> {
  return putJson<OntologyVersion>('/ontology', {
    entity_types: entityTypes,
    relation_types: relationTypes,
  })
}

export function getGraph(filters: GraphFilters): Promise<GraphQueryResult> {
  const params = new URLSearchParams()
  for (const type of filters.entityTypes ?? []) params.append('entity_types', type)
  for (const type of filters.relationTypes ?? []) params.append('relation_types', type)
  if (filters.minConfidence !== undefined) {
    params.set('min_confidence', String(filters.minConfidence))
  }
  if (filters.search) params.set('search', filters.search)
  if (filters.limit !== undefined) params.set('limit', String(filters.limit))
  const query = params.toString()
  return getJson<GraphQueryResult>(`/graph${query ? `?${query}` : ''}`)
}

export function getGraphNode(uuid: string): Promise<NodeDetail> {
  return getJson<NodeDetail>(`/graph/nodes/${encodeURIComponent(uuid)}`)
}

export function getChatHistory(conversationId?: string): Promise<ChatTurn[]> {
  const query = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ''
  return getJson<ChatTurn[]>(`/chat/history${query}`)
}

/** Omit `conversationId` to start a new conversation -- the returned turn
 * carries the id it was filed under. */
export function askChat(question: string, conversationId?: string | null): Promise<ChatTurn> {
  return postJson<ChatTurn>('/chat', { question, conversation_id: conversationId ?? null })
}

export function listConversations(): Promise<Conversation[]> {
  return getJson<Conversation[]>('/chat/conversations')
}

export function getRetrievalTrace(turnId: string): Promise<RetrievalTrace> {
  return getJson<RetrievalTrace>(`/chat/${encodeURIComponent(turnId)}/trace`)
}

// --- Discovery cycle (docs/MEMORY_AND_DISCOVERY.md §3) ---

export function getDiscoveryFeed(limit = 50): Promise<DiscoveryEvent[]> {
  return getJson<DiscoveryEvent[]>(`/discovery/feed?limit=${limit}`)
}

export function listProposals(status?: ProposalStatus): Promise<OntologyChangeProposal[]> {
  return getJson<OntologyChangeProposal[]>(`/discovery/proposals${status ? `?status=${status}` : ''}`)
}

export function acceptProposal(id: string): Promise<ProposalDecision> {
  return postJson<ProposalDecision>(`/discovery/proposals/${encodeURIComponent(id)}/accept`, {})
}

export function rejectProposal(id: string): Promise<ProposalDecision> {
  return postJson<ProposalDecision>(`/discovery/proposals/${encodeURIComponent(id)}/reject`, {})
}

export function discoverSource(sourceId: string): Promise<SourceDiscoveryResult> {
  return postJson<SourceDiscoveryResult>(`/discovery/sources/${encodeURIComponent(sourceId)}`, {})
}

export function getDiscoverySettings(): Promise<DiscoverySettings> {
  return getJson<DiscoverySettings>('/discovery/settings')
}

// --- Memory (docs/MEMORY_AND_DISCOVERY.md §2) ---

export function getMemoryOverview(): Promise<MemoryOverview> {
  return getJson<MemoryOverview>('/memory/overview')
}

export function getVocabulary(): Promise<VocabularyEntry[]> {
  return getJson<VocabularyEntry[]>('/memory/vocabulary')
}

export function consolidateMemory(): Promise<ConsolidationRun> {
  return postJson<ConsolidationRun>('/memory/consolidate', {})
}
