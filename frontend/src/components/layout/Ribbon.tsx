import { NavLink } from 'react-router-dom'
import { Command, Moon, PanelLeft, Sun } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useCommandPalette } from '../../lib/commandContext'
import { MOD_KEY } from '../../lib/platform'
import { useTheme } from '../../lib/themeContext'
import { Tooltip } from '../ui/Tooltip'
import { NAV_ITEMS } from './nav'

const ICON_BUTTON =
  'relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground'

/** Obsidian's left ribbon: a thin strip of icon buttons -- sidebar toggle,
 * one per view, and app-level actions pinned to the bottom. */
export function Ribbon({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const { mode, toggle } = useTheme()
  const { setOpen } = useCommandPalette()

  return (
    <nav aria-label="Primary" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-2">
      <Tooltip side="right" label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>
        <button
          type="button"
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
          className={ICON_BUTTON}
        >
          <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
      </Tooltip>
      <div className="my-1 h-px w-5 bg-border" />
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <Tooltip key={to} side="right" label={label}>
          <NavLink
            to={to}
            end={end}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                ICON_BUTTON,
                isActive &&
                  'bg-active text-foreground before:absolute before:-left-1.5 before:top-1.5 before:h-5 before:w-0.5 before:rounded-full before:bg-accent-foreground',
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </NavLink>
        </Tooltip>
      ))}
      <div className="flex-1" />
      <Tooltip side="right" label={`Command palette (${MOD_KEY} K)`}>
        <button type="button" aria-label="Open command palette" onClick={() => setOpen(true)} className={ICON_BUTTON}>
          <Command className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
      </Tooltip>
      <Tooltip side="right" label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
        <button
          type="button"
          aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={toggle}
          className={ICON_BUTTON}
        >
          {mode === 'dark' ? <Sun className="h-[18px] w-[18px]" strokeWidth={1.75} /> : <Moon className="h-[18px] w-[18px]" strokeWidth={1.75} />}
        </button>
      </Tooltip>
    </nav>
  )
}
