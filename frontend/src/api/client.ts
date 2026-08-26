const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type HealthStatus = {
  status: 'ok' | 'error'
  detail?: string
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`)
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export function getHealth(): Promise<HealthStatus> {
  return getJson<HealthStatus>('/health')
}

export function getGraphHealth(): Promise<HealthStatus> {
  return getJson<HealthStatus>('/health/graph')
}
