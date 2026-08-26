import type {
  EntityType,
  ExtractionResult,
  OntologyVersion,
  RelationType,
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
