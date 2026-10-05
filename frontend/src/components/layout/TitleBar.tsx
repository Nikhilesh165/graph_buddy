import { useLocation } from 'react-router-dom'
import { ChevronRight, Menu, Search } from 'lucide-react'
import { useCommandPalette } from '../../lib/commandContext'
import { MOD_KEY } from '../../lib/platform'
import { Kbd } from '../ui/Kbd'
import { navItemFor } from './nav'

/** The workspace header above every view: breadcrumb for where you are,
 * and the always-visible entry point to the command palette. */
export function TitleBar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { pathname } = useLocation()
  const item = navItemFor(pathname)
  const Icon = item.icon
  const { setOpen } = useCommandPalette()

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-2 md:px-3">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground md:hidden"
      >
        <Menu className="h-[18px] w-[18px]" />
      </button>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <span className="hidden text-faint-foreground sm:inline">Graph Buddy</span>
        <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-faint-foreground sm:block" aria-hidden="true" />
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <span aria-current="page" className="truncate font-medium text-foreground">
          {item.label}
        </span>
      </nav>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search or jump to (command palette)"
        className="ml-auto flex h-7 items-center gap-2 rounded-md border border-border bg-background-alt px-2 text-[12.5px] text-faint-foreground transition-colors hover:border-border-strong hover:text-muted-foreground sm:w-60"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">Search or jump to…</span>
        <Kbd className="ml-auto hidden sm:inline-flex">{MOD_KEY} K</Kbd>
      </button>
    </header>
  )
}
