import { createContext, useContext } from 'react'
import type { OntologyVersion } from '../types'

// Split out from AppDataContext.tsx (the provider component) so that file
// exports only a component -- same "keep constants/hooks in their own
// file" convention as lib/confidence.ts, for oxlint's
// react/only-export-components (mixing component + hook exports defeats
// Fast Refresh).

export type BadgeState = 'checking' | 'ok' | 'error' | 'unreachable'

export type AppData = {
  backendState: BadgeState
  graphState: BadgeState
  graphDetail: string | undefined
  ontology: OntologyVersion | null
  setOntology: (version: OntologyVersion) => void
  /** Ontology entity-type names in definition order -- fixes each type's
   * color slot (lib/palette.ts) so it stays stable across pages. */
  entityTypeOrder: string[]
  hasOntology: boolean
}

export const AppDataContext = createContext<AppData | null>(null)

export function useAppData(): AppData {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}
