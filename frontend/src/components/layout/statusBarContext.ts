import { createContext, useContext } from 'react'

/** The status bar's page-owned slot element (null until mounted). Pages
 * render into it with <StatusBarItem>. */
export const StatusBarContext = createContext<HTMLElement | null>(null)

export function useStatusBarSlot(): HTMLElement | null {
  return useContext(StatusBarContext)
}
