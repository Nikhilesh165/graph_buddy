import type { CSSProperties, ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Props = {
  children: ReactNode
  /** Readable column width in rem (Obsidian's "readable line length"). */
  width?: number
  className?: string
}

/** Scrolling page body with a centered readable-width column -- used by
 * every non-canvas view (Overview, Sources, Ontology). */
export function DocumentPage({ children, width = 52, className }: Props) {
  return (
    <div className="h-full overflow-y-auto">
      <div
        className={cn('readable animate-rise-in px-5 pb-24 pt-10 sm:px-8 lg:pt-14', className)}
        style={{ '--readable-width': `${width}rem` } as CSSProperties}
      >
        {children}
      </div>
    </div>
  )
}
