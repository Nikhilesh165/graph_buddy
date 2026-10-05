import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CommandContext, type Command, type CommandRegistry } from './commandContext'

/** Holds the palette's open state and the per-scope command registry, and
 * owns the global ⌘K / ⌘P (Ctrl on other platforms) shortcut. */
export function CommandProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [scopes, setScopes] = useState<Record<string, Command[]>>({})

  const register = useCallback((scope: string, commands: Command[]) => {
    setScopes((prev) => ({ ...prev, [scope]: commands }))
  }, [])

  const unregister = useCallback((scope: string) => {
    setScopes((prev) => {
      if (!(scope in prev)) return prev
      const next = { ...prev }
      delete next[scope]
      return next
    })
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (key === 'k' || key === 'p')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const commands = useMemo(() => Object.values(scopes).flat(), [scopes])
  const value = useMemo<CommandRegistry>(
    () => ({ open, setOpen, commands, register, unregister }),
    [open, commands, register, unregister],
  )

  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>
}
