import { createContext, useContext, useEffect } from 'react'
import type { LucideIcon } from 'lucide-react'

// Command registry behind the ⌘K palette (components/CommandPalette.tsx).
// The shell registers navigation + app actions; pages register their own
// while mounted (the Graph Explorer adds graph actions and one "open node"
// command per loaded node -- Obsidian's quick switcher, for entities).

export type Command = {
  id: string
  title: string
  /** Section heading in the palette ("Navigation", "Nodes", ...). */
  group: string
  icon?: LucideIcon
  /** Color dot instead of an icon (entity types, nodes). */
  color?: string
  /** Muted text after the title (a node's type, a file's status). */
  subtitle?: string
  /** Extra text the fuzzy matcher considers but doesn't display. */
  keywords?: string
  shortcut?: string[]
  run: () => void
}

export type CommandRegistry = {
  open: boolean
  setOpen: (open: boolean) => void
  commands: Command[]
  register: (scope: string, commands: Command[]) => void
  unregister: (scope: string) => void
}

export const CommandContext = createContext<CommandRegistry | null>(null)

export function useCommandPalette(): CommandRegistry {
  const ctx = useContext(CommandContext)
  if (!ctx) throw new Error('useCommandPalette must be used within CommandProvider')
  return ctx
}

/** Contribute commands for as long as the calling component is mounted.
 * Memoize `commands` -- every new array identity re-registers. */
export function useRegisterCommands(scope: string, commands: Command[]) {
  const { register, unregister } = useCommandPalette()
  useEffect(() => {
    register(scope, commands)
  }, [scope, commands, register])
  useEffect(() => () => unregister(scope), [scope, unregister])
}
