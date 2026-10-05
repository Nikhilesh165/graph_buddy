import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { usePresence } from '../../lib/usePresence'
import { Button } from './Button'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  widthClassName?: string
}

const EXIT_MS = 200

/** Right-side slide-over drawer -- used by ChatPage so "explain this
 * answer" opens over the chat instead of replacing it. Closes on backdrop
 * click or Escape, returns focus to whatever opened it, and plays an exit
 * animation instead of vanishing. */
export function Sheet({ open, onClose, title, description, children, widthClassName = 'max-w-3xl' }: Props) {
  const { mounted, closing } = usePresence(open, EXIT_MS)
  const panelRef = useRef<HTMLDivElement>(null)
  // Latest-callback ref: callers pass inline closures, and re-running the
  // focus effect on every parent render would bounce focus around.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={cn('absolute inset-0 bg-scrim', closing ? 'animate-fade-out' : 'animate-fade-in')}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex h-full w-full flex-col border-l border-border bg-background shadow-popover outline-none',
          closing ? 'animate-slide-out-right' : 'animate-slide-in-right',
          widthClassName,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
