import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Monitor, Moon, PanelLeft, Sun, Upload } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useAppData } from '../../lib/appDataContext'
import { useRegisterCommands, type Command } from '../../lib/commandContext'
import { fileIcon } from '../../lib/fileIcon'
import { typeColor } from '../../lib/palette'
import { MOD_KEY } from '../../lib/platform'
import { usePersistentState } from '../../lib/storage'
import { useTheme } from '../../lib/themeContext'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { usePresence } from '../../lib/usePresence'
import { CommandPalette } from '../CommandPalette'
import { NAV_ITEMS } from './nav'
import { Ribbon } from './Ribbon'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { StatusBarContext } from './statusBarContext'
import { TitleBar } from './TitleBar'

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 264

/** The app's workspace, modeled on Obsidian's: icon ribbon, collapsible +
 * resizable explorer sidebar, a title bar over the active view, and a
 * status bar. Every view renders into a full-height `<main>` and owns its
 * own scrolling, so the graph can be full-bleed while document pages keep
 * a readable column. */
export function AppShell() {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [sidebarOpen, setSidebarOpen] = usePersistentState('sidebar.open', true)
  const [sidebarWidth, setSidebarWidth] = usePersistentState('sidebar.width', SIDEBAR_DEFAULT)
  const [resizing, setResizing] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null)
  const location = useLocation()

  // Any navigation closes the mobile drawer.
  const [lastPath, setLastPath] = useState(location.pathname + location.search)
  if (lastPath !== location.pathname + location.search) {
    setLastPath(location.pathname + location.search)
    setMobileNavOpen(false)
  }

  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), [setSidebarOpen])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        setSidebarOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setSidebarOpen])

  useShellCommands(sidebarOpen, toggleSidebar)

  return (
    <StatusBarContext.Provider value={statusSlot}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:shadow-popover"
      >
        Skip to content
      </a>
      <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
        <div className="flex min-h-0 flex-1">
          {isDesktop && <Ribbon sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />}
          {isDesktop && (
            <aside
              aria-label="Explorer"
              inert={!sidebarOpen}
              style={{ width: sidebarOpen ? sidebarWidth : 0 }}
              className={cn(
                'relative shrink-0 overflow-hidden bg-sidebar',
                sidebarOpen && 'border-r border-border',
                !resizing && 'transition-[width] duration-250 ease-out-expo',
              )}
            >
              <div className="h-full" style={{ width: sidebarWidth }}>
                <Sidebar />
              </div>
              {sidebarOpen && (
                <ResizeHandle
                  width={sidebarWidth}
                  onResize={setSidebarWidth}
                  onResizingChange={setResizing}
                  onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
                />
              )}
            </aside>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <TitleBar onOpenMobileNav={() => setMobileNavOpen(true)} />
            <main id="main" tabIndex={-1} className="relative min-h-0 flex-1 overflow-hidden outline-none">
              <Outlet />
            </main>
          </div>
        </div>
        <StatusBar slotRef={setStatusSlot} />
      </div>

      {!isDesktop && <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />}
      <CommandPalette />
    </StatusBarContext.Provider>
  )
}

function ResizeHandle({
  width,
  onResize,
  onResizingChange,
  onReset,
}: {
  width: number
  onResize: (width: number) => void
  onResizingChange: (resizing: boolean) => void
  onReset: () => void
}) {
  const start = useRef<{ x: number; width: number } | null>(null)

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, width }
    onResizingChange(true)
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return
    onResize(Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, start.current.width + e.clientX - start.current.x))))
  }

  function onPointerUp() {
    start.current = null
    onResizingChange(false)
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') onResize(Math.max(SIDEBAR_MIN, width - 16))
    else if (e.key === 'ArrowRight') onResize(Math.min(SIDEBAR_MAX, width + 16))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none transition-colors hover:bg-accent-foreground/30 focus-visible:bg-accent-foreground/40 active:bg-accent-foreground/50"
    />
  )
}

function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mounted, closing } = usePresence(open, 200)
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!mounted) return null
  return (
    <div className="fixed inset-0 z-50">
      <div
        className={cn('absolute inset-0 bg-scrim', closing ? 'animate-fade-out' : 'animate-fade-in')}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={cn(
          'relative h-full w-[288px] max-w-[85vw] border-r border-border bg-sidebar shadow-popover',
          closing ? 'animate-fade-out' : 'animate-slide-in-left',
        )}
      >
        <Sidebar showNav onNavigate={onClose} onClose={onClose} />
      </div>
    </div>
  )
}

/** Navigation, theme, sidebar, entity-type, and source commands for ⌘K. */
function useShellCommands(sidebarOpen: boolean, toggleSidebar: () => void) {
  const navigate = useNavigate()
  const { mode, toggle, setPreference, preference } = useTheme()
  const { ontology, sources } = useAppData()

  const commands = useMemo<Command[]>(() => {
    const entityOrder = ontology?.entity_types.map((et) => et.name) ?? []
    const list: Command[] = NAV_ITEMS.map((item) => ({
      id: `nav:${item.to}`,
      title: item.label,
      subtitle: item.description,
      group: 'Navigation',
      icon: item.icon,
      keywords: `go to open ${item.label}`,
      run: () => navigate(item.to),
    }))
    list.push(
      {
        id: 'theme:toggle',
        title: mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        group: 'Actions',
        icon: mode === 'dark' ? Sun : Moon,
        keywords: 'appearance color scheme dark light mode',
        run: toggle,
      },
      {
        id: 'sidebar:toggle',
        title: sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar',
        group: 'Actions',
        icon: PanelLeft,
        shortcut: [MOD_KEY, '\\'],
        run: toggleSidebar,
      },
      {
        id: 'source:upload',
        title: 'Upload a source',
        group: 'Actions',
        icon: Upload,
        keywords: 'add file document import',
        run: () => navigate('/sources?upload=1'),
      },
    )
    if (preference !== 'system') {
      list.push({
        id: 'theme:system',
        title: 'Match system theme',
        group: 'Actions',
        icon: Monitor,
        keywords: 'appearance automatic os',
        run: () => setPreference('system'),
      })
    }
    for (const et of ontology?.entity_types ?? []) {
      list.push({
        id: `type:${et.name}`,
        title: `Show ${et.name} in graph`,
        group: 'Entity types',
        color: typeColor(mode, entityOrder, et.name),
        keywords: et.description,
        run: () => navigate(`/graph?types=${encodeURIComponent(et.name)}`),
      })
    }
    for (const source of sources ?? []) {
      list.push({
        id: `source:${source.id}`,
        title: source.filename,
        group: 'Sources',
        icon: fileIcon(source.filename),
        subtitle: source.graphiti_status === 'extracted' ? 'extracted' : source.status,
        run: () => navigate(`/sources?focus=${source.id}`),
      })
    }
    return list
  }, [navigate, mode, toggle, preference, setPreference, sidebarOpen, toggleSidebar, ontology, sources])

  useRegisterCommands('shell', commands)
}
