// Tiny fuzzy matcher for the command palette: characters of the query must
// appear in order; contiguous runs and word-start hits score higher, so
// "gv" ranks "Graph view" above "Go to overview".

export type FuzzyMatch = { score: number; indices: number[] }

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase()
  if (!q) return { score: 0, indices: [] }
  const t = text.toLowerCase()

  // Fast path: a plain substring match beats any scattered match.
  const at = t.indexOf(q)
  if (at !== -1) {
    const wordStart = at === 0 || /[\s/:_-]/.test(t[at - 1])
    return {
      score: 1000 - at + (wordStart ? 200 : 0) - t.length * 0.5,
      indices: Array.from({ length: q.length }, (_, i) => at + i),
    }
  }

  const indices: number[] = []
  let score = 0
  let ti = 0
  let prev = -2
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    const wordStart = found === 0 || /[\s/:_-]/.test(t[found - 1])
    score += (found === prev + 1 ? 12 : 1) + (wordStart ? 10 : 0)
    indices.push(found)
    prev = found
    ti = found + 1
  }
  return { score: score - t.length * 0.5, indices }
}
