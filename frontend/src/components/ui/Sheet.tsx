import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  widthClassName?: string
}

/** Right-side slide-over drawer -- used by RetrievalInspector so "explain
 * this answer" opens over the chat instead of pushing a whole new section
 * into the page (the old single-page layout's approach). Closes on
 * backdrop click or Escape. */
export function Sheet({ open, onClose, title, description, children, widthClassName = 'max-w-2xl' }: Props) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex h-full w-full flex-col border-l border-border bg-card shadow-2xl animate-slide-in-right',
          widthClassName,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
