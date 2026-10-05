import { createContext, useContext } from 'react'

// Hooks + types for lib/ThemeProvider.tsx, split out so the provider file
// exports only a component (oxlint's react/only-export-components).

export type ThemeMode = 'light' | 'dark'
export type ThemePreference = ThemeMode | 'system'

export type ThemeState = {
  /** What the viewer picked: an explicit mode, or "follow the OS". */
  preference: ThemePreference
  /** What is actually on screen right now. */
  mode: ThemeMode
  setPreference: (preference: ThemePreference) => void
  /** Flip between light and dark (pins an explicit preference). */
  toggle: () => void
}

export const ThemeContext = createContext<ThemeState | null>(null)

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

/** The resolved light/dark mode -- what canvas drawing (lib/palette.ts)
 * keys its concrete colors on. */
export function useThemeMode(): ThemeMode {
  return useTheme().mode
}
