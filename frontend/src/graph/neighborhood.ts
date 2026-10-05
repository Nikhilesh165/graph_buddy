import type { GraphEdge } from '../types'

/** Node ids within `depth` hops of `rootId` (ignoring direction) -- the
 * node set of Obsidian's "local graph". Always includes the root. */
export function neighborhood(edges: readonly GraphEdge[], rootId: string, depth: number): Set<string> {
  const adjacency = new Map<string, string[]>()
  for (const e of edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, [])
    if (!adjacency.has(e.target)) adjacency.set(e.target, [])
    adjacency.get(e.source)!.push(e.target)
    adjacency.get(e.target)!.push(e.source)
  }
  const seen = new Set([rootId])
  let frontier = [rootId]
  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor)
          next.push(neighbor)
        }
      }
    }
    frontier = next
  }
  return seen
}
