import { useCallback, useEffect, useState } from 'react'

// Per-viewer UI preferences (sidebar width, graph display settings, ...).
// localStorage can be unavailable (private windows, blocked site data), so
// every access is wrapped and falls back to the in-memory default -- a
// preference failing to persist must never break the page.

const PREFIX = 'graph-buddy:'

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeStored<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // ignore -- see module comment
  }
}

/** `useState` that survives reloads. `merge` lets object-shaped settings
 * pick up keys added in a later release instead of staying stuck on an old
 * stored shape. */
export function usePersistentState<T>(
  key: string,
  initial: T,
  merge?: (stored: T, initial: T) => T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readStored<T | undefined>(key, undefined)
    if (stored === undefined) return initial
    return merge ? merge(stored, initial) : stored
  })

  useEffect(() => {
    writeStored(key, value)
  }, [key, value])

  const set = useCallback((next: T | ((prev: T) => T)) => setValue(next), [])
  return [value, set]
}

/** Shallow merge for settings objects: stored values win, but only for keys
 * that still exist with the same primitive type. */
export function mergeSettings<T extends object>(stored: T, initial: T): T {
  if (typeof stored !== 'object' || stored === null) return initial
  const out = { ...initial }
  for (const key of Object.keys(initial) as (keyof T)[]) {
    const value = (stored as T)[key]
    if (value !== undefined && typeof value === typeof initial[key]) out[key] = value
  }
  return out
}
