import type {
  ChatTurn,
  EntityType,
  ExtractionResult,
  GraphFilters,
  GraphQueryResult,
  NodeDetail,
  OntologyVersion,
  RelationType,
  RetrievalTrace,
  SourceRead,
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

export function getChatHistory(): Promise<ChatTurn[]> {
  return getJson<ChatTurn[]>('/chat/history')
}

export function askChat(question: string): Promise<ChatTurn> {
  return postJson<ChatTurn>('/chat', { question })
}

export function getRetrievalTrace(turnId: string): Promise<RetrievalTrace> {
  return getJson<RetrievalTrace>(`/chat/${encodeURIComponent(turnId)}/trace`)
}
