import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ThemeContext, type ThemeMode, type ThemePreference, type ThemeState } from './themeContext'

// Stored as a raw string (not JSON like lib/storage.ts) because index.html's
// pre-paint script reads it with no helpers available -- keep both in step.
const STORAGE_KEY = 'graph-buddy:theme'

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function systemMode(): ThemeMode {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Light/dark theming with an explicit override: "system" follows the OS
 * live, "light"/"dark" pin it. Applies the `dark` class on <html> that
 * index.css's tokens and Tailwind's `dark:` variant key off. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [system, setSystem] = useState<ThemeMode>(systemMode)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => setSystem(systemMode())
    mql.addEventListener('change', listener)
    return () => mql.removeEventListener('change', listener)
  }, [])

  const mode: ThemeMode = preference === 'system' ? system : preference

  useEffect(() => {
    const root = document.documentElement
    // Suppress every transition for the one frame the palette swaps, so
    // borders/backgrounds don't visibly cross-fade at different speeds.
    root.classList.add('theme-switching')
    root.classList.toggle('dark', mode === 'dark')
    const id = window.requestAnimationFrame(() => root.classList.remove('theme-switching'))
    return () => {
      window.cancelAnimationFrame(id)
      root.classList.remove('theme-switching')
    }
  }, [mode])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY)
      else window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // preference just won't persist
    }
  }, [])

  const value = useMemo<ThemeState>(
    () => ({
      preference,
      mode,
      setPreference,
      toggle: () => setPreference(mode === 'dark' ? 'light' : 'dark'),
    }),
    [preference, mode, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
